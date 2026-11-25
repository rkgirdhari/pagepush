import type { Action } from "./types.ts";
import {
  checkboxesByLabel,
  clickAdd,
  clickElement,
  ensureCount,
  inputsByLabel,
  locate,
  radioChecked,
  radioText,
  radiosIn,
  rowOf,
  visibleText,
  widgetOf,
} from "./bind.ts";
import { labelKey } from "./util.ts";

export function writeAction(doc: Document, action: Action): boolean {
  switch (action.kind) {
    case "text":
    case "textarea":
    case "url":
    case "email":
    case "date":
      return writeText(doc, action);
    case "tags":
      return writeTags(doc, action);
    case "tokens":
      return writeTokens(doc, action);
    case "lines":
      return writeLines(doc, action);
    case "select":
      return writeSelect(doc, action);
    case "checkbox":
      return writeCheck(doc, action);
    case "button":
      return writeButton(doc, action);
    case "choice":
      return writeChoice(doc, action);
    case "invites":
      return writeInvites(doc, action);
    case "pricing":
      return writePricing(doc, action);
    case "features":
      return writeFeatures(doc, action);
    case "faq":
      return writeFaq(doc, action);
    default:
      return false;
  }
}

export function matchesAction(doc: Document, action: Action): boolean {
  switch (action.kind) {
    case "text":
    case "textarea":
    case "url":
    case "email":
    case "date":
      return readText(doc, action) === action.value;
    case "tags":
      return landedAll(widgetOf(locate(doc, action.controlId) ?? doc.documentElement), stringList(action.value));
    case "tokens":
      return tokensMatch(doc, action);
    case "lines":
      return linesMatch(doc, action);
    case "select":
      return selectMatches(doc, action);
    case "choice":
      return choiceMatches(doc, action);
    case "pricing":
      return pricingMatches(doc, action);
    case "features":
      return featuresMatch(doc, action);
    case "faq":
      return faqMatches(doc, action);
    default:
      return false;
  }
}

function writeText(doc: Document, action: Action): boolean {
  const el = locate(doc, action.controlId);
  if (!el || typeof action.value !== "string") return false;
  setValue(el, action.value);
  return readValue(el) === action.value;
}

function readText(doc: Document, action: Action): string {
  const el = locate(doc, action.controlId);
  return el ? readValue(el) : "";
}

function writeTags(doc: Document, action: Action): boolean {
  const el = locate(doc, action.controlId);
  const tags = stringList(action.value);
  if (!el) return false;
  const widget = widgetOf(el);
  for (const tag of tags) {
    setValue(el, tag);
    dispatchKey(el, "keydown", "Enter");
    if (!chipLanded(widget, tag)) {
      setValue(el, "");
      return false;
    }
  }
  return landedAll(widget, tags);
}

function writeTokens(doc: Document, action: Action): boolean {
  const el = locate(doc, action.controlId);
  const tokens = stringList(action.value);
  if (!el) return false;
  const widget = widgetOf(el);
  for (const token of tokens) {
    setValue(el, token);
    const option = optionsOf(el).find((candidate) => optionMatches(candidate, token));
    if (!option) {
      setValue(el, "");
      return false;
    }
    clickElement(option);
    if (!tokenLanded(widget, token, option)) return false;
  }
  return tokens.every((token) => tokenLanded(widget, token));
}

function tokensMatch(doc: Document, action: Action): boolean {
  const el = locate(doc, action.controlId);
  if (!el) return false;
  const widget = widgetOf(el);
  return stringList(action.value).every((token) => tokenLanded(widget, token));
}

