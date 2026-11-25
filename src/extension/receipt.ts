// Sprint receipts: a local audit trail of every Approve & Commit, exportable as JSON for the
// client. One entry per approval, whether the commit ran, ran in part, or was refused before any
// click. Entries hold field ids and labels, never field values, passwords, or page content. The
// export carries a SHA-256 over its own body so an edited receipt is easy to spot.
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
  /** "committed": every commit step ran. "partial": some ran before a refusal. "refused": none ran. */
  outcome: "committed" | "partial" | "refused";
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
  tier: FacebookTier;
  offer: { name: string; priceUsd: number } | null;
  /** What the person confirmed by clicking Approve & Commit. */
  approvalStatement: string;
  entries: ReceiptEntry[];
  totals: { approvals: number; committed: number; partial: number; refused: number; fieldsCommitted: number };
  /** SHA-256 (hex) of this object without the hash field, keys sorted. */
  sha256: string;
}

export const APPROVAL_STATEMENT =
  "Each entry was approved by a person clicking Approve & Commit in the Page Push side panel for that exact plan hash, after the drafted fields were reviewed on the open Facebook page. Page Push does not submit, save, or post without that click.";

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
  const ran = input.outcome === "committed" ? commitIds : (input.committedIds ?? []).filter((id) => commitIds.includes(id));
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
    // Drafted fields are committed with the commit step that saves them; a refusal commits none.
    committed: input.outcome === "refused" ? [] : [...drafted.map(ref), ...ran.map(ref)],
    checklist: {
      ...input.checklist,
      profilePictureRequired: pack.media?.profilePicture === "required",
      coverPhotoRequired: pack.media?.coverPhoto === "required",
    },
  };
}

export function buildSprintReceipt(input: { pack: FacebookPack; entries: ReceiptEntry[]; now?: Date; extensionVersion: string }): SprintReceipt {
  const offer = tierOffer(input.pack.tier);
  const entries = [...input.entries];
  const body: Omit<SprintReceipt, "sha256"> = {
    format: RECEIPT_FORMAT,
    version: RECEIPT_VERSION,
    extension: { name: "Page Push", version: input.extensionVersion },
    schemaVersion: facebookSchema.version,
    generatedAt: (input.now ?? new Date()).toISOString(),
    pageName: input.pack.page?.name?.trim() ?? "",
    tier: input.pack.tier,
    offer: offer ? { name: offer.name, priceUsd: offer.priceUsd } : null,
    approvalStatement: APPROVAL_STATEMENT,
    entries,
    totals: {
      approvals: entries.length,
      committed: entries.filter((entry) => entry.outcome === "committed").length,
      partial: entries.filter((entry) => entry.outcome === "partial").length,
      refused: entries.filter((entry) => entry.outcome === "refused").length,
      fieldsCommitted: new Set(entries.flatMap((entry) => entry.committed.map((field) => field.id))).size,
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

