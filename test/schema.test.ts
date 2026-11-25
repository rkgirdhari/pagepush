import assert from "node:assert/strict";
import { test } from "node:test";
import { appsumoSchema, devpostSchema, facebookSchema, facebookTiers } from "../src/index.ts";

test("platform schemas have unique fields and published sources", () => {
  for (const schema of [devpostSchema, appsumoSchema, facebookSchema]) {
    const ids = schema.fields.map((field) => field.id);
    assert.equal(new Set(ids).size, ids.length, schema.id);
    assert.ok(schema.sources.every((source) => source.url.startsWith("https://")));
    assert.ok(schema.fields.every((field) => field.labels.length > 0 && field.path));
  }
  assert.equal(devpostSchema.offer.priceUsd, 25);
  assert.equal(appsumoSchema.offer.priceUsd, 200);
  assert.equal(appsumoSchema.fields.find((field) => field.id === "productName")?.writesTo, "product.name");
});

test("Facebook tiers are $5, $15, and $50 and only name fields the schema has", () => {
  const tiers = facebookTiers();
  assert.deepEqual(
    Object.entries(tiers).map(([id, tier]) => [id, tier.priceUsd]),
    [["essentials", 5], ["standard", 15], ["launch", 50]],
  );
  const ids = new Set(facebookSchema.fields.map((field) => field.id));
  for (const tier of Object.values(tiers)) {
    for (const id of tier.fields) assert.ok(ids.has(id), id);
  }
  const commits = facebookSchema.fields.filter((field) => field.control === "button");
  assert.ok(commits.every((field) => field.phase === "commit"), "every Facebook button is a commit action");
});
