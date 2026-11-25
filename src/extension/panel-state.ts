// Side panel state and the rules that decide when Draft and Approve & Commit are allowed.
// Pure functions so the approval rules are unit-tested without Chrome.
import type { ApplyResult, FacebookPack, FillPlan } from "../browser.ts";
import { fieldById, packFingerprint, starterPack } from "./packs.ts";
import { receiptEntry, type ReceiptEntry } from "./receipt.ts";
import type { PackVersion } from "./version-history.ts";

export interface Checklist {
  /** The operator read every drafted field on the Facebook page. Reset on every draft. */
  reviewedPage: boolean;
  profilePicture: boolean;
  coverPhoto: boolean;
}

export interface ProgressEntry {
  fieldId: string;
  label: string;
  status: "drafted" | "attempted" | "committed"; // committed is a legacy, unverified status
  url: string;
  planHash: string;
  at: string;
}

export interface Session {
  tabId: number;
  url: string;
  plan: FillPlan;
  /** Fingerprint of the cleaned pack this plan was made from. */
  packPrint: string;
  drafted?: { at: string; applied: string[]; unconfirmed: string[] };
  drift: string[];
  /** Why this plan can no longer be drafted or committed. */
  stale?: string;
  committedAt?: string;
}

export interface RecordArchive {
  pageName: string;
  tier: FacebookPack["tier"];
  receipts: ReceiptEntry[];
  progress: ProgressEntry[];
  /** Legacy records may already have been mixed; never attribute them to the current pack. */
  unverifiedOwner?: boolean;
}

export interface PanelState {
  pack: FacebookPack;
  checklist: Checklist;
  progress: ProgressEntry[];
  session: Session | null;
  /** One audit entry per Approve & Commit click, exported as the sprint receipt. */
  receipts: ReceiptEntry[];
  /** Explicit snapshots of client-pack values stored only on this device. */
  versions: PackVersion[];
  archives?: RecordArchive[];
}

export interface Context {
  /** The tab the side panel would talk to right now. */
  activeTabId: number | null;
}

export interface Readiness {
  ok: boolean;
  reasons: string[];
}

export function initialState(): PanelState {
  return {
    pack: starterPack("standard"),
    checklist: { reviewedPage: false, profilePicture: false, coverPhoto: false },
    progress: [],
    session: null,
    receipts: [],
    versions: [],
  };
}

export function startSession(state: PanelState, tabId: number, plan: FillPlan, submittedPrint = packFingerprint(state.pack)): PanelState {
  return {
    ...state,
    checklist: { ...state.checklist, reviewedPage: false },
    session: { tabId, url: plan.pageUrl, plan, packPrint: submittedPrint, drift: [] },
  };
}

/** Marks the plan unusable. Approval never survives a context change. */
export function invalidate(state: PanelState, reason: string): PanelState {
  if (!state.session || state.session.stale || state.session.committedAt) return state;
  return { ...state, session: { ...state.session, stale: reason } };
}

export function archiveRecords(state: PanelState, unverifiedOwner = false): PanelState {
  if (!state.progress.length && !(state.receipts ?? []).length) return state;
  const archive: RecordArchive = {
    pageName: unverifiedOwner ? "" : (state.pack.page?.name?.trim() ?? ""),
    tier: state.pack.tier,
    progress: structuredClone(state.progress), receipts: structuredClone(state.receipts ?? []),
    ...(unverifiedOwner ? { unverifiedOwner: true } : {}),
  };
  return { ...state, archives: [...(state.archives ?? []), archive], progress: [], receipts: [] };
}

/** Explicit replacement always creates a fresh work context, even for identical pack contents. */
export function replacePack(state: PanelState, pack: FacebookPack): PanelState {
  return { ...archiveRecords(state), pack, session: null,
    checklist: { reviewedPage: false, profilePicture: false, coverPhoto: false } };
}

export function editPack(state: PanelState, pack: FacebookPack): PanelState {
  if ((state.pack.page?.name ?? "").trim() !== (pack.page?.name ?? "").trim()) {
    return replacePack(state, pack);
  }
  return { ...state, pack };
}

export function recordDraft(state: PanelState, result: ApplyResult, at = new Date()): PanelState {
  const session = state.session;
  if (!session) return state;
  const stamp = at.toISOString();
  const drafted = session.plan.actions.filter((action) => result.applied.includes(action.id));
  return {
    ...state,
    checklist: { ...state.checklist, reviewedPage: false },
    session: { ...session, drafted: { at: stamp, applied: [...result.applied], unconfirmed: [...result.unconfirmed] }, drift: [] },
    progress: mergeProgress(state.progress, drafted.map((action) => ({
      fieldId: action.id,
      label: action.label,
      status: "drafted" as const,
      url: session.url,
      planHash: session.plan.planHash,
      at: stamp,
    }))),
  };
}

