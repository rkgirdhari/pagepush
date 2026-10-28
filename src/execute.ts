import type { ApplyResult, ConfirmToken, FillPlan } from "./types.ts";
import { matchesAction, writeAction } from "./apply.ts";
import { captchaCleared, fileCount } from "./bind.ts";

export class CommitRefused extends Error {
  readonly code: "confirm" | "blocked" | "stale" | "captcha" | "file" | "unconfirmed";

  constructor(code: CommitRefused["code"], message: string) {
    super(message);
    this.name = "CommitRefused";
    this.code = code;
  }
}

export function approve(plan: FillPlan, at = new Date()): ConfirmToken {
  return { planHash: plan.planHash, approvedAt: at.toISOString() };
}

export function executeDraft(doc: Document, plan: FillPlan): ApplyResult {
  const applied: string[] = [];
  const unconfirmed: string[] = [];
  for (const action of plan.actions) {
    if (action.phase !== "draft") continue;
    if (writeAction(doc, action)) applied.push(action.id);
    else unconfirmed.push(action.id);
  }
  return { applied, unconfirmed };
}

export function executeCommit(doc: Document, plan: FillPlan, token: ConfirmToken | undefined): void {
  if (!token || token.planHash !== plan.planHash) {
    throw new CommitRefused("confirm", "Phone confirm does not match this plan.");
  }
  if (plan.errors.length) {
    throw new CommitRefused("blocked", plan.errors.map((item) => item.message).join(" "));
  }
  for (const action of plan.actions) {
    if (action.phase !== "draft") continue;
    if (!matchesAction(doc, action)) {
      throw new CommitRefused("stale", `${action.label} no longer matches the confirmed plan.`);
    }
  }
  for (const gate of plan.gates) {
    if (gate.code === "captcha" && !captchaCleared(doc)) {
      throw new CommitRefused("captcha", gate.message);
    }
    if (gate.code === "file") {
      const el = gate.controlId ? doc.getElementById(gate.controlId) : null;
      if (fileCount(el) < (gate.minFiles ?? 1)) throw new CommitRefused("file", gate.message);
    }
  }
  for (const action of plan.actions) {
    if (action.phase !== "commit") continue;
    if (!writeAction(doc, action)) {
      throw new CommitRefused("unconfirmed", `${action.label} did not stick.`);
    }
  }
}
