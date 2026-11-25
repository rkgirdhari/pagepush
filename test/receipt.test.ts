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

test("an attempt records the approval time, tier, view, drafted and attempted fields, and the checklist", () => {
  const state = recordCommit(drafted(), new Date("2026-11-25T10:02:05Z"), new Date("2026-11-25T10:02:00Z"));
  assert.equal(state.receipts.length, 1);
  assert.deepEqual(state.receipts[0], {
    planHash: "a".repeat(64),
    outcome: "attempted",
    tier: "standard",
    offer: { name: "Facebook Business Page Setup Sprint: Standard Business", priceUsd: 15 },
    pageUrl: "https://www.facebook.com/profile.php?id=61550000000001&sk=about",
    view: "page",
    approvedAt: "2026-11-25T10:02:00.000Z",
    draftedAt: "2026-11-25T10:00:00.000Z",
    finishedAt: "2026-11-25T10:02:05.000Z",
    drafted: [{ id: "bio", label: "Introduce yourself" }, { id: "website", label: "Link" }],
    unconfirmed: [],
    committed: [],
    attempted: [{ id: "bio", label: "Introduce yourself" }, { id: "website", label: "Link" }, { id: "saveChanges", label: "Save" }],
    checklist: { reviewedPage: true, profilePicture: false, coverPhoto: true, profilePictureRequired: false, coverPhotoRequired: false },
  });
});

test("a refusal before any click is recorded as refused and leaves the plan usable", () => {
  const before = drafted();
  const state = recordCommitRefused(before, { code: "captcha", message: "Solve the captcha.", approvedAt: new Date("2026-11-25T10:03:00Z") });
  assert.equal(state.receipts[0]!.outcome, "refused");
  assert.deepEqual(state.receipts[0]!.committed, []);
  assert.deepEqual(state.receipts[0]!.attempted, []);
  assert.deepEqual(state.receipts[0]!.refusal, { code: "captcha", message: "Solve the captcha." });
  assert.deepEqual(state.progress, before.progress, "a pre-click refusal does not promote drafted progress");
  assert.equal(state.session!.stale, undefined, "the person can fix the page and approve again");
});

test("a partial attempt records what may have run and closes the plan", () => {
  const state = recordCommitRefused(drafted(), { code: "unconfirmed", message: "Post did not stick.", applied: ["saveChanges"], approvedAt: new Date() });
  assert.equal(state.receipts[0]!.outcome, "partial");
  assert.deepEqual(state.receipts[0]!.committed, []);
  assert.deepEqual(state.receipts[0]!.attempted!.map((field) => field.id), ["bio", "website", "saveChanges"]);
  assert.deepEqual(state.receipts[0]!.refusal, { code: "unconfirmed", message: "Post did not stick." });
  assert.ok(state.progress.every((field) => field.status === "attempted"));
  assert.match(state.session!.stale ?? "", /Part of this commit ran or may have run.*do not retry blindly/);
});

test("a lost dispatch reply is partial and does not invent a confirmed commit action", () => {
  const state = recordCommitRefused(drafted(), { code: "unknown-dispatch", message: "The reply was lost.", approvedAt: new Date() });
  const entry = state.receipts[0]!;
  assert.equal(entry.outcome, "partial");
  assert.deepEqual(entry.committed, []);
  assert.deepEqual(entry.attempted!.map((field) => field.id), ["bio", "website"]);
  assert.deepEqual(state.progress.map((field) => [field.fieldId, field.status]), [["bio", "attempted"], ["website", "attempted"]]);
  assert.match(state.session!.stale ?? "", /Check Facebook.*do not retry blindly/);
});

