// Drives the real bundled side panel (dist-equivalent esbuild output) in happy-dom against a
// content controller on the Facebook fixture, through a stub of the chrome APIs it uses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as esbuild from "esbuild";
import { Window } from "happy-dom";
import { createController } from "../src/extension/controller.ts";
import type { ContentEvent, PanelRequest } from "../src/extension/messages.ts";
import { STORAGE_KEY } from "../src/extension/storage.ts";
import { countClicks, facebookDoc, PAGE_URL } from "./facebook-helpers.ts";

const TAB = 7;
let bundled: string | null = null;

async function panelCode(): Promise<string> {
  if (bundled) return bundled;
  const result = await esbuild.build({
    entryPoints: ["src/extension/sidepanel.ts"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    logLevel: "silent",
  });
  bundled = result.outputFiles[0]!.text;
  return bundled;
}

type Listener = (...args: never[]) => unknown;

interface Harness {
  panel: Document;
  window: Window;
  page: Document;
  local: Record<string, unknown>;
  syncWrites: number;
  clipboard: string[];
  setTab(tab: { id: number; url: string } | null): void;
  breakConnection(message: string | null): void;
  pushEvent(event: ContentEvent): void;
  type(id: string, value: string): void;
  click(id: string): Promise<void>;
  tick(times?: number): Promise<void>;
  banner(): string;
}

async function harness(options: { pageView?: "page" | "profile"; fetch?: (url: string, init?: { method?: string; body?: string }) => Promise<unknown> } = {}): Promise<Harness> {
  const page = facebookDoc({ view: options.pageView ?? "page" });
  const controller = createController({ document: page, location: { href: PAGE_URL }, notify: () => undefined, watchDialogs: false });
  const window = new Window({ url: "chrome-extension://pagepush/sidepanel.html" });
  const html = readFileSync("src/extension/sidepanel.html", "utf8");
  const head = /<head>([\s\S]*)<\/head>/.exec(html)![1]!;
  const body = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, "");
  window.document.head.innerHTML = head;
  window.document.body.innerHTML = body;
  const panel = window.document as unknown as Document;
  // No real network in tests: Ollama is "not running" unless a test scripts it.
  (window as unknown as { fetch: unknown }).fetch = options.fetch ?? (async () => { throw new TypeError("Failed to fetch"); });

  const local: Record<string, unknown> = {};
  let tab: { id: number; url: string; active: boolean } | null = { id: TAB, url: PAGE_URL, active: true };
  let broken: string | null = null;
  const runtimeListeners: Listener[] = [];
  const clipboard: string[] = [];
  const state = { syncWrites: 0, inflight: 0 };

  const chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in local ? { [key]: structuredClone(local[key]) } : {}),
        set: async (items: Record<string, unknown>) => { Object.assign(local, structuredClone(items)); },
        clear: async () => { for (const key of Object.keys(local)) delete local[key]; },
      },
      sync: new Proxy({}, { get: () => () => { state.syncWrites += 1; throw new Error("sync must never be used"); } }),
    },
    tabs: {
      query: async () => (tab ? [tab] : []),
      sendMessage: async (tabId: number, request: PanelRequest) => {
        if (broken) throw new Error(broken);
        assert.equal(tabId, TAB);
        state.inflight += 1;
        try {
          return structuredClone(await controller.handle(structuredClone(request)));
        } finally {
          state.inflight -= 1;
        }
      },
      onActivated: { addListener: () => undefined },
      onRemoved: { addListener: () => undefined },
      onUpdated: { addListener: () => undefined },
    },
    runtime: { onMessage: { addListener: (fn: Listener) => runtimeListeners.push(fn) } },
  };
  const navigator = { clipboard: { writeText: async (text: string) => { clipboard.push(text); } } };

  new Function("chrome", "document", "window", "navigator", await panelCode())(chrome, panel, window, navigator);

  const h: Harness = {
    panel,
    window,
    page,
    local,
    get syncWrites() { return state.syncWrites; },
    clipboard,
    setTab(next) { tab = next ? { ...next, active: true } : null; },
    breakConnection(message) { broken = message; },
    pushEvent(event) {
      for (const fn of runtimeListeners) (fn as (m: unknown, s: unknown) => void)(event, { tab: { id: TAB } });
    },
    type(id, value) {
      const el = panel.getElementById(id) as HTMLInputElement;
      el.value = value;
      el.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    },
    async click(id) {
      (panel.getElementById(id) as HTMLButtonElement).click();
      await h.tick(6);
    },
    async tick(times = 3) {
      // Drafts and commits wait for the page to settle, so let in-flight page messages finish first.
      const pass = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
      for (let i = 0; i < times; i += 1) await pass();
      for (let guard = 0; state.inflight > 0 && guard < 2000; guard += 1) await pass();
      for (let i = 0; i < times; i += 1) await pass();
    },
    banner() {
      return `${panel.getElementById("banner-title")!.textContent} ${panel.getElementById("banner-detail")!.textContent}`.trim();
    },
  };
  await h.tick(6);
  return h;
}

