import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as esbuild from "esbuild";
import { Window } from "happy-dom";
import { initialState } from "../src/extension/panel-state.ts";
import { buildSprintReceipt, type ReceiptEntry } from "../src/extension/receipt.ts";
import { saver, STORAGE_KEY, type LocalArea } from "../src/extension/storage.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function sharedArea(): { area: LocalArea; data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    area: {
      get: async (key) => key in data ? { [key]: structuredClone(data[key]) } : {},
      set: async (items) => { Object.assign(data, structuredClone(items)); },
      clear: async () => { for (const key of Object.keys(data)) delete data[key]; },
    },
  };
}

function nameIn(data: Record<string, unknown>): string | undefined {
  return (data[STORAGE_KEY] as { pack: { page: { name: string } } } | undefined)?.pack.page.name;
}

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(predicate(), "expected asynchronous step to complete");
}

test("another panel's pending snapshot and subsequent settings write can repopulate storage after clear", async () => {
  const { area, data } = sharedArea();
  const first = saver(area, 10_000), second = saver(area, 10_000);
  const old = initialState(); old.pack.page.name = "Private client";
  second.schedule(old);
  await first.clear();
  assert.deepEqual(data, {});
  await second.flush();
  await second.write({ "pagepush.ollama.v1": { model: "old-model" } });
  assert.equal(nameIn(data), "Private client");
  assert.deepEqual(data["pagepush.ollama.v1"], { model: "old-model" });
});

test("a different panel's in-flight set can finish after clear", async () => {
  const { area: backing, data } = sharedArea();
  const gate = deferred(), started = deferred();
  const area: LocalArea = {
    get: backing.get,
    clear: backing.clear,
    set: async (items) => { started.resolve(); await gate.promise; await backing.set(items); },
  };
  const first = saver(area, 10_000), second = saver(area, 10_000);
  const old = initialState(); old.pack.page.name = "Old in-flight client";
  second.schedule(old);
  const writing = second.flush();
  await started.promise;
  await first.clear();
  assert.deepEqual(data, {});
  gate.resolve();
  await writing;
  assert.equal(nameIn(data), "Old in-flight client");
});

test("the same panel does wait for its own in-flight write and fences its queued work", async () => {
  const { area: backing, data } = sharedArea();
  const gate = deferred(), started = deferred();
  const area: LocalArea = {
    get: backing.get,
    clear: backing.clear,
    set: async (items) => { started.resolve(); await gate.promise; await backing.set(items); },
  };
  const store = saver(area, 10_000), old = initialState();
  old.pack.page.name = "Old client";
  store.schedule(old);
  const writing = store.flush();
  await started.promise;
  store.schedule(old);
  const queued = store.flush();
  const clearing = store.clear();
  gate.resolve();
  await Promise.all([writing, queued, clearing]);
  assert.deepEqual(data, {});
});

test("real panels warn about cross-panel clearing and dynamically disclose receipt contents", async () => {
  const html = readFileSync("src/extension/sidepanel.html", "utf8");
  const output = await esbuild.build({ entryPoints: ["src/extension/sidepanel.ts"], bundle: true, write: false, format: "iife", platform: "browser", target: ["chrome120"], logLevel: "silent" });
  const code = output.outputFiles[0]!.text;
  const { area, data } = sharedArea();
  const createPanel = () => {
    const win = new Window({ url: "chrome-extension://pagepush/sidepanel.html" });
    win.document.head.innerHTML = /<head>([\s\S]*)<\/head>/.exec(html)![1]!;
    win.document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, "");
    const doc = win.document as unknown as Document;
    const initialDescription = doc.getElementById("receipt-summary")!.nextElementSibling!.textContent!;
    assert.match(initialDescription, /Page name.*address or ID/i);
    assert.match(initialDescription, /refusal messages/i);
    (win as unknown as { fetch: unknown }).fetch = async () => { throw new Error("network not permitted in this test"); };
    const chrome = {
      storage: { local: area },
      tabs: {
        query: async () => [],
        sendMessage: async () => { throw new Error("no tab"); },
        onActivated: { addListener() {} }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
      },
      runtime: { onMessage: { addListener() {} } },
    };
    // Shorten only the clear-confirmation expiry; clicks below remain synchronous.
    const panelTimer = (handler: () => void, ms: number) => setTimeout(handler, ms === 5000 ? 20 : ms);
    new Function("chrome", "document", "window", "navigator", "setTimeout", code)(chrome, doc, win, { clipboard: { writeText: async () => {} } }, panelTimer);
    return { win, doc };
  };
  const first = createPanel(), second = createPanel();
  await until(() => [first, second].every(({ doc }) => /\/ 75/.test(doc.querySelector("[data-counter='page.name']")!.textContent ?? "")));
  const warning = first.doc.getElementById("clear-warning")!.textContent!;
  assert.match(warning, /other open Page Push panels/i);
  assert.match(warning, /already-started writes/i);
  assert.match(warning, /not guaranteed/i);
  assert.match(warning, /Downloaded files and Facebook data are not erased/i);
  const receiptSection = first.doc.querySelector("[aria-labelledby='receipt-heading']")!.textContent!;
  assert.match(receiptSection, /Page name.*address or ID/i);
  assert.match(receiptSection, /refusal messages may include/i);
  assert.match(receiptSection, /review before sharing/i);
  assert.doesNotMatch(receiptSection, /field values are not included/i);
  const input = second.doc.getElementById("page-name") as HTMLInputElement;
  input.value = "Other panel's client";
  input.dispatchEvent(new second.win.Event("input", { bubbles: true }) as unknown as Event);
  const clear = first.doc.getElementById("clear") as HTMLButtonElement;
  clear.click(); clear.click();
  await until(() => /Local data cleared in this panel/.test(first.doc.getElementById("banner-title")!.textContent!));
  assert.match(first.doc.getElementById("banner-detail")!.textContent!, /another panel.*restore data/i);
  assert.deepEqual(data, {});
  await until(() => nameIn(data) === "Other panel's client");
});

test("a receipt can expose the Page identity and the refusal message", () => {
  const state = initialState();
  state.pack.page.name = "Private Page";
  const entry: ReceiptEntry = {
    planHash: "hash", outcome: "refused", refusal: { code: "refused", message: "Private text from page" },
    tier: state.pack.tier, offer: null, pageUrl: "https://www.facebook.com/profile.php?id=123", view: "page",
    approvedAt: "2026-01-01T00:00:00.000Z", draftedAt: null, finishedAt: "2026-01-01T00:00:00.000Z",
    drafted: [], unconfirmed: [], committed: [],
    checklist: { ...state.checklist, profilePictureRequired: false, coverPhotoRequired: false },
  };
  const receipt = buildSprintReceipt({ pack: state.pack, entries: [entry], extensionVersion: "1.0.0" });
  assert.equal(receipt.pageName, "Private Page");
  assert.match(receipt.entries[0]!.pageUrl, /id=123/);
  assert.equal(receipt.entries[0]!.refusal?.message, "Private text from page");
});