function writeLines(doc: Document, action: Action): boolean {
  const payload = linePayload(action.value);
  if (!payload) return false;
  const root = scope(doc, action);
  const inputs = ensureCount(root, payload.label, payload.lines.length, payload.addLabel);
  if (inputs.length === 1 && payload.lines.length > 1 && inputs[0]!.tagName === "TEXTAREA") {
    setValue(inputs[0]!, payload.lines.join("\n"));
    return linesMatch(doc, action);
  }
  if (inputs.length < payload.lines.length) return false;
  payload.lines.forEach((line, index) => setValue(inputs[index]!, line));
  return linesMatch(doc, action);
}

function linesMatch(doc: Document, action: Action): boolean {
  const payload = linePayload(action.value);
  if (!payload) return false;
  const inputs = inputsByLabel(scope(doc, action), payload.label);
  if (inputs.length === 1 && payload.lines.length > 1 && inputs[0]!.tagName === "TEXTAREA") {
    return readValue(inputs[0]!) === payload.lines.join("\n");
  }
  return payload.lines.every((line, index) => inputs[index] != null && readValue(inputs[index]!) === line);
}

function writeSelect(doc: Document, action: Action): boolean {
  const el = locate(doc, action.controlId);
  if (!el || typeof action.value !== "string") return false;
  const option = optionElements(el).find((candidate) => optionMatches(candidate, action.value as string));
  if (!option) return false;
  const optionValue = option.getAttribute("value") ?? (option.textContent ?? "").trim();
  setValue(el, optionValue);
  return selectMatches(doc, action);
}

function selectMatches(doc: Document, action: Action): boolean {
  const el = locate(doc, action.controlId) as HTMLSelectElement | null;
  if (!el || typeof action.value !== "string") return false;
  const expected = labelKey(action.value);
  if (labelKey(readValue(el)) === expected) return true;
  const option = optionElements(el)[el.selectedIndex];
  if (!option) return false;
  const text = (option.textContent ?? "").trim();
  return labelKey(text) === expected || labelKey(option.getAttribute("value") ?? "") === expected;
}

function writeCheck(doc: Document, action: Action): boolean {
  const el = locate(doc, action.controlId);
  if (!el) return false;
  setChecked(el, true);
  return (el as HTMLInputElement).checked === true;
}

function writeChoice(doc: Document, action: Action): boolean {
  const group = locate(doc, action.controlId);
  if (!group || typeof action.value !== "string") return false;
  const radio = radiosIn(group).find((candidate) => radioIs(candidate, action.value as string));
  if (!radio) return false;
  if (!radioChecked(radio)) activate(radio);
  return choiceMatches(doc, action);
}

function choiceMatches(doc: Document, action: Action): boolean {
  const group = locate(doc, action.controlId);
  if (!group || typeof action.value !== "string") return false;
  const selected = radiosIn(group).filter((radio) => radioChecked(radio));
  return selected.length === 1 && radioIs(selected[0]!, action.value);
}

function radioIs(radio: Element, value: string): boolean {
  const want = labelKey(value);
  return labelKey(radioText(radio)) === want || labelKey(radio.getAttribute("value") ?? "") === want;
}

/** A real activation: native .click() runs the browser's default action, so React sees the change. */
function activate(el: Element): void {
  const clickable = el as Element & { click?: () => void };
  if (typeof clickable.click === "function") clickable.click();
  else clickElement(el);
}

function writeButton(doc: Document, action: Action): boolean {
  const el = locate(doc, action.controlId);
  if (!el) return false;
  clickElement(el);
  return true;
}

function writeInvites(doc: Document, action: Action): boolean {
  const payload = invitePayload(action.value);
  const el = locate(doc, action.controlId);
  if (!payload || !el) return false;
  const root = widgetOf(el);
  for (const email of payload.emails) {
    setValue(el, email);
    if (!clickAdd(root, payload.addLabel)) return false;
    if (!chipLanded(root, email)) return false;
  }
  return payload.emails.every((email) => chipLanded(root, email));
}

