import type { Control, FieldSchema, FillPlan, PlanIssue, PlatformSchema } from "../types.ts";
import { facebookSchema } from "../schema.ts";
import { buildPlan, type PlanDraft } from "../plan.ts";
import { isButtonControl, labelMatches, visibleText, type Page } from "../bind.ts";
import { asStringList, isBlank } from "../validate.ts";
import { dedupe, getPath, issue, labelKey } from "../util.ts";

export type FacebookTier = "essentials" | "standard" | "launch";
export type MediaNeed = "required" | "optional";
export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface FacebookPack {
  tier: FacebookTier;
  page: {
    name: string;
    /** Up to three, each matching an option Facebook lists. */
    categories: string[];
    bio?: string;
  };
  contact?: {
    website?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    zip?: string;
  };
  hours?: {
    mode: string;
    /** Opening times per day, for the person to set by hand. Not written by the shim in v1. */
    schedule?: Partial<Record<Weekday, string>>;
  };
  cta?: { type: string; url?: string };
  launchPost?: { text: string };
  media?: { profilePicture?: MediaNeed; coverPhoto?: MediaNeed };
  /** Which commit actions the person wants after Approve & Commit. Defaults are filled in by prepareFacebookPack. */
  commit?: {
    createPage?: boolean;
    saveChanges?: boolean;
    saveActionButton?: boolean;
    publishLaunchPost?: boolean;
  };
}

interface TierRule {
  name: string;
  priceUsd: number;
  promise: string;
  fields: string[];
}

const WEEK: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const SECRET_KEY = /^(pass(word)?|passcode|token|access[_-]?token|secret|otp|2fa|two[_-]?factor|cookie|session)$/i;
const SECRET_VALUE = /private key|begin [a-z ]*private|EAA[A-Za-z0-9]{20,}|sk_live_|api[_ -]?key|password\s*[:=]/i;

export function facebookTiers(schema: PlatformSchema = facebookSchema): Record<FacebookTier, TierRule> {
  return (schema.rules?.tiers ?? {}) as Record<FacebookTier, TierRule>;
}

export function tierOffer(tier: FacebookTier): PlatformSchema["offer"] | null {
  const rule = facebookTiers()[tier];
  return rule ? { name: rule.name, priceUsd: rule.priceUsd, promise: rule.promise } : null;
}

/**
 * Trims and dedupes the pack, fills commit defaults, and drops values the tier does not cover.
 * Never invents a value: anything dropped is named in `issues`.
 */
export function prepareFacebookPack(pack: FacebookPack): { pack: FacebookPack; issues: PlanIssue[] } {
  const issues: PlanIssue[] = [];
  const next = structuredClone(pack);
  const rule = facebookTiers()[next.tier];
  if (!rule) {
    issues.push(issue("error", "tier", "tier", `Unknown tier "${String(next.tier)}". Use essentials, standard, or launch.`));
  }

  next.page.name = (next.page.name ?? "").trim();
  next.page.categories = dedupe((next.page.categories ?? []).map((item) => item.trim()).filter(Boolean));
  if (next.page.bio != null) next.page.bio = next.page.bio.trim();
  if (next.contact) {
    for (const key of Object.keys(next.contact) as (keyof NonNullable<FacebookPack["contact"]>)[]) {
      const value = next.contact[key];
      if (typeof value === "string") next.contact[key] = value.trim();
    }
  }
  // The panel's Not set choice can leave a schedule without a mode. Do not draft it.
  if (next.hours && (typeof next.hours.mode !== "string" || !next.hours.mode.trim())) delete next.hours;
  else if (next.hours) next.hours.mode = next.hours.mode.trim();
  if (next.cta) {
    next.cta.type = next.cta.type.trim();
    if (next.cta.url != null) next.cta.url = next.cta.url.trim();
  }
  if (next.launchPost) next.launchPost.text = next.launchPost.text.trim();

  next.commit = {
    createPage: next.commit?.createPage ?? true,
    saveChanges: next.commit?.saveChanges ?? true,
    saveActionButton: next.commit?.saveActionButton ?? Boolean(next.cta?.type),
    publishLaunchPost: next.commit?.publishLaunchPost ?? Boolean(next.launchPost?.text),
  };

  if (rule) {
    for (const field of facebookSchema.fields) {
      if (rule.fields.includes(field.id)) continue;
      const value = getPath(next, field.path);
      if (isBlank(value) || value === false) continue;
      unsetPath(next as unknown as Record<string, unknown>, field.path);
      if (field.phase === "commit") continue;
      issues.push(issue(
        "warning",
        field.id,
        "out-of-tier",
        `${field.labels[0]} is not part of the ${rule.name.split(": ").pop()} tier and was left out.`,
      ));
    }
  }
  return { pack: next, issues };
}

