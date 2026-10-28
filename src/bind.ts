import type { Control } from "./types.ts";
import { labelKey, wordsOf } from "./util.ts";

export interface Page {
  document: Document;
  controls: Control[];
  captcha: boolean;
  password: boolean;
}

const CONTROL_SELECTOR = "input, textarea, select, button, [contenteditable='true'], [role='combobox']";

export function bindPage(doc: Document): Page {
  const controls: Control[] = [];
  let generated = 0;
  doc.querySelectorAll(CONTROL_SELECTOR).forEach((node) => {
    const el = node as Element;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    const name = el.getAttribute("name") ?? "";
    if (type === "hidden") return;
    if (name === "g-recaptcha-response" || name === "h-captcha-response") return;
    if (!el.id) {
      generated += 1;
      el.id = `pp-${generated}`;
    }
    const rawLabels = readRawLabels(doc, el);
    const labels = rawLabels.map((label) => labelKey(label));
    controls.push({
      id: el.id,
      element: el,
      labels,
      rawLabels,
      required: isRequired(el, rawLabels),
      maxLength: readMaxLength(el),
      tag: el.tagName,
      type,
      role: el.getAttribute("role") ?? "",
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      editable: el.getAttribute("contenteditable") === "true",
    });
  });
  return {
    document: doc,
    controls,
    captcha: captchaPresent(doc),
    password: Boolean(doc.querySelector("input[type='password']")),
  };
}

export function captchaPresent(doc: Document): boolean {
  return Boolean(
    doc.querySelector(
      ".g-recaptcha, iframe[src*='recaptcha'], iframe[src*='hcaptcha'], [data-sitekey], textarea[name='g-recaptcha-response'], textarea[name='h-captcha-response']",
    ),
  );
}

export function captchaCleared(doc: Document): boolean {
  if (!captchaPresent(doc)) return true;
  const boxes = doc.querySelectorAll("textarea[name='g-recaptcha-response'], textarea[name='h-captcha-response']");
  for (const box of boxes) {
    const value = "value" in box ? String((box as HTMLTextAreaElement).value) : "";
    if (value.trim()) return true;
  }
  return false;
}

export function locate(doc: Document, id: string): Element | null {
  return doc.getElementById(id);
}

export function ensureId(el: Element, fallback: string): string {
  if (!el.id) el.id = fallback;
  return el.id;
}

export function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("input, textarea, select, button").forEach((node) => node.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function readRawLabels(doc: Document, el: Element): string[] {
  if (el.tagName === "BUTTON") {
    const text = visibleText(el);
    return text ? [text] : [];
  }
  const raw: string[] = [];
  if (el.id) {
    doc.querySelectorAll("label").forEach((label) => {
      if (label.getAttribute("for") === el.id) raw.push(visibleText(label));
    });
  }
  const wrapping = el.closest("label");
  if (wrapping) raw.push(visibleText(wrapping));
  const aria = el.getAttribute("aria-label");
  if (aria) raw.push(aria.trim());
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const ref of labelledBy.split(/\s+/)) {
      const node = doc.getElementById(ref);
      if (node) raw.push((node.textContent ?? "").replace(/\s+/g, " ").trim());
    }
  }
  return raw.filter(Boolean);
}

function isRequired(el: Element, rawLabels: string[]): boolean {
  if (el.hasAttribute("required") || el.getAttribute("aria-required") === "true") return true;
  return rawLabels.some((label) => /\*\s*$/.test(label));
}

