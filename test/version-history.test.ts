import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState, editPack, startSession, recordDraft } from "../src/extension/panel-state.ts";
import { readVersions, restoreVersion, saveVersion, VERSION_LIMIT } from "../src/extension/version-history.ts";
import { toSaved } from "../src/extension/storage.ts";
import { planFacebook } from "../src/index.ts";
import { facebookDoc, PAGE_URL } from "./facebook-helpers.ts";

const date = (n: number) => new Date(Date.UTC(2026, 10, 25, 0, 0, n));

test("versions are explicit, immutable, deduplicated, and included in local saves", () => {
  let state = initialState();
  state.pack.page.name = "First";
  state = saveVersion(state, date(1));
  const same = saveVersion(state, date(2));
  assert.equal(same, state);
  state.pack.page.name = "Second";
  assert.equal(state.versions[0]!.pack.page.name, "First");
  state = saveVersion(state, date(3));
  assert.deepEqual(state.versions.map(v => v.pack.page.name), ["Second", "First"]);
  assert.deepEqual(toSaved(state, date(4)).versions, state.versions);
});

test("restoring preserves the previous pack but discards active plan, progress and checks", () => {
  let state = initialState();
  state.pack.page.name = "Older";
  state.pack.page.categories = ["Software Company"];
  state = saveVersion(state, date(1));
  const changed = structuredClone(state.pack);
  changed.page.name = "Current";
  state = editPack(state, changed);
  const plan = planFacebook(facebookDoc({ view: "page" }), state.pack, PAGE_URL);
  state = startSession(state, 7, plan);
  state = recordDraft(state, { applied: plan.actions.filter(a => a.phase === "draft").map(a => a.id), unconfirmed: [] });
  state.checklist = { reviewedPage: true, profilePicture: true, coverPhoto: true };
  state = restoreVersion(state, 0, date(2));
  assert.equal(state.pack.page.name, "Older");
  assert.equal(state.versions[0]!.pack.page.name, "Current");
  assert.equal(state.session, null);
  assert.deepEqual(state.progress, []);
  assert.deepEqual(state.checklist, { reviewedPage: false, profilePicture: false, coverPhoto: false });
  assert.equal(restoreVersion(state, 99), state);
});

test("history is bounded and damaged or pre-history saves are safely ignored", () => {
  let state = initialState();
  for (let i = 0; i < VERSION_LIMIT + 3; i++) {
    const pack = structuredClone(state.pack);
    pack.page.name = `Version ${i}`;
    state = saveVersion(editPack(state, pack), date(i));
  }
  assert.equal(state.versions.length, VERSION_LIMIT);
  assert.equal(state.versions[0]!.pack.page.name, "Version 22");
  assert.equal(state.versions.at(-1)!.pack.page.name, "Version 3");
  assert.deepEqual(readVersions(undefined), []);
  assert.deepEqual(readVersions([{ savedAt: "bad", pack: {} }, null]), []);
  assert.equal(readVersions(state.versions).length, VERSION_LIMIT);
});