/** Pack-level checks that do not need the page. Errors here block the plan. */
export function assessFacebook(pack: FacebookPack): PlanIssue[] {
  const issues: PlanIssue[] = [];
  for (const path of secretPaths(pack)) {
    issues.push(issue("error", path, "secret", `The pack holds something that looks like a credential at ${path}. Remove it; do not enter sign-in details in a pack.`));
  }
  if (!pack.page?.name?.trim()) issues.push(issue("error", "pageName", "required", "The pack needs the Page name."));
  const categories = asStringList(pack.page?.categories) ?? [];
  if (!categories.length) issues.push(issue("error", "categories", "required", "The pack needs at least one Page category."));
  const modes = (facebookSchema.rules?.hoursModes ?? []) as string[];
  const hoursMode = typeof pack.hours?.mode === "string" ? pack.hours.mode.trim() : "";
  if (hoursMode && !modes.some((mode) => labelKey(mode) === labelKey(hoursMode))) {
    issues.push(issue("error", "hoursMode", "enum", `Hours must be one of: ${modes.join(", ")}.`));
  }
  if (pack.hours?.schedule && labelKey(hoursMode) !== labelKey("Open on selected hours")) {
    issues.push(issue("warning", "hoursMode", "schedule-ignored", "Opening times only apply to \"Open on selected hours\"."));
  }
  if (pack.cta && !pack.cta.url && !/call|message|email/i.test(pack.cta.type)) {
    issues.push(issue("warning", "ctaUrl", "cta-url", `The "${pack.cta.type}" button usually needs a link.`));
  }
  return issues;
}

/**
 * Plans the Facebook view that is open. `pageUrl` is required: the guard reads it to tell
 * the Page creation view from an existing Page, and refuses anything off facebook.com.
 */
export function planFacebook(doc: Document, pack: FacebookPack, pageUrl: string): FillPlan {
  const prepared = prepareFacebookPack(pack);
  const offer = tierOffer(prepared.pack.tier) ?? undefined;
  const phoneIssues = fitPhoneToPicker(doc, prepared.pack);
  return buildPlan({
    schema: schemaFor(prepared.pack),
    document: doc,
    pack: prepared.pack as unknown as Record<string, unknown>,
    pageUrl,
    offer,
    extraIssues: [...prepared.issues, ...phoneIssues, ...assessFacebook(pack)],
    guard: (page) => guardFacebook(page, prepared.pack, pageUrl),
    onUnmapped: (control, draft) => onFacebookUnmapped(control, draft),
    after: (draft) => facebookAfter(draft, prepared.pack),
  });
}

/** Facebook prompts the Page composer as "What's on your mind, <Page name>?" (verified 2026-11-25). */
function composerPrompt(pageName: string): string {
  return `What's on your mind, ${pageName}?`;
}

/** The schema with the labels that depend on the pack, such as the Page-named composer prompt. */
function schemaFor(pack: FacebookPack): PlatformSchema {
  const name = pack.page?.name?.trim();
  if (!name) return facebookSchema;
  return {
    ...facebookSchema,
    fields: facebookSchema.fields.map((field) =>
      field.id === "launchPost" ? { ...field, labels: [composerPrompt(name), ...field.labels] } : field,
    ),
  };
}

/**
 * Facebook's phone editor has its own country-code picker ("Country code, US+1"). When the pack
 * number starts with that same code, drop it so the field does not get it twice, and say so.
 * A different code is left alone and flagged: the person picks the country.
 */
function fitPhoneToPicker(doc: Document, pack: FacebookPack): PlanIssue[] {
  const phone = pack.contact?.phone;
  if (!phone || !phone.startsWith("+")) return [];
  const picker = Array.from(doc.querySelectorAll("[aria-label]")).find((el) => /^country code\b/i.test(el.getAttribute("aria-label") ?? ""));
  const code = /\+(\d{1,4})\s*$/.exec(picker?.getAttribute("aria-label") ?? "")?.[1];
  if (!code) return [];
  const match = new RegExp(`^\\+${code}(?![0-9])[\\s.-]*`).exec(phone);
  if (!match) {
    return [issue("warning", "phone", "country-code", `Facebook's country picker shows +${code}, but the phone number starts with a different code. Pick the country yourself before saving.`)];
  }
  pack.contact!.phone = phone.slice(match[0].length);
  return [issue("warning", "phone", "country-code", `Facebook's country picker already shows +${code}, so the number is drafted as "${pack.contact!.phone}".`)];
}

