import type { FieldSchema, PlanIssue } from "./types.ts";
import {
  charLength,
  isDevpostVideo,
  isEmail,
  isFullDay,
  isHttpUrl,
  issue,
  wordCount,
} from "./util.ts";

export function validateField(field: FieldSchema, value: unknown, maxLength = field.maxLength): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (typeof value === "string") {
    checkString(field, value, maxLength, issues);
    return issues;
  }
  if (typeof value === "number") {
    if (field.minimum != null && value < field.minimum) {
      issues.push(issue("error", field.id, "min", `${field.labels[0]} must be at least ${field.minimum}.`));
    }
    if (field.maximum != null && value > field.maximum) {
      issues.push(issue("error", field.id, "max", `${field.labels[0]} must be at most ${field.maximum}.`));
    }
    return issues;
  }
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string");
    if (items.length !== value.length) {
      issues.push(issue("error", field.id, "type", `${field.labels[0]} must be a list of text.`));
      return issues;
    }
    if (field.minItems != null && items.length < field.minItems) {
      issues.push(issue("error", field.id, "min-items", `${field.labels[0]} needs at least ${field.minItems}.`));
    }
    if (field.maxItems != null && items.length > field.maxItems) {
      issues.push(issue("error", field.id, "max-items", `${field.labels[0]} allows at most ${field.maxItems}.`));
    }
    items.forEach((item, index) => {
      if (field.itemMaxLength != null && charLength(item) > field.itemMaxLength) {
        issues.push(issue("error", field.id, "item-length", `${field.labels[0]} item ${index + 1} is over ${field.itemMaxLength} characters.`));
      }
      if (field.itemMinWords != null && wordCount(item) < field.itemMinWords) {
        issues.push(issue("error", field.id, "item-words", `${field.labels[0]} item ${index + 1} needs at least ${field.itemMinWords} words.`));
      }
      if (field.format === "url" && !isHttpUrl(item)) {
        issues.push(issue("error", field.id, "url", `${field.labels[0]} item ${index + 1} must be an http(s) URL.`));
      }
      if (field.format === "email" && !isEmail(item)) {
        issues.push(issue("error", field.id, "email", `${field.labels[0]} item ${index + 1} must be an email address.`));
      }
    });
  }
  return issues;
}

function checkString(field: FieldSchema, value: string, maxLength: number | undefined, issues: PlanIssue[]): void {
  const length = charLength(value);
  if (field.minLength != null && length < field.minLength) {
    issues.push(issue("error", field.id, "min-length", `${field.labels[0]} must be at least ${field.minLength} characters.`));
  }
  if (maxLength != null && length > maxLength) {
    issues.push(issue("error", field.id, "max-length", `${field.labels[0]} must be at most ${maxLength} characters.`));
  }
  if (field.enum && !field.enum.includes(value)) {
    issues.push(issue("error", field.id, "enum", `${field.labels[0]} must be one of: ${field.enum.join(", ")}.`));
  }
  if (field.pattern && !new RegExp(field.pattern).test(value)) {
    issues.push(issue("error", field.id, "pattern", `${field.labels[0]} does not match the expected format.`));
  }
  if ((field.format === "url" || field.control === "url") && !isHttpUrl(value)) {
    issues.push(issue("error", field.id, "url", `${field.labels[0]} must be an http(s) URL.`));
  }
  if (field.format === "email" && !isEmail(value)) {
    issues.push(issue("error", field.id, "email", `${field.labels[0]} must be an email address.`));
  }
  if (field.format === "date" && !isFullDay(value)) {
    issues.push(issue("error", field.id, "date", `${field.labels[0]} must be a full day, YYYY-MM-DD.`));
  }
  if (field.format === "video" && !isDevpostVideo(value)) {
    issues.push(issue("error", field.id, "video", `${field.labels[0]} must be a public https YouTube, Vimeo, or Youku URL.`));
  }
}

export function effectiveMax(field: FieldSchema, domMax: number | null): number | undefined {
  if (field.maxLength != null && domMax != null) return Math.min(field.maxLength, domMax);
  return field.maxLength ?? domMax ?? undefined;
}

export function asStringList(value: unknown): string[] | null {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  return null;
}

export function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