interface PricingPayload {
  model: string;
  tiers: { name: string; price: number; originalPrice?: number; recommended?: boolean }[];
  features: { label: string; values: string[]; tooltip?: string }[];
  labels: {
    addTier: string;
    addFeature: string;
    tierName: string;
    price: string;
    originalPrice: string;
    recommended: string;
    feature: string;
    tooltip: string;
    value: string;
    codes: string;
    licensing: string;
  };
}

function writePricing(doc: Document, action: Action): boolean {
  const payload = action.value as PricingPayload;
  const root = scope(doc, action);
  if (!selectModel(root, payload)) return false;
  const nameInputs = ensureCount(root, payload.labels.tierName, payload.tiers.length, payload.labels.addTier);
  if (nameInputs.length < payload.tiers.length) return false;
  for (let index = 0; index < payload.tiers.length; index += 1) {
    const tier = payload.tiers[index]!;
    const row = rowOf(nameInputs[index]!);
    setValue(nameInputs[index]!, tier.name);
    const price = inputsByLabel(row, payload.labels.price)[0];
    if (!price) return false;
    setValue(price, String(tier.price));
    const original = inputsByLabel(row, payload.labels.originalPrice)[0];
    if (original) setValue(original, tier.originalPrice == null ? "" : String(tier.originalPrice));
    const recommended = checkboxesByLabel(row, payload.labels.recommended)[0];
    if (recommended) setChecked(recommended, Boolean(tier.recommended));
  }
  const featureInputs = ensureCount(root, payload.labels.feature, payload.features.length, payload.labels.addFeature);
  if (featureInputs.length < payload.features.length) return false;
  for (let index = 0; index < payload.features.length; index += 1) {
    const feature = payload.features[index]!;
    const row = rowOf(featureInputs[index]!);
    setValue(featureInputs[index]!, feature.label);
    const tooltip = inputsByLabel(row, payload.labels.tooltip)[0];
    if (tooltip) setValue(tooltip, feature.tooltip ?? "");
    const cells = inputsByLabel(row, payload.labels.value);
    if (cells.length < feature.values.length) return false;
    feature.values.forEach((value, cell) => setValue(cells[cell]!, value));
  }
  return pricingMatches(doc, action);
}

function pricingMatches(doc: Document, action: Action): boolean {
  const payload = action.value as PricingPayload;
  const root = scope(doc, action);
  const selected = radiosIn(root).find((radio) => (radio as HTMLInputElement).checked);
  if (!selected || !radioMatches(selected, payload.model, payload.labels)) return false;
  const names = inputsByLabel(root, payload.labels.tierName);
  if (names.length < payload.tiers.length) return false;
  for (let index = 0; index < payload.tiers.length; index += 1) {
    const tier = payload.tiers[index]!;
    const row = rowOf(names[index]!);
    if (readValue(names[index]!) !== tier.name) return false;
    const price = inputsByLabel(row, payload.labels.price)[0];
    if (!price || readValue(price) !== String(tier.price)) return false;
    const original = inputsByLabel(row, payload.labels.originalPrice)[0];
    if (original && readValue(original) !== (tier.originalPrice == null ? "" : String(tier.originalPrice))) return false;
    const recommended = checkboxesByLabel(row, payload.labels.recommended)[0];
    if (recommended && (recommended as HTMLInputElement).checked !== Boolean(tier.recommended)) return false;
  }
  const features = inputsByLabel(root, payload.labels.feature);
  if (features.length < payload.features.length) return false;
  for (let index = 0; index < payload.features.length; index += 1) {
    const feature = payload.features[index]!;
    const row = rowOf(features[index]!);
    if (readValue(features[index]!) !== feature.label) return false;
    const cells = inputsByLabel(row, payload.labels.value);
    if (feature.values.some((value, cell) => cells[cell] == null || readValue(cells[cell]!) !== value)) return false;
  }
  return true;
}

function selectModel(root: Element, payload: PricingPayload): boolean {
  const radios = radiosIn(root);
  const match = radios.find((radio) => radioMatches(radio, payload.model, payload.labels));
  if (!match) return false;
  for (const radio of radios) setChecked(radio, radio === match);
  return true;
}