function fillLaunchPack(h: Harness): void {
  const launch = h.panel.querySelector("input[name='tier'][value='launch']") as HTMLInputElement;
  launch.checked = true;
  launch.dispatchEvent(new h.window.Event("change", { bubbles: true }) as unknown as Event);
  h.type("page-name", "Northline Studio");
  h.type("category-0", "Software Company");
  h.type("bio", "Retainer-hour tracking for small agencies.");
  h.type("website", "https://northline.example");
  h.type("phone", "+1 503 555 0142");
  h.type("email", "hello@northline.example");
  h.type("address", "211 SE Ankeny St");
  h.type("city", "Portland, Oregon");
  h.type("zip", "97214");
  h.type("hours-mode", "Always open");
  h.type("cta-type", "Book now");
  h.type("cta-url", "https://northline.example/book");
  h.type("launch-post", "Northline Studio is open.");
  h.type("media-profile", "optional");
  h.type("media-cover", "optional");
}

function disabled(h: Harness, id: string): boolean {
  return (h.panel.getElementById(id) as HTMLButtonElement).disabled;
}

test("the side panel runs Plan → Draft → Approve & Commit and gates commit on the reviewed tick and pack edits", async () => {
  const h = await harness();
  const clicks = countClicks(h.page, ["fb-save", "fb-cta-save", "fb-post"]);
  fillLaunchPack(h);
  await h.tick();
  assert.equal(h.panel.querySelector("[data-counter='page.name']")!.textContent, "16 / 75");
  assert.match(h.panel.getElementById("offer")!.textContent!, /\$50/);
  assert.equal(h.panel.getElementById("launch-post")!.closest("fieldset")!.hidden, false);

  await h.click("plan");
  assert.match(h.banner(), /^Planned\./);
  assert.equal(h.panel.getElementById("inspector")!.hidden, false);
  assert.ok(h.panel.querySelectorAll("#plan-actions tr").length >= 12);
  assert.match(h.panel.getElementById("plan-deferred")!.textContent!, /Page name — Page creation form/);
  assert.equal(disabled(h, "draft"), false);
  assert.equal(disabled(h, "commit"), true);

  await h.click("draft");
  assert.match(h.banner(), /^Drafted\./);
  assert.equal((h.page.getElementById("fb-website") as HTMLInputElement).value, "https://northline.example");
  assert.equal(h.page.getElementById("fb-composer")!.textContent, "Northline Studio is open.");
  assert.deepEqual(clicks, { "fb-save": 0, "fb-cta-save": 0, "fb-post": 0 });
  assert.equal(disabled(h, "commit"), true);
  assert.match(h.panel.getElementById("reasons")!.textContent!, /I read every drafted field/);

  const reviewed = h.panel.getElementById("check-reviewed") as HTMLInputElement;
  reviewed.checked = true;
  reviewed.dispatchEvent(new h.window.Event("change", { bubbles: true }) as unknown as Event);
  await h.tick();
  assert.equal(disabled(h, "commit"), false);

  h.type("bio", "Edited after planning.");
  await h.tick();
  assert.equal(disabled(h, "commit"), true, "editing the pack disables commit at once");
  assert.match(h.panel.getElementById("reasons")!.textContent!, /pack changed after planning/);
  h.type("bio", "Retainer-hour tracking for small agencies.");
  await h.tick();
  assert.equal(disabled(h, "commit"), false, "the approved pack is back");

  await h.click("commit");
  assert.match(h.banner(), /^Committed:/);
  assert.deepEqual(clicks, { "fb-save": 1, "fb-cta-save": 1, "fb-post": 1 });
  assert.equal(disabled(h, "commit"), true);
  assert.equal(h.panel.getElementById("progress-card")!.hidden, false);

  await h.tick();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const saved = h.local[STORAGE_KEY] as { pack: { page: { name: string } }; progress: unknown[] };
  assert.equal(saved.pack.page.name, "Northline Studio");
  assert.ok(saved.progress.length > 0);
  assert.equal(h.syncWrites, 0, "chrome.storage.sync is never touched");
});

test("drift reported by the page disables commit, and the copy-paste drawer copies a block", async () => {
  const h = await harness();
  fillLaunchPack(h);
  await h.click("plan");
  await h.click("draft");
  const reviewed = h.panel.getElementById("check-reviewed") as HTMLInputElement;
  reviewed.checked = true;
  reviewed.dispatchEvent(new h.window.Event("change", { bubbles: true }) as unknown as Event);
  await h.tick();
  assert.equal(disabled(h, "commit"), false);

  const planHash = h.panel.getElementById("plan-hash")!.textContent!;
  h.pushEvent({ type: "pagepush:drift", url: PAGE_URL, planHash, fields: ["phone"] });
  await h.tick();
  assert.equal(disabled(h, "commit"), true);
  assert.match(h.banner(), /A drafted field changed on the page/);
  assert.equal(h.panel.querySelector("#plan-actions [data-kind='drift']")?.textContent, "Drift");

  const copyBio = h.panel.querySelector("[data-copy='bio']") as HTMLButtonElement;
  copyBio.click();
  await h.tick();
  assert.deepEqual(h.clipboard, ["Retainer-hour tracking for small agencies."]);
});

