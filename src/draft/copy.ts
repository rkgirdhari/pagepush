import { appsumoSchema } from "../schema.ts";
import type { PlanIssue } from "../types.ts";
import type { TraceEvent } from "../debug.ts";
import { charLength, issue, wordCount } from "../util.ts";

export interface CopyField {
  id: string;
  maxLength: number;
  minLength?: number;
  minWords?: number;
  /** When set, the field is a list of this many strings. */
  items?: number;
  itemMaxLength?: number;
}

export interface DraftInput {
  platform: "devpost" | "appsumo";
  facts: string;
  fields: CopyField[];
}

export type ModelResult =
  | { ok: true; text: string }
  | { ok: false; code: "weights" | "tokenizer" | "timeout" | "protocol" | "runtime" | "secret"; message: string };

export interface CopyRunner {
  complete(input: { system: string; user: string; maxTokens: number }): Promise<ModelResult>;
}

export interface DraftOutcome {
  source: "qwen3" | "fallback" | "mixed";
  fields: Record<string, string | string[]>;
  issues: PlanIssue[];
  trace: TraceEvent[];
}

const BANNED = (appsumoSchema.rules?.voice as { banned?: string[] } | undefined)?.banned ?? [];
const SECRET = /private key|begin [a-z ]*private|sk_live_|sk_test_|api[_ -]?key|redemption code/i;

export async function draftCopy(input: DraftInput, runner: CopyRunner): Promise<DraftOutcome> {
  const trace: TraceEvent[] = [];
  const issues: PlanIssue[] = [];
  if (!input.facts.trim() || input.fields.length === 0) {
    issues.push(issue("error", "facts", "facts", "Drafting needs facts and at least one field."));
    trace.push({ phase: "model", code: "facts" });
    return { source: "fallback", fields: {}, issues, trace };
  }
  if (SECRET.test(input.facts)) {
    issues.push(issue("error", "facts", "secret", "Facts look like a secret. Nothing was sent to the model."));
    trace.push({ phase: "model", code: "secret" });
    return { source: "fallback", fields: {}, issues, trace };
  }

  const prompt = {
    system: systemPrompt(input.platform),
    user: userPrompt(input),
    maxTokens: Math.min(1024, 96 + input.fields.length * 80),
  };
  let modelText = "";
  try {
    const result = await runner.complete(prompt);
    if (!result.ok) {
      issues.push(issue("warning", "model", result.code, "The local model did not answer. Drafted from the facts instead."));
      trace.push({ phase: "model", code: result.code });
    } else {
      modelText = result.text;
      trace.push({ phase: "model", code: "answered" });
    }
  } catch {
    issues.push(issue("warning", "model", "runtime", "The local model did not answer. Drafted from the facts instead."));
    trace.push({ phase: "model", code: "runtime" });
  }

  const parsed = modelText ? extractObject(modelText) : null;
  if (modelText && !parsed) {
    issues.push(issue("warning", "model", "protocol", "The model did not return JSON. Drafted from the facts instead."));
    trace.push({ phase: "model", code: "protocol" });
  }

  const fields: Record<string, string | string[]> = {};
  let fromModel = 0;
  let fromFacts = 0;
  const sentences = splitFacts(input.facts);
  let cursor = 0;
  for (const field of input.fields) {
    const candidate = parsed ? parsed[field.id] : undefined;
    const accepted = acceptField(input.platform, input.facts, field, candidate);
    if (accepted.ok) {
      fields[field.id] = accepted.value;
      fromModel += 1;
      trace.push({ phase: "model", code: "accepted", fieldId: field.id });
      continue;
    }
    if (candidate !== undefined) {
      issues.push(issue("warning", field.id, "model-rejected", `The model draft for ${field.id} was rejected (${accepted.reason}).`));
      trace.push({ phase: "model", code: "rejected", fieldId: field.id });
    }
    const fallback = fallbackField(field, sentences, cursor);
    cursor = fallback.cursor;
    if (fallback.value == null) {
      issues.push(issue("error", field.id, "fallback-short", `The facts are too short to fill ${field.id}.`));
      trace.push({ phase: "model", code: "fallback-short", fieldId: field.id });
      continue;
    }
    fields[field.id] = fallback.value;
    fromFacts += 1;
    trace.push({ phase: "model", code: "fallback", fieldId: field.id });
  }

  const source = fromModel > 0 && fromFacts > 0 ? "mixed" : fromModel > 0 ? "qwen3" : "fallback";
  return { source, fields, issues, trace };
}

function systemPrompt(platform: DraftInput["platform"]): string {
  const voice = platform === "appsumo"
    ? ` Do not use these words: ${BANNED.join(", ")}.`
    : "";
  return [
    "You fill form copy a person will read before anything is submitted.",
    "Reply with one JSON object and no markdown.",
    "Use only the facts. Do not add cities, dates, prices, emails, or URLs that are not written in the facts.",
    "Do not use an em dash, an exclamation mark, or emoji.",
    voice,
  ].join(" ");
}