export function recordDrift(state: PanelState, planHash: string, fields: string[]): PanelState {
  const session = state.session;
  if (!session || session.plan.planHash !== planHash || !fields.length) return state;
  return { ...state, session: { ...session, drift: [...new Set([...session.drift, ...fields])] } };
}

/**
 * A commit that ran. `approvedAt` is when the person clicked Approve & Commit; it goes into the
 * sprint receipt with the drafted and committed fields and the checklist as ticked.
 */
export function recordCommit(state: PanelState, at = new Date(), approvedAt = at): PanelState {
  const session = state.session;
  if (!session) return state;
  const stamp = at.toISOString();
  const done = session.plan.actions.filter((action) => action.phase === "commit" || session.drafted?.applied.includes(action.id));
  const receipt = receiptEntry({ session, pack: state.pack, checklist: state.checklist, approvedAt, finishedAt: at, outcome: "attempted" });
  return {
    ...state,
    receipts: [...(state.receipts ?? []), receipt],
    session: { ...session, committedAt: stamp },
    progress: mergeProgress(state.progress, done.map((action) => ({
      fieldId: action.id,
      label: action.label,
      status: "attempted" as const,
      url: session.url,
      planHash: session.plan.planHash,
      at: stamp,
    }))),
  };
}

/**
 * An approval that did not fully commit. With nothing applied, the plan and its draft still stand
 * (the person can fix the page and approve again). With some steps applied, those are recorded as
 * committed and the plan is closed, since the page no longer matches what was approved.
 */
export function recordCommitRefused(
  state: PanelState,
  input: { code: string; message: string; applied?: string[]; approvedAt: Date; at?: Date },
): PanelState {
  const session = state.session;
  if (!session) return state;
  const at = input.at ?? new Date();
  const applied = input.applied ?? [];
  const outcome = applied.length || ["unconfirmed", "unknown-dispatch", "error"].includes(input.code) ? "partial" : "refused";
  const receipt = receiptEntry({
    session,
    pack: state.pack,
    checklist: state.checklist,
    approvedAt: input.approvedAt,
    finishedAt: at,
    outcome,
    committedIds: applied,
    refusal: { code: input.code, message: input.message },
  });
  const next: PanelState = { ...state, receipts: [...(state.receipts ?? []), receipt] };
  if (outcome === "refused") return next;
  const stamp = at.toISOString();
  const done = session.plan.actions.filter((action) => applied.includes(action.id) || session.drafted?.applied.includes(action.id));
  return invalidate({
    ...next,
    progress: mergeProgress(state.progress, done.map((action) => ({
      fieldId: action.id,
      label: action.label,
      status: "attempted" as const,
      url: session.url,
      planHash: session.plan.planHash,
      at: stamp,
    }))),
  }, "Part of this commit ran or may have run. Check Facebook before planning again; do not retry blindly.");
}

/** One entry per field: committed beats drafted, newer beats older. */
function mergeProgress(existing: ProgressEntry[], updates: ProgressEntry[]): ProgressEntry[] {
  const byField = new Map(existing.map((entry) => [entry.fieldId, entry]));
  for (const entry of updates) {
    const prior = byField.get(entry.fieldId);
    if (prior?.status === "committed" && entry.status === "drafted" && prior.planHash !== entry.planHash) {
      byField.set(entry.fieldId, entry);
      continue;
    }
    if (prior?.status === "committed" && entry.status === "drafted") continue;
    byField.set(entry.fieldId, entry);
  }
  return [...byField.values()];
}

function sessionBlocks(state: PanelState, context: Context): string[] {
  const session = state.session;
  if (!session) return ["Plan this view first."];
  const reasons: string[] = [];
  if (session.committedAt) reasons.push("This plan was already attempted. Check Facebook before planning another view.");
  if (session.stale) reasons.push(session.stale);
  if (context.activeTabId !== session.tabId) reasons.push("Switch back to the Facebook tab you planned, or plan this tab.");
  if (packFingerprint(state.pack) !== session.packPrint) reasons.push("The pack changed after planning. Plan again.");
  if (session.plan.errors.length) reasons.push("Fix the plan errors first.");
  return reasons;
}

