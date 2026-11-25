import assert from "node:assert/strict";
import { test } from "node:test";
import type { FacebookPack } from "../src/index.ts";
import example from "../examples/facebook-pack.json" with { type: "json" };
import {
  checkPack,
  cleanPack,
  counters,
  packFingerprint,
  pasteBlocks,
  setPath,
  starterPack,
  tierFields,
  TIERS,
} from "../src/extension/packs.ts";

const pack = example as FacebookPack;

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

test("starter packs exist for all three tiers and carry no placeholder client facts", () => {
  for (const tier of TIERS) {
    const starter = starterPack(tier);
    assert.equal(starter.tier, tier);
    const facts = strings({ ...starter, tier: undefined, media: undefined });
    assert.ok(facts.every((value) => value === ""), `${tier}: ${facts.join("|")}`);
    const check = checkPack(starter);
    assert.ok(check.errors.some((item) => item.fieldId === "pageName"), "a blank starter cannot be planned as-is");
  }
  assert.equal(starterPack("essentials").launchPost, undefined);
  assert.equal(starterPack("standard").launchPost, undefined);
  assert.deepEqual(starterPack("launch").launchPost, { text: "" });
  assert.ok(tierFields("launch").has("launchPost") && !tierFields("standard").has("launchPost"));
  assert.ok(tierFields("standard").has("ctaType") && !tierFields("essentials").has("ctaType"));
});

test("cleanPack drops blanks without inventing values, and the fingerprint follows real edits", () => {
  const raw = setPath(starterPack("standard"), "page.name", "  Northline Studio  ");
  setPath(raw, "page.categories.0", "Software Company");
  setPath(raw, "page.categories.2", "  ");
  const cleaned = cleanPack(raw);
  assert.deepEqual(cleaned.page, { name: "Northline Studio", categories: ["Software Company"] });
  assert.equal(cleaned.contact, undefined);
  assert.equal(cleaned.hours, undefined);
  assert.equal(cleaned.cta, undefined);

  const print = packFingerprint(raw);
  assert.equal(packFingerprint(setPath(structuredClone(raw), "page.name", "Northline Studio")), print, "whitespace is not an edit");
  assert.notEqual(packFingerprint(setPath(structuredClone(raw), "page.bio", "New bio")), print);
});

test("checkPack accepts the example and explains what is wrong with bad imports", () => {
  const good = checkPack(pack);
  assert.deepEqual(good.errors, []);
  assert.ok(good.pack);

  assert.equal(checkPack([1, 2]).pack, null);
  assert.equal(checkPack({ ...pack, tier: "platinum" }).errors[0]?.code, "tier");
  const typed = checkPack({ ...pack, page: { name: 7, categories: "Bakery" } });
  assert.deepEqual(typed.errors.map((item) => item.fieldId).sort(), ["categories", "pageName"]);
  const media = checkPack({ ...pack, media: { coverPhoto: "always" } });
  assert.equal(media.errors[0]?.code, "enum");

  const limits = checkPack({ ...pack, page: { ...pack.page, bio: "x".repeat(102) }, contact: { website: "northline", email: "nope" } });
  assert.deepEqual(limits.errors.map((item) => `${item.fieldId}:${item.code}`).sort(), ["bio:max-length", "email:email", "website:url"]);

  const extra = checkPack({ ...pack, password: "x", page: { ...pack.page, slogan: "y" } });
  assert.ok(extra.warnings.some((item) => item.code === "unknown-key" && item.fieldId === "page.slogan"));
  assert.ok(extra.errors.some((item) => item.code === "secret"));

  const tier = checkPack({ ...pack, tier: "essentials" });
  assert.ok(tier.warnings.some((item) => item.code === "out-of-tier" && item.fieldId === "launchPost"));
});

test("counters track Page name, bio, and the launch post against the schema limits", () => {
  const over = { ...pack, page: { ...pack.page, bio: "é".repeat(102) } };
  const byPath = Object.fromEntries(counters(over).map((item) => [item.path, item]));
  assert.deepEqual([byPath["page.name"]!.used, byPath["page.name"]!.max], [16, 75]);
  assert.deepEqual([byPath["page.bio"]!.used, byPath["page.bio"]!.over], [102, true]);
  assert.equal(byPath["launchPost.text"]!.max, 63206);
});

test("paste blocks cover the tier's text, and only the tier's text", () => {
  const launch = pasteBlocks(pack);
  assert.deepEqual(launch.map((block) => block.id), ["pageName", "categories", "bio", "contact", "address", "hours", "cta", "launchPost"]);
  assert.equal(launch.find((block) => block.id === "contact")!.text, "Website: https://northline.example\nPhone: +1 503 555 0142\nEmail: hello@northline.example");
  assert.equal(launch.find((block) => block.id === "cta")!.text, "Button: Book now\nLink: https://northline.example/book");
  assert.equal(launch.find((block) => block.id === "launchPost")!.text, pack.launchPost!.text);

  const essentials = pasteBlocks({ ...pack, tier: "essentials" });
  assert.deepEqual(essentials.map((block) => block.id), ["pageName", "categories", "bio", "contact"]);

  const scheduled = pasteBlocks({ ...pack, hours: { mode: "Open on selected hours", schedule: { monday: "9:00-17:00", sunday: "Closed" } } });
  assert.equal(scheduled.find((block) => block.id === "hours")!.text, "Hours: Open on selected hours\nMonday: 9:00-17:00\nSunday: Closed");
});
