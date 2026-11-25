// Plans, drafts, and commits against the sanitized Phase 5 captures in test/fixtures/facebook/.
// The fixtures keep Facebook's real roles, labels, and nesting; the wiring below stands in for the
// React and Lexical behaviour seen live (async re-renders, Save/Post enabling after an edit,
// chips replacing the listbox, radio rows with nested indicators).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { approve, executeCommit, executeDraft, planFacebook } from "../src/index.ts";
import type { FacebookPack } from "../src/index.ts";
import example from "../examples/facebook-pack.json" with { type: "json" };
import { load } from "./helpers.ts";
import { countClicks, wireLexical } from "./facebook-helpers.ts";

const pack = example as FacebookPack;
const PROFILE_URL = "https://www.facebook.com/profile.php?id=61550000000001&sk=about";
const COMPOSER_URL = "https://www.facebook.com/post/create";
const DASHBOARD_URL = "https://www.facebook.com/professional_dashboard/";
const later = (fn: () => void): void => { setTimeout(fn, 5); };

function fixture(name: string): Document {
  const doc = load(readFileSync(`test/fixtures/facebook/${name}.html`, "utf8"));
  doc.querySelectorAll("[data-lexical-editor='true']").forEach((el) => {
    wireLexical(el);
    // Post enables once React has seen text in the composer.
    el.addEventListener("beforeinput", () => later(() => doc.getElementById("fb-post")?.setAttribute("aria-disabled", "false")));
  });
  // Each editor's Save enables a render after any edit inside it.
  doc.querySelectorAll("[data-enables]").forEach((save) => {
    const region = save.closest("section, [data-step], [role='dialog']")!;
    region.addEventListener("input", () => later(() => save.setAttribute("aria-disabled", "false")));
  });
  wireCategories(doc);
  wireOptionRows(doc);
  return doc;
}

/** Picking an option adds a "Selected values" chip with a Remove button and clears the listbox. */
function wireCategories(doc: Document): void {
  const list = doc.getElementById("fb-category-list");
  const chips = doc.querySelector("[role='list'][aria-label='Selected values']");
  list?.querySelectorAll("[role='option']").forEach((option) => {
    option.addEventListener("click", () => later(() => {
      const name = option.textContent ?? "";
      const chip = doc.createElement("span");
      chip.textContent = name;
      const remove = doc.createElement("div");
      remove.setAttribute("role", "button");
      remove.setAttribute("aria-label", `Remove ${name}`);
      chip.appendChild(remove);
      chips?.appendChild(chip);
      list.innerHTML = "";
      (doc.getElementById("fb-category") as HTMLInputElement).value = "";
    }));
  });
}

/** A click anywhere on an option row selects it; the row and its nested indicator flip together. */
function wireOptionRows(doc: Document): void {
  const dialog = doc.querySelector("[role='dialog']");
  const rows = dialog ? Array.from(dialog.querySelectorAll("[role='radio']")).filter((r) => !r.parentElement?.closest("[role='radio']")) : [];
  for (const row of rows) {
    row.addEventListener("click", () => later(() => {
      for (const other of rows) {
        const on = String(other === row);
        other.setAttribute("aria-checked", on);
        other.querySelector("[role='radio']")?.setAttribute("aria-checked", on);
      }
    }));
  }
}

test("the /post/create composer binds by its Page-named prompt and Post waits for Approve & Commit", async () => {
  const doc = fixture("post-create");
  const clicks = countClicks(doc, ["fb-post", "fb-boost", "fb-ai-label"]);
  const plan = planFacebook(doc, pack, COMPOSER_URL);
  assert.deepEqual(plan.errors, []);
  const ids = plan.actions.map((action) => `${action.phase}:${action.id}:${action.controlId}`);
  assert.deepEqual(ids, ["draft:launchPost:fb-composer", "commit:publishPost:fb-post"]);

  const draft = await executeDraft(doc, plan, { settleMs: 500 });
  assert.deepEqual(draft.unconfirmed, []);
  assert.match(doc.getElementById("fb-composer")!.textContent ?? "", /^Northline Studio is open\./);
  assert.equal(clicks["fb-post"], 0, "drafting never posts");

  await executeCommit(doc, plan, approve(plan), { settleMs: 500 });
  assert.deepEqual(clicks, { "fb-post": 1, "fb-boost": 0, "fb-ai-label": 0 }, "Boost and AI label are never touched");
});

test("Post that never enables is refused as unconfirmed instead of clicking a dead button", async () => {
  const doc = load(readFileSync("test/fixtures/facebook/post-create.html", "utf8"));
  doc.querySelectorAll("[data-lexical-editor='true']").forEach((el) => wireLexical(el)); // no enabling
  const clicks = countClicks(doc, ["fb-post"]);
  const plan = planFacebook(doc, pack, COMPOSER_URL);
  await executeDraft(doc, plan, { settleMs: 100 });
  await assert.rejects(() => executeCommit(doc, plan, approve(plan), { settleMs: 100 }), (error: unknown) => {
    return (error as { code?: string }).code === "unconfirmed";
  });
  assert.equal(clicks["fb-post"], 0);
});

