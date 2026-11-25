import type { ApplyResult, ConfirmToken, FillPlan } from "./types.ts";
import type { RunOptions } from "./debug.ts";
import { matchesAction, writeAction } from "./apply.ts";
import { captchaCleared, fileCount } from "./bind.ts";

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

export function approve(plan: FillPlan, at = new Date()): ConfirmToken {
  return { planHash: plan.planHash, approvedAt: at.toISOString() };
}

export async function executeDraft(doc: Document, plan: FillPlan, options: RunOptions = {}): Promise<ApplyResult> {
  const applied: string[] = [];
  const unconfirmed: string[] = [];
  for (const action of plan.actions) {
    if (action.phase !== "draft") continue;
    let wrote = false;
    try {
      wrote = await writeAction(doc, action, options.settleMs);
    } catch {
      wrote = false;
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

/**
 * Draft actions in `ids` (default: every draft action) whose control no longer holds the planned
 * value. A non-empty result means the page drifted from what the person approved.
 */
export function checkDrift(doc: Document, plan: FillPlan, ids?: readonly string[]): string[] {
  const wanted = ids ? new Set(ids) : null;
  const drifted: string[] = [];
  for (const action of plan.actions) {
    if (action.phase !== "draft" || (wanted && !wanted.has(action.id))) continue;
    let ok = false;
    try {
      ok = matchesAction(doc, action);
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
  options: RunOptions = {},
): Promise<void> {
  const refuse = (code: CommitRefused["code"], message: string, applied: string[] = [], actionId?: string): never => {
    options.trace?.({ phase: "commit", code, actionId });
    throw new CommitRefused(code, message, applied);
  };
  if (!token || token.planHash !== plan.planHash) {
    refuse("confirm", "Phone confirm does not match this plan.");
  }
  if (plan.errors.length) {
    refuse("blocked", plan.errors.map((item) => item.message).join(" "));
  }
  for (const action of plan.actions) {
    if (action.phase !== "draft") continue;
    if (!matchesAction(doc, action)) {
      refuse("stale", `${action.label} no longer matches the confirmed plan.`, [], action.id);
    }
  }
  for (const gate of plan.gates) {
    if (gate.code === "captcha" && !captchaCleared(doc)) {
      refuse("captcha", gate.message, [], gate.fieldId);
    }
    if (gate.code === "file") {
      const el = gate.controlId ? doc.getElementById(gate.controlId) : null;
      if (fileCount(el) < (gate.minFiles ?? 1)) refuse("file", gate.message, [], gate.fieldId);
    }
  }
  const applied: string[] = [];
  for (const action of plan.actions) {
    if (action.phase !== "commit") continue;
    let wrote = false;
    try {
      wrote = await writeAction(doc, action, options.settleMs);
    } catch {
      wrote = false;
    }
    if (!wrote) {
      const earlier = applied.length ? ` Already written: ${applied.join(", ")}.` : "";
      refuse("unconfirmed", `${action.label} did not stick.${earlier}`, applied, action.id);
    }
    applied.push(action.id);
    options.trace?.({ phase: "commit", code: "applied", actionId: action.id });
  }
}
