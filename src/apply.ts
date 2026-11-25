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
  tokenLanded,
  visibleText,
  widgetOf,
} from "./bind.ts";
import { labelKey } from "./util.ts";
import { DEFAULT_SETTLE_MS, settle, settleFind } from "./settle.ts";

/** How long each write step may wait for the page to settle. */
interface Ctx {
  doc: Document;
  settleMs: number;
  guard: (target?: Element) => void;
}

/**
 * Writes one action and resolves true once the page shows it, waiting up to `settleMs` per step
 * for React and Lexical to re-render. Resolves false when it never settles.
 */
export async function writeAction(doc: Document, action: Action, settleMs = DEFAULT_SETTLE_MS, guard: (target?: Element) => void = () => {}): Promise<boolean> {
  const ctx: Ctx = { doc, settleMs, guard };
  guard();
  switch (action.kind) {
    case "text":
    case "textarea":
    case "url":
    case "email":
    case "date":
      return writeText(ctx, action);
    case "tags":
      return writeTags(ctx, action);
    case "tokens":
      return writeTokens(ctx, action);
    case "lines":
      return writeLines(ctx, action);
    case "select":
      return writeSelect(ctx, action);
    case "checkbox":
      return writeCheck(ctx, action);
    case "button":
      return writeButton(ctx, action);
    case "choice":
      return writeChoice(ctx, action);
    case "invites":
      return writeInvites(ctx, action);
    case "pricing":
      return writePricing(ctx, action);
    case "features":
      return writeFeatures(ctx, action);
    case "faq":
      return writeFaq(ctx, action);
    default:
      return false;
  }
}

