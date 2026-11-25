// Pack model for the side panel: starter packs per tier, form path editing, cleaning, schema
// validation, a fingerprint that approval is tied to, and the copy-paste fallback blocks.
// Pure functions, no chrome.* calls, so all of it is unit-tested in Node.
import {
  assessFacebook,
  charLength,
  facebookSchema,
  facebookTiers,
  getPath,
  prepareFacebookPack,
  sha256,
  validateField,
  type FacebookPack,
  type FacebookTier,
  type FieldSchema,
  type PlanIssue,
  type Weekday,
} from "../browser.ts";

export const TIERS: FacebookTier[] = ["essentials", "standard", "launch"];
export const WEEKDAYS: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export const HOURS_MODES = (facebookSchema.rules?.hoursModes ?? []) as string[];
/** Suggestions only. The Page's own option list decides; a type it does not offer is a plan error. */
export const CTA_SUGGESTIONS = [
  "Book now",
  "Contact us",
  "Learn more",
  "Shop now",
  "Sign up",
  "Send message",
  "Call now",
  "Send email",
  "Watch video",
];

export const TIER_LABELS: Record<FacebookTier, string> = {
  essentials: "Essentials",
  standard: "Standard Business",
  launch: "Full Launch + Post",
};

/** Schema field ids the tier covers. */
export function tierFields(tier: FacebookTier): Set<string> {
  return new Set(facebookTiers()[tier]?.fields ?? []);
}

export function fieldById(id: string): FieldSchema {
  const field = facebookSchema.fields.find((item) => item.id === id);
  if (!field) throw new Error(`Unknown Facebook field ${id}`);
  return field;
}

/**
 * A blank pack for the tier. Client facts stay empty on purpose: placeholder text would pass
 * validation and get drafted into a real Page. The plan reports what is still missing.
 */
export function starterPack(tier: FacebookTier): FacebookPack {
  const pack: FacebookPack = {
    tier,
    page: { name: "", categories: [], bio: "" },
    contact: { website: "", phone: "", email: "" },
    media: { profilePicture: "required", coverPhoto: tier === "essentials" ? "optional" : "required" },
  };
  if (tier !== "essentials") {
    pack.contact = { ...pack.contact, address: "", city: "", zip: "" };
    pack.hours = { mode: "" };
    pack.cta = { type: "", url: "" };
  }
  if (tier === "launch") pack.launchPost = { text: "" };
  return pack;
}

/** Sets a dotted path, creating objects on the way. Array indexes are numeric segments. */
export function setPath<T extends object>(root: T, path: string, value: unknown): T {
  const keys = path.split(".");
  let current = root as Record<string, unknown>;
  keys.forEach((key, index) => {
    const last = index === keys.length - 1;
    if (last) {
      current[key] = value;
      return;
    }
    const nextIsIndex = /^\d+$/.test(keys[index + 1]!);
    if (current[key] == null || typeof current[key] !== "object") current[key] = nextIsIndex ? [] : {};
    current = current[key] as Record<string, unknown>;
  });
  return root;
}

export function readPath(root: unknown, path: string): unknown {
  return getPath(root, path);
}

/**
 * The pack the engine sees: strings trimmed, empty strings, empty objects, and empty list items
 * removed. `page.categories` always stays a list. Never adds a value.
 */
export function cleanPack(pack: FacebookPack): FacebookPack {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    }
    if (Array.isArray(value)) {
      const items = value.map(walk).filter((item) => item !== undefined);
      return items;
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const next = walk(item);
        if (next === undefined) continue;
        if (next && typeof next === "object" && !Array.isArray(next) && Object.keys(next).length === 0) continue;
        out[key] = next;
      }
      return out;
    }
    return value;
  };
  const cleaned = (walk(structuredClone(pack)) ?? {}) as FacebookPack;
  cleaned.tier = pack.tier;
  cleaned.page = { ...(cleaned.page ?? { name: "" }), categories: (cleaned.page?.categories ?? []) as string[] };
  if (cleaned.page.name == null) cleaned.page.name = "";
  if (Array.isArray((cleaned as { launchPost?: unknown }).launchPost)) delete cleaned.launchPost;
  return cleaned;
}

/** Approval is bound to this. Any edit to the cleaned pack changes it. */
export function packFingerprint(pack: FacebookPack): string {
  return sha256(cleanPack(pack));
}

export interface PackCheck {
  pack: FacebookPack | null;
  errors: PlanIssue[];
  warnings: PlanIssue[];
}

const KNOWN: Record<string, readonly string[]> = {
  "": ["tier", "page", "contact", "hours", "cta", "launchPost", "media", "commit"],
  page: ["name", "categories", "bio"],
  contact: ["website", "phone", "email", "address", "city", "zip"],
  hours: ["mode", "schedule"],
  "hours.schedule": WEEKDAYS,
  cta: ["type", "url"],
  launchPost: ["text"],
  media: ["profilePicture", "coverPhoto"],
  commit: ["createPage", "saveChanges", "saveActionButton", "publishLaunchPost"],
};

/**
 * Validates an imported or edited pack against the Facebook schema without a page: shape and
 * types, known keys, tier, and every field limit the schema states. Page-level checks (option
 * lists, live maxlength) happen when the view is planned.
 */
