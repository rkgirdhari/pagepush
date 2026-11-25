// Production side panel: pack manager, plan inspector, pre-flight checklist, the
// Plan → Draft → Approve & Commit controls, copy-paste fallback, and local-only storage.
// The approval rules live in panel-state.ts and the pack rules in packs.ts; this file wires them
// to the DOM, chrome.tabs, and chrome.storage.local.
import { tierOffer, type FacebookPack, type FacebookTier } from "../browser.ts";
import { isContentEvent, type ContentEvent, type ContentReply, type PanelRequest } from "./messages.ts";
import {
  CTA_SUGGESTIONS,
  HOURS_MODES,
  WEEKDAYS,
  checkPack,
  cleanPack,
  counters,
  fieldById,
  pasteBlocks,
  readPath,
  setPath,
  starterPack,
  tierFields,
} from "./packs.ts";
import {
  bannerFor,
  commitReadiness,
  draftReadiness,
  editPack,
  initialState,
  invalidate,
  recordCommit,
  recordDraft,
  recordDrift,
  startSession,
  type Banner,
  type PanelState,
} from "./panel-state.ts";
import { clearAll, load, saver } from "./storage.ts";

const FACEBOOK_TAB = /^https:\/\/([a-z0-9-]+\.)*facebook\.com\//i;
const RETRIES = 4;
const RETRY_MS = 600;

let state: PanelState = initialState();
let activeTabId: number | null = null;
let busy = false;
const store = saver(chrome.storage.local);

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};
const form = $<HTMLFormElement>("pack-form");
const planButton = $<HTMLButtonElement>("plan");
const draftButton = $<HTMLButtonElement>("draft");
const commitButton = $<HTMLButtonElement>("commit");

// ---------- setup ----------

function buildStaticControls(): void {
  const mode = $<HTMLSelectElement>("hours-mode");
  mode.append(option("", "Not set"));
  for (const item of HOURS_MODES) mode.append(option(item, item));
  const schedule = $("schedule");
  for (const day of WEEKDAYS) {
    const label = document.createElement("label");
    label.htmlFor = `hours-${day}`;
    label.textContent = `${day[0]!.toUpperCase()}${day.slice(1)}`;
    const input = document.createElement("input");
    input.type = "text";
    input.id = `hours-${day}`;
    input.dataset.path = `hours.schedule.${day}`;
    input.placeholder = "9:00–17:00 or Closed";
    schedule.append(label, input);
  }
  const list = $("cta-types");
  for (const item of CTA_SUGGESTIONS) list.append(option(item, item));
}

function option(value: string, text: string): HTMLOptionElement {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = text;
  return el;
}

// ---------- state changes ----------

function commitState(next: PanelState, options: { renderForm?: boolean } = {}): void {
  state = next;
  store.schedule(state);
  render(options);
}

function setBanner(banner: Banner): void {
  const box = $("banner");
  box.dataset.tone = banner.tone;
  $("banner-title").textContent = banner.title;
  $("banner-detail").textContent = banner.detail ?? "";
}

function setTier(tier: FacebookTier): void {
  const base = starterPack(tier);
  const merged = mergeDefaults(base, state.pack) as FacebookPack;
  merged.tier = tier;
  commitState(editPack(state, merged), { renderForm: true });
}

/** Adds the starter structure under existing values without overwriting any of them. */
function mergeDefaults(base: unknown, value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (!base || typeof base !== "object" || Array.isArray(base)) return value === undefined ? base : value;
  if (!value || typeof value !== "object") return structuredClone(base);
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [key, item] of Object.entries(base as Record<string, unknown>)) out[key] = mergeDefaults(item, out[key]);
  return out;
}

// ---------- chrome plumbing ----------

async function refreshActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  return tab ?? null;
}

type SendResult = { reply: ContentReply; tabId: number } | { error: string; message?: string };

