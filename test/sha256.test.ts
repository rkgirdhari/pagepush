import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { sha256Hex } from "../src/sha256.ts";
import { sha256, stableStringify } from "../src/util.ts";
import { planFacebook } from "../src/index.ts";
import type { FacebookPack } from "../src/index.ts";
import example from "../examples/facebook-pack.json" with { type: "json" };
import { facebookDoc, PAGE_URL } from "./facebook-helpers.ts";

const nodeHex = (input: string | Uint8Array): string => createHash("sha256").update(input).digest("hex");

test("SHA-256 matches the FIPS 180-4 test vectors", () => {
  const vectors: [string, string][] = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    ],
    ["a".repeat(1_000_000), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"],
  ];
  for (const [input, expected] of vectors) assert.equal(sha256Hex(input), expected, `length ${input.length}`);
});

test("SHA-256 matches node:crypto at every padding boundary and on UTF-8 text", () => {
  for (let length = 0; length <= 300; length += 1) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = (i * 151 + length * 7) & 0xff;
    assert.equal(sha256Hex(bytes), nodeHex(bytes), `bytes ${length}`);
  }
  for (const text of ["Café — naïve", "Northline Studio 🚀 is open.", "日本語のページ", "\u0000\n\r\t"]) {
    assert.equal(sha256Hex(text), nodeHex(text), text);
  }
});

test("a plan hash is the SHA-256 of the same stable JSON node:crypto would hash", () => {
  const value = { b: [1, "two", { z: true, a: null }], a: "Café" };
  assert.equal(sha256(value), nodeHex(stableStringify(value)));
  const plan = planFacebook(facebookDoc({ view: "page" }), example as FacebookPack, PAGE_URL);
  assert.match(plan.planHash, /^[0-9a-f]{64}$/);
});
