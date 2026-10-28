import type { Action, Control, FieldSchema, FillPlan, PlanIssue, PlatformSchema } from "./types.ts";
import { bindPage, ensureId, findSection, labelMatches, type Page } from "./bind.ts";
import { asStringList, effectiveMax, isBlank, validateField } from "./validate.ts";
import { clip, getPath, issue, labelKey, sha256 } from "./util.ts";

export interface PlanDraft {
  schema: PlatformSchema;
  page: Page;
  pack: Record<string, unknown>;
  actions: Action[];
  errors: PlanIssue[];
  warnings: PlanIssue[];
  gates: FillPlan["gates"];
  deferred: string[];
  notes: string[];
  matched: Set<string>;
}

interface BuildInput {
  schema: PlatformSchema;
  document: Document;
  pack: Record<string, unknown>;
  pageUrl: string;
  extraIssues?: PlanIssue[];
  onUnmapped?: (control: Control, draft: PlanDraft) => void;
  after?: (draft: PlanDraft) => void;
}

export function buildPlan(input: BuildInput): FillPlan {
  const draft: PlanDraft = {
    schema: input.schema,
    page: bindPage(input.document),
    pack: input.pack,
    actions: [],
    errors: [],
    warnings: [],
    gates: [],
    deferred: [],
    notes: [],
    matched: new Set<string>(),
  };
  for (const item of input.extraIssues ?? []) {
    if (item.level === "error") draft.errors.push(item);
    else draft.warnings.push(item);
  }

  if (draft.page.password) {
    draft.errors.push(issue("error", "page", "sign-in", "Sign in yourself, then run the shim on the open submission form."));
    return finish(input, draft);
  }
  if (draft.page.captcha) {
    draft.gates.push({
      code: "captcha",
      message: "Solve the captcha on the page. The shim leaves it for you.",
    });
  }

  for (const field of input.schema.fields) planField(draft, field);
  for (const control of draft.page.controls) {
    if (draft.matched.has(control.id)) continue;
    if (control.tag === "BUTTON" || control.type === "hidden") continue;
    if (control.type === "radio" && !control.required) continue;
    input.onUnmapped?.(control, draft);
  }
  input.after?.(draft);
  return finish(input, draft);
}

function planField(draft: PlanDraft, field: FieldSchema): void {
  if (field.control === "pricing" || field.control === "features" || field.control === "faq") {
    planSection(draft, field);
    return;
  }
  if (field.control === "file") {
    planFile(draft, field);
    return;
  }
  const control = findControl(draft.page, field);
  if (!control) {
    draft.deferred.push(field.id);
    return;
  }
  draft.matched.add(control.id);
  if (control.disabled) {
    draft.warnings.push(issue("warning", field.id, "locked", `${field.labels[0]} is locked on this page and was left alone.`));
    return;
  }
  if (field.control === "checkbox" || field.control === "button") {
    planCommitControl(draft, field, control);
    return;
  }
  if (field.control === "invites") {
    planInvites(draft, field, control);
    return;
  }
  const value = getPath(draft.pack, field.path);
  if (isBlank(value)) {
    if (field.required) draft.errors.push(issue("error", field.id, "required", `${field.labels[0]} is required on this page.`));
    return;
  }
  const prepared = prepareValue(field, value);
  const problems = validateField(field, prepared, effectiveMax(field, control.maxLength));
  problems.forEach((problem) => (problem.level === "error" ? draft.errors : draft.warnings).push(problem));
  if (problems.some((problem) => problem.level === "error")) return;
  if (field.control === "tokens" && field.taxonomy) {
    const missing = missingTokens(control, asStringList(prepared) ?? []);
    if (missing.length) {
      draft.errors.push(issue("error", field.id, "taxonomy-miss", `${field.labels[0]} has no option for ${missing.join(", ")}.`));
      return;
    }
  }
  if (field.control === "select" && typeof prepared === "string" && !selectHas(control, prepared)) {
    draft.errors.push(issue("error", field.id, "option-miss", `${field.labels[0]} has no option for ${prepared}.`));
    return;
  }
  if (blocked(draft, field.id)) return;
  const kind = field.control;
  if (kind === "lines") {
    const lines = asStringList(prepared) ?? [];
    draft.actions.push(action({
      id: field.id,
      phase: "draft",
      kind,
      label: field.labels[0] ?? field.id,
      controlId: control.id,
      value: { lines, label: matchedLabel(control, field), addLabel: field.addLabel },
    }));
    return;
  }
  draft.actions.push(action({
    id: field.id,
    phase: field.phase === "commit" ? "commit" : "draft",
    kind,
    label: matchedLabel(control, field),
    controlId: control.id,
    value: prepared,
  }));
}

