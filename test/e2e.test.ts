// End to end: the bundled side panel and the bundled content script (the same esbuild output as
// dist/) run together, connected only through stubs of chrome.runtime / chrome.tabs messaging,
// against the sanitized live Facebook captures. A person's clicks are simulated in the panel; the
// Facebook page is the fixture with its React/Lexical stand-ins. Nothing here talks to a network.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as esbuild from "esbuild";
import { Window } from "happy-dom";
import type { PanelRequest } from "../src/extension/messages.ts";
import { verifySprintReceipt, type SprintReceipt } from "../src/extension/receipt.ts";
import { countClicks } from "./facebook-helpers.ts";
import { fixture } from "./live-fixtures.ts";

const TAB = 11;
const PROFILE_URL = "https://www.facebook.com/profile.php?id=61550000000001&sk=directory_contact_info&__cft__=tracking";
const bundles = new Map<string, string>();

async function bundle(entry: string): Promise<string> {
  const cached = bundles.get(entry);
  if (cached) return cached;
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser", target: ["chrome120"], logLevel: "silent" });
  const code = result.outputFiles[0]!.text;
  bundles.set(entry, code);
  return code;
}

type Responder = (reply: unknown) => void;
type ContentListener = (message: unknown, sender: unknown, respond: Responder) => unknown;

async function extension(fixtureName: string, url: string) {
  // ---- the Facebook tab, with the real content script ----
  const page = fixture(fixtureName);
  let contentListener: ContentListener | undefined;
  const pageChrome = {
    runtime: {
      onMessage: { addListener: (fn: ContentListener) => { contentListener = fn; } },
      sendMessage: async () => undefined,
    },
  };
  new Function("chrome", "document", "location", await bundle("src/extension/content.ts"))(pageChrome, page, { href: url });
  assert.ok(contentListener, "the content script listens for the panel");

  // ---- the side panel, with the real panel bundle ----
  const window = new Window({ url: "chrome-extension://pagepush/sidepanel.html" });
  const html = readFileSync("src/extension/sidepanel.html", "utf8");
  window.document.head.innerHTML = /<head>([\s\S]*)<\/head>/.exec(html)![1]!;
  window.document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, "");
  const panel = window.document as unknown as Document;
  (window as unknown as { fetch: unknown }).fetch = async () => { throw new TypeError("no network in tests"); };

  const local: Record<string, unknown> = {};
  const counts = { syncCalls: 0, inflight: 0 };
  const downloads: { name: string; href: string }[] = [];
  panel.addEventListener("click", (event) => {
    const link = event.target as HTMLAnchorElement;
    if (link?.tagName === "A" && link.download) {
      event.preventDefault();
      downloads.push({ name: link.download, href: link.getAttribute("href") ?? "" });
    }
  }, true);

  const chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in local ? { [key]: structuredClone(local[key]) } : {}),
        set: async (items: Record<string, unknown>) => { Object.assign(local, structuredClone(items)); },
        clear: async () => { for (const key of Object.keys(local)) delete local[key]; },
      },
      sync: new Proxy({}, { get: () => () => { counts.syncCalls += 1; throw new Error("chrome.storage.sync must never be used"); } }),
    },
    tabs: {
      query: async () => [{ id: TAB, url, active: true }],
      // Messages cross the panel/page boundary as structured clones, as in Chrome.
      sendMessage: (tabId: number, request: PanelRequest) => new Promise((resolve) => {
        assert.equal(tabId, TAB);
        counts.inflight += 1;
        const keepOpen = contentListener!(structuredClone(request), { id: "pagepush" }, (reply) => {
          counts.inflight -= 1;
          resolve(structuredClone(reply));
        });
        assert.equal(keepOpen, true, "the content script answers asynchronously");
      }),
      onActivated: { addListener: () => undefined },
      onRemoved: { addListener: () => undefined },
      onUpdated: { addListener: () => undefined },
    },
    runtime: { onMessage: { addListener: () => undefined } },
  };
  new Function("chrome", "document", "window", "navigator", await bundle("src/extension/sidepanel.ts"))(chrome, panel, window, { clipboard: { writeText: async () => undefined } });

  const pass = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i += 1) await pass();
    for (let guard = 0; counts.inflight > 0 && guard < 4000; guard += 1) await pass();
    for (let i = 0; i < 4; i += 1) await pass();
  };
  const ui = {
    page,
    panel,
    local,
    counts,
    downloads,
    settle,
    async click(id: string) {
      (panel.getElementById(id) as HTMLButtonElement).click();
      await settle();
    },
    type(id: string, value: string) {
      const el = panel.getElementById(id) as HTMLInputElement;
      el.value = value;
      el.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    },
    tick(id: string) {
      const el = panel.getElementById(id) as HTMLInputElement;
      el.checked = true;
      el.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    },
    tier(value: string) {
      const radio = panel.querySelector(`input[name='tier'][value='${value}']`) as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    },
    disabled: (id: string) => (panel.getElementById(id) as HTMLButtonElement).disabled,
    banner: () => `${panel.getElementById("banner-title")!.textContent} ${panel.getElementById("banner-detail")!.textContent}`.trim(),
  };
  await settle();
  return ui;
}

