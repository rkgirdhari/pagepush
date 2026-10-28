import assert from "node:assert/strict";
import { test } from "node:test";
import { appsumoSchema, devpostSchema } from "../src/index.ts";

test("platform schemas have unique fields and published sources", () => {
  for (const schema of [devpostSchema, appsumoSchema]) {
    const ids = schema.fields.map((field) => field.id);
    assert.equal(new Set(ids).size, ids.length, schema.id);
    assert.ok(schema.sources.every((source) => source.url.startsWith("https://")));
    assert.ok(schema.fields.every((field) => field.labels.length > 0 && field.path));
  }
  assert.equal(devpostSchema.offer.priceUsd, 25);
  assert.equal(appsumoSchema.offer.priceUsd, 200);
  assert.equal(appsumoSchema.fields.find((field) => field.id === "productName")?.writesTo, "product.name");
});
