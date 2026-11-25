// Sprint receipts record approvals that reach the commit step; earlier verification failures can
// leave no entry. Outcomes are attempted, partial, or refused, not confirmation from Facebook.
// Exports include the Page name when attributable, a redacted URL that may identify the Page,
// field ids and labels, and possible refusal text; that text may contain sensitive information.
// Drafted values are not separately exported. SHA-256 is a checksum, not a signature, and can be
// recomputed. Review receipts before sharing them.
import { facebookContext, facebookSchema, sha256, tierOffer, type FacebookPack, type FacebookTier } from "../browser.ts";
import type { Checklist, Session } from "./panel-state.ts";

export const RECEIPT_FORMAT = "pagepush.sprint-receipt";
export const RECEIPT_VERSION = 1;

export interface FieldRef {
  id: string;
  label: string;
}

export interface ReceiptEntry {
  planHash: string;
  /** Legacy committed entries are normalized to attempted on export; no server confirmation exists. */
  outcome: "attempted" | "committed" | "partial" | "refused";
  /** Why a commit was refused or stopped, as the page reported it. */
  refusal?: { code: string; message: string };
  tier: FacebookTier;
  offer: { name: string; priceUsd: number } | null;
  pageUrl: string;
  view: "create" | "page" | "off-site";
  /** When the person clicked Approve & Commit for this plan hash. */
  approvedAt: string;
  draftedAt: string | null;
  finishedAt: string;
  drafted: FieldRef[];
  unconfirmed: FieldRef[];
  committed: FieldRef[];
  attempted?: FieldRef[];
  checklist: Checklist & { profilePictureRequired: boolean; coverPhotoRequired: boolean };
}

export interface SprintReceipt {
  format: typeof RECEIPT_FORMAT;
  version: typeof RECEIPT_VERSION;
  extension: { name: "Page Push"; version: string };
  /** The Facebook schema version (verified labels and limits) the plans were made with. */
  schemaVersion: string;
  generatedAt: string;
  pageName: string;
  tier: FacebookTier | null;
  offer: { name: string; priceUsd: number } | null;
  attribution: "current-pack" | "unknown-may-be-mixed";
  /** What the person confirmed by clicking Approve & Commit. */
  approvalStatement: string;
  entries: ReceiptEntry[];
  totals: { approvals: number; committed: number; attempted: number; partial: number; refused: number; fieldsCommitted: number; fieldsAttempted: number };
  /** SHA-256 (hex) of this object without the hash field, keys sorted. */
  sha256: string;
}

export const APPROVAL_STATEMENT =
  "Each entry records a person clicking Approve & Commit for that plan. Dispatched actions are attempts, not proof Facebook saved or published anything. Check Facebook directly; do not retry blindly. Earlier records may have uncertain ownership.";

export function receiptEntry(input: {
  session: Session;
  pack: FacebookPack;
  checklist: Checklist;
  approvedAt: Date;
  finishedAt: Date;
  outcome: ReceiptEntry["outcome"];
  /** Commit-phase action ids that ran. Defaults to every commit step for a full commit. */
  committedIds?: string[];
  refusal?: ReceiptEntry["refusal"];
}): ReceiptEntry {
  const { session, pack } = input;
  const plan = session.plan;
  const ref = (id: string): FieldRef => ({ id, label: plan.actions.find((action) => action.id === id)?.label ?? id });
  const commitIds = plan.actions.filter((action) => action.phase === "commit").map((action) => action.id);
  const ran = input.outcome === "attempted" || input.outcome === "committed" ? commitIds : (input.committedIds ?? []).filter((id) => commitIds.includes(id));
  const drafted = session.drafted?.applied ?? [];
  const offer = tierOffer(pack.tier);
  return {
    planHash: plan.planHash,
    outcome: input.outcome,
    ...(input.refusal ? { refusal: input.refusal } : {}),
    tier: pack.tier,
    offer: offer ? { name: offer.name, priceUsd: offer.priceUsd } : null,
    pageUrl: redactUrl(session.url),
    view: facebookContext(session.url),
    approvedAt: input.approvedAt.toISOString(),
    draftedAt: session.drafted?.at ?? null,
    finishedAt: input.finishedAt.toISOString(),
    drafted: drafted.map(ref),
    unconfirmed: (session.drafted?.unconfirmed ?? []).map(ref),
    committed: [],
    attempted: input.outcome === "refused" ? [] : [...drafted.map(ref), ...ran.map(ref)],
    checklist: {
      ...input.checklist,
      profilePictureRequired: pack.media?.profilePicture === "required",
      coverPhotoRequired: pack.media?.coverPhoto === "required",
    },
  };
}

export function buildSprintReceipt(input: { pack: FacebookPack; entries: ReceiptEntry[]; now?: Date; extensionVersion: string; unattributed?: boolean }): SprintReceipt {
  const offer = tierOffer(input.pack.tier);
  const entries = input.entries.map((entry): ReceiptEntry => ({
    ...entry,
    outcome: entry.outcome === "committed" ? "attempted" : entry.outcome,
    attempted: entry.attempted ?? entry.committed ?? [],
    committed: [],
  }));
  const body: Omit<SprintReceipt, "sha256"> = {
    format: RECEIPT_FORMAT,
    version: RECEIPT_VERSION,
    extension: { name: "Page Push", version: input.extensionVersion },
    schemaVersion: facebookSchema.version,
    generatedAt: (input.now ?? new Date()).toISOString(),
    pageName: input.unattributed ? "" : (input.pack.page?.name?.trim() ?? ""),
    tier: input.unattributed ? null : input.pack.tier,
    offer: !input.unattributed && offer ? { name: offer.name, priceUsd: offer.priceUsd } : null,
    attribution: input.unattributed ? "unknown-may-be-mixed" : "current-pack",
    approvalStatement: APPROVAL_STATEMENT,
    entries,
    totals: {
      approvals: entries.length,
      committed: 0,
      attempted: entries.filter((entry) => entry.outcome === "attempted").length,
      partial: entries.filter((entry) => entry.outcome === "partial").length,
      refused: entries.filter((entry) => entry.outcome === "refused").length,
      fieldsCommitted: 0,
      fieldsAttempted: new Set(entries.flatMap((entry) => (entry.attempted ?? []).map((field) => field.id))).size,
    },
  };
  return { ...body, sha256: sha256(body) };
}

/** True when the receipt's hash matches its body: nothing was edited after export. */
export function verifySprintReceipt(receipt: SprintReceipt): boolean {
  const { sha256: claimed, ...body } = receipt;
  return typeof claimed === "string" && sha256(body) === claimed;
}

export function receiptFileName(receipt: SprintReceipt): string {
  const slug = receipt.pageName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "page";
  return `pagepush-receipt-${slug}-${receipt.generatedAt.slice(0, 10)}.json`;
}

/**
 * Keeps the Facebook path and the view-selecting query keys, drops everything else (tracking and
 * session parameters). A Page's numeric id stays: it identifies the client's Page, not a person.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const keep = new URLSearchParams();
    for (const key of ["id", "sk"]) {
      const value = parsed.searchParams.get(key);
      if (value) keep.set(key, value);
    }
    const query = keep.toString();
    return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "";
  }
}

