// Facebook bio and launch-post drafting. The deterministic, fact-based draft is the default and
// needs nothing installed. When the person runs a local model (Ollama), its answer is used only if
// it passes the same checks as the rest of Page Push: within the field's limit, no URL, email,
// date, or price that is not in the pack, and no words beyond the pack facts plus a short neutral
// vocabulary. Anything else falls back to the deterministic draft, field by field.
//
// Drafts only fill the side panel's pack form. They reach Facebook through the usual
// Plan -> Draft -> Approve & Commit, after the person has read them.
import type { TraceEvent } from "../debug.ts";
import { facebookSchema } from "../schema.ts";
import { assessFacebook, type FacebookPack } from "../shims/facebook.ts";
import type { PlanIssue } from "../types.ts";
import { charLength, issue } from "../util.ts";
import { acceptField, extractObject, type CopyField, type CopyRunner } from "./copy.ts";

/** A launch post longer than this is a wall of text; the composer allows far more. */
export const LAUNCH_POST_DRAFT_MAX = 600;

export interface FacebookCopyOutcome {
  source: "offline" | "ollama" | "mixed";
  bio?: string;
  launchPost?: string;
  issues: PlanIssue[];
  trace: TraceEvent[];
}

export function bioLimit(): number {
  return facebookSchema.fields.find((field) => field.id === "bio")?.maxLength ?? 255;
}

/** The fields to draft for this pack: the bio always, the launch post only on the launch tier. */
export function facebookCopyFields(pack: FacebookPack): CopyField[] {
  const fields: CopyField[] = [{ id: "bio", maxLength: bioLimit(), minLength: 20 }];
  if (pack.tier === "launch") fields.push({ id: "launchPost", maxLength: LAUNCH_POST_DRAFT_MAX, minLength: 40 });
  return fields;
}

/** The pack facts as plain lines: the only source of names, places, and links a draft may use. */
export function facebookFacts(pack: FacebookPack): string {
  const lines: string[] = [];
  const add = (label: string, value: string | undefined): void => {
    const text = value?.replace(/\s+/g, " ").trim();
    if (text) lines.push(`${label}: ${text}`);
  };
  add("Page name", pack.page?.name);
  add("Categories", (pack.page?.categories ?? []).filter(Boolean).join(", "));
  add("About", pack.page?.bio);
  add("Launch notes", pack.launchPost?.text);
  add("Website", pack.contact?.website);
  add("City", pack.contact?.city);
  if (pack.cta?.type) add("Action button", [pack.cta.type, pack.cta.url].filter(Boolean).join(" "));
  add("Hours", pack.hours?.mode);
  return lines.join("\n");
}

/**
 * Drafts the bio (and the launch post on the launch tier) with no model at all. Text the person
 * already wrote is kept; empty fields get a template built only from the pack facts.
 */
export function offlineFacebookCopy(pack: FacebookPack): { bio?: string; launchPost?: string } {
  const name = pack.page?.name?.trim() ?? "";
  const categories = (pack.page?.categories ?? []).map((item) => item.trim()).filter(Boolean);
  const city = pack.contact?.city?.trim();
  const website = pack.contact?.website?.trim();

  let bio = pack.page?.bio?.trim();
  if (!bio && name) {
    const what = categories.length ? `: ${joinList(categories)}` : "";
    const where = city ? ` in ${city}` : "";
    bio = `${name}${what}${where}.${website ? ` ${website}` : ""}`;
  }
  const out: { bio?: string; launchPost?: string } = {};
  if (bio) out.bio = clipWords(bio, bioLimit());

  if (pack.tier === "launch") {
    let post = pack.launchPost?.text?.trim();
    if (!post && name) {
      const link = pack.cta?.url?.trim() || website;
      const action = pack.cta?.type?.trim();
      const parts = [`${name} is now on Facebook.`];
      if (out.bio && out.bio !== name) parts.push(out.bio);
      if (link) parts.push(action ? `${action}: ${link}` : link);
      post = parts.join("\n\n");
    }
    if (post) out.launchPost = clipParagraphs(post, LAUNCH_POST_DRAFT_MAX);
  }
  return out;
}

/**
 * Drafts with the local model when one is given, falling back to the offline draft per field.
 * Without a runner (Ollama stopped or not installed) this is exactly offlineFacebookCopy.
 */
