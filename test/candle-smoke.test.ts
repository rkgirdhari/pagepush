import assert from "node:assert/strict";
import { test } from "node:test";
import { candleRunner, draftCopy } from "../src/index.ts";

const enabled = process.env.PAGE_PUSH_QWEN_SMOKE === "1";

test("Candle loads the pinned Qwen3 GGUF and returns fact-bound JSON", { skip: !enabled }, async () => {
  const facts = "Northline tracks retainer hours for agencies. Clients see burn before the month ends.";
  const draft = await draftCopy({
    platform: "appsumo",
    facts,
    fields: [
      { id: "tagline", maxLength: 100, minLength: 3 },
      { id: "usp", maxLength: 40, minLength: 15 },
    ],
  }, candleRunner({ timeoutMs: 120_000 }));
  assert.equal(draft.trace.some((event) => event.code === "answered"), true);
  for (const value of Object.values(draft.fields)) {
    const text = Array.isArray(value) ? value.join(" ") : value;
    assert.match(text, /retainer|Northline|clients|burn/i);
    assert.doesNotMatch(text, /efficient|affordable|reliable/i);
  }
  assert.equal(JSON.stringify(draft.trace).includes(facts), false);
});