async function send(request: PanelRequest, tabId?: number): Promise<SendResult> {
  const tab = await refreshActiveTab();
  if (!tab?.id) return { error: "no-tab" };
  if (tabId != null && tab.id !== tabId) return { error: "context", message: "Switch back to the tab you planned." };
  if (!tab.url || !FACEBOOK_TAB.test(tab.url)) return { error: "not-facebook-tab" };
  for (let attempt = 0; ; attempt += 1) {
    try {
      const reply = (await chrome.tabs.sendMessage(tab.id, request)) as ContentReply | undefined;
      if (!reply) return { error: "no-receiver" };
      return { reply, tabId: tab.id };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (/Receiving end does not exist|Could not establish connection/i.test(text)) {
        if (request.type === "pagepush:plan" || request.type === "pagepush:status") {
          if (attempt < RETRIES - 1) {
            await wait(RETRY_MS);
            continue;
          }
        }
        return { error: "no-receiver" };
      }
      if (/No tab with id|tab was closed|message port closed|back\/forward cache/i.test(text)) return { error: "disconnected" };
      return { error: "error", message: text };
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failure(result: SendResult): boolean {
  if ("error" in result) {
    setBanner(bannerFor(result.error, result.message));
    return true;
  }
  if (!result.reply.ok) {
    setBanner(bannerFor(result.reply.code, result.reply.message));
    return true;
  }
  return false;
}

// ---------- actions ----------

async function planView(auto = false): Promise<void> {
  if (busy) return;
  const check = checkPack(state.pack);
  if (!check.pack) {
    renderPackIssues(check.errors, check.warnings);
    setBanner({ tone: "bad", title: "The pack is not valid yet.", detail: "Fix the pack checks listed above the Plan button, then plan." });
    return;
  }
  busy = true;
  render();
  try {
    const result = await send({ type: "pagepush:plan", pack: cleanPack(state.pack) });
    if (failure(result) || "error" in result || !result.reply.ok || !result.reply.plan) {
      // A failed re-plan never leaves an older approval usable.
      commitState(invalidate(state, "This view could not be planned. Plan again."));
      return;
    }
    commitState(startSession(state, result.tabId, result.reply.plan));
    const plan = result.reply.plan;
    if (plan.errors.length) {
      const refusal = plan.errors.find((item) => ["not-facebook", "page-identity", "not-business-page", "sign-in"].includes(item.code));
      setBanner(refusal ? bannerFor(refusal.code, refusal.message) : { tone: "bad", title: "The plan has errors.", detail: "They are listed in the plan inspector." });
    } else if (!plan.actions.length) {
      setBanner({ tone: "info", title: "Nothing to fill on this view.", detail: "Open the next Page screen; it is planned automatically." });
    } else {
      setBanner({
        tone: "good",
        title: auto ? "Planned the new view." : "Planned.",
        detail: `${plan.actions.filter((a) => a.phase === "draft").length} field(s) to draft, ${plan.actions.filter((a) => a.phase === "commit").length} commit step(s). Review, then Draft.`,
      });
    }
  } finally {
    busy = false;
    render();
  }
}

async function draft(): Promise<void> {
  const session = state.session;
  if (!session || busy || !draftReadiness(state, { activeTabId }).ok) return;
  busy = true;
  render();
  try {
    const result = await send({ type: "pagepush:draft", planHash: session.plan.planHash }, session.tabId);
    if (failure(result) || "error" in result || !result.reply.ok || !result.reply.draft) {
      const code = "error" in result ? result.error : result.reply.ok ? "" : result.reply.code;
      if (["context", "disconnected", "no-plan", "confirm"].includes(code)) {
        commitState(invalidate(state, "The tab no longer holds this plan. Plan again."));
      }
      return;
    }
    commitState(recordDraft(state, result.reply.draft));
    const unconfirmed = result.reply.draft.unconfirmed;
    setBanner(unconfirmed.length
      ? { tone: "warn", title: "Drafted, but some fields did not stick.", detail: "Use the copy-paste fallback for them, or fix the pack and plan again." }
      : { tone: "good", title: "Drafted.", detail: "Read every drafted field on the Facebook page, tick the checklist, then Approve & Commit." });
  } finally {
    busy = false;
    render();
  }
}

async function approveAndCommit(): Promise<void> {
  const session = state.session;
  if (!session || busy || !commitReadiness(state, { activeTabId }).ok) return;
  busy = true;
  render();
  try {
    const verify = await send({ type: "pagepush:verify", planHash: session.plan.planHash }, session.tabId);
    if (failure(verify) || "error" in verify || !verify.reply.ok) return;
    if (verify.reply.drift?.length) {
      commitState(recordDrift(state, session.plan.planHash, verify.reply.drift));
      setBanner(bannerFor("drift"));
      return;
    }
    const result = await send({ type: "pagepush:commit", planHash: session.plan.planHash }, session.tabId);
    if (failure(result) || "error" in result || !result.reply.ok) {
      if (!("error" in result) && !result.reply.ok && result.reply.applied?.length) {
        commitState(invalidate(recordCommit(state), "Part of this commit ran. Check the page before planning again."));
      }
      return;
    }
    commitState(recordCommit(state));
    const steps = session.plan.actions.filter((action) => action.phase === "commit").map((action) => action.label);
    setBanner({ tone: "good", title: `Committed: ${steps.join(", ")}.`, detail: "When Facebook shows the next screen, it is planned automatically." });
  } finally {
    busy = false;
    render();
  }
}

// ---------- rendering ----------

function render(options: { renderForm?: boolean } = {}): void {
  const offer = tierOffer(state.pack.tier);
  $("offer").textContent = offer ? `$${offer.priceUsd} · ${offer.name.split(": ").pop()}` : "";
  for (const radio of document.querySelectorAll<HTMLInputElement>("input[name='tier']")) radio.checked = radio.value === state.pack.tier;
  if (options.renderForm) renderForm();
  renderTierVisibility();
  renderCounters();
  const check = checkPack(state.pack);
  renderPackIssues(check.errors, check.warnings);
  renderInspector();
  renderChecklist();
  renderProgress();
  renderPaste();
  renderControls();
}

function renderForm(): void {
  for (const input of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-path]")) {
    const value = readPath(state.pack, input.dataset.path!);
    input.value = typeof value === "string" ? value : "";
  }
}

function renderTierVisibility(): void {
  const allowed = tierFields(state.pack.tier);
  for (const group of form.querySelectorAll<HTMLElement>("fieldset[data-fields]")) {
    group.hidden = !group.dataset.fields!.split(",").some((id) => allowed.has(id));
  }
  $("schedule").hidden = state.pack.hours?.mode !== "Open on selected hours";
}

function renderCounters(): void {
  for (const counter of counters(state.pack)) {
    const el = document.querySelector<HTMLElement>(`[data-counter="${counter.path}"]`);
    if (!el) continue;
    el.textContent = `${counter.used} / ${counter.max}`;
    el.dataset.over = String(counter.over);
  }
}

function renderPackIssues(errors: { message: string }[], warnings: { message: string }[]): void {
  const list = $("pack-issues");
  list.replaceChildren(
    ...errors.map((item) => issueItem("error", item.message)),
    ...warnings.map((item) => issueItem("warning", item.message)),
  );
}

function issueItem(level: "error" | "warning", text: string): HTMLLIElement {
  const li = document.createElement("li");
  li.dataset.level = level;
  li.textContent = text;
  return li;
}

function renderInspector(): void {
  const session = state.session;
  const card = $("inspector");
  card.hidden = !session;
  if (!session) return;
  const plan = session.plan;
  const status = session.committedAt ? "committed" : session.stale ? `stale — ${session.stale}` : session.drafted ? "drafted" : "planned";
  $("plan-context").textContent = `${shortUrl(plan.pageUrl)} · ${status}`;
  $("plan-issues").replaceChildren(
    ...plan.errors.map((item) => issueItem("error", item.message)),
    ...plan.warnings.map((item) => issueItem("warning", item.message)),
  );
  $("plan-actions").replaceChildren(...plan.actions.map((action) => {
    const row = document.createElement("tr");
    const value = action.preview.startsWith(`${action.label}: `) ? action.preview.slice(action.label.length + 2) : action.preview;
    const kind = session.drift.includes(action.id)
      ? "drift"
      : session.drafted?.unconfirmed.includes(action.id)
        ? "unconfirmed"
        : session.committedAt
          ? "committed"
          : session.drafted?.applied.includes(action.id)
            ? "applied"
            : action.phase;
    row.append(cell(action.label), cell(value), badgeCell(kind));
    return row;
  }));
  const gates = plan.gates.map((gate) => gate.message);
  $("plan-gates-wrap").hidden = gates.length === 0;
  $("plan-gates").replaceChildren(...gates.map((text) => issueItem("warning", text)));
  const notes = plan.preview.filter((line) => !plan.actions.some((action) => action.preview === line));
  $("plan-notes-wrap").hidden = notes.length === 0;
  $("plan-notes").replaceChildren(...notes.map((text) => plainItem(text)));
  const deferred = plan.deferred.filter((id) => tierFields(state.pack.tier).has(id));
  $("plan-deferred-wrap").hidden = deferred.length === 0;
  $("plan-deferred").replaceChildren(...deferred.map((id) => {
    const field = fieldById(id);
    return plainItem(`${field.labels[0]} — ${STEP_NAMES[field.step ?? ""] ?? "a later screen"}`);
  }));
  $("plan-hash").textContent = plan.planHash;
}

const STEP_NAMES: Record<string, string> = {
  create: "Page creation form",
  contact: "contact info in Page settings",
  location: "location in Page settings",
  hours: "hours in Page settings",
  cta: "the Add action button dialog",
  post: "the Create post composer",
  customize: "profile and cover photo step",
};

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function badgeCell(kind: string): HTMLTableCellElement {
  const td = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.dataset.kind = kind;
  badge.textContent = kind === "draft" ? "Draft" : kind === "commit" ? "On approve" : kind[0]!.toUpperCase() + kind.slice(1);
  td.append(badge);
  return td;
}

function plainItem(text: string): HTMLLIElement {
  const li = document.createElement("li");
  li.textContent = text;
  return li;
}

function renderChecklist(): void {
  $<HTMLInputElement>("check-reviewed").checked = state.checklist.reviewedPage;
  $<HTMLInputElement>("check-profile").checked = state.checklist.profilePicture;
  $<HTMLInputElement>("check-cover").checked = state.checklist.coverPhoto;
  $("need-profile").textContent = state.pack.media?.profilePicture === "required" ? "(required)" : "(optional)";
  $("need-cover").textContent = state.pack.media?.coverPhoto === "required" ? "(required)" : "(optional)";
}

function renderProgress(): void {
  $("progress-card").hidden = state.progress.length === 0;
  $("progress").replaceChildren(...state.progress.map((entry) => {
    const row = document.createElement("tr");
    row.append(cell(entry.label), badgeCell(entry.status), cell(shortUrl(entry.url)));
    return row;
  }));
}

function renderPaste(): void {
  const blocks = pasteBlocks(state.pack);
  const host = $("paste-blocks");
  if (!blocks.length) {
    host.replaceChildren(plainItem("Fill in the pack to get copy blocks."));
    return;
  }
  host.replaceChildren(...blocks.map((block) => {
    const wrap = document.createElement("div");
    wrap.className = "paste";
    const head = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = block.label;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Copy";
    button.dataset.copy = block.id;
    button.setAttribute("aria-label", `Copy ${block.label}`);
    button.addEventListener("click", () => { void copy(block.text, button); });
    head.append(title, button);
    head.style.display = "flex";
    head.style.justifyContent = "space-between";
    const pre = document.createElement("pre");
    pre.textContent = block.text;
    wrap.append(head, pre);
    return wrap;
  }));
}

function renderControls(): void {
  const context = { activeTabId };
  const canDraft = draftReadiness(state, context);
  const canCommit = commitReadiness(state, context);
  planButton.disabled = busy;
  draftButton.disabled = busy || !canDraft.ok;
  commitButton.disabled = busy || !canCommit.ok;
  const reasons = state.session ? (state.session.drafted ? canCommit.reasons : canDraft.ok ? canCommit.reasons.filter((r) => !r.startsWith("Tick")) : canDraft.reasons) : [];
  $("reasons").replaceChildren(...reasons.map((reason) => plainItem(reason)));
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function copy(text: string, button: HTMLButtonElement): Promise<void> {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    ok = (document as Document & { execCommand?: (c: string) => boolean }).execCommand?.("copy") ?? false;
    area.remove();
  }
  button.textContent = ok ? "Copied" : "Select and copy";
  setTimeout(() => { button.textContent = "Copy"; }, 1500);
}

// ---------- events ----------

form.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const path = target.dataset?.path;
  if (!path) return;
  const pack = structuredClone(state.pack);
  setPath(pack, path, target.value);
  commitState(editPack(state, pack));
});
form.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.tagName !== "SELECT" || !target.dataset.path) return;
  const pack = structuredClone(state.pack);
  setPath(pack, target.dataset.path, target.value);
  commitState(editPack(state, pack));
});
form.addEventListener("submit", (event) => event.preventDefault());

