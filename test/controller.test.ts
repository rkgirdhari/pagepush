import assert from "node:assert/strict";
import { test } from "node:test";
import type { FacebookPack } from "../src/index.ts";
import example from "../examples/facebook-pack.json" with { type: "json" };
import { createController } from "../src/extension/controller.ts";
import type { ContentEvent, ContentReply } from "../src/extension/messages.ts";
import { wireTokens } from "./helpers.ts";
import { countClicks, CREATE_URL, facebookDoc, facebookHtml, PAGE_URL, wireLexical, wireRoleRadios } from "./facebook-helpers.ts";

const pack = example as FacebookPack;

function setup(view: "create" | "page", options: { captcha?: boolean } = {}) {
  const doc = facebookDoc({ view, ...options });
  const location = { href: view === "create" ? CREATE_URL : PAGE_URL };
  const events: ContentEvent[] = [];
  let userEdits = false;
  const controller = createController({
    document: doc,
    location,
    notify: (event) => events.push(event),
    isUserEdit: () => userEdits,
  });
  return {
    doc,
    location,
    events,
    controller,
    asUser<T>(fn: () => T): T {
      userEdits = true;
      try {
        return fn();
      } finally {
        userEdits = false;
      }
    },
  };
}

function ok(reply: ContentReply): Extract<ContentReply, { ok: true }> {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply as Extract<ContentReply, { ok: true }>;
}

function refused(reply: ContentReply): string {
  assert.equal(reply.ok, false, JSON.stringify(reply));
  return (reply as Extract<ContentReply, { ok: false }>).code;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("one approval commits once: a second commit with the same hash is refused", async () => {
  const { doc, controller } = setup("page");
  const clicks = countClicks(doc, ["fb-save", "fb-post"]);
  const plan = ok(await controller.handle({ type: "pagepush:plan", pack })).plan!;
  ok(await controller.handle({ type: "pagepush:draft", planHash: plan.planHash }));
  assert.equal(ok(await controller.handle({ type: "pagepush:commit", planHash: plan.planHash })).committed, true);
  assert.equal(refused(await controller.handle({ type: "pagepush:commit", planHash: plan.planHash })), "no-plan");
  assert.deepEqual(clicks, { "fb-save": 1, "fb-post": 1 });
});

test("a person editing a drafted field is drift: the panel is told and commit is refused", async () => {
  const { doc, controller, events, asUser } = setup("page");
  const clicks = countClicks(doc, ["fb-save"]);
  const plan = ok(await controller.handle({ type: "pagepush:plan", pack })).plan!;
  ok(await controller.handle({ type: "pagepush:draft", planHash: plan.planHash }));
  const phone = doc.getElementById("fb-phone") as HTMLInputElement;
  const view = doc.defaultView!;

  // Typing the same value back is not drift.
  asUser(() => phone.dispatchEvent(new view.Event("input", { bubbles: true })));
  assert.equal(events.length, 0);

  phone.value = "+1 503 555 9999";
  asUser(() => phone.dispatchEvent(new view.Event("input", { bubbles: true })));
  assert.deepEqual(events, [{ type: "pagepush:drift", url: PAGE_URL, planHash: plan.planHash, fields: ["phone"] }]);
  assert.deepEqual(ok(await controller.handle({ type: "pagepush:verify", planHash: plan.planHash })).drift, ["phone"]);
  assert.equal(refused(await controller.handle({ type: "pagepush:commit", planHash: plan.planHash })), "drift");
  assert.equal(clicks["fb-save"], 0);
});

test("an unsolved captcha refuses commit without using up the approval", async () => {
  const { doc, controller } = setup("create", { captcha: true });
  const clicks = countClicks(doc, ["fb-create"]);
  const plan = ok(await controller.handle({ type: "pagepush:plan", pack })).plan!;
  ok(await controller.handle({ type: "pagepush:draft", planHash: plan.planHash }));
  assert.equal(refused(await controller.handle({ type: "pagepush:commit", planHash: plan.planHash })), "captcha");
  (doc.querySelector("[name='cf-turnstile-response']") as HTMLInputElement).value = "solved-by-person";
  ok(await controller.handle({ type: "pagepush:commit", planHash: plan.planHash }));
  assert.equal(clicks["fb-create"], 1);
});

test("an SPA move from /pages/create to the Page view re-binds with a new plan and refuses the old one", async () => {
  const { doc, location, controller, events } = setup("create");
  const first = ok(await controller.handle({ type: "pagepush:plan", pack })).plan!;
  ok(await controller.handle({ type: "pagepush:draft", planHash: first.planHash }));
  ok(await controller.handle({ type: "pagepush:commit", planHash: first.planHash }));

  // Facebook swaps the view in place and pushes a new URL.
  location.href = PAGE_URL;
  doc.body.innerHTML = facebookHtml({ view: "page" });
  wireTokens(doc);
  wireRoleRadios(doc);
  doc.querySelectorAll("[data-lexical-editor='true']").forEach((el) => wireLexical(el));
  await tick();
  assert.ok(events.some((event) => event.type === "pagepush:view-changed" && event.reason === "navigated" && event.url === PAGE_URL));

  assert.equal(refused(await controller.handle({ type: "pagepush:draft", planHash: first.planHash })), "no-plan");
  const second = ok(await controller.handle({ type: "pagepush:plan", pack })).plan!;
  assert.notEqual(second.planHash, first.planHash);
  assert.ok(second.actions.every((action) => doc.getElementById(action.controlId)), "every control id re-bound on the new view");
  const draft = ok(await controller.handle({ type: "pagepush:draft", planHash: second.planHash })).draft!;
  assert.deepEqual(draft.unconfirmed, []);
  assert.equal((doc.getElementById("fb-website") as HTMLInputElement).value, "https://northline.example");
});

test("a URL change without a re-plan refuses draft and commit as a context change", async () => {
  const { location, controller } = setup("page");
  const plan = ok(await controller.handle({ type: "pagepush:plan", pack })).plan!;
  ok(await controller.handle({ type: "pagepush:draft", planHash: plan.planHash }));
  location.href = `${PAGE_URL}&sk=about`;
  assert.equal(refused(await controller.handle({ type: "pagepush:commit", planHash: plan.planHash })), "context");
  assert.equal(ok(await controller.handle({ type: "pagepush:status" })).plan, undefined, "status drops a plan made on another URL");
});

test("a dialog opening is reported so the panel can re-plan it", async () => {
  const { doc, controller, events } = setup("page");
  ok(await controller.handle({ type: "pagepush:plan", pack }));
  const dialog = doc.createElement("div");
  dialog.setAttribute("role", "dialog");
  doc.body.append(dialog);
  await tick();
  assert.deepEqual(events.at(-1), { type: "pagepush:view-changed", url: PAGE_URL, reason: "dialog" });
  controller.dispose();
});

test("a second draft or commit while one is still settling is refused as busy, not interleaved", async () => {
  const { controller } = setup("page");
  const plan = ok(await controller.handle({ type: "pagepush:plan", pack })).plan!;
  const first = controller.handle({ type: "pagepush:draft", planHash: plan.planHash });
  assert.equal(refused(await controller.handle({ type: "pagepush:draft", planHash: plan.planHash })), "busy");
  assert.equal(refused(await controller.handle({ type: "pagepush:commit", planHash: plan.planHash })), "busy");
  assert.deepEqual(ok(await first).draft!.unconfirmed, []);
  assert.equal(ok(await controller.handle({ type: "pagepush:commit", planHash: plan.planHash })).committed, true);
});