type Ui = Awaited<ReturnType<typeof extension>>;

function fillStandardPack(ui: Ui): void {
  ui.tier("standard");
  ui.type("page-name", "Northline Studio");
  ui.type("category-0", "Software Company");
  ui.type("category-1", "Consulting Agency");
  ui.type("bio", "Retainer-hour tracking for small agencies.");
  ui.type("website", "https://northline.example");
  ui.type("phone", "+1 503 555 0142");
  ui.type("email", "hello@northline.example");
  ui.type("address", "211 SE Ankeny St");
  ui.type("city", "Portland, Oregon");
  ui.type("zip", "97214");
  ui.type("hours-mode", "Always open");
  ui.type("cta-type", "Book now");
  ui.type("cta-url", "https://northline.example/book");
  ui.type("media-profile", "optional");
  ui.type("media-cover", "optional");
}

test("the manifest points at the three bundles the build emits", () => {
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
  const build = readFileSync("scripts/build.mjs", "utf8");
  for (const entry of ["src/extension/content.ts", "src/extension/sidepanel.ts", "src/extension/background.ts"]) {
    assert.ok(existsSync(entry) && build.includes(entry.split("/").pop()!.replace(".ts", "")), `${entry} is built`);
  }
});

test("full stack on the live About capture: plan, draft, approve, commit once, export a verifiable receipt, clear", async () => {
  const ui = await extension("page-about", PROFILE_URL);
  const saves = countClicks(ui.page, ["fb-save"]);
  fillStandardPack(ui);
  assert.equal(ui.disabled("receipt-download"), true, "no receipt before any approval");

  await ui.click("plan");
  assert.equal(ui.disabled("draft"), false, ui.banner());
  assert.equal(ui.disabled("commit"), true, "commit waits for the draft");
  assert.match(ui.panel.getElementById("plan-notes")!.textContent ?? "", /City\/Town: pick "Portland, Oregon"/);

  await ui.click("draft");
  assert.equal((ui.page.getElementById("fb-bio") as HTMLTextAreaElement).value, "Retainer-hour tracking for small agencies.");
  assert.equal((ui.page.getElementById("fb-phone") as HTMLInputElement).value, "503 555 0142");
  assert.equal((ui.page.getElementById("fb-website") as HTMLInputElement).value, "https://northline.example");
  assert.equal(saves["fb-save"], 0, "drafting never saves");
  assert.equal(ui.disabled("commit"), true, "commit waits for the reviewed tick");

  ui.tick("check-reviewed");
  await ui.settle();
  assert.equal(ui.disabled("commit"), false);
  await ui.click("commit");
  assert.equal(saves["fb-save"], 1, "one approval, one Save");
  assert.match(ui.banner(), /^Committed: Save\./);
  assert.equal(ui.disabled("commit"), true, "the approval is used up");

  assert.match(ui.panel.getElementById("receipt-summary")!.textContent ?? "", /^1 approval recorded: 1 committed\./);
  await ui.click("receipt-download");
  assert.equal(ui.downloads.length, 1);
  const { name, href } = ui.downloads[0]!;
  assert.match(name, /^pagepush-receipt-northline-studio-\d{4}-\d{2}-\d{2}\.json$/);
  assert.ok(href.startsWith("data:application/json;charset=utf-8,"));
  const receipt = JSON.parse(decodeURIComponent(href.slice(href.indexOf(",") + 1))) as SprintReceipt;
  assert.equal(verifySprintReceipt(receipt), true);
  assert.equal(receipt.extension.version, "1.0.0");
  assert.equal(receipt.tier, "standard");
  assert.equal(receipt.offer?.priceUsd, 15);
  const entry = receipt.entries[0]!;
  assert.equal(entry.outcome, "committed");
  assert.equal(entry.view, "page");
  assert.equal(entry.pageUrl, "https://www.facebook.com/profile.php?id=61550000000001&sk=directory_contact_info", "tracking parameters dropped");
  assert.deepEqual(entry.drafted.map((field) => field.id).sort(), ["address", "bio", "categories", "email", "phone", "website", "zip"]);
  assert.ok(entry.committed.some((field) => field.id === "saveChanges"));
  assert.equal(entry.checklist.reviewedPage, true);
  assert.ok(Date.parse(entry.approvedAt) <= Date.parse(entry.finishedAt));
  assert.equal(JSON.stringify(receipt).includes("hello@northline.example"), false, "no field values in the receipt");

  // The receipt is also kept locally until cleared.
  await ui.settle();
  await new Promise((resolve) => setTimeout(resolve, 350)); // the debounced save
  assert.equal(((ui.local["pagepush.v1"] as { receipts?: unknown[] })?.receipts ?? []).length, 1);

  await ui.click("clear");
  assert.ok(Object.keys(ui.local).length > 0, "the first click only arms Clear All");
  await ui.click("clear");
  assert.deepEqual(ui.local, {}, "chrome.storage.local is empty");
  assert.equal(ui.counts.syncCalls, 0, "chrome.storage.sync was never touched");
  assert.equal(ui.disabled("receipt-download"), true);
  assert.match(ui.banner(), /sprint receipts, and settings were erased/);
});