for (const radio of document.querySelectorAll<HTMLInputElement>("input[name='tier']")) {
  radio.addEventListener("change", () => { if (radio.checked) setTier(radio.value as FacebookTier); });
}

$("starter").addEventListener("click", () => {
  const button = $<HTMLButtonElement>("starter");
  if (button.dataset.armed !== "true" && cleanPack(state.pack).page.name) {
    button.dataset.armed = "true";
    button.textContent = "Click again to replace the pack";
    setTimeout(() => { button.dataset.armed = ""; button.textContent = "Start a blank pack"; }, 4000);
    return;
  }
  button.dataset.armed = "";
  button.textContent = "Start a blank pack";
  commitState({ ...editPack(state, starterPack(state.pack.tier)), checklist: { reviewedPage: false, profilePicture: false, coverPhoto: false } }, { renderForm: true });
  setBanner({ tone: "info", title: `Blank ${state.pack.tier} pack ready.`, detail: "Fill in the client details, then open the Facebook view and plan it." });
});

$("import").addEventListener("click", () => $<HTMLInputElement>("import-file").click());
$<HTMLInputElement>("import-file").addEventListener("change", async () => {
  const input = $<HTMLInputElement>("import-file");
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    setBanner({ tone: "bad", title: "That file is not valid JSON.", detail: (error as Error).message });
    return;
  }
  importPack(parsed);
});

