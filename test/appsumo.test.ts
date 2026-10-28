import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approve,
  assessAppSumo,
  executeCommit,
  executeDraft,
  planAppSumo,
  renderListingPaste,
  CommitRefused,
} from "../src/index.ts";
import type { AppSumoPack } from "../src/index.ts";
import example from "../examples/appsumo-pack.json" with { type: "json" };
import { appsumoHtml, attachFiles, load, readyAppSumo, wireGrowth, wireTokens } from "./helpers.ts";

const pack = example as AppSumoPack;

function ready(submit = true): { doc: Document; pack: AppSumoPack } {
  return {
    doc: readyAppSumo(),
    pack: { ...pack, attestations: { submitForReview: submit } },
  };
}

test("draft fills the partner editor and submit waits for the phone confirm", () => {
  const { doc, pack: listing } = ready(true);
  const submitClicks = { count: 0 };
  doc.getElementById("submit-review")!.addEventListener("click", () => { submitClicks.count += 1; });
  const plan = planAppSumo(doc, listing, "https://partners.appsumo.com/self-submission/demo/build");
  assert.equal(plan.offer.name, "AppSumo Application Service");
  assert.equal(plan.offer.priceUsd, 200);
  assert.deepEqual(plan.errors, [], JSON.stringify(plan.errors, null, 2));
  const draft = executeDraft(doc, plan);
  assert.deepEqual(draft.unconfirmed, [], JSON.stringify({ warnings: plan.warnings, actions: plan.actions.map((item) => item.id) }, null, 2));
  assert.equal((doc.getElementById("product-name") as HTMLInputElement).value, "Northline");
  assert.equal((doc.getElementById("usp") as HTMLInputElement).value, pack.story.usp);
  assert.match((doc.getElementById("tldr") as HTMLTextAreaElement).value, /See remaining retainer hours/);
  assert.equal((doc.getElementById("team-size") as HTMLSelectElement).value, "1-10");
  assert.equal((doc.getElementById("funding") as HTMLSelectElement).value, "Bootstrapped");
  assert.equal(doc.querySelectorAll("[data-tier]").length, 2);
  assert.equal(doc.querySelectorAll("[data-feature]").length, 4);
  assert.equal(doc.querySelectorAll("[data-story]").length, 2);
  assert.equal(doc.querySelectorAll("[data-faq]").length, 6);
  assert.match((doc.getElementById("steps") as HTMLTextAreaElement).value, /^1\. Open the receipt email/);
  assert.equal((doc.querySelector("input[value='licensing']") as HTMLInputElement).checked, true);
  assert.equal((doc.getElementById("private-key") as HTMLInputElement).value, "");
  assert.equal((doc.getElementById("company-linkedin") as HTMLInputElement).value, "");
  assert.equal((doc.getElementById("g2") as HTMLInputElement).value, "");
  assert.equal((doc.getElementById("website") as HTMLInputElement).value, "https://northline.example");
  assert.equal(submitClicks.count, 0);

  const again = planAppSumo(doc, listing, "https://partners.appsumo.com/self-submission/demo/build");
  assert.equal(again.planHash, plan.planHash);
  assert.throws(() => executeCommit(doc, plan, approve(plan)), (error: unknown) => {
    return error instanceof CommitRefused && error.code === "file";
  });
  attachFiles(doc, "icon", ["icon.png"]);
  attachFiles(doc, "hero", ["hero.png"]);
  attachFiles(doc, "shots", ["hours.png", "portal.png"]);
  executeCommit(doc, plan, approve(plan));
  assert.equal(submitClicks.count, 1);
});

test("submit for review stays unclicked until the partner approves the draft", () => {
  const { doc, pack: listing } = ready(false);
  const plan = planAppSumo(doc, listing);
  assert.equal(plan.errors.some((item) => item.code === "approval"), true);
  executeDraft(doc, plan);
  assert.throws(() => executeCommit(doc, plan, approve(plan)), (error: unknown) => {
    return error instanceof CommitRefused && error.code === "blocked";
  });
});

