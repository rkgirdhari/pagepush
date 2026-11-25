import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkAndLoad,
  draftFacebookCopy,
  modelMatches,
  offlineFacebookCopy,
  ollamaRunner,
  ollamaStatus,
} from "../src/browser.ts";
import type { FacebookPack, FetchLike } from "../src/browser.ts";
import example from "../examples/facebook-pack.json" with { type: "json" };

const pack = example as FacebookPack;

interface Call { url: string; method: string; body?: unknown }

/** A scripted Ollama: each route returns a status and JSON (or NDJSON lines for /api/pull). */
function mockOllama(routes: Record<string, (body: unknown) => { status?: number; json?: unknown; lines?: unknown[] } | "down">) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    const route = routes[path];
    if (!route) throw new TypeError("Failed to fetch");
    const answer = route(body);
    if (answer === "down") throw new TypeError("Failed to fetch");
    const status = answer.status ?? 200;
    const text = answer.lines ? answer.lines.map((line) => JSON.stringify(line)).join("\n") : JSON.stringify(answer.json ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text),
      text: async () => text,
      body: null,
    };
  };
  return { fetch, calls };
}

const healthy = {
  "/api/version": () => ({ json: { version: "0.12.0" } }),
  "/api/tags": () => ({ json: { models: [{ name: "qwen3:latest" }, { name: "llama3.2:3b" }] } }),
};

test("model names match by family unless a tag is given", () => {
  assert.equal(modelMatches("qwen3:latest", "qwen3"), true);
  assert.equal(modelMatches("qwen3:8b", "qwen3"), true);
  assert.equal(modelMatches("qwen3:8b", "qwen3:4b"), false);
  assert.equal(modelMatches("qwen2.5:7b", "qwen3"), false);
});

test("status reports the version, installed models, and the matching tag", async () => {
  const { fetch } = mockOllama(healthy);
  const status = await ollamaStatus("qwen3", { fetch });
  assert.deepEqual(status, { ok: true, version: "0.12.0", models: ["qwen3:latest", "llama3.2:3b"], match: "qwen3:latest" });
});

test("an Ollama that is not running is reported as unreachable, never thrown", async () => {
  const { fetch } = mockOllama({ "/api/version": () => "down" });
  const status = await ollamaStatus("qwen3", { fetch });
  assert.equal(status.ok, false);
  assert.equal(!status.ok && status.code, "unreachable");
});

test("a 403 explains how to allow the extension with OLLAMA_ORIGINS on Windows", async () => {
  const { fetch } = mockOllama({ "/api/version": () => ({ status: 403, json: {} }) });
  const status = await ollamaStatus("qwen3", { fetch });
  assert.equal(!status.ok && status.code, "forbidden");
  assert.match(!status.ok ? status.message : "", /setx OLLAMA_ORIGINS "chrome-extension:\/\/\*"/);
});

test("Check / Load pulls a missing model with progress, then warms it", async () => {
  let pulled = false;
  const { fetch, calls } = mockOllama({
    "/api/version": () => ({ json: { version: "0.12.0" } }),
    "/api/tags": () => ({ json: { models: pulled ? [{ name: "qwen3:latest" }] : [] } }),
    "/api/pull": () => {
      pulled = true;
      return { lines: [{ status: "pulling manifest" }, { status: "downloading", completed: 50, total: 100 }, { status: "success" }] };
    },
    "/api/generate": () => ({ json: { done: true } }),
  });
  const steps: string[] = [];
  const progress: string[] = [];
  const result = await checkAndLoad("qwen3", {
    fetch,
    onStep: (step, detail) => steps.push(detail ? `${step}:${detail}` : step),
    onProgress: (item) => progress.push(item.total ? `${item.status} ${item.completed}/${item.total}` : item.status),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(steps, ["checking", "pulling:qwen3", "warming:qwen3:latest", "ready:qwen3:latest"]);
  assert.deepEqual(progress, ["pulling manifest", "downloading 50/100", "success"]);
  const pull = calls.find((call) => call.url.endsWith("/api/pull"));
  assert.deepEqual(pull?.body, { model: "qwen3", stream: true });
  const warm = calls.find((call) => call.url.endsWith("/api/generate"));
  assert.deepEqual(warm?.body, { model: "qwen3:latest", prompt: "", stream: false, keep_alive: "10m" });
});

test("Check / Load skips the pull when the model is installed", async () => {
  const { fetch, calls } = mockOllama({ ...healthy, "/api/generate": () => ({ json: { done: true } }) });
  const result = await checkAndLoad("qwen3", { fetch });
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call.url.endsWith("/api/pull")), false);
});

test("a failed pull is reported with Ollama's own error", async () => {
  const { fetch } = mockOllama({
    "/api/version": () => ({ json: { version: "0.12.0" } }),
    "/api/tags": () => ({ json: { models: [] } }),
    "/api/pull": () => ({ lines: [{ status: "pulling manifest" }, { error: "pull model manifest: file does not exist" }] }),
  });
  const result = await checkAndLoad("qwen3:nope", { fetch });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /file does not exist/);
});

