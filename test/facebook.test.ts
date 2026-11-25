import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approve,
  CommitRefused,
  executeCommit,
  executeDraft,
  facebookContext,
  planFacebook,
} from "../src/index.ts";
import type { FacebookPack } from "../src/index.ts";
import example from "../examples/facebook-pack.json" with { type: "json" };
import { attachFiles } from "./helpers.ts";
import { countClicks, CREATE_URL, facebookDoc, PAGE_URL } from "./facebook-helpers.ts";

const pack = example as FacebookPack;

function withPack(extra: Partial<FacebookPack>): FacebookPack {
  return { ...structuredClone(pack), ...extra };
}

function value(doc: Document, id: string): string {
  return (doc.getElementById(id) as HTMLInputElement).value;
}

async function refusal(fn: () => Promise<void>): Promise<CommitRefused> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof CommitRefused) return error;
    throw error;
  }
  assert.fail("expected CommitRefused");
}

test("the create view drafts name, categories, and bio, and Create Page waits for Approve & Commit", async () => {
  const doc = facebookDoc({ view: "create" });
  const clicks = countClicks(doc, ["fb-create"]);
  const plan = planFacebook(doc, pack, CREATE_URL);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.offer.priceUsd, 50);
  assert.equal(plan.offer.name, "Facebook Business Page Setup Sprint: Full Launch + Post");
  assert.deepEqual(plan.actions.filter((item) => item.phase === "commit").map((item) => item.id), ["createPage"]);
  assert.ok(plan.deferred.includes("website") && plan.deferred.includes("launchPost") && plan.deferred.includes("ctaType"));

  const draft = await executeDraft(doc, plan);
  assert.deepEqual(draft.unconfirmed, [], JSON.stringify(plan.actions, null, 2));
  assert.equal(value(doc, "fb-name"), "Northline Studio");
  assert.deepEqual(
    [...doc.querySelectorAll("#fb-category-chips [data-tag]")].map((chip) => chip.textContent),
    ["Software Company", "Consulting Agency"],
  );
  assert.equal(value(doc, "fb-bio"), pack.page.bio);
  assert.equal(clicks["fb-create"], 0);

  await executeCommit(doc, plan, approve(plan));
  assert.equal(clicks["fb-create"], 1);
});

test("the Page view drafts contact, hours, the action button, and the Lexical launch post", async () => {
  const doc = facebookDoc({ view: "page" });
  const clicks = countClicks(doc, ["fb-save", "fb-cta-save", "fb-post"]);
  const plan = planFacebook(doc, pack, PAGE_URL);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.gates, []);
  assert.ok(plan.deferred.includes("pageName") && plan.deferred.includes("categories"));

  const draft = await executeDraft(doc, plan);
  assert.deepEqual(draft.unconfirmed, [], JSON.stringify(plan.actions, null, 2));
  assert.equal(value(doc, "fb-website"), "https://northline.example");
  assert.equal(value(doc, "fb-cta-url"), "https://northline.example/book");
  assert.equal(value(doc, "fb-phone"), "+1 503 555 0142");
  assert.equal(value(doc, "fb-email"), "hello@northline.example");
  assert.equal(value(doc, "fb-address"), "211 SE Ankeny St");
  assert.equal(value(doc, "fb-city"), "Portland, Oregon");
  assert.equal(value(doc, "fb-zip"), "97214");
  assert.equal((doc.getElementById("fb-hours-always") as HTMLInputElement).checked, true);
  assert.equal(doc.getElementById("fb-cta-book")!.getAttribute("aria-checked"), "true");

  const composer = doc.getElementById("fb-composer")!;
  assert.equal(composer.querySelectorAll("p").length, 3, "Lexical rendered one paragraph per line");
  assert.equal(composer.querySelector("p span[data-lexical-text]")!.textContent, "Northline Studio is open.");
  assert.deepEqual(clicks, { "fb-save": 0, "fb-cta-save": 0, "fb-post": 0 });

  assert.ok(plan.preview.some((line) => line === "Confirm: Post"));
  await executeCommit(doc, plan, approve(plan));
  assert.deepEqual(clicks, { "fb-save": 1, "fb-cta-save": 1, "fb-post": 1 });
});