test("full stack on the live composer capture: a refused commit is recorded and the approval can be given again", async () => {
  const ui = await extension("post-create", "https://www.facebook.com/post/create");
  const posts = countClicks(ui.page, ["fb-post"]);
  fillStandardPack(ui);
  ui.tier("launch");
  ui.type("launch-post", "Northline Studio is open.");
  await ui.click("plan");
  await ui.click("draft");
  assert.match(ui.page.getElementById("fb-composer")!.textContent ?? "", /^Northline Studio is open\./);

  // A captcha appears before the person approves: commit is refused before any click.
  const turnstile = ui.page.createElement("div");
  turnstile.className = "cf-turnstile";
  const response = ui.page.createElement("input");
  response.type = "hidden";
  response.name = "cf-turnstile-response";
  ui.page.body.append(turnstile, response);
  ui.tick("check-reviewed");
  await ui.settle();
  await ui.click("commit");
  assert.equal(posts["fb-post"], 0);
  assert.match(ui.panel.getElementById("receipt-summary")!.textContent ?? "", /1 approval recorded: 0 committed, 1 refused or partial/);

  // The person solves it and approves again; the same plan commits once.
  response.value = "solved-by-person";
  await ui.click("commit");
  assert.equal(posts["fb-post"], 1);
  await ui.click("receipt-download");
  const href = ui.downloads.at(-1)!.href;
  const receipt = JSON.parse(decodeURIComponent(href.slice(href.indexOf(",") + 1))) as SprintReceipt;
  assert.deepEqual(receipt.entries.map((entry) => entry.outcome), ["refused", "committed"]);
  assert.equal(receipt.entries[0]!.refusal?.code, "captcha");
  assert.equal(receipt.entries[0]!.planHash, receipt.entries[1]!.planHash, "the same plan, approved twice");
  assert.deepEqual(receipt.totals, { approvals: 2, committed: 1, partial: 0, refused: 1, fieldsCommitted: 2 });
});
