import { test } from "node:test";
import assert from "node:assert/strict";
import { isWithinOptimalWindow, checkPostingCadence } from "../src/lib/timing.js";
import { MAX_POSTS_PER_DAY_RECOMMENDED, MIN_HOURS_BETWEEN_POSTS } from "../src/lib/constants.js";

test("isWithinOptimalWindow is true for Wednesday 9am", () => {
  const date = new Date(2026, 0, 7, 9, 0); // a Wednesday
  assert.equal(date.getDay(), 3);
  assert.equal(isWithinOptimalWindow(date), true);
});

test("isWithinOptimalWindow is false for Saturday", () => {
  const date = new Date(2026, 0, 10, 9, 0); // a Saturday
  assert.equal(date.getDay(), 6);
  assert.equal(isWithinOptimalWindow(date), false);
});

test("checkPostingCadence warns at the daily frequency cap", () => {
  const now = Date.now();
  const history = Array.from({ length: MAX_POSTS_PER_DAY_RECOMMENDED }, (_, i) => ({ at: now - i * 60 * 60 * 1000 }));
  const warnings = checkPostingCadence(history, now);
  assert.ok(warnings.some((w) => w.code === "frequency_cap"));
});

test("checkPostingCadence warns when posting too soon after the last post", () => {
  const now = Date.now();
  const history = [{ at: now - (MIN_HOURS_BETWEEN_POSTS - 1) * 60 * 60 * 1000 }];
  const warnings = checkPostingCadence(history, now);
  assert.ok(warnings.some((w) => w.code === "too_soon"));
});

test("checkPostingCadence is quiet when history is empty and timing is optimal", () => {
  const optimalWednesday = new Date(2026, 0, 7, 9, 0).getTime();
  const warnings = checkPostingCadence([], optimalWednesday);
  assert.deepEqual(warnings, []);
});