/** Exposed for tests through the same path a file import takes. */
function importPack(parsed: unknown): void {
  const check = checkPack(parsed);
  const shapeErrors = check.errors.filter((item) => item.code === "shape" || item.code === "type" || item.code === "tier" || item.code === "enum");
  if (!check.pack || shapeErrors.length) {
    renderPackIssues(check.errors, check.warnings);
    setBanner({ tone: "bad", title: "Import refused.", detail: "The file does not match the Page Push Facebook pack format. Nothing was changed." });
    return;
  }
  const merged = mergeDefaults(starterPack(check.pack.tier), parsed) as FacebookPack;
  commitState(editPack(state, merged), { renderForm: true });
  setBanner({ tone: "info", title: "Pack imported.", detail: check.errors.length ? "It still has errors; they are listed above the Plan button." : "Open the Facebook view and plan it." });
}

$("export").addEventListener("click", () => {
  const pack = cleanPack(state.pack);
  const blob = new Blob([`${JSON.stringify(pack, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const slug = (pack.page.name || "pack").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pack";
  link.href = url;
  link.download = `pagepush-${slug}-${pack.tier}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

planButton.addEventListener("click", () => { void planView(); });
draftButton.addEventListener("click", () => { void draft(); });
commitButton.addEventListener("click", () => { void approveAndCommit(); });

for (const [id, key] of [["check-reviewed", "reviewedPage"], ["check-profile", "profilePicture"], ["check-cover", "coverPhoto"]] as const) {
  $<HTMLInputElement>(id).addEventListener("change", (event) => {
    commitState({ ...state, checklist: { ...state.checklist, [key]: (event.target as HTMLInputElement).checked } });
  });
}

$("clear").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("clear");
  if (button.dataset.armed !== "true") {
    button.dataset.armed = "true";
    button.textContent = "Click again to erase all Page Push data";
    setTimeout(() => { button.dataset.armed = ""; button.textContent = "Clear All Local Data"; }, 5000);
    return;
  }
  button.dataset.armed = "";
  button.textContent = "Clear All Local Data";
  await store.flush();
  await clearAll(chrome.storage.local);
  state = initialState();
  render({ renderForm: true });
  setBanner({ tone: "good", title: "Local data cleared.", detail: "Packs, plans, progress, and the checklist were erased from this browser." });
});

chrome.tabs.onActivated.addListener(() => { void refreshActiveTab().then(() => render()); });
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.session?.tabId !== tabId) return;
  commitState(invalidate(state, "The Facebook tab was closed."));
  setBanner(bannerFor("disconnected"));
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (state.session?.tabId !== tabId) return;
  if (change.url && change.url !== state.session.url) {
    commitState(invalidate(state, "The page navigated since this plan."));
    setBanner({ tone: "info", title: "Facebook moved to a new view.", detail: "Planning it again; the earlier approval no longer applies." });
  }
  if (change.status === "complete" && tab.url && tab.url !== state.session?.url && tab.active) void planView(true);
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isContentEvent(message)) return undefined;
  if (sender.tab?.id == null || sender.tab.id !== state.session?.tabId) return undefined;
  onContentEvent(message);
  return undefined;
});