test("the offline draft needs nothing installed and stays inside the 255-character bio cap", () => {
  const blank: FacebookPack = { ...structuredClone(pack), page: { ...pack.page, bio: "" }, launchPost: { text: "" } };
  const draft = offlineFacebookCopy(blank);
  assert.equal(draft.bio, "Northline Studio: Software Company and Consulting Agency in Portland, Oregon. https://northline.example");
  assert.ok(Array.from(draft.bio!).length <= 255);
  assert.equal(draft.launchPost, [
    "Northline Studio is now on Facebook.",
    draft.bio,
    "Book now: https://northline.example/book",
  ].join("\n\n"));
  // Text the person already wrote is kept as it is.
  assert.equal(offlineFacebookCopy(pack).bio, pack.page.bio);
  // Only the launch tier drafts a post.
  assert.equal(offlineFacebookCopy({ ...blank, tier: "standard" }).launchPost, undefined);
});

test("without Ollama, drafting is exactly the offline draft", async () => {
  const outcome = await draftFacebookCopy(pack);
  assert.equal(outcome.source, "offline");
  assert.deepEqual({ bio: outcome.bio, launchPost: outcome.launchPost }, offlineFacebookCopy(pack));
});

test("an unreachable Ollama falls back to the offline draft with a warning", async () => {
  const { fetch } = mockOllama({ "/api/chat": () => "down" });
  const outcome = await draftFacebookCopy(pack, ollamaRunner("qwen3", { fetch }));
  assert.equal(outcome.source, "offline");
  assert.equal(outcome.bio, offlineFacebookCopy(pack).bio);
  assert.ok(outcome.issues.some((item) => item.fieldId === "model" && item.level === "warning"));
});

test("grounded Ollama copy is used; qwen3 thinking is off and stripped", async () => {
  const bio = "Northline Studio helps small agencies track retainer hours so clients see the burn before the month ends.";
  const post = "Northline Studio is open.\n\nWe help small agencies track retainer hours. Book a walkthrough at https://northline.example/book";
  const { fetch, calls } = mockOllama({
    "/api/chat": () => ({ json: { message: { role: "assistant", content: `<think>planning</think>${JSON.stringify({ bio, launchPost: post })}` } } }),
  });
  const outcome = await draftFacebookCopy(pack, ollamaRunner("qwen3:latest", { fetch }));
  assert.equal(outcome.source, "ollama");
  assert.equal(outcome.bio, bio);
  assert.equal(outcome.launchPost, post, "paragraph breaks survive");
  const request = calls[0]!.body as { model: string; format: string; think: boolean; stream: boolean; messages: { role: string; content: string }[] };
  assert.equal(request.model, "qwen3:latest");
  assert.equal(request.format, "json");
  assert.equal(request.think, false);
  assert.equal(request.stream, false);
  assert.match(request.messages[1]!.content, /bio: one string, 20 to 255 characters/);
  assert.match(request.messages[1]!.content, /Page name: Northline Studio/);
});

test("Ollama copy that invents a link, runs over the cap, or adds claims is set aside per field", async () => {
  const { fetch } = mockOllama({
    "/api/chat": () => ({ json: { message: { content: JSON.stringify({
      bio: "Award-winning Northline Studio, voted best in Seattle. Visit https://elsewhere.example now.",
      launchPost: "x ".repeat(400),
    }) } } }),
  });
  const outcome = await draftFacebookCopy(pack, ollamaRunner("qwen3", { fetch }));
  assert.equal(outcome.source, "offline");
  assert.equal(outcome.bio, offlineFacebookCopy(pack).bio);
  assert.equal(outcome.launchPost, offlineFacebookCopy(pack).launchPost);
  assert.deepEqual(outcome.issues.filter((item) => item.code === "model-rejected").map((item) => item.fieldId), ["bio", "launchPost"]);
});

test("a pack holding a credential is never sent to the model", async () => {
  const { fetch, calls } = mockOllama({ "/api/chat": () => ({ json: { message: { content: "{}" } } }) });
  const leaky = { ...structuredClone(pack), contact: { ...pack.contact, password: "hunter2" } } as unknown as FacebookPack;
  const outcome = await draftFacebookCopy(leaky, ollamaRunner("qwen3", { fetch }));
  assert.equal(calls.length, 0);
  assert.equal(outcome.source, "offline");
  assert.ok(outcome.issues.some((item) => item.code === "secret"));
});

test("a streamed pull is read line by line even when chunks split a line", async () => {
  const encoder = new TextEncoder();
  const chunks = ['{"status":"pulling manifest"}\n{"status":"downl', 'oading","completed":1,"total":2}\n{"status":"success"}\n'];
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  });
  const { pullModel } = await import("../src/browser.ts");
  const seen: string[] = [];
  const result = await pullModel("qwen3", { fetch, onProgress: (item) => seen.push(item.status) });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(seen, ["pulling manifest", "downloading", "success"]);
});
