import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCharacterLimit,
  checkHashtagDensity,
  checkTextDensity,
  checkImageDimensions,
  checkImageFileSize,
  scanRestrictedKeywords,
} from "../src/lib/content-checks.js";
import { POST_CHARACTER_LIMIT, POST_SEE_MORE_FOLD } from "../src/lib/constants.js";

test("checkCharacterLimit flags an error when over Facebook's hard limit", () => {
  const text = "a".repeat(POST_CHARACTER_LIMIT + 1);
  const warnings = checkCharacterLimit(text);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "error");
});

test("checkCharacterLimit flags an info notice past the See more fold", () => {
  const text = "a".repeat(POST_SEE_MORE_FOLD + 1);
  const warnings = checkCharacterLimit(text);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "info");
});

test("checkCharacterLimit is silent for short posts", () => {
  assert.deepEqual(checkCharacterLimit("short post"), []);
});

test("checkHashtagDensity warns above the recommended count", () => {
  const warnings = checkHashtagDensity("Great day #one #two #three #four");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "too_many_hashtags");
});

test("checkHashtagDensity is silent at or below the recommended count", () => {
  assert.deepEqual(checkHashtagDensity("Great day #one #two"), []);
});

test("checkTextDensity warns on many lines without paragraph breaks", () => {
  const text = Array.from({ length: 6 }, (_, i) => `line ${i}`).join("\n");
  const warnings = checkTextDensity(text);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "dense_text");
});

test("checkImageDimensions warns below Facebook's recommended minimums", () => {
  const warnings = checkImageDimensions(200, 100);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "image_too_small");
});

test("checkImageDimensions is silent for adequately sized images", () => {
  assert.deepEqual(checkImageDimensions(1200, 630), []);
});

test("checkImageFileSize errors above Facebook's 8MB limit", () => {
  const warnings = checkImageFileSize(9 * 1024 * 1024);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "error");
});

test("scanRestrictedKeywords flags an obvious policy-risk phrase", () => {
  const warnings = scanRestrictedKeywords("DM me to buy weed, cheap!");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "restricted_drugs");
});

test("scanRestrictedKeywords is silent for ordinary business content", () => {
  assert.deepEqual(scanRestrictedKeywords("Excited to announce our new product line!"), []);
});