function onContentEvent(event: ContentEvent): void {
  const session = state.session;
  if (!session) return;
  if (event.type === "pagepush:drift") {
    commitState(recordDrift(state, event.planHash, event.fields));
    setBanner(bannerFor("drift", `Changed after drafting: ${event.fields.map((id) => fieldById(id).labels[0]).join(", ")}. Plan again to approve the page as it is now.`));
    return;
  }
  if (event.reason === "navigated") {
    commitState(invalidate(state, "The page navigated since this plan."));
    void planView(true);
    return;
  }
  if (!session.drafted && !session.committedAt) {
    void planView(true);
    return;
  }
  setBanner({ tone: "info", title: "A Facebook dialog opened or closed.", detail: "If it has fields from the pack, plan again to include them. Your current draft still stands." });
}

// ---------- start ----------

async function start(): Promise<void> {
  buildStaticControls();
  const saved = await load(chrome.storage.local);
  if (saved) state = { pack: saved.pack, checklist: saved.checklist, progress: saved.progress, session: saved.session };
  await refreshActiveTab();
  render({ renderForm: true });
  const session = state.session;
  if (!session || session.committedAt || session.stale) return;
  const status = await send({ type: "pagepush:status" }, session.tabId);
  const holds = !("error" in status) && status.reply.ok && status.reply.plan?.planHash === session.plan.planHash;
  if (!holds) {
    commitState(invalidate(state, "The tab no longer holds this plan (it reloaded or navigated). Plan again."));
    return;
  }
  if (!("error" in status) && status.reply.ok && status.reply.drift?.length) {
    commitState(recordDrift(state, session.plan.planHash, status.reply.drift));
  }
  setBanner({ tone: "info", title: "Resumed the last plan.", detail: "The Facebook tab still holds it." });
}

void start();