test("the Essentials tier leaves hours, the action button, and the launch post out", async () => {
  const doc = facebookDoc({ view: "page" });
  const clicks = countClicks(doc, ["fb-save", "fb-cta-save", "fb-post"]);
  const plan = planFacebook(doc, withPack({ tier: "essentials" }), PAGE_URL);
  assert.equal(plan.offer.priceUsd, 5);
  assert.deepEqual(plan.errors, []);
  const ids = plan.actions.map((item) => item.id);
  for (const id of ["launchPost", "publishPost", "ctaType", "ctaUrl", "ctaSave", "hoursMode", "address"]) {
    assert.equal(ids.includes(id), false, id);
  }
  const outOfTier = plan.warnings.filter((item) => item.code === "out-of-tier").map((item) => item.fieldId).sort();
  assert.deepEqual(outOfTier, ["address", "city", "ctaType", "ctaUrl", "hoursMode", "launchPost", "zip"]);

  await executeDraft(doc, plan);
  await executeCommit(doc, plan, approve(plan));
  assert.equal(doc.getElementById("fb-composer")!.textContent, "");
  assert.deepEqual(clicks, { "fb-save": 1, "fb-cta-save": 0, "fb-post": 0 });
});

test("a personal profile, another Page, or a non-Facebook URL is refused with no actions", async () => {
  const profile = facebookDoc({ view: "profile" });
  const personal = planFacebook(profile, pack, "https://www.facebook.com/rosa.diaz");
  assert.equal(personal.actions.length, 0);
  assert.equal(personal.errors[0]?.code, "page-identity");

  const lookalike = facebookDoc({ view: "profile" });
  lookalike.querySelector("h1")!.textContent = "Northline Studio";
  const impostor = planFacebook(lookalike, pack, PAGE_URL);
  assert.equal(impostor.actions.length, 0);
  assert.equal(impostor.errors[0]?.code, "not-business-page");

  const other = planFacebook(facebookDoc({ view: "page", pageName: "Someone Else's Bakery" }), pack, PAGE_URL);
  assert.equal(other.actions.length, 0);
  assert.equal(other.errors[0]?.code, "page-identity");

  const offsite = planFacebook(facebookDoc({ view: "page" }), pack, "https://facebook.example/profile");
  assert.equal(offsite.actions.length, 0);
  assert.equal(offsite.errors[0]?.code, "not-facebook");
  assert.equal(facebookContext("http://www.facebook.com/pages/create"), "off-site");
  assert.equal(facebookContext(CREATE_URL), "create");

  const blocked = await refusal(() => executeCommit(profile, personal, approve(personal)));
  assert.equal(blocked.code, "blocked");
});

test("a Lexical composer that ignores every input path is reported, not silently overwritten", async () => {
  const doc = facebookDoc({ view: "page", deafComposer: true });
  const plan = planFacebook(doc, pack, PAGE_URL);
  const draft = await executeDraft(doc, plan);
  assert.deepEqual(draft.unconfirmed, ["launchPost"]);
  assert.equal(doc.getElementById("fb-composer")!.textContent, "", "no DOM text was written behind the editor's back");
  assert.equal((await refusal(() => executeCommit(doc, plan, approve(plan)))).code, "stale");
});