function radioMatches(radio: Element, model: string, labels: PricingPayload["labels"]): boolean {
  const text = radio.closest("label") ? visibleText(radio.closest("label")!) : (radio.getAttribute("aria-label") ?? "");
  const wanted = model === "codes" ? labels.codes : labels.licensing;
  return labelKey(radio.getAttribute("value") ?? "") === labelKey(model) || labelKey(text) === labelKey(wanted);
}

interface FeaturePayload {
  sectionHeader: string;
  stories: { title: string; bullets: string[] }[];
  labels: { header: string; title: string; bullets: string; add: string };
}

function writeFeatures(doc: Document, action: Action): boolean {
  const payload = action.value as FeaturePayload;
  const root = scope(doc, action);
  const header = inputsByLabel(root, payload.labels.header)[0];
  if (!header) return false;
  setValue(header, payload.sectionHeader);
  const titles = ensureCount(root, payload.labels.title, payload.stories.length, payload.labels.add);
  if (titles.length < payload.stories.length) return false;
  for (let index = 0; index < payload.stories.length; index += 1) {
    const story = payload.stories[index]!;
    setValue(titles[index]!, story.title);
    const bullets = inputsByLabel(rowOf(titles[index]!), payload.labels.bullets)[0];
    if (!bullets) return false;
    setValue(bullets, story.bullets.join("\n"));
  }
  return featuresMatch(doc, action);
}

function featuresMatch(doc: Document, action: Action): boolean {
  const payload = action.value as FeaturePayload;
  const root = scope(doc, action);
  const header = inputsByLabel(root, payload.labels.header)[0];
  if (!header || readValue(header) !== payload.sectionHeader) return false;
  const titles = inputsByLabel(root, payload.labels.title);
  return payload.stories.every((story, index) => {
    const title = titles[index];
    if (!title || readValue(title) !== story.title) return false;
    const bullets = inputsByLabel(rowOf(title), payload.labels.bullets)[0];
    return bullets != null && readValue(bullets) === story.bullets.join("\n");
  });
}

interface FaqPayload {
  items: { question: string; answer: string }[];
  labels: { question: string; answer: string; add: string };
}

function writeFaq(doc: Document, action: Action): boolean {
  const payload = action.value as FaqPayload;
  const root = scope(doc, action);
  const questions = ensureCount(root, payload.labels.question, payload.items.length, payload.labels.add);
  if (questions.length < payload.items.length) return false;
  for (let index = 0; index < payload.items.length; index += 1) {
    const item = payload.items[index]!;
    setValue(questions[index]!, item.question);
    const answer = inputsByLabel(rowOf(questions[index]!), payload.labels.answer)[0];
    if (!answer) return false;
    setValue(answer, item.answer);
  }
  return faqMatches(doc, action);
}

function faqMatches(doc: Document, action: Action): boolean {
  const payload = action.value as FaqPayload;
  const root = scope(doc, action);
  const questions = inputsByLabel(root, payload.labels.question);
  return payload.items.every((item, index) => {
    const question = questions[index];
    if (!question || readValue(question) !== item.question) return false;
    const answer = inputsByLabel(rowOf(question), payload.labels.answer)[0];
    return answer != null && readValue(answer) === item.answer;
  });
}

function scope(doc: Document, action: Action): Element {
  if (action.sectionId) return locate(doc, action.sectionId) ?? doc.documentElement;
  return doc.documentElement;
}

