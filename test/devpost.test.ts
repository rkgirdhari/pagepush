import assert from "node:assert/strict";
import { test } from "node:test";
import { approve, executeCommit, executeDraft, planDevpost, planDevpostSprint, CommitRefused } from "../src/index.ts";
import type { DevpostPack } from "../src/index.ts";
import example from "../examples/devpost-pack.json" with { type: "json" };
import { devpostHtml, load, wireInvite, wireTags } from "./helpers.ts";

const pack = example as DevpostPack;

function form(options: Parameters<typeof devpostHtml>[0] = {}): Document {
  const doc = load(devpostHtml(options));
  if (!options.password && doc.getElementById("built")) {
    wireTags(doc, "built");
    wireInvite(doc, "mate", "invite");
  }
  return doc;
}

function accepted(extra: Partial<DevpostPack> = {}): DevpostPack {
  return {
    ...pack,
    ...extra,
    project: { ...pack.project, ...extra.project },
    attestations: { acceptedTerms: true },
  };
}

test("draft fills the hackathon form and leaves invites, terms, and submit for the phone confirm", () => {
  const doc = form();
  const submitClicks = { count: 0 };
  doc.getElementById("submit-entry")!.addEventListener("click", () => { submitClicks.count += 1; });
  const plan = planDevpost(doc, accepted(), "https://devpost.com/hackathons/north-1");
  assert.equal(plan.offer.name, "Hackathon Submission Sprint");
  assert.equal(plan.offer.priceUsd, 25);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.warnings.some((item) => item.code === "unmapped"), true);
  const draft = executeDraft(doc, plan);
  assert.deepEqual(draft.unconfirmed, [], JSON.stringify(plan.actions, null, 2));
  assert.equal((doc.getElementById("name") as HTMLInputElement).value, "Northline");
  assert.match((doc.getElementById("story") as HTMLTextAreaElement).value, /## Inspiration/);
  assert.match((doc.getElementById("story") as HTMLTextAreaElement).value, /## What it does/);
  assert.deepEqual(
    [...doc.querySelectorAll("[data-tag]")].map((node) => node.getAttribute("data-tag")),
    ["TypeScript", "Node.js"],
  );
  assert.equal((doc.getElementById("try-1") as HTMLInputElement).value, "https://northline.example");
  assert.equal((doc.getElementById("video") as HTMLInputElement).value, pack.project.videoUrl);
  assert.equal((doc.getElementById("table") as HTMLInputElement).value, "");
  assert.equal((doc.getElementById("terms") as HTMLInputElement).checked, false);
  assert.equal(doc.getElementById("mates")!.children.length, 0);
  assert.equal(submitClicks.count, 0);

  const again = planDevpost(doc, accepted(), "https://devpost.com/hackathons/north-1");
  assert.equal(again.planHash, plan.planHash);

  executeCommit(doc, plan, approve(plan));
  assert.equal((doc.getElementById("terms") as HTMLInputElement).checked, true);
  assert.deepEqual(
    [...doc.querySelectorAll("#mates [data-tag]")].map((node) => node.getAttribute("data-tag")),
    ["mina@example.com", "otto@example.com"],
  );
  assert.equal(submitClicks.count, 1);
});

test("a confirm for one hackathon does not submit another", () => {
  const first = form();
  const second = form({ category: true });
  const plans = planDevpostSprint(
    [
      { url: "https://devpost.com/hackathons/north-1", document: first },
      { url: "https://devpost.com/hackathons/north-2", document: second },
    ],
    {
      ...pack,
      targets: pack.targets?.map((target) => ({ ...target, acceptedTerms: true })),
    },
  );
  assert.equal(plans.length, 2);
  assert.notEqual(plans[0]!.planHash, plans[1]!.planHash);
  assert.equal(plans[1]!.actions.some((action) => action.id.includes("is your project new")), true);
  assert.equal(plans[0]!.errors.some((item) => item.code === "unanswered"), false);
  executeDraft(second, plans[1]!);
  assert.equal((second.getElementById("newness") as HTMLSelectElement).value, "Yes");
  assert.throws(() => executeCommit(second, plans[1]!, approve(plans[0]!)), (error: unknown) => {
    return error instanceof CommitRefused && error.code === "confirm";
  });
});

test("submit stays blocked until the pack says the terms were accepted", () => {
  const doc = form();
  const plan = planDevpost(doc, pack, "https://devpost.com/hackathons/north-1");
  assert.equal(plan.errors.some((item) => item.code === "terms"), true);
  executeDraft(doc, plan);
  assert.throws(() => executeCommit(doc, plan, approve(plan)), (error: unknown) => {
    return error instanceof CommitRefused && error.code === "blocked";
  });
  assert.equal((doc.getElementById("terms") as HTMLInputElement).checked, false);
});

test("captcha stays on the page until a person solves it", () => {
  const doc = form({ captcha: true });
  const plan = planDevpost(doc, accepted(), "https://devpost.com/software/new");
  assert.equal(plan.gates.some((gate) => gate.code === "captcha"), true);
  executeDraft(doc, plan);
  assert.equal((doc.querySelector("textarea[name='g-recaptcha-response']") as HTMLTextAreaElement).value, "");
  assert.throws(() => executeCommit(doc, plan, approve(plan)), (error: unknown) => {
    return error instanceof CommitRefused && error.code === "captcha";
  });
  (doc.querySelector("textarea[name='g-recaptcha-response']") as HTMLTextAreaElement).value = "solved-by-a-person";
  executeCommit(doc, plan, approve(plan));
  assert.equal((doc.getElementById("terms") as HTMLInputElement).checked, true);
});

test("a sign-in page is refused", () => {
  const doc = form({ password: true });
  const plan = planDevpost(doc, accepted());
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.errors.some((item) => item.code === "sign-in"), true);
});