function planCommitControl(draft: PlanDraft, field: FieldSchema, control: Control): void {
  const value = getPath(draft.pack, field.path);
  if (value === true && !blocked(draft, field.id)) {
    draft.actions.push(action({
      id: field.id,
      phase: "commit",
      kind: field.control,
      label: matchedLabel(control, field),
      controlId: control.id,
      value: true,
    }));
    return;
  }
  if (field.required) {
    draft.errors.push(issue("error", field.id, "required", `${field.labels[0]} is required before submit.`));
  }
}

function planInvites(draft: PlanDraft, field: FieldSchema, control: Control): void {
  const emails = asStringList(getPath(draft.pack, field.path)) ?? [];
  if (!emails.length) return;
  const problems = validateField(field, emails);
  problems.forEach((problem) => (problem.level === "error" ? draft.errors : draft.warnings).push(problem));
  if (problems.some((problem) => problem.level === "error") || blocked(draft, field.id)) return;
  draft.actions.push(action({
    id: field.id,
    phase: "commit",
    kind: "invites",
    label: field.labels[0] ?? "Teammates",
    controlId: control.id,
    value: { emails, addLabel: field.addLabel ?? "Invite" },
  }));
}

function planFile(draft: PlanDraft, field: FieldSchema): void {
  const control = findControl(draft.page, field);
  if (!control) {
    draft.deferred.push(field.id);
    return;
  }
  draft.matched.add(control.id);
  if (field.required) {
    draft.gates.push({
      code: "file",
      fieldId: field.id,
      controlId: control.id,
      message: `Attach ${field.labels[0]} before submit.`,
    });
  } else {
    draft.notes.push(`${field.labels[0]}: attach the file yourself`);
  }
}

function planSection(draft: PlanDraft, field: FieldSchema): void {
  const section = findSection(draft.page.document, field.labels);
  if (!section) {
    draft.deferred.push(field.id);
    return;
  }
  const sectionId = ensureId(section, `pp-${field.id}`);
  claim(draft, section);
  if (blocked(draft, field.id)) return;
  const value = getPath(draft.pack, field.path);
  if (value == null) {
    if (field.required) draft.errors.push(issue("error", field.id, "required", `${field.labels[0]} is required on this page.`));
    return;
  }
  if (field.control === "pricing") {
    const payload = pricingPayload(draft.schema, value);
    if (!payload) {
      draft.errors.push(issue("error", field.id, "shape", "Pricing needs a model, tiers, and feature rows."));
      return;
    }
    draft.actions.push(action({
      id: field.id,
      phase: "draft",
      kind: "pricing",
      label: field.labels[0] ?? "Pricing",
      controlId: sectionId,
      sectionId,
      value: payload,
    }));
    return;
  }
  if (field.control === "features") {
    const payload = featurePayload(draft.schema, value);
    if (!payload) {
      draft.errors.push(issue("error", field.id, "shape", "Highlighted features need a header and stories."));
      return;
    }
    draft.actions.push(action({
      id: field.id,
      phase: "draft",
      kind: "features",
      label: field.labels[0] ?? "Highlighted features",
      controlId: sectionId,
      sectionId,
      value: payload,
    }));
    return;
  }
  const payload = faqPayload(draft.schema, value);
  if (!payload) {
    draft.errors.push(issue("error", field.id, "shape", "FAQ needs question and answer pairs."));
    return;
  }
  draft.actions.push(action({
    id: field.id,
    phase: "draft",
    kind: "faq",
    label: field.labels[0] ?? "FAQ",
    controlId: sectionId,
    sectionId,
    value: payload,
  }));
}

