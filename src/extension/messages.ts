import type { ApplyResult, FacebookPack, FillPlan } from "../browser.ts";

/** Side panel → content script. Every request names the plan hash it acts on, except plan. */
export type PanelRequest =
  | { type: "pagepush:plan"; pack: FacebookPack }
  | { type: "pagepush:draft"; planHash: string }
  | { type: "pagepush:commit"; planHash: string }
  | { type: "pagepush:status" };

export type ContentReply =
  | { ok: true; url: string; plan?: FillPlan; draft?: ApplyResult; committed?: boolean }
  | { ok: false; url?: string; code: string; message: string; applied?: string[] };

export function isPanelRequest(value: unknown): value is PanelRequest {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("pagepush:");
}