function readMaxLength(el: Element): number | null {
  const attr = el.getAttribute("maxlength");
  if (!attr) return null;
  const parsed = Number(attr);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function labelMatches(control: Control, labels: string[], match: "exact" | "all-words", words?: string[]): boolean {
  const wanted = labels.map((label) => labelKey(label));
  if (control.labels.some((label) => wanted.includes(label))) return true;
  if (match !== "all-words" || !words?.length) return false;
  return control.labels.some((label) => {
    const tokens = new Set(wordsOf(label));
    return words.every((word) => tokens.has(labelKey(word)));
  });
}

function ownerDocument(root: ParentNode): Document | null {
  if (root.nodeType === 9) return root as Document;
  return root.ownerDocument;
}

export function inputsByLabel(root: ParentNode, label: string): Element[] {
  return controlsByLabel(root, label, ["input", "textarea", "select"], (type) => {
    return type !== "hidden" && type !== "radio" && type !== "checkbox" && type !== "file";
  });
}

export function checkboxesByLabel(root: ParentNode, label: string): Element[] {
  return controlsByLabel(root, label, ["input"], (type) => type === "checkbox");
}

export function radiosIn(root: ParentNode): Element[] {
  const found: Element[] = [];
  root.querySelectorAll("input[type='radio']").forEach((node) => found.push(node as Element));
  return found;
}

function controlsByLabel(
  root: ParentNode,
  label: string,
  selectors: string[],
  acceptType: (type: string) => boolean,
): Element[] {
  const doc = ownerDocument(root);
  if (!doc) return [];
  const want = labelKey(label);
  const found: Element[] = [];
  root.querySelectorAll(selectors.join(", ")).forEach((node) => {
    const el = node as Element;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (!acceptType(type)) return;
    const labels = readRawLabels(doc, el).map((item) => labelKey(item));
    if (labels.includes(want)) found.push(el);
  });
  return found;
}

export function findSection(doc: Document, names: string[]): Element | null {
  const wanted = names.map((name) => labelKey(name));
  const candidates = doc.querySelectorAll("section, fieldset, [role='group']");
  for (const el of candidates) {
    const texts = sectionTexts(doc, el);
    if (texts.some((text) => wanted.includes(labelKey(text)))) return el;
  }
  for (const heading of doc.querySelectorAll("h1, h2, h3, legend")) {
    if (!wanted.includes(labelKey(heading.textContent ?? ""))) continue;
    return heading.closest("section, fieldset") ?? heading.parentElement;
  }
  return null;
}

function sectionTexts(doc: Document, el: Element): string[] {
  const texts: string[] = [];
  const aria = el.getAttribute("aria-label");
  if (aria) texts.push(aria);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const ref of labelledBy.split(/\s+/)) {
      const node = doc.getElementById(ref);
      if (node) texts.push(node.textContent ?? "");
    }
  }
  const heading = Array.from(el.children).find((child) => /^(H1|H2|H3|LEGEND)$/.test(child.tagName));
  if (heading) texts.push(heading.textContent ?? "");
  return texts;
}

export function rowOf(input: Element): Element {
  return input.closest("[data-feature], [data-tier], [data-story], [data-faq], tr, fieldset, li") ?? input.parentElement ?? input;
}

export function widgetOf(input: Element): Element {
  return input.closest("[data-widget], fieldset, section") ?? input.parentElement ?? input;
}

export function clickElement(el: Element): void {
  const view = el.ownerDocument?.defaultView as (Window & { MouseEvent?: typeof MouseEvent }) | null;
  if (view && typeof view.MouseEvent === "function") {
    el.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true }));
    return;
  }
  el.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
}

export function clickAdd(root: Element, addLabel: string): boolean {
  const want = labelKey(addLabel);
  for (const button of root.querySelectorAll("button")) {
    if (labelKey(button.textContent ?? "") === want) {
      clickElement(button);
      return true;
    }
  }
  return false;
}

export function ensureCount(root: Element, label: string, count: number, addLabel?: string): Element[] {
  let inputs = inputsByLabel(root, label);
  let guard = 0;
  while (inputs.length < count && addLabel && guard < count + 1) {
    const before = inputs.length;
    if (!clickAdd(root, addLabel)) break;
    inputs = inputsByLabel(root, label);
    if (inputs.length <= before) break;
    guard += 1;
  }
  return inputs;
}

export function fileCount(el: Element | null): number {
  if (!el || !("files" in el)) return 0;
  const files = (el as HTMLInputElement).files;
  return files?.length ?? 0;
}
