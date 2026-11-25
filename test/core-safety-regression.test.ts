import assert from "node:assert/strict";
import { test } from "node:test";
import { bindPage, captchaCleared } from "../src/bind.ts";
import { buildPlan } from "../src/plan.ts";
import { approve, CommitRefused, executeCommit, executeDraft } from "../src/execute.ts";
import { planFacebook, prepareFacebookPack, type FacebookPack } from "../src/shims/facebook.ts";
import { createController } from "../src/extension/controller.ts";
import type { FieldSchema, PlatformSchema } from "../src/types.ts";
import example from "../examples/facebook-pack.json" with { type: "json" };
import { load } from "./helpers.ts";
import { CREATE_URL, facebookDoc } from "./facebook-helpers.ts";

const url = "https://example.test/form";
const pack = example as FacebookPack;

function schema(fields: FieldSchema[]): PlatformSchema {
  return { id: "test", version: "1", title: "test", offer: { name: "test", priceUsd: 0, promise: "test" }, sources: [], fields };
}
function plan(doc: Document, fields: FieldSchema[], values: Record<string, unknown>) {
  return buildPlan({ document: doc, schema: schema(fields), pack: values, pageUrl: url });
}
const nameField: FieldSchema = { id: "name", labels: ["Name"], path: "name", control: "text" };
const saveField: FieldSchema = { id: "save", labels: ["Save"], path: "save", control: "button", phase: "commit" };

function success<T extends { ok: boolean }>(reply: T): asserts reply is T & { ok: true } {
  assert.equal(reply.ok, true, JSON.stringify(reply));
}

test("repeated scans reserve all existing IDs and never draft into a newly inserted control", async () => {
  const doc = load('<input aria-label="Name"><div id="pp-2"></div>');
  const original = doc.querySelector("input") as HTMLInputElement;
  bindPage(doc);
  const firstId = original.id;
  const unrelated = doc.createElement("input");
  unrelated.setAttribute("aria-label", "Unrelated");
  doc.body.prepend(unrelated);
  const p = plan(doc, [nameField], { name: "Intended" });
  assert.equal(original.id, firstId);
  assert.notEqual(unrelated.id, firstId);
  assert.notEqual(unrelated.id, "pp-2");
  assert.equal(new Set(Array.from(doc.querySelectorAll("[id]")).map((el) => el.id)).size, doc.querySelectorAll("[id]").length);
  assert.deepEqual((await executeDraft(doc, p, { settleMs: 0 })).unconfirmed, []);
  assert.equal(original.value, "Intended");
  assert.equal(unrelated.value, "");
});

test("ambiguous authored IDs fail closed rather than mutating either element", async () => {
  const doc = load('<input id="dup" aria-label="Name"><input id="dup" aria-label="Other">');
  const p = plan(doc, [nameField], { name: "Intended" });
  assert.deepEqual((await executeDraft(doc, p, { settleMs: 0 })).unconfirmed, ["name"]);
  assert.deepEqual(Array.from(doc.querySelectorAll("input")).map((el) => el.value), ["", ""]);
});

test("each identical replan has a distinct approval, and old approval cannot commit the new plan", async () => {
  const doc = load('<button id="save">Save</button>');
  let clicks = 0;
  doc.getElementById("save")!.addEventListener("click", () => clicks++);
  const first = plan(doc, [saveField], { save: true });
  const second = plan(doc, [saveField], { save: true });
  assert.equal(first.planHash, second.planHash);
  const transportedApproval = structuredClone(approve(first));
  await assert.rejects(() => executeCommit(doc, second, transportedApproval, { settleMs: 0 }), (error: unknown) => error instanceof CommitRefused && error.code === "confirm");
  assert.equal(clicks, 0);
});

test("a same-ID same-label replacement cannot receive an old draft or approval", async () => {
  const doc = load('<input id="name" aria-label="Name"><button id="save">Save</button>');
  const p = plan(doc, [nameField, saveField], { name: "Intended", save: true });
  const original = doc.getElementById("name")!;
  const replacement = original.cloneNode(true) as HTMLInputElement;
  original.replaceWith(replacement);
  assert.deepEqual((await executeDraft(doc, p, { settleMs: 0 })).unconfirmed, ["name"]);
  replacement.value = "Intended";
  let clicks = 0;
  doc.getElementById("save")!.addEventListener("click", () => clicks++);
  await assert.rejects(() => executeCommit(doc, p, approve(p), { settleMs: 0 }), (error: unknown) => error instanceof CommitRefused && error.code === "stale");
  assert.equal(clicks, 0);
});

test("a new controller plan invalidates a stale panel hash even for the same page and pack", async () => {
  const doc = facebookDoc({ view: "create" });
  const controller = createController({ document: doc, location: { href: CREATE_URL }, notify: () => {}, settleMs: 0 });
  const first = await controller.handle({ type: "pagepush:plan", pack }); success(first);
  const second = await controller.handle({ type: "pagepush:plan", pack }); success(second);
  assert.notEqual(first.plan!.planHash, second.plan!.planHash);
  const old = await controller.handle({ type: "pagepush:commit", planHash: first.plan!.planHash });
  assert.equal(old.ok, false);
  if (!old.ok) assert.equal(old.code, "confirm");
  controller.dispose();
});

