import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as esbuild from "esbuild";
import { Window } from "happy-dom";
import { planFacebook } from "../src/index.ts";
import type { FacebookPack, FillPlan } from "../src/browser.ts";
import type { ContentReply, PanelRequest } from "../src/extension/messages.ts";
import { archiveRecords, editPack, initialState, recordCommit, recordCommitRefused, recordDraft, replacePack, startSession } from "../src/extension/panel-state.ts";
import { buildSprintReceipt, verifySprintReceipt } from "../src/extension/receipt.ts";
import { saver, STORAGE_KEY, type LocalArea } from "../src/extension/storage.ts";
import { restoreVersion, saveVersion } from "../src/extension/version-history.ts";
import { facebookDoc, PAGE_URL } from "./facebook-helpers.ts";
import example from "../examples/facebook-pack.json" with { type: "json" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !predicate(); i++) await tick();
  assert.ok(predicate(), "expected asynchronous step to complete");
}
let bundle: string | undefined;
async function code(): Promise<string> {
  if (!bundle) bundle = (await esbuild.build({ entryPoints: ["src/extension/sidepanel.ts"], bundle: true, write: false, format: "iife", platform: "browser", target: ["chrome120"], logLevel: "silent" })).outputFiles[0]!.text;
  return bundle;
}
const reply = (value: unknown) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value), body: null });

type Handler = (request: PanelRequest) => Promise<ContentReply>;
async function panel(options: { handler?: Handler; area?: LocalArea; fetch?: (url: string, init?: { signal?: AbortSignal }) => Promise<ReturnType<typeof reply>>; saved?: Record<string, unknown> } = {}) {
  const win = new Window({ url: "chrome-extension://pagepush/sidepanel.html" });
  const html = readFileSync("src/extension/sidepanel.html", "utf8");
  win.document.head.innerHTML = /<head>([\s\S]*)<\/head>/.exec(html)![1]!;
  win.document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, "");
  const doc = win.document as unknown as Document;
  (win as unknown as { fetch: unknown }).fetch = options.fetch ?? (async () => { throw new TypeError("offline"); });
  const local: Record<string, unknown> = structuredClone(options.saved ?? {});
  const area: LocalArea = options.area ?? {
    get: async (key) => key in local ? { [key]: structuredClone(local[key]) } : {},
    set: async (items) => { Object.assign(local, structuredClone(items)); },
    clear: async () => { for (const key of Object.keys(local)) delete local[key]; },
  };
  let activePlan: FillPlan | null = null;
  const requests: PanelRequest[] = [];
  const normal: Handler = async (request) => {
    if (request.type === "pagepush:plan") {
      activePlan = planFacebook(facebookDoc({ view: "page" }), request.pack, PAGE_URL);
      return { ok: true, url: PAGE_URL, plan: activePlan };
    }
    if (request.type === "pagepush:draft") return { ok: true, url: PAGE_URL, draft: { applied: activePlan!.actions.filter(a => a.phase === "draft").map(a => a.id), unconfirmed: [] } };
    if (request.type === "pagepush:commit") return { ok: true, url: PAGE_URL, committed: true };
    return { ok: true, url: PAGE_URL, ...(activePlan ? { plan: activePlan } : {}) };
  };
  const chrome = {
    storage: { local: area },
    tabs: { query: async () => [{ id: 7, url: PAGE_URL, active: true }],
      sendMessage: async (_tab: number, request: PanelRequest) => { requests.push(structuredClone(request)); return options.handler ? options.handler(request) : normal(request); },
      onActivated: { addListener() {} }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    runtime: { onMessage: { addListener() {} } },
  };
  new Function("chrome", "document", "window", "navigator", await code())(chrome, doc, win, { clipboard: { writeText: async () => {} } });
  await until(() => doc.getElementById("receipt-safety") != null && !(doc.getElementById("plan") as HTMLButtonElement).disabled);
  const input = (id: string, value: string) => {
    const element = doc.getElementById(id) as HTMLInputElement;
    element.value = value; element.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  };
  const click = (id: string) => (doc.getElementById(id) as HTMLButtonElement).click();
  const fill = () => { input("page-name", "Northline Studio"); input("category-0", "Software Company"); input("bio", "Alpha original"); input("website", "https://northline.example"); };
  return { doc, win, local, requests, input, click, fill };
}