test("non-Facebook tabs, a missing content script, and Business-Page refusals get clear banners", async () => {
  const h = await harness({ pageView: "profile" });
  fillLaunchPack(h);

  h.setTab({ id: TAB, url: "https://example.com/" });
  await h.click("plan");
  assert.match(h.banner(), /This tab is not Facebook/);

  h.setTab({ id: TAB, url: PAGE_URL });
  h.breakConnection("Could not establish connection. Receiving end does not exist.");
  (h.panel.getElementById("plan") as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 2200));
  assert.match(h.banner(), /not running in this tab yet.*Reload the Facebook tab/);

  h.breakConnection(null);
  await h.click("plan");
  assert.match(h.banner(), /Page Push refused this view/);
  assert.match(h.banner(), /Switch into that Business Page/);
  assert.equal(disabled(h, "draft"), true);
  assert.equal(disabled(h, "commit"), true);
});

test("Clear All Local Data needs a second click and then erases everything", async () => {
  const h = await harness();
  fillLaunchPack(h);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.ok(h.local[STORAGE_KEY]);
  await h.click("clear");
  assert.ok(h.local[STORAGE_KEY], "first click only arms the button");
  await h.click("clear");
  assert.deepEqual(h.local, {});
  assert.equal((h.panel.getElementById("page-name") as HTMLInputElement).value, "");
  assert.match(h.banner(), /Local data cleared/);
});

function ollamaStub(content: string) {
  const calls: string[] = [];
  const reply = (status: number, json: unknown) => ({ ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json), body: null });
  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const path = new URL(url).pathname;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/version") return reply(200, { version: "0.12.0" });
    if (path === "/api/tags") return reply(200, { models: [{ name: "qwen3:latest" }] });
    if (path === "/api/generate") return reply(200, { done: true });
    if (path === "/api/chat") return reply(200, { message: { content } });
    return reply(404, {});
  };
  return { fetch, calls };
}

test("Draft from facts works with Ollama stopped, fills the pack for review, and can be undone", async () => {
  const h = await harness();
  fillLaunchPack(h);
  h.type("bio", "");
  h.type("launch-post", "");
  await h.click("offline-draft");
  const bio = (h.panel.getElementById("bio") as HTMLTextAreaElement).value;
  assert.equal(bio, "Northline Studio: Software Company in Portland, Oregon. https://northline.example");
  assert.match((h.panel.getElementById("launch-post") as HTMLTextAreaElement).value, /^Northline Studio is now on Facebook\.\n\n/);
  assert.match(h.banner(), /Read the drafted copy before planning/);
  assert.match(h.panel.getElementById("ollama-status")!.textContent ?? "", /offline/);

  await h.click("copy-undo");
  assert.equal((h.panel.getElementById("bio") as HTMLTextAreaElement).value, "");
  assert.equal((h.panel.getElementById("launch-post") as HTMLTextAreaElement).value, "");
});

test("Draft Copy with Ollama when Ollama is not running says so and leaves the pack alone", async () => {
  const h = await harness();
  fillLaunchPack(h);
  await h.click("ollama-draft");
  assert.match(h.panel.getElementById("ollama-status")!.textContent ?? "", /not reachable at http:\/\/localhost:11434/);
  assert.equal((h.panel.getElementById("bio") as HTMLTextAreaElement).value, "Retainer-hour tracking for small agencies.");
  assert.match(h.banner(), /offline draft still works/);
});

test("Check / Load Model then Draft Copy with Ollama fills the pack, and a plan made earlier must be redone", async () => {
  const bio = "Northline Studio: retainer-hour tracking for small agencies in Portland, Oregon.";
  const { fetch, calls } = ollamaStub(JSON.stringify({ bio, launchPost: "Northline Studio is open. Book now: https://northline.example/book" }));
  const h = await harness({ fetch });
  fillLaunchPack(h);
  await h.click("plan");
  assert.equal(disabled(h, "draft"), false, "planned before drafting copy");

  await h.click("ollama-load");
  assert.match(h.panel.getElementById("ollama-status")!.textContent ?? "", /^Ready: qwen3:latest \(Ollama 0\.12\.0\)/);
  assert.deepEqual(calls, ["GET /api/version", "GET /api/tags", "POST /api/generate"]);

  await h.click("ollama-draft");
  assert.equal((h.panel.getElementById("bio") as HTMLTextAreaElement).value, bio);
  assert.match(h.panel.getElementById("ollama-status")!.textContent ?? "", /Drafted with qwen3:latest/);
  assert.equal(calls.at(-1), "POST /api/chat");
  assert.equal(disabled(h, "draft"), true, "the earlier plan no longer matches the pack");
  assert.equal(disabled(h, "commit"), true);
  assert.ok(Array.from(h.panel.querySelectorAll("#reasons li")).some((li) => /pack changed after planning/i.test(li.textContent ?? "")));
});