export function facebookContext(pageUrl: string): "create" | "page" | "off-site" {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return "off-site";
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(host === "facebook.com" || host.endsWith(".facebook.com"))) return "off-site";
  const createPaths = (facebookSchema.rules?.createPaths ?? []) as string[];
  return createPaths.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`)) ? "create" : "page";
}

/**
 * Business-Page-only guardrail. Outside the creation view the open page must name the pack's Page
 * in a heading and show at least one Page-admin signal; otherwise nothing is planned. This fails
 * closed: a personal profile or timeline gets a refusal, not a draft.
 */
function guardFacebook(page: Page, pack: FacebookPack, pageUrl: string): PlanIssue[] {
  const context = facebookContext(pageUrl);
  if (context === "off-site") {
    return [issue("error", "page", "not-facebook", "Open the Facebook Business Page view in this tab. Page Push only runs on https://facebook.com.")];
  }
  if (context === "create") return [];
  const doc = page.document;
  const rawName = (pack.page?.name ?? "").trim();
  const name = labelKey(rawName);
  // Verified 2026-11-25: the Page view shows the name as an h2 under "Manage Page"; the Business
  // Dashboard only greets "Hi <Page>"; /post/create has no headings and names the Page only in the
  // composer prompt, which Facebook shows when you post as that Page.
  const headingNames = new Set([name, labelKey(`Hi ${rawName}`)]);
  const headings = Array.from(doc.querySelectorAll("h1, h2, [role='heading']"));
  const prompt = labelKey(composerPrompt(rawName));
  const named = name !== "" && (
    headings.some((heading) => headingNames.has(labelKey(heading.textContent ?? "")))
    || Array.from(doc.querySelectorAll("[role='textbox'][aria-label]")).some((box) => labelKey(box.getAttribute("aria-label") ?? "") === prompt)
  );
  if (!named) {
    return [issue(
      "error",
      "page",
      "page-identity",
      `This view does not show the Page "${pack.page?.name ?? ""}". Switch into that Business Page, open its settings or composer, and plan again.`,
    )];
  }
  const signals = ((facebookSchema.rules?.pageSignals ?? []) as string[]).map((signal) => labelKey(signal));
  const signalNodes = doc.querySelectorAll(
    "a, button, [role='button'], [role='link'], [role='tab'], [role='menuitem'], h1, h2, h3, [role='heading']",
  );
  const admin = Array.from(signalNodes).some((node) => {
    const texts = [visibleText(node), node.getAttribute("aria-label") ?? ""];
    return texts.some((text) => text && signals.includes(labelKey(text)));
  });
  if (!admin) {
    return [issue(
      "error",
      "page",
      "not-business-page",
      "This looks like a personal profile or a Page you are not managing. Page Push only fills Business Pages you administer.",
    )];
  }
  return [];
}

function facebookAfter(draft: PlanDraft, pack: FacebookPack): void {
  for (const id of ["profilePicture", "coverPhoto"] as const) {
    if (pack.media?.[id] !== "required") continue;
    const field = facebookSchema.fields.find((item) => item.id === id)!;
    const control = fileControl(draft.page.controls, field);
    if (!control) continue;
    draft.notes = draft.notes.filter((note) => !note.startsWith(`${field.labels[0]}:`));
    draft.gates.push({
      code: "file",
      fieldId: id,
      controlId: control.id,
      message: `Attach the ${id === "profilePicture" ? "profile picture" : "cover photo"} yourself before commit.`,
    });
  }

  // City/Town is a typeahead on Facebook: typed text alone is not a city until a suggestion is
  // picked, so a typed value would read back as written yet never save. Leave it to the person.
  const city = draft.actions.find((action) => action.id === "city");
  const cityEl = city ? draft.page.document.getElementById(city.controlId) : null;
  if (city && cityEl?.getAttribute("role") === "combobox") {
    draft.actions = draft.actions.filter((action) => action !== city);
    draft.notes.push(`City/Town: pick "${String(city.value)}" from Facebook's suggestions yourself`);
  }

  const hoursPlanned = draft.actions.some((action) => action.id === "hoursMode");
  const schedule = pack.hours?.schedule;
  if (hoursPlanned && schedule && labelKey(pack.hours!.mode) === labelKey("Open on selected hours")) {
    const days = WEEK.filter((day) => schedule[day]?.trim()).map((day) => `${day.slice(0, 3)} ${schedule[day]!.trim()}`);
    if (days.length) draft.notes.push(`Opening times: set by hand (${days.join(", ")})`);
  }
}

function onFacebookUnmapped(control: Control, draft: PlanDraft): void {
  if (control.disabled || isButtonControl(control) || !control.required) return;
  const prompt = control.rawLabels[0];
  if (!prompt) return;
  draft.warnings.push(issue("warning", `custom:${labelKey(prompt)}`, "unmapped", `Left "${prompt}" alone. Fill it yourself if Facebook asks for it.`));
}

function fileControl(controls: Control[], field: FieldSchema): Control | undefined {
  return controls.find((control) => control.type === "file" && labelMatches(control, field.labels, "exact"));
}

function secretPaths(value: unknown, path = ""): string[] {
  if (typeof value === "string") return SECRET_VALUE.test(value) ? [path || "pack"] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => secretPaths(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const next = path ? `${path}.${key}` : key;
    return SECRET_KEY.test(key) ? [next] : secretPaths(item, next);
  });
}

function unsetPath(root: Record<string, unknown>, path: string): void {
  const keys = path.split(".");
  const last = keys.pop();
  let current: unknown = root;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return;
    current = (current as Record<string, unknown>)[key];
  }
  if (last && current && typeof current === "object") delete (current as Record<string, unknown>)[last];
}