test("a plan reply for pack A is discarded even when edits are reverted before it arrives", async () => {
  const gate = deferred<ContentReply>();
  let first = true;
  const h = await panel({ handler: async (request) => {
    if (request.type === "pagepush:plan") {
      const plan = planFacebook(facebookDoc({ view: "page" }), request.pack, PAGE_URL);
      if (first) { first = false; await gate.promise; }
      return { ok: true, url: PAGE_URL, plan };
    }
    return { ok: true, url: PAGE_URL };
  } });
  h.fill(); h.click("plan");
  await until(() => h.requests.length === 1);
  h.input("bio", "Beta copy"); h.input("bio", "Alpha original");
  gate.resolve({ ok: true, url: PAGE_URL });
  await until(() => !(h.doc.getElementById("plan") as HTMLButtonElement).disabled);
  assert.match(h.doc.getElementById("banner-title")!.textContent!, /changed while planning/i);
  assert.equal((h.doc.getElementById("draft") as HTMLButtonElement).disabled, true);
  h.click("plan");
  await until(() => h.requests.length === 2 && !(h.doc.getElementById("draft") as HTMLButtonElement).disabled);
  assert.match(h.doc.getElementById("banner-title")!.textContent!, /Planned/);
});

test("copy results and undo cannot cross an edit or restored pack revision", async () => {
  const chat = deferred<ReturnType<typeof reply>>();
  let chatStarted = false;
  const h = await panel({ fetch: async (url) => {
    const path = new URL(url).pathname;
    if (path === "/api/version") return reply({ version: "0.12" });
    if (path === "/api/tags") return reply({ models: [{ name: "qwen3:latest" }] });
    if (path === "/api/chat") { chatStarted = true; return chat.promise; }
    return reply({});
  } });
  h.fill(); h.click("offline-draft");
  await until(() => !(h.doc.getElementById("copy-undo") as HTMLButtonElement).hidden);
  h.input("bio", "Human edit"); h.click("copy-undo");
  assert.equal((h.doc.getElementById("bio") as HTMLTextAreaElement).value, "Human edit");
  h.click("version-save");
  h.click("ollama-draft");
  await until(() => chatStarted);
  h.input("bio", "Different pack");
  (h.doc.querySelector("#version-list button") as HTMLButtonElement).click();
  assert.equal((h.doc.getElementById("bio") as HTMLTextAreaElement).value, "Human edit");
  chat.resolve(reply({ message: { content: JSON.stringify({ bio: "Old client model output", launchPost: "Old client" }) } }));
  await tick(); await tick();
  assert.equal((h.doc.getElementById("bio") as HTMLTextAreaElement).value, "Human edit");
});

test("serialized saver fences queued state and settings and awaits an in-flight write before clear", async () => {
  const gate = deferred<void>(), started = deferred<void>();
  const data: Record<string, unknown> = {}, events: string[] = [];
  const area: LocalArea = {
    get: async () => ({}),
    set: async (items) => { events.push("set-start"); started.resolve(); await gate.promise; Object.assign(data, structuredClone(items)); events.push("set-end"); },
    clear: async () => { events.push("clear"); for (const key of Object.keys(data)) delete data[key]; },
  };
  const store = saver(area, 10_000), old = initialState(); old.pack.page.name = "Old client";
  store.schedule(old); const write = store.flush(); await started.promise;
  store.schedule(old); const queued = store.flush();
  const clearing = store.clear();
  await store.write({ settings: "pre-clear" }); store.schedule(old);
  assert.deepEqual(events, ["set-start"]);
  gate.resolve(); await Promise.all([write, queued, clearing]);
  assert.deepEqual(events, ["set-start", "set-end", "clear"]);
  assert.deepEqual(data, {});
  const fresh = initialState(); fresh.pack.page.name = "New client";
  store.schedule(fresh); await store.flush();
  assert.equal((data[STORAGE_KEY] as { pack: { page: { name: string } } }).pack.page.name, "New client");
});