function finish(input: BuildInput, draft: PlanDraft): FillPlan {
  const preview = [...draft.actions.map((item) => item.preview), ...draft.notes];
  const planHash = sha256({
    platform: input.schema.id,
    pageUrl: input.pageUrl,
    notes: draft.notes,
    actions: draft.actions.map((item) => ({
      id: item.id,
      phase: item.phase,
      kind: item.kind,
      label: item.label,
      value: item.value,
      preview: item.preview,
    })),
  });
  return {
    platform: input.schema.id,
    offer: input.schema.offer,
    pageUrl: input.pageUrl,
    actions: draft.actions,
    deferred: draft.deferred,
    errors: draft.errors,
    warnings: draft.warnings,
    gates: draft.gates,
    preview,
    planHash,
  };
}

function claim(draft: PlanDraft, root: Element): void {
  for (const control of draft.page.controls) {
    if (root.contains(control.element)) draft.matched.add(control.id);
  }
}

function blocked(draft: PlanDraft, fieldId: string): boolean {
  return draft.errors.some((item) => item.fieldId === fieldId && item.level === "error");
}

function findControl(page: Page, field: FieldSchema): Control | undefined {
  const candidates = page.controls.filter((control) => fits(control, field.control));
  const exact = candidates.filter((control) => labelMatches(control, field.labels, "exact"));
  const pool = exact.length
    ? exact
    : candidates.filter((control) => labelMatches(control, field.labels, field.match ?? "exact", field.words));
  if (!pool.length) return undefined;
  return field.pick === "last" ? pool[pool.length - 1] : pool[0];
}

function fits(control: Control, kind: string): boolean {
  switch (kind) {
    case "checkbox":
      return control.type === "checkbox";
    case "file":
      return control.type === "file";
    case "button":
      return control.tag === "BUTTON";
    case "select":
      return control.tag === "SELECT";
    case "textarea":
      return control.tag === "TEXTAREA" || control.editable;
    case "tags":
    case "tokens":
    case "lines":
    case "invites":
    case "text":
    case "url":
    case "email":
    case "date":
      return isTextual(control);
    default:
      return false;
  }
}

function isTextual(control: Control): boolean {
  if (control.editable || control.role === "combobox") return true;
  if (control.tag === "TEXTAREA") return true;
  if (control.tag !== "INPUT") return false;
  return !["checkbox", "radio", "file", "password", "hidden", "submit", "button"].includes(control.type);
}

function prepareValue(field: FieldSchema, value: unknown): unknown {
  if (field.control === "lines" || field.control === "tags" || field.control === "tokens" || field.control === "invites") {
    return asStringList(value) ?? value;
  }
  if (typeof value === "string") return value.trim();
  return value;
}

function matchedLabel(control: Control, field: FieldSchema): string {
  const exact = control.rawLabels.find((raw) => field.labels.some((label) => labelKey(label) === labelKey(raw)));
  return exact ?? control.rawLabels[0] ?? field.labels[0] ?? field.id;
}

function missingTokens(control: Control, tokens: string[]): string[] {
  const options = listedOptions(control);
  if (!options.length) return [];
  return tokens.filter((token) => !options.some((option) => optionMatchesToken(option, token)));
}

function listedOptions(control: Control): Element[] {
  const listId = control.element.getAttribute("aria-controls");
  const doc = control.element.ownerDocument;
  const list = listId && doc ? doc.getElementById(listId) : null;
  if (!list) return [];
  return Array.from(list.querySelectorAll("[role='option']"));
}

function optionMatchesToken(option: Element, token: string): boolean {
  const want = labelKey(token);
  const ids = [option.getAttribute("data-slug"), option.getAttribute("value")];
  const text = (option.textContent ?? "").trim();
  return ids.some((id) => id != null && id !== "" && labelKey(id) === want) || labelKey(text) === want;
}

