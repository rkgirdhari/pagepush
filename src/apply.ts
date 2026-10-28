import type { Action } from "./types.ts";
import {
  checkboxesByLabel,
  clickAdd,
  clickElement,
  ensureCount,
  inputsByLabel,
  locate,
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
    el.textContent = value;
    dispatch(el, "input");
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
  if (el.getAttribute("contenteditable") === "true") return el.textContent ?? "";
  return String((el as HTMLInputElement).value ?? "");
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