test("navigation during draft settlement stops all subsequent mutations", async () => {
  const doc = facebookDoc({ view: "create" });
  const location = { href: CREATE_URL };
  const controller = createController({ document: doc, location, notify: () => {}, settleMs: 100 });
  const reply = await controller.handle({ type: "pagepush:plan", pack }); success(reply);
  doc.getElementById("fb-name")!.addEventListener("input", () => { setTimeout(() => { location.href = `${CREATE_URL}&other=1`; }, 0); });
  const draft = await controller.handle({ type: "pagepush:draft", planHash: reply.plan!.planHash });
  assert.equal(draft.ok, false);
  if (!draft.ok) assert.equal(draft.code, "context");
  assert.equal((doc.getElementById("fb-category") as HTMLInputElement).value, "");
  assert.equal((doc.getElementById("fb-bio") as HTMLTextAreaElement).value, "");
  controller.dispose();
});

test("navigation while a commit button enables never clicks and consumes the plan", async () => {
  const doc = facebookDoc({ view: "create" });
  const location = { href: CREATE_URL };
  const button = doc.getElementById("fb-create")!;
  button.setAttribute("aria-disabled", "true");
  let clicks = 0;
  button.addEventListener("click", () => clicks++);
  const controller = createController({ document: doc, location, notify: () => {}, settleMs: 100 });
  const reply = await controller.handle({ type: "pagepush:plan", pack }); success(reply);
  const draft = await controller.handle({ type: "pagepush:draft", planHash: reply.plan!.planHash }); success(draft);
  const committing = controller.handle({ type: "pagepush:commit", planHash: reply.plan!.planHash });
  setTimeout(() => { location.href = `${CREATE_URL}&other=1`; button.setAttribute("aria-disabled", "false"); }, 10);
  const result = await committing;
  assert.equal(result.ok, false);
  assert.equal(clicks, 0);
  location.href = CREATE_URL;
  const retry = await controller.handle({ type: "pagepush:commit", planHash: reply.plan!.planHash });
  assert.equal(retry.ok, false);
  if (!retry.ok) assert.equal(retry.code, "no-plan");
  controller.dispose();
});

test("replacing a disabled commit button while it settles never activates the replacement", async () => {
  const doc = load('<button id="save" aria-disabled="true">Save</button>');
  const old = doc.getElementById("save")!;
  const p = plan(doc, [saveField], { save: true });
  let clicks = 0;
  const pending = executeCommit(doc, p, approve(p), { settleMs: 100 });
  setTimeout(() => {
    const replacement = old.cloneNode(true) as Element;
    replacement.setAttribute("aria-disabled", "false");
    replacement.addEventListener("click", () => clicks++);
    old.replaceWith(replacement);
  }, 10);
  await assert.rejects(() => pending, (error: unknown) => error instanceof CommitRefused && error.code === "unconfirmed");
  assert.equal(clicks, 0);
});

test("every captcha response and every visible challenge must be satisfied", async () => {
  const doc = load('<div class="g-recaptcha"></div><textarea name="g-recaptcha-response">solved</textarea><div class="cf-turnstile"></div><input name="cf-turnstile-response" value="">');
  assert.equal(captchaCleared(doc), false);
  const button = doc.createElement("button"); button.id = "save"; button.textContent = "Save"; doc.body.append(button);
  let clicks = 0; button.addEventListener("click", () => clicks++);
  const p = plan(doc, [saveField], { save: true });
  await assert.rejects(() => executeCommit(doc, p, approve(p), { settleMs: 0 }), (error: unknown) => error instanceof CommitRefused && error.code === "captcha");
  assert.equal(clicks, 0);
  (doc.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement).value = "solved";
  assert.equal(captchaCleared(doc), true);
  const another = doc.createElement("div"); another.className = "cf-turnstile"; doc.body.append(another);
  assert.equal(captchaCleared(doc), false, "a challenge with no response also blocks");
});

test("Not set hours with a retained schedule does not throw or draft a schedule", () => {
  const unset = { ...pack, hours: { schedule: { monday: "09:00-17:00" } } } as unknown as FacebookPack;
  const prepared = prepareFacebookPack(unset);
  assert.equal(prepared.pack.hours, undefined);
  const p = planFacebook(facebookDoc({ view: "page" }), unset, "https://www.facebook.com/profile.php?id=61550000000001");
  assert.equal(p.actions.some((action) => action.id === "hoursMode"), false);
  assert.equal(p.errors.some((issue) => issue.fieldId === "hoursMode"), false);
  assert.equal(p.warnings.some((issue) => issue.code === "schedule-ignored"), true);
});

test("navigation caused by the first commit click prevents every later click", async () => {
  const doc = load('<button id="save">Save</button><button id="post">Post</button>');
  const location = { href: url };
  let saves = 0;
  let posts = 0;
  doc.getElementById("save")!.addEventListener("click", () => { saves++; location.href = `${url}?next`; });
  doc.getElementById("post")!.addEventListener("click", () => posts++);
  const post: FieldSchema = { id: "post", labels: ["Post"], path: "post", control: "button", phase: "commit" };
  const p = plan(doc, [saveField, post], { save: true, post: true });
  await assert.rejects(() => executeCommit(doc, p, approve(p), { settleMs: 0, currentUrl: () => location.href }),
    (error: unknown) => error instanceof CommitRefused && error.code === "unconfirmed");
  assert.equal(saves, 1);
  assert.equal(posts, 0);
});

test("two responses inside one captcha widget cannot mask a second unanswered widget", () => {
  const doc = load('<div class="g-recaptcha"><textarea name="g-recaptcha-response">one</textarea><textarea name="g-recaptcha-response">two</textarea></div><div class="g-recaptcha"></div>');
  assert.equal(captchaCleared(doc), false);
  const response = doc.createElement("textarea");
  response.name = "g-recaptcha-response";
  response.value = "second-widget";
  doc.querySelectorAll(".g-recaptcha")[1]!.append(response);
  assert.equal(captchaCleared(doc), true);
});