function selectHas(control: Control, value: string): boolean {
  return Array.from(control.element.querySelectorAll("option")).some((option) => {
    const optionValue = option.getAttribute("value") ?? "";
    const text = (option.textContent ?? "").trim();
    return labelKey(optionValue) === labelKey(value) || labelKey(text) === labelKey(value);
  });
}

function action(partial: Omit<Action, "preview">): Action {
  return { ...partial, preview: previewLine(partial) };
}

function previewLine(partial: Omit<Action, "preview">): string {
  if (partial.kind === "invites") {
    const emails = (partial.value as { emails?: string[] }).emails ?? [];
    return `Confirm: invite ${emails.join(", ")}`;
  }
  if (partial.phase === "commit" && partial.kind === "checkbox") return `Confirm: check ${partial.label}`;
  if (partial.phase === "commit" && partial.kind === "button") return `Confirm: ${partial.label}`;
  if (partial.kind === "lines") {
    const lines = (partial.value as { lines?: string[] }).lines ?? [];
    return `${partial.label}: ${clip(lines.join(" / "))}`;
  }
  if (partial.kind === "pricing") {
    const pricing = partial.value as { model?: string; tiers?: { name: string; price: number }[] };
    const tiers = pricing.tiers?.map((tier) => `${tier.name} $${tier.price}`).join(", ") ?? "";
    return `${partial.label}: ${pricing.model ?? ""} ${tiers}`.trim();
  }
  if (partial.kind === "features") {
    const features = partial.value as { sectionHeader?: string };
    return `${partial.label}: ${clip(features.sectionHeader ?? "")}`;
  }
  if (partial.kind === "faq") {
    const items = (partial.value as { items?: unknown[] }).items ?? [];
    return `${partial.label}: ${items.length} questions`;
  }
  if (Array.isArray(partial.value)) return `${partial.label}: ${clip(partial.value.join(", "))}`;
  if (typeof partial.value === "string") return `${partial.label}: ${clip(partial.value)}`;
  return partial.label;
}

interface PricingLabels {
  addTier: string;
  addFeature: string;
  tierName: string;
  price: string;
  originalPrice: string;
  recommended: string;
  feature: string;
  tooltip: string;
  value: string;
}

function pricingPayload(schema: PlatformSchema, value: unknown): Record<string, unknown> | null {
  const labels = objectRule<PricingLabels>(schema, "pricing");
  if (!labels || !value || typeof value !== "object") return null;
  const record = value as {
    model?: unknown;
    tiers?: { name: string; price: number; originalPrice?: number; recommended?: boolean }[];
    features?: { label: string; values: string[]; tooltip?: string }[];
  };
  if (typeof record.model !== "string" || !Array.isArray(record.tiers) || !Array.isArray(record.features)) return null;
  return {
    model: record.model,
    tiers: record.tiers,
    features: record.features,
    labels: { ...labels, codes: "Codes", licensing: "Licensing" },
  };
}

function featurePayload(schema: PlatformSchema, value: unknown): Record<string, unknown> | null {
  const labels = objectRule<{ add: string; header: string; title: string; bullets: string }>(schema, "features");
  if (!labels || !value || typeof value !== "object") return null;
  const record = value as { sectionHeader?: unknown; stories?: { title: string; bullets: string[] }[] };
  if (typeof record.sectionHeader !== "string" || !Array.isArray(record.stories)) return null;
  return { sectionHeader: record.sectionHeader, stories: record.stories, labels };
}

function faqPayload(schema: PlatformSchema, value: unknown): Record<string, unknown> | null {
  const labels = objectRule<{ add: string; question: string; answer: string }>(schema, "faq");
  if (!labels || !Array.isArray(value)) return null;
  const items = value.filter((item) => item && typeof item === "object") as { question: string; answer: string }[];
  if (items.length !== value.length) return null;
  return { items, labels };
}

function objectRule<T>(schema: PlatformSchema, key: string): T | null {
  const value = schema.rules?.[key];
  return value && typeof value === "object" ? (value as T) : null;
}
