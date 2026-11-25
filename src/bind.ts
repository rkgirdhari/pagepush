import type { Control } from "./types.ts";
import { labelKey, wordsOf } from "./util.ts";
import { DEFAULT_SETTLE_MS, settle } from "./settle.ts";

export interface Page {
  document: Document;
  controls: Control[];
  captcha: boolean;
  password: boolean;
}

const CONTROL_SELECTOR = "input, textarea, select, button, [role='button'], [contenteditable='true'], [role='combobox']";
const CAPTCHA_RESPONSES = ["g-recaptcha-response", "h-captcha-response", "cf-turnstile-response"];

export function bindPage(doc: Document): Page {
  const controls: Control[] = [];
  let generated = 0;
  doc.querySelectorAll(CONTROL_SELECTOR).forEach((node) => {
    const el = node as Element;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    const name = el.getAttribute("name") ?? "";
    if (type === "hidden") return;
    if (CAPTCHA_RESPONSES.includes(name)) return;
    if (!el.id) ensureId(el, `pp-${++generated}`);
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
      [
        ".g-recaptcha",
        "iframe[src*='recaptcha']",
        "iframe[src*='hcaptcha']",
        ".h-captcha",
        ".cf-turnstile",
        "iframe[src*='challenges.cloudflare.com']",
        "[data-sitekey]",
        ...CAPTCHA_RESPONSES.map((name) => `[name='${name}']`),
      ].join(", "),
    ),
  );
}

export function captchaCleared(doc: Document): boolean {
  if (!captchaPresent(doc)) return true;
  const boxes = Array.from(doc.querySelectorAll(CAPTCHA_RESPONSES.map((name) => `[name='${name}']`).join(", ")));
  if (!boxes.length || boxes.some((box) => !("value" in box) || !String((box as HTMLTextAreaElement).value).trim())) return false;

  // Nested markers are one widget. Separate widgets each need a response, including same-provider widgets.
  const markers = Array.from(doc.querySelectorAll(
    ".g-recaptcha, iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .h-captcha, .cf-turnstile, iframe[src*='challenges.cloudflare.com'], [data-sitekey]",
  ));
  const roots = markers.filter((marker) => !markers.some((other) => other !== marker && other.contains(marker)));
  if (boxes.length < roots.length) return false;
  const providers = [
    { selector: ".g-recaptcha, iframe[src*='recaptcha']", name: "g-recaptcha-response" },
    { selector: ".h-captcha, iframe[src*='hcaptcha']", name: "h-captcha-response" },
    { selector: ".cf-turnstile, iframe[src*='challenges.cloudflare.com']", name: "cf-turnstile-response" },
  ];
  return providers.every(({ selector, name }) => {
    const widgets = roots.filter((root) => root.matches(selector) || root.querySelector(selector));
    const responses = boxes.filter((box) => box.getAttribute("name") === name);
    if (responses.length < widgets.length) return false;
    if (widgets.length < 2) return true;
    // Do not let two tokens in one widget stand in for another widget. External tokens are
    // acceptable only when one unmatched widget and one unassigned token remain.
    const unmatched = widgets.filter((root) => !responses.some((box) => root.contains(box)));
    const external = responses.filter((box) => !widgets.some((root) => root.contains(box)));
    return unmatched.length === 0 || (unmatched.length === 1 && external.length === 1);
  });
}

export function locate(doc: Document, id: string): Element | null {
  // getElementById alone silently chooses one of several controls with the same ID.
  const first = doc.getElementById(id);
  if (!first) return null;
  const found = Array.from(doc.querySelectorAll("[id]")).filter((el) => el.id === id);
  return found.length === 1 && found[0] === first ? first : null;
}

export function ensureId(el: Element, fallback: string): string {
  if (!el.id) {
    const doc = el.ownerDocument;
    let id = fallback;
    let suffix = 0;
    while (doc?.getElementById(id)) id = `${fallback}-${++suffix}`;
    el.id = id;
  }
  return el.id;
}

