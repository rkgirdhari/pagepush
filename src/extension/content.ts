// Content script for facebook.com. It plans, drafts, and commits only when the side panel asks,
// and only against the plan it is holding. Phase 4 persists that plan across Facebook's SPA
// navigation; for now it lives as long as this page.
import { CommitRefused, executeCommit, executeDraft, planFacebook, type FillPlan } from "../browser.ts";
import { isPanelRequest, type ContentReply, type PanelRequest } from "./messages.ts";

let active: FillPlan | null = null;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (reply: ContentReply) => void) => {
  if (!isPanelRequest(message)) return undefined;
  sendResponse(handle(message));
  return undefined;
});

function handle(request: PanelRequest): ContentReply {
  const url = location.href;
  try {
    switch (request.type) {
      case "pagepush:status":
        return active ? { ok: true, url, plan: active } : { ok: true, url };
      case "pagepush:plan":
        active = planFacebook(document, request.pack, url);
        return { ok: true, url, plan: active };
      case "pagepush:draft": {
        const plan = current(request.planHash);
        if (!plan.ok) return plan;
        if (plan.plan.errors.length) {
          return { ok: false, url, code: "blocked", message: "Fix the plan errors before drafting." };
        }
        return { ok: true, url, plan: plan.plan, draft: executeDraft(document, plan.plan) };
      }
      case "pagepush:commit": {
        const plan = current(request.planHash);
        if (!plan.ok) return plan;
        executeCommit(document, plan.plan, { planHash: request.planHash, approvedAt: new Date().toISOString() });
        return { ok: true, url, plan: plan.plan, committed: true };
      }
    }
  } catch (error) {
    if (error instanceof CommitRefused) {
      return { ok: false, url, code: error.code, message: error.message, applied: [...error.applied] };
    }
    return { ok: false, url, code: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

function current(planHash: string): { ok: true; plan: FillPlan } | (ContentReply & { ok: false }) {
  if (!active) {
    return { ok: false, url: location.href, code: "no-plan", message: "This tab has no plan. Plan the page again." };
  }
  if (active.planHash !== planHash) {
    return { ok: false, url: location.href, code: "confirm", message: "The side panel is showing a different plan. Plan the page again." };
  }
  return { ok: true, plan: active };
}