export async function draftFacebookCopy(pack: FacebookPack, runner?: CopyRunner): Promise<FacebookCopyOutcome> {
  const offline = offlineFacebookCopy(pack);
  const issues: PlanIssue[] = [];
  const trace: TraceEvent[] = [];
  const fields = facebookCopyFields(pack);
  const facts = facebookFacts(pack);

  if (!runner) return { source: "offline", ...offline, issues, trace };
  if (!pack.page?.name?.trim()) {
    issues.push(issue("warning", "pageName", "facts", "Add the Page name before drafting with the local model. The offline draft is shown instead."));
    return { source: "offline", ...offline, issues, trace };
  }
  if (assessFacebook(pack).some((item) => item.code === "secret")) {
    issues.push(issue("error", "pack", "secret", "The pack holds something that looks like a credential. Nothing was sent to the local model."));
    trace.push({ phase: "model", code: "secret" });
    return { source: "offline", ...offline, issues, trace };
  }

  let text = "";
  try {
    const result = await runner.complete({ system: systemPrompt(), user: userPrompt(facts, fields), maxTokens: 160 + fields.length * 220 });
    if (result.ok) {
      text = result.text;
      trace.push({ phase: "model", code: "answered" });
    } else {
      issues.push(issue("warning", "model", result.code, `${result.message} Drafted from the pack facts instead.`));
      trace.push({ phase: "model", code: result.code });
    }
  } catch {
    issues.push(issue("warning", "model", "runtime", "The local model did not answer. Drafted from the pack facts instead."));
    trace.push({ phase: "model", code: "runtime" });
  }

  const parsed = text ? extractObject(text) : null;
  if (text && !parsed) {
    issues.push(issue("warning", "model", "protocol", "The local model did not return JSON. Drafted from the pack facts instead."));
    trace.push({ phase: "model", code: "protocol" });
  }

  const out: FacebookCopyOutcome = { source: "offline", issues, trace };
  let fromModel = 0;
  let fromFacts = 0;
  for (const field of fields) {
    const key = field.id as "bio" | "launchPost";
    const candidate = parsed?.[key];
    const accepted = candidate === undefined ? null : acceptField("facebook", facts, field, normalizeParagraphs(candidate));
    if (accepted?.ok && typeof accepted.value === "string") {
      out[key] = key === "launchPost" ? restoreParagraphs(candidate as string, accepted.value) : accepted.value;
      fromModel += 1;
      trace.push({ phase: "model", code: "accepted", fieldId: key });
      continue;
    }
    if (accepted && !accepted.ok) {
      issues.push(issue("warning", key, "model-rejected", `The local model's ${key === "bio" ? "bio" : "launch post"} was set aside (${accepted.reason}); the offline draft is shown.`));
      trace.push({ phase: "model", code: "rejected", fieldId: key });
    }
    if (offline[key]) {
      out[key] = offline[key];
      fromFacts += 1;
      trace.push({ phase: "model", code: "fallback", fieldId: key });
    }
  }
  out.source = fromModel > 0 && fromFacts > 0 ? "mixed" : fromModel > 0 ? "ollama" : "offline";
  return out;
}

function systemPrompt(): string {
  return [
    "You write Facebook Business Page copy that a person reads and edits before anything is posted.",
    "Reply with one JSON object and no markdown.",
    "Use only the facts. Do not add cities, dates, prices, emails, URLs, awards, or services that are not written in the facts.",
    "Plain, friendly, specific. No hashtags, no emoji, no em dash.",
  ].join(" ");
}

function userPrompt(facts: string, fields: CopyField[]): string {
  const lines = fields.map((field) => field.id === "bio"
    ? `- bio: one string, ${field.minLength} to ${field.maxLength} characters, for the Page's Intro`
    : `- launchPost: one string, ${field.minLength} to ${field.maxLength} characters, the Page's first post; short paragraphs separated by a blank line`);
  return `Facts (the only source of names, places, and links):\n${facts}\n\nReturn a JSON object with these keys:\n${lines.join("\n")}`;
}

/** acceptField flattens whitespace; check a flattened copy and keep the model's paragraphs. */
function normalizeParagraphs(candidate: unknown): unknown {
  return typeof candidate === "string" ? candidate.replace(/\s+/g, " ").trim() : candidate;
}

function restoreParagraphs(original: string, accepted: string): string {
  const paragraphs = original.split(/\n\s*\n/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
  return charLength(paragraphs) <= LAUNCH_POST_DRAFT_MAX && paragraphs.replace(/\s+/g, " ") === accepted ? paragraphs : accepted;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function clipWords(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (charLength(flat) <= max) return flat;
  const cut = Array.from(flat).slice(0, max).join("");
  const boundary = cut.lastIndexOf(" ");
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trim();
}

function clipParagraphs(value: string, max: number): string {
  const kept: string[] = [];
  for (const paragraph of value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    const next = [...kept, paragraph].join("\n\n");
    if (charLength(next) <= max) {
      kept.push(paragraph);
      continue;
    }
    if (!kept.length) kept.push(clipWords(paragraph, max));
    break;
  }
  return kept.join("\n\n");
}