function setValue(el: Element, value: string): void {
  if (el.getAttribute("contenteditable") === "true") {
    setRichText(el, value);
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else (el as HTMLInputElement).value = value;
  dispatch(el, "input");
  dispatch(el, "change");
}

function setChecked(el: Element, checked: boolean): void {
  (el as HTMLInputElement).checked = checked;
  dispatch(el, "input");
  dispatch(el, "change");
}

function readValue(el: Element): string {
  if (el.getAttribute("contenteditable") === "true") return readRichText(el);
  return String((el as HTMLInputElement).value ?? "");
}

/**
 * Rich-text editors (Facebook's Lexical composer above all) keep their own state and only
 * accept text that arrives through the browser's input pipeline. Setting DOM text directly
 * desyncs that state and the text is lost on the next render or on submit.
 *
 * One delivery path is used, never two, so an editor that applies text asynchronously is
 * not handed the same text twice:
 *   1. execCommand("insertText"), the native pipeline (fires trusted beforeinput/input);
 *   2. otherwise a cancelable beforeinput (insertText) that the editor handles itself;
 *   3. otherwise a paste event carrying text/plain;
 *   4. otherwise, only for a plain contenteditable that is not a Lexical root, DOM text plus input.
 * A Lexical editor that took none of these is left untouched, so readback fails and the field
 * is reported unconfirmed instead of silently holding text the editor never registered.
 */
function setRichText(el: Element, value: string): void {
  const doc = el.ownerDocument;
  if (!doc) return;
  focusAndSelectAll(el);
  if (deliverByExecCommand(doc, el, value)) return;
  if (!dispatchInputEvent(el, "beforeinput", value)) {
    dispatchInputEvent(el, "input", value);
    return;
  }
  if (dispatchPaste(el, value)) return;
  if (isLexical(el)) return;
  el.textContent = value;
  dispatchInputEvent(el, "input", value);
}

function isLexical(el: Element): boolean {
  return el.closest("[data-lexical-editor='true']") != null;
}

function focusAndSelectAll(el: Element): void {
  (el as HTMLElement).focus?.();
  const view = el.ownerDocument?.defaultView;
  const selection = view?.getSelection?.();
  const doc = el.ownerDocument;
  if (!selection || !doc?.createRange) return;
  const range = doc.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** True when the native pipeline reached the editor (any input event fired during the command). */
function deliverByExecCommand(doc: Document, el: Element, value: string): boolean {
  const exec = (doc as Document & { execCommand?: (command: string, ui: boolean, value: string) => boolean }).execCommand;
  if (typeof exec !== "function") return false;
  let reached = false;
  const seen = (): void => { reached = true; };
  el.addEventListener("beforeinput", seen);
  el.addEventListener("input", seen);
  let ok = false;
  try {
    ok = exec.call(doc, "insertText", false, value) === true;
  } catch {
    ok = false;
  } finally {
    el.removeEventListener("beforeinput", seen);
    el.removeEventListener("input", seen);
  }
  return ok && reached;
}

/** Dispatches an InputEvent. Returns false when a handler cancelled it (the editor took the text). */
function dispatchInputEvent(el: Element, type: "beforeinput" | "input", data: string): boolean {
  const view = el.ownerDocument?.defaultView;
  const InputCtor = (view as { InputEvent?: typeof InputEvent } | null | undefined)?.InputEvent;
  const init = { bubbles: true, cancelable: type === "beforeinput", inputType: "insertText", data };
  let event: Event;
  if (typeof InputCtor === "function") {
    event = new InputCtor(type, init);
  } else {
    const EventCtor = view?.Event ?? Event;
    event = new EventCtor(type, init);
    Object.defineProperty(event, "inputType", { value: init.inputType });
    Object.defineProperty(event, "data", { value: data });
  }
  return el.dispatchEvent(event);
}

/** Returns true when a handler cancelled the paste (the editor inserted the text itself). */
function dispatchPaste(el: Element, text: string): boolean {
  const view = el.ownerDocument?.defaultView as
    | (Window & { DataTransfer?: typeof DataTransfer; ClipboardEvent?: typeof ClipboardEvent })
    | null;
  if (!view || typeof view.DataTransfer !== "function" || typeof view.ClipboardEvent !== "function") return false;
  try {
    const data = new view.DataTransfer();
    data.setData("text/plain", text);
    const event = new view.ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    return !el.dispatchEvent(event);
  } catch {
    return false;
  }
}

const BLOCK = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE)$/;

/** Text as the person sees it: paragraphs and <br> become line breaks. */
function readRichText(el: Element): string {
  let out = "";
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out += child.nodeValue ?? "";
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = (child as Element).tagName;
      if (tag === "BR") {
        out += "\n";
        continue;
      }
      const block = BLOCK.test(tag);
      if (block && out && !out.endsWith("\n")) out += "\n";
      walk(child);
    }
  };
  walk(el);
  return out.replace(/\n+$/, "");
}