export function draftReadiness(state: PanelState, context: Context): Readiness {
  const reasons = sessionBlocks(state, context);
  if (state.session && !state.session.plan.actions.some((action) => action.phase === "draft")) {
    reasons.push("Nothing to draft on this view.");
  }
  return { ok: reasons.length === 0, reasons };
}

export function commitReadiness(state: PanelState, context: Context): Readiness {
  const reasons = sessionBlocks(state, context);
  const session = state.session;
  if (session && !session.committedAt) {
    const plan = session.plan;
    const hasDraftActions = plan.actions.some((action) => action.phase === "draft");
    if (!plan.actions.some((action) => action.phase === "commit")) {
      reasons.push("No Create Page, Save, or Post button on this view, so there is nothing to commit.");
    }
    if (hasDraftActions && !session.drafted) reasons.push("Draft first, then read the page.");
    if (session.drafted?.unconfirmed.length) {
      reasons.push(`These did not stick, so the page does not match the plan: ${labels(plan, session.drafted.unconfirmed)}. Fix the pack or paste them, then plan again.`);
    }
    if (session.drift.length) {
      reasons.push(`Changed on the page after drafting: ${labels(plan, session.drift)}. Plan again to approve the page as it is now.`);
    }
    if (!state.checklist.reviewedPage) reasons.push("Tick \"I read every drafted field on the page\".");
    for (const gate of plan.gates) {
      if (gate.code !== "file") continue;
      if (gate.fieldId === "profilePicture" && !state.checklist.profilePicture) reasons.push("Upload the profile picture on the page and tick it in the checklist.");
      if (gate.fieldId === "coverPhoto" && !state.checklist.coverPhoto) reasons.push("Upload the cover photo on the page and tick it in the checklist.");
    }
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

function labels(plan: FillPlan, ids: string[]): string {
  return ids.map((id) => plan.actions.find((action) => action.id === id)?.label ?? safeLabel(id)).join(", ");
}

function safeLabel(id: string): string {
  try {
    return fieldById(id).labels[0] ?? id;
  } catch {
    return id;
  }
}

export type Tone = "info" | "good" | "warn" | "bad";

export interface Banner {
  tone: Tone;
  title: string;
  detail?: string;
}

/** Turns a connection failure or a content-script refusal code into something an operator can act on. */
export function bannerFor(code: string, message?: string): Banner {
  switch (code) {
    case "no-receiver":
      return { tone: "warn", title: "Page Push is not running in this tab yet.", detail: "Reload the Facebook tab (F5), wait for it to finish loading, then try again." };
    case "not-facebook-tab":
      return { tone: "warn", title: "This tab is not Facebook.", detail: "Open your Facebook Business Page (creation, settings, or composer) in this window and focus that tab." };
    case "no-tab":
      return { tone: "warn", title: "No tab to work with.", detail: "Click into the Facebook tab, then try again." };
    case "disconnected":
      return { tone: "warn", title: "The Facebook tab closed or navigated away.", detail: "Open the Page view again and plan it." };
    case "not-facebook":
    case "page-identity":
    case "not-business-page":
    case "sign-in":
      return { tone: "bad", title: "Page Push refused this view.", detail: message };
    case "context":
      return { tone: "warn", title: "The page changed since this plan.", detail: "Plan this view again. The earlier approval no longer applies." };
    case "no-plan":
      return { tone: "warn", title: "The tab lost its plan (it reloaded).", detail: "Plan this view again." };
    case "drift":
      return { tone: "bad", title: "A drafted field changed on the page.", detail: message ?? "Plan again to approve the page as it is now." };
    case "confirm":
      return { tone: "bad", title: "The tab is holding a different plan.", detail: "Plan again so the panel and the page agree." };
    case "captcha":
      return { tone: "warn", title: "Solve the captcha on the page.", detail: "Page Push never solves captchas. Solve it yourself, then Approve & Commit again." };
    case "file":
      return { tone: "warn", title: "A required image is not attached yet.", detail: message };
    case "stale":
      return { tone: "bad", title: "The page no longer matches the approved plan.", detail: message };
    case "unconfirmed":
      return { tone: "bad", title: "A commit step did not stick.", detail: message };
    case "blocked":
      return { tone: "bad", title: "The plan has errors.", detail: message };
    case "busy":
      return { tone: "info", title: "Still writing to the page.", detail: "Wait for the current draft or commit to finish." };
    default:
      return { tone: "bad", title: "Something went wrong.", detail: message };
  }
}