export function checkPack(input: unknown): PackCheck {
  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const err = (fieldId: string, code: string, message: string): void => { errors.push({ level: "error", fieldId, code, message }); };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    err("pack", "shape", "A pack is a JSON object.");
    return { pack: null, errors, warnings };
  }
  const raw = input as Record<string, unknown>;
  for (const [scope, keys] of Object.entries(KNOWN)) {
    const node = scope ? getPath(raw, scope) : raw;
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    for (const key of Object.keys(node)) {
      if (!keys.includes(key)) {
        warnings.push({ level: "warning", fieldId: scope ? `${scope}.${key}` : key, code: "unknown-key", message: `"${scope ? `${scope}.` : ""}${key}" is not a Page Push field and is ignored.` });
      }
    }
  }
  if (!TIERS.includes(raw.tier as FacebookTier)) err("tier", "tier", "tier must be essentials, standard, or launch.");
  const page = raw.page as Record<string, unknown> | undefined;
  if (!page || typeof page !== "object") err("page", "shape", "page must be an object with name and categories.");
  if (page && typeof page.name !== "string") err("pageName", "type", "page.name must be text.");
  if (page && !(Array.isArray(page.categories) && page.categories.every((item) => typeof item === "string"))) {
    err("categories", "type", "page.categories must be a list of text.");
  }
  for (const [path, type] of [
    ["page.bio", "string"], ["contact", "object"], ["hours", "object"], ["hours.mode", "string"], ["hours.schedule", "object"],
    ["cta", "object"], ["cta.type", "string"], ["cta.url", "string"], ["launchPost", "object"], ["launchPost.text", "string"],
    ["media", "object"], ["commit", "object"],
  ] as const) {
    const value = getPath(raw, path);
    if (value !== undefined && (typeof value !== type || (type === "object" && (value === null || Array.isArray(value))))) {
      err(path, "type", `${path} must be ${type === "object" ? "an object" : "text"}.`);
    }
  }
  for (const key of ["profilePicture", "coverPhoto"]) {
    const value = getPath(raw, `media.${key}`);
    if (value !== undefined && value !== "required" && value !== "optional") err(key, "enum", `media.${key} must be "required" or "optional".`);
  }
  if (errors.length) return { pack: null, errors, warnings };

  const pack = cleanPack(raw as unknown as FacebookPack);
  for (const field of facebookSchema.fields) {
    if (field.control === "button" || field.control === "file" || field.control === "choice") continue;
    const value = getPath(pack, field.path);
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    for (const problem of validateField(field, value)) (problem.level === "error" ? errors : warnings).push(problem);
  }
  for (const problem of assessFacebook(pack)) {
    if (problem.code === "required" && (problem.fieldId === "pageName" || problem.fieldId === "categories")) {
      errors.push(problem);
      continue;
    }
    (problem.level === "error" ? errors : warnings).push(problem);
  }
  warnings.push(...prepareFacebookPack(pack).issues.filter((item) => item.level === "warning"));
  return { pack, errors: dedupeIssues(errors), warnings: dedupeIssues(warnings) };
}

function dedupeIssues(items: PlanIssue[]): PlanIssue[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.fieldId}|${item.code}|${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface Counter {
  path: string;
  label: string;
  used: number;
  max: number;
  over: boolean;
}

/** Live character counters for the fields that have a schema limit people hit. */
export function counters(pack: FacebookPack): Counter[] {
  return [
    ["page.name", "pageName"],
    ["page.bio", "bio"],
    ["launchPost.text", "launchPost"],
  ].map(([path, id]) => {
    const field = fieldById(id!);
    const value = getPath(pack, path!);
    const used = typeof value === "string" ? charLength(value.trim()) : 0;
    const max = field.maxLength ?? 0;
    return { path: path!, label: field.labels[0]!, used, max, over: max > 0 && used > max };
  });
}

export interface PasteBlock {
  id: string;
  label: string;
  text: string;
}

/** Copy-paste fallback: the tier's text blocks, exactly as the plan would draft them. */
export function pasteBlocks(pack: FacebookPack): PasteBlock[] {
  const prepared = prepareFacebookPack(cleanPack(pack)).pack;
  const blocks: PasteBlock[] = [];
  const add = (id: string, label: string, lines: (string | undefined | false)[]): void => {
    const text = lines.filter((line): line is string => typeof line === "string" && line.trim() !== "").join("\n");
    if (text) blocks.push({ id, label, text });
  };
  add("pageName", "Page name", [prepared.page.name]);
  add("categories", "Categories", [prepared.page.categories.join(", ")]);
  add("bio", "Bio", [prepared.page.bio]);
  const contact = prepared.contact ?? {};
  add("contact", "Contact details", [
    contact.website && `Website: ${contact.website}`,
    contact.phone && `Phone: ${contact.phone}`,
    contact.email && `Email: ${contact.email}`,
  ]);
  add("address", "Address", [contact.address, [contact.city, contact.zip].filter(Boolean).join(" ")]);
  if (prepared.hours?.mode) {
    const schedule = prepared.hours.schedule ?? {};
    add("hours", "Hours note", [
      `Hours: ${prepared.hours.mode}`,
      ...WEEKDAYS.filter((day) => schedule[day]?.trim()).map((day) => `${day[0]!.toUpperCase()}${day.slice(1)}: ${schedule[day]!.trim()}`),
    ]);
  }
  if (prepared.cta?.type) add("cta", "Action button", [`Button: ${prepared.cta.type}`, prepared.cta.url && `Link: ${prepared.cta.url}`]);
  add("launchPost", "Launch post", [prepared.launchPost?.text]);
  return blocks;
}