test("when the native insertText pipeline reaches Lexical, no fallback hands it the text again", async () => {
  const doc = facebookDoc({ view: "page" });
  const composer = doc.getElementById("fb-composer")!;
  const deliveries: string[] = [];
  composer.addEventListener("beforeinput", () => deliveries.push("beforeinput"));
  composer.addEventListener("paste", () => deliveries.push("paste"));
  // Stand-in for Chrome: execCommand fires a trusted-style beforeinput that Lexical cancels and applies.
  (doc as Document & { execCommand: (command: string, ui: boolean, text: string) => boolean }).execCommand =
    (command, _ui, text) => {
      if (command !== "insertText") return false;
      const view = doc.defaultView!;
      composer.dispatchEvent(new view.InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
      return true;
    };
  const plan = planFacebook(doc, pack, PAGE_URL);
  const draft = await executeDraft(doc, plan);
  assert.deepEqual(draft.unconfirmed, []);
  assert.deepEqual(deliveries, ["beforeinput"]);
  assert.equal(composer.querySelectorAll("p").length, 3);
});

test("Cloudflare Turnstile blocks commit until a person solves it", async () => {
  const doc = facebookDoc({ view: "create", captcha: true });
  const clicks = countClicks(doc, ["fb-create"]);
  const plan = planFacebook(doc, pack, CREATE_URL);
  assert.equal(plan.gates[0]?.code, "captcha");
  await executeDraft(doc, plan);
  assert.equal((await refusal(() => executeCommit(doc, plan, approve(plan)))).code, "captcha");
  assert.equal(clicks["fb-create"], 0);
  (doc.querySelector("[name='cf-turnstile-response']") as HTMLInputElement).value = "solved-by-person";
  await executeCommit(doc, plan, approve(plan));
  assert.equal(clicks["fb-create"], 1);
});

test("a required cover photo blocks commit until the person attaches it", async () => {
  const doc = facebookDoc({ view: "page" });
  const plan = planFacebook(doc, withPack({ media: { coverPhoto: "required" } }), PAGE_URL);
  assert.deepEqual(plan.gates.map((gate) => gate.fieldId), ["coverPhoto"]);
  assert.equal(plan.preview.some((line) => line.startsWith("Cover photo:")), false);
  await executeDraft(doc, plan);
  assert.equal((await refusal(() => executeCommit(doc, plan, approve(plan)))).code, "file");
  attachFiles(doc, "fb-cover", ["cover.png"]);
  await executeCommit(doc, plan, approve(plan));
});

test("categories, hours, and buttons must be options Facebook lists, and limits apply", async () => {
  const doc = facebookDoc({ view: "create" });
  const plan = planFacebook(doc, withPack({
    page: { name: "Northline Studio", categories: ["Space Agency"], bio: "x".repeat(102) },
  }), CREATE_URL);
  const codes = plan.errors.map((item) => `${item.fieldId}:${item.code}`).sort();
  assert.deepEqual(codes, ["bio:max-length", "categories:taxonomy-miss"]);
  assert.equal(plan.actions.some((item) => item.id === "categories" || item.id === "bio"), false);

  const page = facebookDoc({ view: "page" });
  const wrong = planFacebook(page, withPack({ cta: { type: "Order food", url: "https://northline.example" } }), PAGE_URL);
  assert.deepEqual(wrong.errors.map((item) => `${item.fieldId}:${item.code}`), ["ctaType:option-miss"]);
  const hours = planFacebook(facebookDoc({ view: "page" }), withPack({ hours: { mode: "Sometimes" } }), PAGE_URL);
  assert.ok(hours.errors.some((item) => item.fieldId === "hoursMode" && item.code === "enum"));
});

test("a pack that carries a credential is blocked before anything is written", async () => {
  const doc = facebookDoc({ view: "create" });
  const leaky = { ...structuredClone(pack), password: "hunter2" } as unknown as FacebookPack;
  const plan = planFacebook(doc, leaky, CREATE_URL);
  assert.ok(plan.errors.some((item) => item.code === "secret" && item.fieldId === "password"));
  assert.equal((await refusal(() => executeCommit(doc, plan, approve(plan)))).code, "blocked");
});

test("an edit after approval refuses the commit", async () => {
  const doc = facebookDoc({ view: "page" });
  const clicks = countClicks(doc, ["fb-save"]);
  const plan = planFacebook(doc, pack, PAGE_URL);
  await executeDraft(doc, plan);
  const token = approve(plan);
  (doc.getElementById("fb-phone") as HTMLInputElement).value = "+1 503 555 9999";
  assert.equal((await refusal(() => executeCommit(doc, plan, token))).code, "stale");
  assert.equal(clicks["fb-save"], 0);
});

test("the tier is part of the plan hash", async () => {
  const launch = planFacebook(facebookDoc({ view: "create" }), pack, CREATE_URL);
  const standard = planFacebook(facebookDoc({ view: "create" }), withPack({ tier: "standard" }), CREATE_URL);
  assert.notEqual(launch.planHash, standard.planHash);
  assert.equal(
    planFacebook(facebookDoc({ view: "create" }), pack, CREATE_URL).planHash,
    launch.planHash,
  );
});