export function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("input, textarea, select, button").forEach((node) => node.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** A native button or an ARIA button (Facebook renders most buttons as div[role=button]). */
export function isButtonControl(control: Pick<Control, "tag" | "role">): boolean {
  return control.tag === "BUTTON" || control.role === "button";
}

function readRawLabels(doc: Document, el: Element): string[] {
  if (el.tagName === "BUTTON") {
    const text = visibleText(el);
    return text ? [text] : [];
  }
  if (el.getAttribute("role") === "button") {
    const text = visibleText(el) || (el.getAttribute("aria-label") ?? "").trim();
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
  const found = raw.filter(Boolean);
  if (!found.length) {
    const placeholder = (el.getAttribute("placeholder") ?? "").trim();
    if (placeholder) found.push(placeholder);
  }
  return found;
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
  root.querySelectorAll("input[type='radio'], [role='radio']").forEach((node) => {
    // Facebook nests a second role=radio (the round indicator) inside each option row. The row is
    // what a person clicks, so only the outermost radio counts as an option.
    if (node.parentElement?.closest("[role='radio']")) return;
    found.push(node as Element);
  });
  return found;
}

/** The text a person reads next to a radio option. */
export function radioText(radio: Element): string {
  const wrapping = radio.closest("label");
  if (wrapping) return visibleText(wrapping);
  const own = ariaName(radio);
  if (own) return own;
  // An option row titled through its nested indicator: <div role=radio><div role=radio aria-labelledby=title>.
  const inner = radio.querySelector("[role='radio']");
  const innerName = inner ? ariaName(inner) : "";
  if (innerName) return innerName;
  const doc = radio.ownerDocument;
  if (radio.id && doc) {
    for (const label of doc.querySelectorAll("label")) {
      if (label.getAttribute("for") === radio.id) return visibleText(label);
    }
  }
  return (radio.textContent ?? "").replace(/\s+/g, " ").trim();
}

function ariaName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  const doc = el.ownerDocument;
  const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  if (!doc || !ids.length) return "";
  return ids
    .map((id) => (doc.getElementById(id)?.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

export function radioChecked(radio: Element): boolean {
  if (radio.getAttribute("role") === "radio") return radio.getAttribute("aria-checked") === "true";
  return (radio as HTMLInputElement).checked === true;
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

const SECTION_SELECTOR =
  "section, fieldset, [role='group'], [role='dialog'], [role='radiogroup'], [role='region'], [role='main'], [role='form']";
/** Regions Facebook names only by their first line of text (the /post/create view has no headings). */
const TITLED_BY_FIRST_TEXT = new Set(["main", "dialog"]);

/** The first section named by any of `names`, optionally only inside `within`. */
export function findSection(doc: Document, names: string[], within?: Element): Element | null {
  const wanted = names.map((name) => labelKey(name));
  const inside = (el: Element): boolean => !within || (within !== el && within.contains(el));
  for (const el of doc.querySelectorAll(SECTION_SELECTOR)) {
    if (!inside(el)) continue;
    const texts = sectionTexts(doc, el);
    if (texts.some((text) => wanted.includes(labelKey(text)))) return el;
  }
  for (const heading of doc.querySelectorAll("h1, h2, h3, legend")) {
    if (!wanted.includes(labelKey(heading.textContent ?? ""))) continue;
    const section = heading.closest(SECTION_SELECTOR) ?? heading.parentElement;
    // A heading straight inside the scoping dialog (Facebook's "Choose an option" in "Action
    // button") names the dialog's own content, so the dialog itself is the group.
    if (section && (inside(section) || section === within)) return section;
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
  if (!texts.length && TITLED_BY_FIRST_TEXT.has(el.getAttribute("role") ?? "")) {
    const first = firstText(el);
    if (first) texts.push(first);
  }
  return texts;
}

/** The first non-empty text node outside form controls, the way a person reads a region's title. */
function firstText(el: Element): string {
  const doc = el.ownerDocument;
  if (!doc) return "";
  const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent?.closest("input, textarea, select, [contenteditable='true'], [role='button']")) continue;
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
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

export function clickAdd(root: Element, addLabel: string, guard?: (target: Element) => void): boolean {
  const want = labelKey(addLabel);
  for (const button of root.querySelectorAll("button")) {
    if (labelKey(button.textContent ?? "") === want) {
      guard?.(button);
      clickElement(button);
      return true;
    }
  }
  return false;
}

/**
 * Clicks the section's add button until there are `count` labelled inputs, waiting up to
 * `settleMs` after each click for the new row to render. Never invents a row the page refused.
 */
export async function ensureCount(
  root: Element,
  label: string,
  count: number,
  addLabel?: string,
  settleMs = DEFAULT_SETTLE_MS,
  guard?: (target: Element) => void,
): Promise<Element[]> {
  let inputs = inputsByLabel(root, label);
  let attempts = 0;
  const doc = root.ownerDocument;
  while (inputs.length < count && addLabel && doc && attempts < count + 1) {
    const before = inputs.length;
    if (!clickAdd(root, addLabel, guard)) break;
    const grew = await settle(doc, () => inputsByLabel(root, label).length > before, { timeoutMs: settleMs });
    inputs = inputsByLabel(root, label);
    if (!grew) break;
    attempts += 1;
  }
  return inputs;
}

export function fileCount(el: Element | null): number {
  if (!el || !("files" in el)) return 0;
  const files = (el as HTMLInputElement).files;
  return files?.length ?? 0;
}

/** True when `token` already shows as a picked value in the widget (chip, selected option, or Facebook's Remove button). */
export function tokenLanded(widget: Element, token: string, option?: Element): boolean {
  const want = labelKey(token);
  const label = labelKey(option?.textContent ?? "");
  for (const chip of widget.querySelectorAll("[data-tag], [role='option'][aria-selected='true']")) {
    const tag = labelKey(chip.getAttribute("data-tag") ?? chip.getAttribute("data-slug") ?? chip.getAttribute("value") ?? "");
    const text = labelKey(chip.textContent ?? "");
    if (tag === want || text === want || (label && text === label)) return true;
  }
  // Facebook (verified 2026-11-25): picked values sit in span[role=list][aria-label="Selected values"],
  // each with a "Remove <value>" button. The listbox itself is cleared after a pick.
  const names = new Set([want, label].filter(Boolean));
  for (const remove of widget.querySelectorAll("[role='button'][aria-label]")) {
    const aria = labelKey(remove.getAttribute("aria-label") ?? "");
    if (aria.startsWith("remove ") && names.has(aria.slice("remove ".length))) return true;
  }
  for (const list of widget.querySelectorAll("[role='list'][aria-label]")) {
    if (labelKey(list.getAttribute("aria-label") ?? "") !== "selected values") continue;
    for (const item of list.children) {
      if (names.has(labelKey(visibleText(item)))) return true;
    }
  }
  return false;
}
