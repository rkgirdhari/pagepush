// Content-side controller, separate from chrome.* so it is unit-tested against fixtures.
//
// State rules:
// - One active plan per document. A new plan replaces it; its pp-N ids re-bind to this view.
// - Draft and commit only run while the URL is the one the plan was made on.
// - After a draft, a trusted edit to a planned control marks it as drift and tells the panel.
// - A commit consumes the plan: the same approval never clicks Post or Save twice.
import {
  checkDrift,
  CommitRefused,
  executeCommit,
  executeDraft,
  planFacebook,
  type FillPlan,
} from "../browser.ts";
import type { ContentEvent, ContentReply, PanelRequest } from "./messages.ts";

export interface ControllerDeps {
  document: Document;
  location: { href: string };
  notify: (event: ContentEvent) => void;
  /** True for edits a person made. Defaults to Event.isTrusted; tests override it. */
  isUserEdit?: (event: Event) => boolean;
  /** Observe dialogs opening and closing. Defaults to true when MutationObserver exists. */
  watchDialogs?: boolean;
  /** Longest wait per write step for React/Lexical to settle (ms). */
  settleMs?: number;
}

export interface Controller {
  handle(request: PanelRequest): Promise<ContentReply>;
  dispose(): void;
}

export function createController(deps: ControllerDeps): Controller {
  const doc = deps.document;
  const isUserEdit = deps.isUserEdit ?? ((event: Event) => event.isTrusted);
  let active: FillPlan | null = null;
  let drafted = false;
  let drift = new Set<string>();
  let lastUrl = deps.location.href;
  /** A draft or commit in flight. A second one is refused instead of interleaving writes. */
  let working = false;

  const onEdit = (event: Event): void => {
    if (!active || !drafted || !isUserEdit(event)) return;
    const target = event.target as Node | null;
    if (!target) return;
    const hit = active.actions.filter((action) => {
      if (action.phase !== "draft") return false;
      const control = doc.getElementById(action.controlId);
      return control != null && (control === target || control.contains(target));
    });
    if (!hit.length) return;
    // Confirm against the page: an edit that put the planned value back is not drift.
    const changed = checkDrift(doc, active, hit.map((action) => action.id));
    const fresh = changed.filter((id) => !drift.has(id));
    for (const id of changed) drift.add(id);
    if (fresh.length) deps.notify({ type: "pagepush:drift", url: deps.location.href, planHash: active.planHash, fields: fresh });
  };
  doc.addEventListener("input", onEdit, true);
  doc.addEventListener("change", onEdit, true);

  const view = doc.defaultView as (Window & { MutationObserver?: typeof MutationObserver }) | null;
  const Observer = view?.MutationObserver ?? (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
  let observer: MutationObserver | null = null;
  let dialogs = dialogCount();
  if ((deps.watchDialogs ?? true) && typeof Observer === "function") {
    observer = new Observer(() => {
      const count = dialogCount();
      if (deps.location.href !== lastUrl) {
        lastUrl = deps.location.href;
        dialogs = count;
        deps.notify({ type: "pagepush:view-changed", url: lastUrl, reason: "navigated" });
        return;
      }
      if (count !== dialogs) {
        dialogs = count;
        deps.notify({ type: "pagepush:view-changed", url: lastUrl, reason: "dialog" });
      }
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  }

  function dialogCount(): number {
    return doc.querySelectorAll("[role='dialog']").length;
  }

  function state(): { plan?: FillPlan; drafted?: boolean; drift?: string[] } {
    return active ? { plan: active, drafted, drift: [...drift] } : {};
  }

  function current(planHash: string): FillPlan | ContentReply {
    const url = deps.location.href;
    if (!active) return { ok: false, url, code: "no-plan", message: "This tab has no plan. Plan the page again." };
    if (active.planHash !== planHash) {
      return { ok: false, url, code: "confirm", message: "The side panel is showing a different plan. Plan the page again." };
    }
    if (active.pageUrl !== url) {
      return { ok: false, url, code: "context", message: "The page changed since this plan. Plan this view again." };
    }
    return active;
  }

  async function handle(request: PanelRequest): Promise<ContentReply> {
    const url = deps.location.href;
    if (working && (request.type === "pagepush:draft" || request.type === "pagepush:commit" || request.type === "pagepush:plan")) {
      return { ok: false, url, code: "busy", message: "Page Push is still writing to this page. Wait for it to finish." };
    }
    try {
      switch (request.type) {
        case "pagepush:status":
          if (active && active.pageUrl !== url) {
            active = null;
            drafted = false;
            drift = new Set();
          }
          return { ok: true, url, ...state() };
        case "pagepush:plan":
          active = planFacebook(doc, request.pack, url);
          drafted = false;
          drift = new Set();
          dialogs = dialogCount();
          lastUrl = url;
          return { ok: true, url, ...state() };
        case "pagepush:draft": {
          const plan = current(request.planHash);
          if ("ok" in plan) return plan;
          if (plan.errors.length) return { ok: false, url, code: "blocked", message: plan.errors.map((item) => item.message).join(" ") };
          working = true;
          let draft;
          try {
            draft = await executeDraft(doc, plan, { settleMs: deps.settleMs });
          } finally {
            working = false;
          }
          if (active !== plan) return { ok: false, url: deps.location.href, code: "context", message: "The page changed while drafting. Plan this view again." };
          drafted = true;
          drift = new Set();
          return { ok: true, url, draft, ...state() };
        }
        case "pagepush:verify": {
          const plan = current(request.planHash);
          if ("ok" in plan) return plan;
          if (drafted) for (const id of checkDrift(doc, plan)) drift.add(id);
          return { ok: true, url, ...state() };
        }
        case "pagepush:commit": {
          const plan = current(request.planHash);
          if ("ok" in plan) return plan;
          if (drift.size) {
            return { ok: false, url, code: "drift", message: `Changed on the page after drafting: ${[...drift].join(", ")}. Plan again.` };
          }
          // Consume the approval before any click, so a retry or a double click cannot commit twice.
          active = null;
          drafted = false;
          working = true;
          try {
            await executeCommit(doc, plan, { planHash: request.planHash, approvedAt: new Date().toISOString() }, { settleMs: deps.settleMs });
          } catch (error) {
            // Refused before anything was clicked (captcha, missing file, stale field): the plan
            // and its draft still stand, so the person can fix the page and approve again.
            if (error instanceof CommitRefused && error.applied.length === 0 && error.code !== "unconfirmed") {
              active = plan;
              drafted = true;
            }
            throw error;
          } finally {
            working = false;
          }
          return { ok: true, url, plan, committed: true };
        }
      }
    } catch (error) {
      if (error instanceof CommitRefused) {
        return { ok: false, url, code: error.code, message: error.message, applied: [...error.applied] };
      }
      return { ok: false, url, code: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    handle,
    dispose() {
      doc.removeEventListener("input", onEdit, true);
      doc.removeEventListener("change", onEdit, true);
      observer?.disconnect();
    },
  };
}