test("clear blocks pending import, settings and pack producers until in-flight storage is erased", async () => {
  const gate = deferred<void>(), started = deferred<void>(), file = deferred<string>();
  const data: Record<string, unknown> = {};
  const area: LocalArea = {
    get: async (key) => key in data ? { [key]: data[key] } : {},
    set: async (items) => { started.resolve(); await gate.promise; Object.assign(data, structuredClone(items)); },
    clear: async () => { for (const key of Object.keys(data)) delete data[key]; },
  };
  const h = await panel({ area }); h.fill();
  const input = h.doc.getElementById("import-file") as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [{ text: () => file.promise }] });
  input.dispatchEvent(new h.win.Event("change", { bubbles: true }) as unknown as Event);
  const model = h.doc.getElementById("ollama-model") as HTMLInputElement;
  model.value = "custom"; model.dispatchEvent(new h.win.Event("change", { bubbles: true }) as unknown as Event);
  await started.promise;
  h.click("clear"); assert.match(h.doc.getElementById("clear")!.textContent!, /Click again/);
  h.click("clear");
  h.input("bio", "must not persist"); h.click("offline-draft");
  file.resolve(JSON.stringify(example));
  await tick(); gate.resolve();
  await until(() => /Local data cleared/.test(h.doc.getElementById("banner-title")!.textContent!));
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(data, {});
  assert.equal((h.doc.getElementById("page-name") as HTMLInputElement).value, "");
  assert.equal((h.doc.getElementById("bio") as HTMLTextAreaElement).value, "");
});

test("client replacement and restore archive receipts, and exports report attempts not confirmed success", () => {
  const pack = structuredClone(example) as FacebookPack;
  let state = editPack(initialState(), pack);
  const plan = planFacebook(facebookDoc({ view: "page" }), pack, PAGE_URL);
  state = startSession(state, 7, plan);
  state = recordDraft(state, { applied: plan.actions.filter(a => a.phase === "draft").map(a => a.id), unconfirmed: [] });
  state = recordCommit(state, new Date("2026-11-25T00:00:00Z"));
  assert.equal(state.receipts[0]!.outcome, "attempted");
  assert.deepEqual(state.receipts[0]!.committed, []);
  assert.ok(state.progress.every(item => item.status === "attempted"));
  const oldName = state.pack.page.name;
  const other = structuredClone(pack); other.page.name = "Other Client";
  state = saveVersion(state); state = replacePack(state, other);
  assert.deepEqual(state.receipts, []); assert.deepEqual(state.progress, []);
  assert.equal(state.archives![0]!.pageName, oldName);
  const oldReceipt = buildSprintReceipt({ pack, entries: state.archives![0]!.receipts, extensionVersion: "1.0.0" });
  assert.equal(oldReceipt.pageName, oldName); assert.equal(oldReceipt.totals.committed, 0);
  assert.equal(oldReceipt.totals.attempted, 1); assert.equal(verifySprintReceipt(oldReceipt), true);
  state = restoreVersion(state, 0); assert.equal(state.pack.page.name, oldName);
  assert.equal(state.archives!.length, 1); assert.deepEqual(state.receipts, []);
  const legacy = archiveRecords({ ...state, receipts: state.archives![0]!.receipts }, true);
  assert.equal(legacy.archives!.at(-1)!.unverifiedOwner, true);
  assert.equal(legacy.archives!.at(-1)!.pageName, "");
  const unknown = buildSprintReceipt({ pack, entries: legacy.archives!.at(-1)!.receipts, extensionVersion: "1.0.0", unattributed: true });
  assert.equal(unknown.attribution, "unknown-may-be-mixed");
  assert.equal(unknown.pageName, ""); assert.equal(unknown.tier, null); assert.equal(unknown.offer, null);
  assert.equal(verifySprintReceipt(unknown), true);
  const uncertain = recordCommitRefused(startSession(state, 7, plan), { code: "error", message: "lost", approvedAt: new Date() });
  assert.equal(uncertain.receipts[0]!.outcome, "partial");
  assert.match(uncertain.session!.stale!, /do not retry blindly/i);
});

