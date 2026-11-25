import type { ApplyResult, ConfirmToken, FillPlan } from "./types.ts";
import type { RunOptions } from "./debug.ts";
import { matchesAction, writeAction } from "./apply.ts";
import { captchaCleared, fileCount, locate } from "./bind.ts";
import { planGateValid, planInstanceId, planTargetValid } from "./plan.ts";

export class CommitRefused extends Error {
  readonly code: "confirm" | "blocked" | "stale" | "captcha" | "file" | "unconfirmed";
  /** Commit actions that already wrote before this refusal. Invites in this list were sent. */
  readonly applied: readonly string[];

  constructor(code: CommitRefused["code"], message: string, applied: string[] = []) {
    super(message);
    this.name = "CommitRefused";
    this.code = code;
    this.applied = applied;
  }
}

/** An optional live URL is provided by the controller, including for SPA navigation. */
type ExecutionOptions = RunOptions & { currentUrl?: () => string; isCurrent?: () => boolean };
class UnsafeMutation extends Error {}

function contextValid(doc: Document, plan: FillPlan, options: ExecutionOptions): boolean {
  return planTargetValid(doc, plan)
    && (!options.currentUrl || options.currentUrl() === plan.pageUrl)
    && (!options.isCurrent || options.isCurrent());
}

export function approve(plan: FillPlan, at = new Date()): ConfirmToken {
  return { planHash: plan.planHash, approvedAt: at.toISOString(), instanceId: planInstanceId(plan) } as ConfirmToken;
}

export async function executeDraft(doc: Document, plan: FillPlan, options: ExecutionOptions = {}): Promise<ApplyResult> {
  const applied: string[] = [];
  const unconfirmed: string[] = [];
  const actions = plan.actions.filter((action) => action.phase === "draft");
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]!;
    const guard = (target?: Element): void => {
      if (!contextValid(doc, plan, options) || !planTargetValid(doc, plan, action, target)) throw new UnsafeMutation();
    };
    let wrote = false;
    try {
      wrote = await writeAction(doc, action, options.settleMs, guard);
      guard();
    } catch (error) {
      if (error instanceof UnsafeMutation) {
        unconfirmed.push(...actions.slice(index).map((item) => item.id));
        options.trace?.({ phase: "draft", code: "stale", actionId: action.id });
        break;
      }
      options.trace?.({ phase: "draft", code: "threw", actionId: action.id });
    }
    if (wrote) {
      applied.push(action.id);
      options.trace?.({ phase: "draft", code: "applied", actionId: action.id });
    } else {
      unconfirmed.push(action.id);
      options.trace?.({ phase: "draft", code: "unconfirmed", actionId: action.id });
    }
  }
  return { applied, unconfirmed };
}

export function checkDrift(doc: Document, plan: FillPlan, ids?: readonly string[]): string[] {
  const wanted = ids ? new Set(ids) : null;
  const drifted: string[] = [];
  for (const action of plan.actions) {
    if (action.phase !== "draft" || (wanted && !wanted.has(action.id))) continue;
    let ok = false;
    try {
      ok = planTargetValid(doc, plan, action) && matchesAction(doc, action);
    } catch {
      ok = false;
    }
    if (!ok) drifted.push(action.id);
  }
  return drifted;
}

export async function executeCommit(
  doc: Document,
  plan: FillPlan,
  token: ConfirmToken | undefined,
  options: ExecutionOptions = {},
): Promise<void> {
  const refuse = (code: CommitRefused["code"], message: string, applied: string[] = [], actionId?: string): never => {
    options.trace?.({ phase: "commit", code, actionId });
    throw new CommitRefused(code, message, applied);
  };
  const instance = planInstanceId(plan);
  if (!token || instance == null || token.planHash !== plan.planHash || (token as ConfirmToken & { instanceId?: string }).instanceId !== instance) {
    refuse("confirm", "Phone confirm does not match this plan.");
  }
  if (!contextValid(doc, plan, options)) refuse("stale", "The page changed since this plan. Plan this view again.");
  if (plan.errors.length) refuse("blocked", plan.errors.map((item) => item.message).join(" "));
  for (const action of plan.actions) {
    if (action.phase !== "draft") continue;
    if (!planTargetValid(doc, plan, action) || !matchesAction(doc, action)) {
      refuse("stale", `${action.label} no longer matches the confirmed plan.`, [], action.id);
    }
  }
  if (!captchaCleared(doc)) {
    const gate = plan.gates.find((item) => item.code === "captcha");
    refuse("captcha", gate?.message ?? "Solve the captcha on the page yourself, then click Approve & Commit again.");
  }
  for (const gate of plan.gates) {
    if (gate.code !== "file") continue;
    const el = gate.controlId && planGateValid(doc, plan, gate.controlId) ? locate(doc, gate.controlId) : null;
    if (fileCount(el) < (gate.minFiles ?? 1)) refuse("file", gate.message, [], gate.fieldId);
  }
  const applied: string[] = [];
  for (const action of plan.actions) {
    if (action.phase !== "commit") continue;
    const guard = (target?: Element): void => {
      if (!contextValid(doc, plan, options) || !planTargetValid(doc, plan, action, target) || !captchaCleared(doc)) throw new UnsafeMutation();
      for (const gate of plan.gates) {
        if (gate.code !== "file") continue;
        const el = gate.controlId && planGateValid(doc, plan, gate.controlId) ? locate(doc, gate.controlId) : null;
        if (fileCount(el) < (gate.minFiles ?? 1)) throw new UnsafeMutation();
      }
    };
    let wrote = false;
    try {
      wrote = await writeAction(doc, action, options.settleMs, guard);
      guard();
    } catch {
      wrote = false;
    }
    if (!wrote) {
      const earlier = applied.length ? ` Already written: ${applied.join(", ")}.` : "";
      refuse("unconfirmed", `${action.label} did not stick or the page changed; it may have already been activated. Plan again.${earlier}`, applied, action.id);
    }
    applied.push(action.id);
    options.trace?.({ phase: "commit", code: "applied", actionId: action.id });
  }
}