test("a composer prompting for a different Page is refused before anything is planned", () => {
  const doc = fixture("post-create");
  const plan = planFacebook(doc, { ...structuredClone(pack), page: { ...pack.page, name: "Some Other Page" } }, COMPOSER_URL);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.errors[0]?.code, "page-identity");
});

test("the Business Dashboard is recognised by its h1 and the 'Hi <Page>' greeting", () => {
  const plan = planFacebook(fixture("dashboard"), pack, DASHBOARD_URL);
  assert.deepEqual(plan.errors.filter((item) => item.fieldId === "page"), []);
  assert.equal(plan.actions.length, 0, "the dashboard has nothing to fill");
});

test("the About editors draft bio, categories, link, phone, email, address, and ZIP; City/Town stays manual", async () => {
  const doc = fixture("page-about");
  const clicks = countClicks(doc, ["fb-save"]);
  const standard: FacebookPack = { ...structuredClone(pack), tier: "standard" };
  const plan = planFacebook(doc, standard, PROFILE_URL);
  assert.deepEqual(plan.errors, []);
  const byId = Object.fromEntries(plan.actions.map((action) => [action.id, action.controlId]));
  assert.deepEqual(byId, {
    bio: "fb-bio",
    categories: "fb-category",
    website: "fb-website",
    phone: "fb-phone",
    email: "fb-email",
    address: "fb-address",
    zip: "fb-zip",
    saveChanges: "fb-save",
  });
  assert.ok(plan.preview.some((line) => line.includes('City/Town: pick "Portland, Oregon"')), plan.preview.join("\n"));
  assert.ok(plan.warnings.some((item) => item.code === "country-code" && item.message.includes('"503 555 0142"')));

  const draft = await executeDraft(doc, plan, { settleMs: 500 });
  assert.deepEqual(draft.unconfirmed, []);
  assert.equal((doc.getElementById("fb-phone") as HTMLInputElement).value, "503 555 0142", "the +1 is not typed twice");
  assert.equal((doc.getElementById("fb-city") as HTMLInputElement).value, "", "the typeahead is left for the person");
  assert.deepEqual(
    Array.from(doc.querySelectorAll("[aria-label='Selected values'] [role='button']")).map((el) => el.getAttribute("aria-label")),
    ["Remove Software Company", "Remove Consulting Agency"],
    "the existing chip is kept and only the missing category is picked",
  );
  assert.equal(clicks["fb-save"], 0);

  await executeCommit(doc, plan, approve(plan), { settleMs: 500 });
  assert.equal(clicks["fb-save"], 1);
});

test("a bio over the live editor's 255-character cap is a plan error", () => {
  const long: FacebookPack = { ...structuredClone(pack), tier: "standard", page: { ...pack.page, bio: "x".repeat(256) } };
  const plan = planFacebook(fixture("page-about"), long, PROFILE_URL);
  assert.ok(plan.errors.some((item) => item.fieldId === "bio" && item.code === "max-length"));
});

test("the Action button dialog picks the option row by title and saves only after Approve & Commit", async () => {
  const doc = fixture("action-button");
  const clicks = countClicks(doc, ["fb-cta-save"]);
  const withCta: FacebookPack = { ...structuredClone(pack), tier: "standard", cta: { type: "Learn more", url: "https://northline.example" } };
  const plan = planFacebook(doc, withCta, PROFILE_URL);
  // The dialog alone carries no Page heading; on the live Page it opens over the profile.
  const page = load(readFileSync("test/fixtures/facebook/page-about.html", "utf8").replace(/<section[\s\S]*<\/section>/, "") + doc.body.innerHTML);
  wireOptionRows(page);
  page.querySelectorAll("[data-enables]").forEach((save) => {
    save.closest("[data-step]")!.addEventListener("input", () => later(() => save.setAttribute("aria-disabled", "false")));
  });
  const live = planFacebook(page, withCta, PROFILE_URL);
  assert.equal(plan.errors[0]?.code, "page-identity", "a bare dialog is not proof of the Page");
  assert.deepEqual(live.errors, []);
  const actions = live.actions.map((action) => `${action.phase}:${action.id}`);
  assert.deepEqual(actions.filter((item) => item.includes(":cta")), ["draft:ctaType", "draft:ctaUrl", "commit:ctaSave"]);

  const saves = countClicks(page, ["fb-cta-save"]);
  const draft = await executeDraft(page, live, { settleMs: 500 });
  assert.deepEqual(draft.unconfirmed, []);
  assert.equal(page.getElementById("fb-cta-learn")!.getAttribute("aria-checked"), "true");
  assert.equal(page.getElementById("fb-cta-learn")!.querySelector("[role='radio']")!.getAttribute("aria-checked"), "true");
  assert.equal(saves["fb-cta-save"], 0);

  await executeCommit(page, live, approve(live), { settleMs: 500 });
  assert.equal(saves["fb-cta-save"], 1);
  assert.equal(clicks["fb-cta-save"], 0);
});