function until(ctx: Ctx, check: () => boolean): Promise<boolean> {
  return settle(ctx.doc, check, { timeoutMs: ctx.settleMs });
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

async function writeText(ctx: Ctx, action: Action): Promise<boolean> {
  const el = locate(ctx.doc, action.controlId);
  if (!el || typeof action.value !== "string") return false;
  setValue(ctx, el, action.value);
  // Re-read by id: React may swap the element while it re-renders.
  return until(ctx, () => readText(ctx.doc, action) === action.value);
}

function readText(doc: Document, action: Action): string {
  const el = locate(doc, action.controlId);
  return el ? readValue(el) : "";
}

async function writeTags(ctx: Ctx, action: Action): Promise<boolean> {
  const el = locate(ctx.doc, action.controlId);
  const tags = stringList(action.value);
  if (!el) return false;
  const widget = widgetOf(el);
  for (const tag of tags) {
    if (chipLanded(widget, tag)) continue;
    setValue(ctx, el, tag);
    dispatchKey(ctx, el, "keydown", "Enter");
    if (!(await until(ctx, () => chipLanded(widget, tag)))) {
      setValue(ctx, el, "");
      return false;
    }
  }
  return landedAll(widget, tags);
}

async function writeTokens(ctx: Ctx, action: Action): Promise<boolean> {
  const el = locate(ctx.doc, action.controlId);
  const tokens = stringList(action.value);
  if (!el) return false;
  const widget = widgetOf(el);
  for (const token of tokens) {
    if (tokenLanded(widget, token)) continue;
    setValue(ctx, el, token);
    // Typeahead options arrive after the query round trip.
    const option = await settleFind(ctx.doc, () => optionsOf(el).find((candidate) => optionMatches(candidate, token)), { timeoutMs: ctx.settleMs });
    if (!option) {
      setValue(ctx, el, "");
      return false;
    }
    ctx.guard(option);
    clickElement(option);
    if (!(await until(ctx, () => tokenLanded(widget, token, option)))) return false;
  }
  return tokens.every((token) => tokenLanded(widget, token));
}

function tokensMatch(doc: Document, action: Action): boolean {
  const el = locate(doc, action.controlId);
  if (!el) return false;
  const widget = widgetOf(el);
  return stringList(action.value).every((token) => tokenLanded(widget, token));
}

async function writeLines(ctx: Ctx, action: Action): Promise<boolean> {
  const payload = linePayload(action.value);
  if (!payload) return false;
  const root = scope(ctx.doc, action);
  const inputs = await ensureCount(root, payload.label, payload.lines.length, payload.addLabel, ctx.settleMs, ctx.guard);
  if (inputs.length === 1 && payload.lines.length > 1 && inputs[0]!.tagName === "TEXTAREA") {
    setValue(ctx, inputs[0]!, payload.lines.join("\n"));
    return until(ctx, () => linesMatch(ctx.doc, action));
  }
  if (inputs.length < payload.lines.length) return false;
  payload.lines.forEach((line, index) => setValue(ctx, inputs[index]!, line));
  return until(ctx, () => linesMatch(ctx.doc, action));
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

async function writeSelect(ctx: Ctx, action: Action): Promise<boolean> {
  const el = locate(ctx.doc, action.controlId);
  if (!el || typeof action.value !== "string") return false;
  const option = optionElements(el).find((candidate) => optionMatches(candidate, action.value as string));
  if (!option) return false;
  const optionValue = option.getAttribute("value") ?? (option.textContent ?? "").trim();
  setValue(ctx, el, optionValue);
  return until(ctx, () => selectMatches(ctx.doc, action));
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

async function writeCheck(ctx: Ctx, action: Action): Promise<boolean> {
  const el = locate(ctx.doc, action.controlId);
  if (!el) return false;
  return setChecked(ctx, el, true);
}

async function writeChoice(ctx: Ctx, action: Action): Promise<boolean> {
  const group = locate(ctx.doc, action.controlId);
  if (!group || typeof action.value !== "string") return false;
  const radio = radiosIn(group).find((candidate) => radioIs(candidate, action.value as string));
  if (!radio) return false;
  if (!radioChecked(radio)) activate(ctx, radio);
  return until(ctx, () => choiceMatches(ctx.doc, action));
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
function activate(ctx: Ctx, el: Element): void {
  ctx.guard(el);
  const clickable = el as Element & { click?: () => void };
  if (typeof clickable.click === "function") clickable.click();
  else clickElement(el);
}

/**
 * Facebook keeps Save and Post aria-disabled until React has registered the drafted text, so the
 * click waits (bounded) for the button to enable and reports false rather than clicking a dead one.
 */
async function writeButton(ctx: Ctx, action: Action): Promise<boolean> {
  if (!locate(ctx.doc, action.controlId)) return false;
  const enabled = (): boolean => {
    const el = locate(ctx.doc, action.controlId);
    return el != null && el.getAttribute("aria-disabled") !== "true" && !el.hasAttribute("disabled");
  };
  if (!enabled() && !(await until(ctx, enabled))) return false;
  const button = locate(ctx.doc, action.controlId);
  if (!button) return false;
  ctx.guard(button);
  clickElement(button);
  return true;
}

async function writeInvites(ctx: Ctx, action: Action): Promise<boolean> {
  const payload = invitePayload(action.value);
  const el = locate(ctx.doc, action.controlId);
  if (!payload || !el) return false;
  const root = widgetOf(el);
  for (const email of payload.emails) {
    if (chipLanded(root, email)) continue;
    setValue(ctx, el, email);
    if (!clickAdd(root, payload.addLabel, ctx.guard)) return false;
    if (!(await until(ctx, () => chipLanded(root, email)))) return false;
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

async function writePricing(ctx: Ctx, action: Action): Promise<boolean> {
  const payload = action.value as PricingPayload;
  const root = scope(ctx.doc, action);
  if (!(await selectModel(ctx, root, payload))) return false;
  const nameInputs = await ensureCount(root, payload.labels.tierName, payload.tiers.length, payload.labels.addTier, ctx.settleMs, ctx.guard);
  if (nameInputs.length < payload.tiers.length) return false;
  for (let index = 0; index < payload.tiers.length; index += 1) {
    const tier = payload.tiers[index]!;
    const row = rowOf(nameInputs[index]!);
    setValue(ctx, nameInputs[index]!, tier.name);
    const price = inputsByLabel(row, payload.labels.price)[0];
    if (!price) return false;
    setValue(ctx, price, String(tier.price));
    const original = inputsByLabel(row, payload.labels.originalPrice)[0];
    if (original) setValue(ctx, original, tier.originalPrice == null ? "" : String(tier.originalPrice));
    const recommended = checkboxesByLabel(row, payload.labels.recommended)[0];
    if (recommended) await setChecked(ctx, recommended, Boolean(tier.recommended));
  }
  const featureInputs = await ensureCount(root, payload.labels.feature, payload.features.length, payload.labels.addFeature, ctx.settleMs, ctx.guard);
  if (featureInputs.length < payload.features.length) return false;
  for (let index = 0; index < payload.features.length; index += 1) {
    const feature = payload.features[index]!;
    const row = rowOf(featureInputs[index]!);
    setValue(ctx, featureInputs[index]!, feature.label);
    const tooltip = inputsByLabel(row, payload.labels.tooltip)[0];
    if (tooltip) setValue(ctx, tooltip, feature.tooltip ?? "");
    const cells = inputsByLabel(row, payload.labels.value);
    if (cells.length < feature.values.length) return false;
    feature.values.forEach((value, cell) => setValue(ctx, cells[cell]!, value));
  }
  return until(ctx, () => pricingMatches(ctx.doc, action));
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

async function selectModel(ctx: Ctx, root: Element, payload: PricingPayload): Promise<boolean> {
  const match = radiosIn(root).find((radio) => radioMatches(radio, payload.model, payload.labels));
  if (!match) return false;
  // Clicking the wanted radio unchecks the rest of its group; radios cannot be clicked off.
  return setChecked(ctx, match, true);
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

async function writeFeatures(ctx: Ctx, action: Action): Promise<boolean> {
  const payload = action.value as FeaturePayload;
  const root = scope(ctx.doc, action);
  const header = inputsByLabel(root, payload.labels.header)[0];
  if (!header) return false;
  setValue(ctx, header, payload.sectionHeader);
  const titles = await ensureCount(root, payload.labels.title, payload.stories.length, payload.labels.add, ctx.settleMs, ctx.guard);
  if (titles.length < payload.stories.length) return false;
  for (let index = 0; index < payload.stories.length; index += 1) {
    const story = payload.stories[index]!;
    setValue(ctx, titles[index]!, story.title);
    const bullets = inputsByLabel(rowOf(titles[index]!), payload.labels.bullets)[0];
    if (!bullets) return false;
    setValue(ctx, bullets, story.bullets.join("\n"));
  }
  return until(ctx, () => featuresMatch(ctx.doc, action));
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

async function writeFaq(ctx: Ctx, action: Action): Promise<boolean> {
  const payload = action.value as FaqPayload;
  const root = scope(ctx.doc, action);
  const questions = await ensureCount(root, payload.labels.question, payload.items.length, payload.labels.add, ctx.settleMs, ctx.guard);
  if (questions.length < payload.items.length) return false;
  for (let index = 0; index < payload.items.length; index += 1) {
    const item = payload.items[index]!;
    setValue(ctx, questions[index]!, item.question);
    const answer = inputsByLabel(rowOf(questions[index]!), payload.labels.answer)[0];
    if (!answer) return false;
    setValue(ctx, answer, item.answer);
  }
  return until(ctx, () => faqMatches(ctx.doc, action));
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

function setValue(ctx: Ctx, el: Element, value: string): void {
  ctx.guard(el);
  if (el.getAttribute("contenteditable") === "true") {
    setRichText(ctx, el, value);
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else (el as HTMLInputElement).value = value;
  dispatch(ctx, el, "input");
  dispatch(ctx, el, "change");
}

/**
 * Checks or unchecks with a real click, the way a person does, so React-controlled checkboxes,
 * switches (role=switch / role=checkbox), and radios run their own handlers. Never sets
 * .checked directly. Resolves once the control shows the wanted state.
 */
function setChecked(ctx: Ctx, el: Element, checked: boolean): Promise<boolean> {
  if (isChecked(el) !== checked) activate(ctx, el);
  return until(ctx, () => isChecked(el) === checked);
}

function isChecked(el: Element): boolean {
  const role = el.getAttribute("role");
  if (role === "checkbox" || role === "switch" || role === "radio" || role === "menuitemcheckbox") {
    return el.getAttribute("aria-checked") === "true";
  }
  return (el as HTMLInputElement).checked === true;
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
function setRichText(ctx: Ctx, el: Element, value: string): void {
  const doc = el.ownerDocument;
  if (!doc) return;
  focusAndSelectAll(ctx, el);
  if (deliverByExecCommand(ctx, doc, el, value)) return;
  if (!dispatchInputEvent(ctx, el, "beforeinput", value)) {
    dispatchInputEvent(ctx, el, "input", value);
    return;
  }
  if (dispatchPaste(ctx, el, value)) return;
  if (isLexical(el)) return;
  ctx.guard(el);
  el.textContent = value;
  dispatchInputEvent(ctx, el, "input", value);
}

function isLexical(el: Element): boolean {
  return el.closest("[data-lexical-editor='true']") != null;
}

function focusAndSelectAll(ctx: Ctx, el: Element): void {
  ctx.guard(el);
  (el as HTMLElement).focus?.();
  ctx.guard(el);
  const view = el.ownerDocument?.defaultView;
  const selection = view?.getSelection?.();
  const doc = el.ownerDocument;
  if (!selection || !doc?.createRange) return;
  const range = doc.createRange();
  range.selectNodeContents(el);
  ctx.guard(el);
  selection.removeAllRanges();
  ctx.guard(el);
  selection.addRange(range);
}

/** True when the native pipeline reached the editor (any input event fired during the command). */
function deliverByExecCommand(ctx: Ctx, doc: Document, el: Element, value: string): boolean {
  const exec = (doc as Document & { execCommand?: (command: string, ui: boolean, value: string) => boolean }).execCommand;
  if (typeof exec !== "function") return false;
  let reached = false;
  const seen = (): void => { reached = true; };
  el.addEventListener("beforeinput", seen);
  el.addEventListener("input", seen);
  let ok = false;
  ctx.guard(el);
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
function dispatchInputEvent(ctx: Ctx, el: Element, type: "beforeinput" | "input", data: string): boolean {
  ctx.guard(el);
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
function dispatchPaste(ctx: Ctx, el: Element, text: string): boolean {
  const view = el.ownerDocument?.defaultView as
    | (Window & { DataTransfer?: typeof DataTransfer; ClipboardEvent?: typeof ClipboardEvent })
    | null;
  if (!view || typeof view.DataTransfer !== "function" || typeof view.ClipboardEvent !== "function") return false;
  ctx.guard(el);
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

function dispatch(ctx: Ctx, el: Element, type: string): void {
  ctx.guard(el);
  const view = el.ownerDocument?.defaultView;
  const EventCtor = view?.Event ?? Event;
  el.dispatchEvent(new EventCtor(type, { bubbles: true }));
}

function dispatchKey(ctx: Ctx, el: Element, type: string, key: string): void {
  ctx.guard(el);
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
