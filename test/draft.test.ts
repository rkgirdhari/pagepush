import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  draftCopy,
  formatTrace,
  interpretModelOutput,
  pinnedModelPaths,
  runCandle,
} from "../src/index.ts";
import type { CopyRunner } from "../src/index.ts";
import manifest from "../models/qwen3-0.6b-q8.json" with { type: "json" };

const facts = "Northline tracks retainer hours for agencies. Clients see burn before the month ends.";

const fields = [
  { id: "tagline", maxLength: 100, minLength: 3 },
  { id: "usp", maxLength: 40, minLength: 15 },
];

function runner(text: string): CopyRunner {
  return { complete: async () => ({ ok: true, text }) };
}

test("the Qwen3 pin is the official 639MB Q8_0 GGUF", () => {
  assert.equal(manifest.repo, "Qwen/Qwen3-0.6B-GGUF");
  assert.equal(manifest.file, "Qwen3-0.6B-Q8_0.gguf");
  assert.equal(manifest.bytes, 639446688);
  assert.equal(manifest.sha256, "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031");
  assert.equal(manifest.runtime, "candle");
  const pinned = pinnedModelPaths();
  assert.equal(path.basename(pinned.model), manifest.file);
  assert.equal(pinned.bytes, manifest.bytes);
});

test("a valid model JSON is kept and the trace stores no copy", async () => {
  const draft = await draftCopy({
    platform: "appsumo",
    facts,
    fields,
  }, runner(JSON.stringify({
    tagline: "Retainer hours for agencies",
    usp: "See burn before the month ends",
  })));
  assert.equal(draft.source, "qwen3");
  assert.equal(draft.fields.tagline, "Retainer hours for agencies");
  assert.equal(draft.fields.usp, "See burn before the month ends");
  assert.equal(JSON.stringify(draft.trace).includes("Retainer hours"), false);
  assert.match(formatTrace(draft.trace), /model accepted tagline/);
});

test("banned voice, new URLs, and broken JSON fall back to the facts", async () => {
  const banned = await draftCopy({
    platform: "appsumo",
    facts,
    fields: [fields[0]!],
  }, runner(JSON.stringify({ tagline: "A seamless retainer tracker" })));
  assert.equal(banned.source, "fallback");
  assert.equal(banned.fields.tagline, "Northline tracks retainer hours for agencies.");
  assert.equal(banned.issues.some((item) => item.code === "model-rejected"), true);

  const leaked = await draftCopy({
    platform: "devpost",
    facts,
    fields: [fields[0]!],
  }, runner("```json\n{\"tagline\":\"Watch https://evil.example/demo\"}\n```"));
  assert.equal(String(leaked.fields.tagline).includes("evil.example"), false);
  assert.equal(leaked.issues.some((item) => item.code === "model-rejected"), true);

  let calls = 0;
  const down = await draftCopy({
    platform: "devpost",
    facts,
    fields: [fields[0]!],
  }, {
    complete: async () => {
      calls += 1;
      return { ok: false, code: "timeout", message: "slow" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(down.source, "fallback");
  assert.equal(down.trace.some((event) => event.code === "timeout"), true);
  assert.equal(down.fields.tagline, "Northline tracks retainer hours for agencies.");
});

test("secrets are not sent and short facts stay empty", async () => {
  let calls = 0;
  const secret = await draftCopy({
    platform: "appsumo",
    facts: "BEGIN PRIVATE KEY\nabc",
    fields,
  }, {
    complete: async () => {
      calls += 1;
      return { ok: true, text: "{}" };
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(secret.fields, {});
  assert.equal(secret.issues.some((item) => item.code === "secret"), true);
  assert.equal(JSON.stringify(secret).includes("BEGIN PRIVATE KEY"), false);

  const empty = await draftCopy({ platform: "devpost", facts: "  ", fields }, runner("{}"));
  assert.deepEqual(empty.fields, {});
  assert.equal(empty.issues.some((item) => item.code === "facts"), true);
});

test("copy that adds words outside the facts is rejected", async () => {
  const draft = await draftCopy({
    platform: "appsumo",
    facts,
    fields: [fields[0]!],
  }, runner(JSON.stringify({ tagline: "Efficient, Reliable, and Affordable" })));
  assert.equal(draft.source, "fallback");
  assert.equal(draft.fields.tagline, "Northline tracks retainer hours for agencies.");
  assert.equal(draft.issues.some((item) => item.code === "model-rejected"), true);
});

test("one accepted field and one rejected field are reported as mixed", async () => {
  const draft = await draftCopy({
    platform: "appsumo",
    facts,
    fields,
  }, runner(JSON.stringify({
    tagline: "Retainer hours for agencies",
    usp: "Only $99 until Friday",
  })));
  assert.equal(draft.source, "mixed");
  assert.equal(draft.fields.tagline, "Retainer hours for agencies");
  assert.equal(draft.fields.usp, "Northline tracks retainer hours for");
  assert.equal(String(draft.fields.usp).includes("$99"), false);
  assert.ok(String(draft.fields.usp).length <= 40);
});

test("the Candle protocol parser and the process wrapper fail closed", async () => {
  assert.deepEqual(interpretModelOutput("noise\n{\"ok\":true,\"text\":\"hi\"}\n"), { ok: true, text: "hi" });
  assert.equal(interpretModelOutput("no json").ok, false);

  const standIn = fileURLToPath(new URL("../models/qwen3-0.6b-q8.json", import.meta.url));
  const missing = await runCandle(
    { system: "s", user: "u", maxTokens: 8 },
    { command: process.execPath, commandArgs: ["-e", "process.exit(0)"], modelPath: path.join(standIn, "missing.gguf") },
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "weights");

  const directory = await mkdtemp(path.join(tmpdir(), "page-push-"));
  const marker = path.join(directory, "spawned");
  await runCandle(
    { system: "s", user: "u", maxTokens: 8 },
    {
      command: process.execPath,
      commandArgs: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x")`],
      modelPath: "/no/such/qwen.gguf",
      tokenizerPath: standIn,
    },
  );
  await assert.rejects(() => stat(marker));

  const timed = await runCandle(
    { system: "Reply with JSON.", user: facts, maxTokens: 16 },
    {
      command: process.execPath,
      commandArgs: ["-e", "setInterval(() => {}, 1000)"],
      modelPath: standIn,
      tokenizerPath: standIn,
      skipSizeCheck: true,
      timeoutMs: 200,
    },
  );
  assert.equal(timed.ok, false);
  if (!timed.ok) assert.equal(timed.code, "timeout");

  const piped = await runCandle(
    { system: "Reply with JSON.", user: facts, maxTokens: 32 },
    {
      command: process.execPath,
      commandArgs: ["-e", "let raw='';process.stdin.on('data', (chunk) => { raw += chunk; }); process.stdin.on('end', () => { const body = JSON.parse(raw); if (!body.system || !body.user || typeof body.max_tokens !== 'number') { process.stdout.write(JSON.stringify({ ok: false, code: 'protocol', message: 'bad' })); return; } process.stdout.write(JSON.stringify({ ok: true, text: JSON.stringify({ tagline: 'Retainer hours for agencies' }) })); });"],
      modelPath: standIn,
      tokenizerPath: standIn,
      skipSizeCheck: true,
      timeoutMs: 5000,
    },
  );
  assert.equal(piped.ok, true);
  if (piped.ok) {
    const draft = await draftCopy({ platform: "appsumo", facts, fields: [fields[0]!] }, { complete: async () => piped });
    assert.equal(draft.fields.tagline, "Retainer hours for agencies");
  }
});
