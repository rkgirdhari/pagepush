import assert from "node:assert/strict";
import { test } from "node:test";
import { planFacebook } from "../src/index.ts";
import type { FacebookPack } from "../src/index.ts";
import example from "../examples/facebook-pack.json" with { type: "json" };
import {
  bannerFor,
  commitReadiness,
  draftReadiness,
  editPack,
  initialState,
  invalidate,
  recordCommit,
  recordDraft,
  recordDrift,
  startSession,
  type PanelState,
} from "../src/extension/panel-state.ts";
import { facebookDoc, PAGE_URL } from "./facebook-helpers.ts";

const pack = example as FacebookPack;
const TAB = 7;
const here = { activeTabId: TAB };

function planned(over: Partial<FacebookPack> = {}): PanelState {
  const withPack = editPack(initialState(), { ...structuredClone(pack), ...over });
  const plan = planFacebook(facebookDoc({ view: "page" }), withPack.pack, PAGE_URL);
  return startSession(withPack, TAB, plan);
}

function drafted(state: PanelState): PanelState {
  const draftIds = state.session!.plan.actions.filter((action) => action.phase === "draft").map((action) => action.id);
  return recordDraft(state, { applied: draftIds, unconfirmed: [] });
}

function reviewed(state: PanelState): PanelState {
  return { ...state, checklist: { ...state.checklist, reviewedPage: true } };
}

test("Approve & Commit opens only after plan, draft, and the reviewed tick, for this exact pack and tab", () => {
  let state = planned();
  assert.equal(draftReadiness(state, here).ok, true);
  assert.ok(commitReadiness(state, here).reasons.includes("Draft first, then read the page."));
  state = drafted(state);
  assert.deepEqual(commitReadiness(state, here).reasons, ["Tick \"I read every drafted field on the page\"."]);
  state = reviewed(state);
  assert.deepEqual(commitReadiness(state, here), { ok: true, reasons: [] });

  const edited = editPack(state, { ...state.pack, page: { ...state.pack.page, bio: "A different bio." } });
  assert.equal(commitReadiness(edited, here).ok, false);
  assert.ok(commitReadiness(edited, here).reasons.includes("The pack changed after planning. Plan again."));
  assert.equal(draftReadiness(edited, here).ok, false);

  assert.equal(commitReadiness(state, { activeTabId: 99 }).ok, false);
  assert.equal(commitReadiness(state, { activeTabId: null }).ok, false);
});

test("a new draft clears the reviewed tick, and drift or a stale context blocks commit", () => {
  const ready = reviewed(drafted(planned()));
  assert.equal(drafted(ready).checklist.reviewedPage, false);

  const drifted = recordDrift(ready, ready.session!.plan.planHash, ["phone"]);
  assert.match(commitReadiness(drifted, here).reasons.join(" "), /Changed on the page after drafting: Phone number/);
  assert.equal(recordDrift(ready, "other-hash", ["phone"]), ready, "drift for another plan is ignored");

  const stale = invalidate(ready, "The page navigated since this plan.");
  assert.ok(commitReadiness(stale, here).reasons.includes("The page navigated since this plan."));
  assert.equal(invalidate(stale, "second reason").session!.stale, "The page navigated since this plan.");

  const unconfirmed = reviewed(recordDraft(planned(), { applied: ["website"], unconfirmed: ["launchPost"] }));
  assert.match(commitReadiness(unconfirmed, here).reasons.join(" "), /did not stick.*What's on your mind\?/);
});

test("a required image gate needs its checklist tick", () => {
  let state = reviewed(drafted(planned({ media: { coverPhoto: "required" } })));
  assert.deepEqual(commitReadiness(state, here).reasons, ["Upload the cover photo on the page and tick it in the checklist."]);
  state = { ...state, checklist: { ...state.checklist, coverPhoto: true } };
  assert.equal(commitReadiness(state, here).ok, true);
});

test("an attempted plan cannot be committed again, and unverified progress survives into the next view", () => {
  const attempted = recordCommit(reviewed(drafted(planned())), new Date("2026-11-24T12:00:00Z"));
  assert.deepEqual(commitReadiness(attempted, here), { ok: false, reasons: ["This plan was already attempted. Check Facebook before planning another view."] });
  assert.equal(draftReadiness(attempted, here).ok, false);
  const byField = Object.fromEntries(attempted.progress.map((entry) => [entry.fieldId, entry.status]));
  assert.equal(byField.website, "attempted");
  assert.equal(byField.publishPost, "attempted");
  assert.ok(attempted.progress.every((entry) => entry.status === "attempted" && entry.url === PAGE_URL));
  assert.equal(attempted.session!.committedAt, "2026-11-24T12:00:00.000Z");

  const next = startSession(attempted, TAB, planFacebook(facebookDoc({ view: "create" }), attempted.pack, "https://www.facebook.com/pages/create"));
  assert.deepEqual(next.progress, attempted.progress, "a new view keeps earlier unverified progress");
  assert.equal(next.session!.committedAt, undefined);
});

test("refusals and connection failures become actionable banners", () => {
  assert.deepEqual(bannerFor("no-receiver").tone, "warn");
  assert.match(bannerFor("no-receiver").detail!, /Reload the Facebook tab/);
  assert.match(bannerFor("not-facebook-tab").title, /not Facebook/);
  assert.equal(bannerFor("not-business-page", "This looks like a personal profile").tone, "bad");
  assert.equal(bannerFor("not-business-page", "This looks like a personal profile").detail, "This looks like a personal profile");
  assert.match(bannerFor("captcha").detail!, /never solves captchas/);
  assert.equal(bannerFor("disconnected").tone, "warn");
});