test("a taxonomy slug on the option value is accepted", () => {
  const doc = load(`
    <div data-widget>
      <label for="alternative">Alternative to</label>
      <input id="alternative" role="combobox" aria-controls="alternative-list" data-chips="alternative-chips">
      <ul id="alternative-list" role="listbox">
        <li role="option" value="mondaycom">Monday</li>
      </ul>
      <ul id="alternative-chips"></ul>
    </div>
  `);
  wireTokens(doc);
  const plan = planAppSumo(doc, {
    ...pack,
    product: { ...pack.product, alternativeTo: ["mondaycom"] },
  });
  assert.equal(plan.errors.some((item) => item.code === "taxonomy-miss"), false, JSON.stringify(plan.errors));
  const draft = executeDraft(doc, plan);
  assert.equal(draft.unconfirmed.includes("alternativeTo"), false, draft.unconfirmed.join(","));
  assert.equal(doc.querySelector("[role='option']")?.getAttribute("aria-selected"), "true");
});

test("unknown taxonomy values and over-limit copy are not written", () => {
  const doc = readyAppSumo();
  const missed = planAppSumo(doc, {
    ...pack,
    product: { ...pack.product, alternativeTo: ["not-a-tool"] },
    attestations: { submitForReview: true },
  });
  assert.equal(missed.errors.some((item) => item.code === "taxonomy-miss"), true);
  executeDraft(doc, missed);
  assert.equal((doc.getElementById("alternative") as HTMLInputElement).value, "");

  const longDoc = readyAppSumo();
  const long = planAppSumo(longDoc, {
    ...pack,
    story: { ...pack.story, usp: "U".repeat(41) },
    attestations: { submitForReview: true },
  });
  assert.equal(long.errors.some((item) => item.fieldId === "usp"), true);
  executeDraft(longDoc, long);
  assert.equal((longDoc.getElementById("usp") as HTMLInputElement).value, "");
});

test("voice warnings do not block a draft, and an entry tier over $49 is a warning", () => {
  const doc = readyAppSumo();
  const dashed = "Client retainer tracking, for agencies";
  const withDash = `${dashed.slice(0, 20)}\u2014${dashed.slice(20)}`;
  const plan = planAppSumo(doc, {
    ...pack,
    story: { ...pack.story, tagline: withDash },
    attestations: { submitForReview: true },
  });
  assert.equal(plan.warnings.some((item) => item.code === "em-dash"), true);
  assert.equal(plan.errors.some((item) => item.fieldId === "tagline"), false);
  executeDraft(doc, plan);
  assert.equal((doc.getElementById("tagline") as HTMLInputElement).value, withDash);

  const pricey = assessAppSumo({
    ...pack,
    pricing: { ...pack.pricing, tiers: [{ ...pack.pricing.tiers[0]!, price: 99 }, pack.pricing.tiers[1]!] },
  });
  assert.equal(pricey.some((item) => item.code === "entry-price"), true);
});

test("the paste fallback follows the listing brief and reports submit gaps", () => {
  const pasted = renderListingPaste(pack);
  assert.equal(pasted.issues.filter((item) => item.level === "error").length, 0);
  for (const heading of ["## Basic information", "## Media", "## Highlighted features", "## Pricing", "## Product story", "## FAQ"]) {
    assert.match(pasted.markdown, new RegExp(heading));
  }
  assert.match(pasted.markdown, /Pricing model: Licensing/);
  assert.match(pasted.markdown, /Hero image: attach in the Media section, alt: Retainer dashboard/);
  assert.doesNotMatch(pasted.markdown, /private key/i);

  const gap = renderListingPaste({
    ...pack,
    pricing: { ...pack.pricing, model: "licensing" },
    fulfillment: { ...pack.fulfillment, webhookUrl: undefined, redirectUrl: undefined },
  });
  assert.equal(gap.issues.some((item) => item.fieldId === "webhookUrl"), true);
});

test("a sign-in form is refused and a fresh editor still grows rows from one", () => {
  const login = load(`<label for="email">Email</label><input id="email"><label for="password">Password</label><input id="password" type="password">`);
  const refused = planAppSumo(login, { ...pack, attestations: { submitForReview: true } });
  assert.equal(refused.actions.length, 0);
  assert.equal(refused.errors.some((item) => item.code === "sign-in"), true);

  const doc = load(appsumoHtml());
  wireTokens(doc);
  wireGrowth(doc);
  const plan = planAppSumo(doc, { ...pack, attestations: { submitForReview: true } });
  assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
  const draft = executeDraft(doc, plan);
  assert.equal(draft.unconfirmed.length, 0);
});