function userPrompt(input: DraftInput): string {
  const lines = input.fields.map((field) => {
    if (field.items) {
      const cap = field.itemMaxLength ?? field.maxLength;
      const words = field.minWords ? `, at least ${field.minWords} words` : "";
      return `- ${field.id}: an array of ${field.items} strings, each at most ${cap} characters${words}`;
    }
    const min = field.minLength ?? 1;
    const words = field.minWords ? `, at least ${field.minWords} words` : "";
    return `- ${field.id}: one string, ${min} to ${field.maxLength} characters${words}`;
  });
  return `Facts (the only source of names, numbers, and links):\n${input.facts.trim()}\n\nReturn a JSON object with these keys:\n${lines.join("\n")}`;
}

function acceptField(
  platform: DraftInput["platform"],
  facts: string,
  field: CopyField,
  candidate: unknown,
): { ok: true; value: string | string[] } | { ok: false; reason: string } {
  if (field.items) {
    if (!Array.isArray(candidate) || candidate.length !== field.items || candidate.some((item) => typeof item !== "string")) {
      return { ok: false, reason: "shape" };
    }
    const cap = field.itemMaxLength ?? field.maxLength;
    const items = candidate.map((item) => clipWords(item, cap));
    for (const item of items) {
      const reason = rejectText(platform, facts, item, 1, cap, field.minWords);
      if (reason) return { ok: false, reason };
    }
    return { ok: true, value: items };
  }
  if (typeof candidate !== "string") return { ok: false, reason: "shape" };
  const text = clipWords(candidate, field.maxLength);
  const reason = rejectText(platform, facts, text, field.minLength ?? 1, field.maxLength, field.minWords);
  if (reason) return { ok: false, reason };
  return { ok: true, value: text };
}

function rejectText(
  platform: DraftInput["platform"],
  facts: string,
  text: string,
  minLength: number,
  maxLength: number,
  minWords: number | undefined,
): string | null {
  if (!text.trim()) return "empty";
  if (charLength(text) < minLength || charLength(text) > maxLength) return "length";
  if (minWords != null && wordCount(text) < minWords) return "words";
  const leak = leaked(text, facts);
  if (leak) return leak;
  if (ungrounded(text, facts)) return "grounding";
  if (platform === "appsumo") {
    if (text.includes("\u2014") || text.includes("!") || /\p{Extended_Pictographic}/u.test(text)) return "voice";
    for (const word of BANNED) {
      if (new RegExp(`\\b${word}\\b`, "i").test(text)) return "voice";
    }
  }
  return null;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "with", "before", "after",
  "from", "by", "at", "is", "are", "it", "its", "as", "that", "this", "these", "those",
]);

function contentWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function ungrounded(text: string, facts: string): boolean {
  const allowed = new Set(contentWords(facts));
  const used = contentWords(text);
  return used.length === 0 || used.some((word) => !allowed.has(word));
}

function leaked(text: string, facts: string): string | null {
  for (const url of text.match(/https?:\/\/[^\s)"']+/g) ?? []) {
    if (!facts.includes(url.replace(/[.,]$/, ""))) return "url";
  }
  for (const email of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) {
    if (!facts.toLowerCase().includes(email.toLowerCase())) return "email";
  }
  for (const date of text.match(/\d{4}-\d{2}-\d{2}/g) ?? []) {
    if (!facts.includes(date)) return "date";
  }
  for (const money of text.match(/\$\s?\d[\d,]*/g) ?? []) {
    const digits = money.replace(/[^\d]/g, "");
    if (!facts.includes(digits)) return "price";
  }
  return null;
}

function fallbackField(
  field: CopyField,
  sentences: string[],
  cursor: number,
): { value: string | string[] | null; cursor: number } {
  if (field.items) {
    const cap = field.itemMaxLength ?? field.maxLength;
    const items: string[] = [];
    let next = cursor;
    for (let index = 0; index < field.items; index += 1) {
      const sentence = sentences[next];
      if (!sentence) return { value: null, cursor: next };
      const clipped = clipWords(sentence, cap);
      if (field.minWords && wordCount(clipped) < field.minWords) return { value: null, cursor: next };
      items.push(clipped);
      next += 1;
    }
    return { value: items, cursor: next };
  }
  const parts: string[] = [];
  let next = cursor;
  while (next < sentences.length) {
    parts.push(sentences[next] ?? "");
    next += 1;
    const joined = clipWords(parts.join(" "), field.maxLength);
    const longEnough = charLength(joined) >= (field.minLength ?? 1);
    const enoughWords = field.minWords == null || wordCount(joined) >= field.minWords;
    if (longEnough && enoughWords) return { value: joined, cursor: next };
  }
  return { value: null, cursor };
}

function clipWords(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (charLength(flat) <= max) return flat;
  const cut = Array.from(flat).slice(0, max).join("");
  const boundary = cut.lastIndexOf(" ");
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trim();
}

function extractObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, index + 1)) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function splitFacts(facts: string): string[] {
  return facts
    .split(/\n+|(?<=[.])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