function dispatch(el: Element, type: string): void {
  const view = el.ownerDocument?.defaultView;
  const EventCtor = view?.Event ?? Event;
  el.dispatchEvent(new EventCtor(type, { bubbles: true }));
}

function dispatchKey(el: Element, type: string, key: string): void {
  const view = el.ownerDocument?.defaultView as (Window & { KeyboardEvent?: typeof KeyboardEvent }) | null;
  if (view && typeof view.KeyboardEvent === "function") {
    el.dispatchEvent(new view.KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
    return;
  }
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  el.dispatchEvent(event);
}

function optionsOf(input: Element): Element[] {
  const listId = input.getAttribute("aria-controls");
  const doc = input.ownerDocument;
  const list = listId && doc ? doc.getElementById(listId) : widgetOf(input).querySelector("[role='listbox']");
  if (!list) return [];
  return Array.from(list.querySelectorAll("[role='option']"));
}

function optionElements(el: Element): Element[] {
  return Array.from(el.querySelectorAll("option"));
}

function optionMatches(option: Element, token: string): boolean {
  const want = labelKey(token);
  const ids = [option.getAttribute("data-slug"), option.getAttribute("value")];
  const text = (option.textContent ?? "").trim();
  return ids.some((id) => id != null && id !== "" && labelKey(id) === want) || labelKey(text) === want;
}

function tokenLanded(widget: Element, token: string, option?: Element): boolean {
  const want = labelKey(token);
  const label = labelKey(option?.textContent ?? "");
  for (const chip of widget.querySelectorAll("[data-tag], [role='option'][aria-selected='true']")) {
    const tag = labelKey(chip.getAttribute("data-tag") ?? chip.getAttribute("data-slug") ?? chip.getAttribute("value") ?? "");
    const text = labelKey(chip.textContent ?? "");
    if (tag === want || text === want || (label && text === label)) return true;
  }
  return false;
}

function chipLanded(widget: Element, value: string): boolean {
  const want = labelKey(value);
  for (const chip of widget.querySelectorAll("[data-tag]")) {
    const tag = labelKey(chip.getAttribute("data-tag") ?? "");
    const text = labelKey(chip.textContent ?? "");
    if (tag === want || text === want) return true;
  }
  return false;
}

function landedAll(widget: Element, values: string[]): boolean {
  return values.every((value) => chipLanded(widget, value));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function linePayload(value: unknown): { lines: string[]; label: string; addLabel?: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { lines?: unknown; label?: unknown; addLabel?: unknown };
  if (!Array.isArray(record.lines) || typeof record.label !== "string") return null;
  return {
    lines: record.lines.filter((item): item is string => typeof item === "string"),
    label: record.label,
    addLabel: typeof record.addLabel === "string" ? record.addLabel : undefined,
  };
}

function invitePayload(value: unknown): { emails: string[]; addLabel: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { emails?: unknown; addLabel?: unknown };
  if (!Array.isArray(record.emails) || typeof record.addLabel !== "string") return null;
  return {
    emails: record.emails.filter((item): item is string => typeof item === "string"),
    addLabel: record.addLabel,
  };
}