test("clearing fences a late plan reply and does not repopulate local storage", async () => {
  const gate = deferred<void>();
  const h = await panel({ handler: async (request) => {
    if (request.type === "pagepush:plan") {
      const plan = planFacebook(facebookDoc({ view: "page" }), request.pack, PAGE_URL);
      await gate.promise;
      return { ok: true, url: PAGE_URL, plan };
    }
    return { ok: true, url: PAGE_URL };
  } });
  h.fill(); h.click("plan"); await until(() => h.requests.length === 1);
  h.click("clear"); h.click("clear");
  await until(() => /Local data cleared/.test(h.doc.getElementById("banner-title")!.textContent!));
  gate.resolve();
  await until(() => !(h.doc.getElementById("plan") as HTMLButtonElement).disabled);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal((h.doc.getElementById("page-name") as HTMLInputElement).value, "");
  assert.equal((h.doc.getElementById("draft") as HTMLButtonElement).disabled, true);
  assert.deepEqual(h.local, {});
  assert.match(h.doc.getElementById("banner-title")!.textContent!, /Local data cleared/);
});

test("clearing cancels an old Ollama draft even if its transport ignores abort", async () => {
  const gate = deferred<ReturnType<typeof reply>>(); let started = false;
  const h = await panel({ fetch: async (url) => {
    const path = new URL(url).pathname;
    if (path === "/api/version") return reply({ version: "0.12" });
    if (path === "/api/tags") return reply({ models: [{ name: "qwen3:latest" }] });
    if (path === "/api/chat") { started = true; return gate.promise; }
    return reply({});
  } });
  h.fill(); h.click("ollama-draft"); await until(() => started);
  h.click("clear"); h.click("clear");
  await until(() => /Local data cleared/.test(h.doc.getElementById("banner-title")!.textContent!));
  gate.resolve(reply({ message: { content: JSON.stringify({ bio: "Old client", launchPost: "Old client post" }) } }));
  await tick(); await tick();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal((h.doc.getElementById("bio") as HTMLTextAreaElement).value, "");
  assert.equal((h.doc.getElementById("copy-undo") as HTMLButtonElement).hidden, true);
  assert.deepEqual(h.local, {});
});

test("a lost commit reply closes the approval and is never automatically retried", async () => {
  let plan: FillPlan | null = null;
  const h = await panel({ handler: async (request) => {
    if (request.type === "pagepush:plan") {
      plan = planFacebook(facebookDoc({ view: "page" }), request.pack, PAGE_URL);
      return { ok: true, url: PAGE_URL, plan };
    }
    if (request.type === "pagepush:draft") return { ok: true, url: PAGE_URL, draft: { applied: plan!.actions.filter(a => a.phase === "draft").map(a => a.id), unconfirmed: [] } };
    if (request.type === "pagepush:commit") throw new Error("message port closed");
    return { ok: true, url: PAGE_URL };
  } });
  h.fill(); h.input("media-profile", "optional"); h.input("media-cover", "optional"); h.click("plan");
  await until(() => !(h.doc.getElementById("draft") as HTMLButtonElement).disabled);
  h.click("draft");
  await until(() => /Drafted/.test(h.doc.getElementById("banner-title")!.textContent!));
  const reviewed = h.doc.getElementById("check-reviewed") as HTMLInputElement;
  reviewed.checked = true; reviewed.dispatchEvent(new h.win.Event("change", { bubbles: true }) as unknown as Event);
  assert.equal((h.doc.getElementById("commit") as HTMLButtonElement).disabled, false, h.doc.getElementById("reasons")!.textContent ?? "");
  h.click("commit");
  await until(() => /outcome unknown/i.test(h.doc.getElementById("banner-title")!.textContent!));
  assert.equal(h.requests.filter(request => request.type === "pagepush:commit").length, 1);
  assert.equal((h.doc.getElementById("commit") as HTMLButtonElement).disabled, true);
  assert.match(h.doc.getElementById("banner-detail")!.textContent!, /do not retry blindly/i);
  h.input("page-name", "Different Client");
  assert.match(h.doc.getElementById("receipt-archives")!.textContent!, /Northline Studio/);
  assert.match(h.doc.getElementById("receipt-archives")!.textContent!, /View archived progress/);
  assert.match(h.doc.getElementById("receipt-summary")!.textContent!, /No approvals for this pack/);
  assert.equal((h.doc.getElementById("receipt-download") as HTMLButtonElement).disabled, true);
});
