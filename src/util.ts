import { createHash } from "node:crypto";

import type { PlanIssue } from "./types.ts";

export function issue(
  level: PlanIssue["level"],
  fieldId: string,
  code: string,
  message: string,
): PlanIssue {
  return { level, fieldId, code, message };
}

export function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function labelKey(value: string): string {
  return normalize(value)
    .replace(/[*]\s*$/, "")
    .replace(/\s*\(required\)$/, "")
    .trim();
}

export function wordsOf(value: string): string[] {
  return labelKey(value).split(/[^a-z0-9+]+/).filter(Boolean);
}

export function charLength(value: string): number {
  return Array.from(value).length;
}

export function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function paragraphs(value: string): string[] {
  return value
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function clip(value: string, max = 80): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (Array.from(flat).length <= max) return flat;
  return `${Array.from(flat).slice(0, max - 1).join("")}…`;
}

export function getPath(root: unknown, path: string): unknown {
  let current = root;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isFullDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year == null || month == null || day == null) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "youku.com"];

export function isDevpostVideo(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  const url = new URL(value);
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  return VIDEO_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
