import type { ApplyResult, FacebookPack, FillPlan } from "../browser.ts";

/** Side panel → content script. Every request except plan and status names the plan hash it acts on. */
export type PanelRequest =
  | { type: "pagepush:plan"; pack: FacebookPack }
  | { type: "pagepush:draft"; planHash: string }
  | { type: "pagepush:verify"; planHash: string }
  | { type: "pagepush:commit"; planHash: string }
  | { type: "pagepush:status" };

export interface ContentState {
  plan?: FillPlan;
  /** True once this plan was drafted on this document. */
  drafted?: boolean;
  /** Drafted fields the person (or the page) changed afterwards. */
  drift?: string[];
}

export type ContentReply =
  | ({ ok: true; url: string; draft?: ApplyResult; committed?: boolean } & ContentState)
  | { ok: false; url?: string; code: string; message: string; applied?: string[] };

/** Content script → side panel, unprompted. */
export type ContentEvent =
  | { type: "pagepush:drift"; url: string; planHash: string; fields: string[] }
  | { type: "pagepush:view-changed"; url: string; reason: "navigated" | "dialog" };

export function isPanelRequest(value: unknown): value is PanelRequest {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && ["pagepush:plan", "pagepush:draft", "pagepush:verify", "pagepush:commit", "pagepush:status"].includes(type);
}

export function isContentEvent(value: unknown): value is ContentEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "pagepush:drift" || type === "pagepush:view-changed";
}
