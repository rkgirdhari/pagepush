import assert from "node:assert/strict";
import { test } from "node:test";
import * as esbuild from "esbuild";
import example from "../examples/facebook-pack.json" with { type: "json" };
import type { ContentReply, PanelRequest } from "../src/extension/messages.ts";
import { countClicks, facebookDoc, PAGE_URL } from "./facebook-helpers.ts";

async function bundle(entry: string): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    logLevel: "silent",
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert.equal(inputs.some((input) => /candle|^node:|^native\/|^daemon\//.test(input)), false, inputs.join("\n"));
  return result.outputFiles[0]!.text;
}

test("browser bundles carry no Node built-ins or Node-only modules", async () => {
  for (const entry of ["src/extension/content.ts", "src/extension/sidepanel.ts", "src/extension/background.ts"]) {
    const code = await bundle(entry);
    assert.doesNotMatch(code, /require\(\s*["']node:|from\s*["']node:|child_process/, entry);
  }
});

test("the bundled content script plans, drafts, and commits through chrome.runtime messages", async () => {
  const code = await bundle("src/extension/content.ts");
  const doc = facebookDoc({ view: "page" });
  const clicks = countClicks(doc, ["fb-save", "fb-post"]);
  let listener: ((message: unknown, sender: unknown, reply: (value: ContentReply) => void) => unknown) | undefined;
  const chromeStub = { runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } };
  new Function("chrome", "document", "location", code)(chromeStub, doc, { href: PAGE_URL });
  assert.ok(listener, "content script registered a message listener");

  // The listener answers asynchronously and returns true to keep the channel open.
  const ask = (request: PanelRequest): Promise<ContentReply> =>
    new Promise((resolve) => {
      const keepOpen = listener!(request, {}, resolve);
      assert.equal(keepOpen, true, request.type);
    });

  assert.deepEqual(await ask({ type: "pagepush:status" }), { ok: true, url: PAGE_URL });
  const planned = await ask({ type: "pagepush:plan", pack: example as never });
  assert.ok(planned.ok && planned.plan);
  const plan = planned.plan!;
  assert.deepEqual(plan.errors, []);

  const wrong = await ask({ type: "pagepush:commit", planHash: "0".repeat(64) });
  assert.equal(wrong.ok, false);
  assert.equal(!wrong.ok && wrong.code, "confirm");
  assert.deepEqual(clicks, { "fb-save": 0, "fb-post": 0 });

  const drafted = await ask({ type: "pagepush:draft", planHash: plan.planHash });
  assert.ok(drafted.ok);
  assert.deepEqual(drafted.ok && drafted.draft?.unconfirmed, []);
  assert.equal((doc.getElementById("fb-website") as HTMLInputElement).value, "https://northline.example");
  assert.deepEqual(clicks, { "fb-save": 0, "fb-post": 0 });

  const committed = await ask({ type: "pagepush:commit", planHash: plan.planHash });
  assert.deepEqual(committed.ok && committed.committed, true);
  assert.deepEqual(clicks, { "fb-save": 1, "fb-post": 1 });
});