test("limits and video hosts are enforced before anything is written", () => {
  const longName = form();
  const namePlan = planDevpost(longName, accepted({ project: { ...pack.project, name: "N".repeat(61) } }));
  assert.equal(namePlan.errors.some((item) => item.fieldId === "projectName"), true);
  executeDraft(longName, namePlan);
  assert.equal((longName.getElementById("name") as HTMLInputElement).value, "");

  const tight = form({ taglineMax: 80 });
  const taglinePlan = planDevpost(tight, accepted({ project: { ...pack.project, tagline: "T".repeat(100) } }));
  assert.equal(taglinePlan.errors.some((item) => item.code === "max-length" && item.fieldId === "tagline"), true);

  const video = form();
  const videoPlan = planDevpost(video, accepted({
    project: { ...pack.project, videoUrl: "https://www.facebook.com/watch/?v=1" },
    hackathon: { requiresVideo: true },
  }));
  assert.equal(videoPlan.errors.some((item) => item.code === "video"), true);
  executeDraft(video, videoPlan);
  assert.equal((video.getElementById("video") as HTMLInputElement).value, "");

  const missing = form();
  const missingPlan = planDevpost(missing, accepted({
    project: { ...pack.project, videoUrl: "" },
    hackathon: { requiresVideo: true },
  }));
  assert.equal(missingPlan.errors.some((item) => item.code === "video-required"), true);
});

test("an edit after the phone confirm refuses the commit", () => {
  const doc = form();
  const plan = planDevpost(doc, accepted(), "https://devpost.com/hackathons/north-1");
  executeDraft(doc, plan);
  (doc.getElementById("name") as HTMLInputElement).value = "Someone else";
  assert.throws(() => executeCommit(doc, plan, approve(plan)), (error: unknown) => {
    return error instanceof CommitRefused && error.code === "stale";
  });
  assert.equal((doc.getElementById("terms") as HTMLInputElement).checked, false);
});

test("duplicate built-with tags collapse", () => {
  const doc = form();
  const plan = planDevpost(doc, accepted({
    project: { ...pack.project, builtWith: ["TypeScript", "typescript", "Node.js"] },
  }));
  assert.equal(plan.warnings.some((item) => item.code === "duplicate-tag"), true);
  executeDraft(doc, plan);
  assert.deepEqual(
    [...doc.querySelectorAll("[data-widget] [data-tag]")].map((node) => node.getAttribute("data-tag")),
    ["TypeScript", "Node.js"],
  );
});
