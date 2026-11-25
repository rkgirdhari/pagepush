import assert from "node:assert/strict";
import { test } from "node:test";
import type { FacebookPack, FillPlan } from "../src/browser.ts";
import example from "../examples/facebook-pack.json" with { type: "json" };
import { initialState, recordCommit, recordCommitRefused, recordDraft, startSession, type PanelState } from "../src/extension/panel-state.ts";
import { buildSprintReceipt, receiptFileName, redactUrl, verifySprintReceipt } from "../src/extension/receipt.ts";
import { load, save, type LocalArea } from "../src/extension/storage.ts";

const pack = { ...(example as FacebookPack), tier: "standard" } as FacebookPack;
const URL_WITH_TRACKING = "https://www.facebook.com/profile.php?id=61550000000001&sk=about&__cft__=abc123&__tn__=xyz&ref=bookmarks";

function plan(): FillPlan {
  return {
    platform: "facebook",
    offer: { name: "x", priceUsd: 15, promise: "" },
    pageUrl: URL_WITH_TRACKING,
    actions: [
      { id: "bio", phase: "draft", kind: "textarea", label: "Introduce yourself", controlId: "fb-bio", value: pack.page.bio, preview: "" },
      { id: "website", phase: "draft", kind: "url", label: "Link", controlId: "fb-website", value: pack.contact!.website, preview: "" },
      { id: "saveChanges", phase: "commit", kind: "button", label: "Save", controlId: "fb-save", value: true, preview: "" },
    ],
    deferred: [],
    errors: [],
    warnings: [],
    gates: [],
    preview: [],
    planHash: "a".repeat(64),
  };
}

function drafted(): PanelState {
  let state: PanelState = { ...initialState(), pack };
  state = startSession(state, 7, plan());
  state = recordDraft(state, { applied: ["bio", "website"], unconfirmed: [] }, new Date("2026-11-25T10:00:00Z"));
  return { ...state, checklist: { reviewedPage: true, profilePicture: false, coverPhoto: true } };
}

test("a commit records the approval time, tier, view, drafted and committed fields, and the checklist", () => {
  const state = recordCommit(drafted(), new Date("2026-11-25T10:02:05Z"), new Date("2026-11-25T10:02:00Z"));
  assert.equal(state.receipts.length, 1);
  assert.deepEqual(state.receipts[0], {
    planHash: "a".repeat(64),
    outcome: "committed",
    tier: "standard",
    offer: { name: "Facebook Business Page Setup Sprint: Standard Business", priceUsd: 15 },
    pageUrl: "https://www.facebook.com/profile.php?id=61550000000001&sk=about",
    view: "page",
    approvedAt: "2026-11-25T10:02:00.000Z",
    draftedAt: "2026-11-25T10:00:00.000Z",
    finishedAt: "2026-11-25T10:02:05.000Z",
    drafted: [{ id: "bio", label: "Introduce yourself" }, { id: "website", label: "Link" }],
    unconfirmed: [],
    committed: [{ id: "bio", label: "Introduce yourself" }, { id: "website", label: "Link" }, { id: "saveChanges", label: "Save" }],
    checklist: { reviewedPage: true, profilePicture: false, coverPhoto: true, profilePictureRequired: false, coverPhotoRequired: false },
  });
});

test("a refusal before any click is recorded as refused and leaves the plan usable", () => {
  const before = drafted();
  const state = recordCommitRefused(before, { code: "captcha", message: "Solve the captcha.", approvedAt: new Date("2026-11-25T10:03:00Z") });
  assert.equal(state.receipts[0]!.outcome, "refused");
  assert.deepEqual(state.receipts[0]!.committed, []);
  assert.deepEqual(state.receipts[0]!.refusal, { code: "captcha", message: "Solve the captcha." });
  assert.equal(state.session!.stale, undefined, "the person can fix the page and approve again");
});

test("a partial commit records what ran and closes the plan", () => {
  const state = recordCommitRefused(drafted(), { code: "unconfirmed", message: "Post did not stick.", applied: ["saveChanges"], approvedAt: new Date() });
  assert.equal(state.receipts[0]!.outcome, "partial");
  assert.deepEqual(state.receipts[0]!.committed.map((field) => field.id), ["bio", "website", "saveChanges"]);
  assert.match(state.session!.stale ?? "", /Part of this commit ran/);
});

test("the exported receipt totals entries, hashes its body, and detects edits", () => {
  let state = recordCommit(drafted(), new Date("2026-11-25T10:02:05Z"), new Date("2026-11-25T10:02:00Z"));
  state = recordCommitRefused(state, { code: "drift", message: "Changed after drafting.", approvedAt: new Date("2026-11-25T10:05:00Z"), at: new Date("2026-11-25T10:05:00Z") });
  const receipt = buildSprintReceipt({ pack: state.pack, entries: state.receipts, now: new Date("2026-11-25T11:00:00Z"), extensionVersion: "1.0.0" });
  assert.equal(receipt.format, "pagepush.sprint-receipt");
  assert.equal(receipt.version, 1);
  assert.equal(receipt.schemaVersion, "2026-11-25");
  assert.equal(receipt.pageName, "Northline Studio");
  assert.deepEqual(receipt.offer, { name: "Facebook Business Page Setup Sprint: Standard Business", priceUsd: 15 });
  assert.deepEqual(receipt.totals, { approvals: 2, committed: 1, partial: 0, refused: 1, fieldsCommitted: 3 });
  assert.match(receipt.approvalStatement, /clicking Approve & Commit/);
  assert.match(receipt.sha256, /^[0-9a-f]{64}$/);
  assert.equal(verifySprintReceipt(receipt), true);
  assert.equal(verifySprintReceipt(JSON.parse(JSON.stringify(receipt))), true, "survives a JSON round trip");
  const edited = { ...receipt, entries: receipt.entries.map((entry) => ({ ...entry, outcome: "committed" as const })) };
  assert.equal(verifySprintReceipt(edited), false);
  assert.equal(receiptFileName(receipt), "pagepush-receipt-northline-studio-2026-11-25.json");
});

test("the receipt names fields but never carries their values or contact details", () => {
  const state = recordCommit(drafted());
  const text = JSON.stringify(buildSprintReceipt({ pack: state.pack, entries: state.receipts, extensionVersion: "1.0.0" }));
  for (const secret of [pack.page.bio!, pack.contact!.website!, pack.contact!.email!, pack.contact!.phone!, "__cft__", "abc123"]) {
    assert.equal(text.includes(secret), false, `receipt must not contain ${secret}`);
  }
});

test("URLs keep the Page id and view, and drop tracking parameters", () => {
  assert.equal(redactUrl(URL_WITH_TRACKING), "https://www.facebook.com/profile.php?id=61550000000001&sk=about");
  assert.equal(redactUrl("https://www.facebook.com/pages/creation/?ref=launch_point"), "https://www.facebook.com/pages/creation/");
  assert.equal(redactUrl("not a url"), "");
});

test("receipts persist in chrome.storage.local and older saves without them still load", async () => {
  const data: Record<string, unknown> = {};
  const area: LocalArea = {
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => { Object.assign(data, structuredClone(items)); },
    clear: async () => { for (const key of Object.keys(data)) delete data[key]; },
  };
  const state = recordCommit(drafted());
  await save(area, state);
  assert.equal((await load(area))!.receipts!.length, 1);
  const legacy = structuredClone(data["pagepush.v1"]) as Record<string, unknown>;
  delete legacy.receipts;
  data["pagepush.v1"] = legacy;
  assert.equal((await load(area))!.receipts, undefined, "the panel reads a missing list as empty");
});