test("the exported receipt totals entries, hashes its body, and detects edits", () => {
  let state = recordCommit(drafted(), new Date("2026-11-25T10:02:05Z"), new Date("2026-11-25T10:02:00Z"));
  state = recordCommitRefused(state, { code: "drift", message: "Changed after drafting.", approvedAt: new Date("2026-11-25T10:05:00Z"), at: new Date("2026-11-25T10:05:00Z") });
  const partial = recordCommitRefused(drafted(), { code: "unconfirmed", message: "Stopped after Save.", applied: ["saveChanges"], approvedAt: new Date("2026-11-25T10:06:00Z") });
  const receipt = buildSprintReceipt({ pack: state.pack, entries: [...state.receipts, partial.receipts[0]!], now: new Date("2026-11-25T11:00:00Z"), extensionVersion: "1.0.0" });
  assert.equal(receipt.format, "pagepush.sprint-receipt");
  assert.equal(receipt.version, 1);
  assert.equal(receipt.schemaVersion, "2026-11-25");
  assert.equal(receipt.pageName, "Northline Studio");
  assert.deepEqual(receipt.offer, { name: "Facebook Business Page Setup Sprint: Standard Business", priceUsd: 15 });
  assert.deepEqual(receipt.totals, { approvals: 3, committed: 0, attempted: 1, partial: 1, refused: 1, fieldsCommitted: 0, fieldsAttempted: 3 }, "attempted field totals are deduplicated across entries");
  assert.match(receipt.approvalStatement, /clicking Approve & Commit/);
  assert.match(receipt.approvalStatement, /attempts, not proof Facebook saved or published anything/);
  assert.match(receipt.approvalStatement, /Check Facebook directly; do not retry blindly/);
  assert.match(receipt.sha256, /^[0-9a-f]{64}$/);
  assert.equal(verifySprintReceipt(receipt), true);
  assert.equal(verifySprintReceipt(JSON.parse(JSON.stringify(receipt))), true, "survives a JSON round trip");
  const edited = { ...receipt, entries: receipt.entries.map((entry) => ({ ...entry, outcome: "committed" as const })) };
  assert.equal(verifySprintReceipt(edited), false);
  assert.equal(receiptFileName(receipt), "pagepush-receipt-northline-studio-2026-11-25.json");
});

test("legacy committed receipts export as unverified attempts without mutating saved records", () => {
  const state = recordCommit(drafted());
  const { attempted, ...base } = state.receipts[0]!;
  assert.ok(attempted);
  const legacy = { ...base, outcome: "committed" as const, committed: attempted };
  const receipt = buildSprintReceipt({ pack: state.pack, entries: [legacy, state.receipts[0]!], extensionVersion: "1.0.0", unattributed: true });
  assert.equal(receipt.attribution, "unknown-may-be-mixed");
  assert.equal(receipt.pageName, "");
  assert.equal(receipt.tier, null);
  assert.equal(receipt.offer, null);
  assert.equal(receipt.entries[0]!.outcome, "attempted");
  assert.deepEqual(receipt.entries[0]!.attempted, attempted);
  assert.deepEqual(receipt.entries[0]!.committed, []);
  assert.deepEqual(receipt.totals, { approvals: 2, committed: 0, attempted: 2, partial: 0, refused: 0, fieldsCommitted: 0, fieldsAttempted: 3 });
  assert.equal(legacy.outcome, "committed");
  assert.deepEqual(legacy.committed, attempted);
  assert.equal(verifySprintReceipt(receipt), true);
});

test("an attempted receipt names fields without their values or contact details", () => {
  const state = recordCommit(drafted());
  const text = JSON.stringify(buildSprintReceipt({ pack: state.pack, entries: state.receipts, extensionVersion: "1.0.0" }));
  for (const secret of [pack.page.bio!, pack.contact!.website!, pack.contact!.email!, pack.contact!.phone!, "__cft__", "abc123"]) {
    assert.equal(text.includes(secret), false, `receipt must not contain ${secret}`);
  }
});

test("refusal messages are included verbatim and should be reviewed before sharing", () => {
  const message = "Check client@example.test on the page.";
  const state = recordCommitRefused(drafted(), { code: "captcha", message, approvedAt: new Date() });
  const receipt = buildSprintReceipt({ pack: state.pack, entries: state.receipts, extensionVersion: "1.0.0" });
  assert.equal(receipt.entries[0]!.refusal?.message, message);
  assert.ok(JSON.stringify(receipt).includes(message));
  assert.equal(verifySprintReceipt(receipt), true);
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
