import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approve,
  executeCommit,
  executeDraft,
  formatTrace,
  planDevpost,
  recoverListing,
  renderDevpostPaste,
  CommitRefused,
} from "../src/index.ts";
import type { AppSumoPack, DevpostPack, TraceEvent } from "../src/index.ts";
import devpostExample from "../examples/devpost-pack.json" with { type: "json" };
import appsumoExample from "../examples/appsumo-pack.json" with { type: "json" };
import { devpostHtml, load, wireInvite, wireTags } from "./helpers.ts";

const pack = devpostExample as DevpostPack;

function form(): Document {
  const doc = load(devpostHtml());
  wireTags(doc, "built");
  wireInvite(doc, "mate", "invite");
  return doc;
}

test("a commit that stops after invites names the actions already written", () => {
  const doc = form();
  const events: TraceEvent[] = [];
  const plan = planDevpost(doc, {
    ...pack,
    attestations: { acceptedTerms: true },
  }, "https://devpost.com/hackathons/north-1");
  const draft = executeDraft(doc, plan, { trace: (event) => events.push(event) });
  assert.equal(draft.unconfirmed.length, 0);
  assert.equal(formatTrace(events).includes("Northline"), false);
  assert.equal(formatTrace(events).includes("mina@example.com"), false);
  doc.getElementById("terms")!.remove();
  const clicks = { count: 0 };
  doc.getElementById("submit-entry")!.addEventListener("click", () => { clicks.count += 1; });
  assert.throws(() => executeCommit(doc, plan, approve(plan), { trace: (event) => events.push(event) }), (error: unknown) => {
    return error instanceof CommitRefused
      && error.code === "unconfirmed"
      && error.applied.includes("teammates")
      && !error.applied.includes("submitEntry");
  });
  assert.equal(doc.getElementById("mates")!.children.length, 2);
  assert.equal(clicks.count, 0);
  assert.equal(events.some((event) => event.phase === "commit" && event.code === "unconfirmed" && event.actionId === "acceptedTerms"), true);
});

test("a throwing control is skipped and the rest of the draft still runs", () => {
  const doc = form();
  const plan = planDevpost(doc, { ...pack, attestations: { acceptedTerms: false } });
  const original = doc.getElementById.bind(doc);
  doc.getElementById = ((id: string) => {
    if (id === "name") throw new Error("Northline secret boom");
    return original(id);
  }) as Document["getElementById"];
  const events: TraceEvent[] = [];
  const draft = executeDraft(doc, plan, { trace: (event) => events.push(event) });
  assert.equal(draft.unconfirmed.includes("projectName"), true);
  assert.equal(draft.applied.includes("tagline"), true);
  assert.equal(JSON.stringify(events).includes("secret boom"), false);
  assert.equal(events.some((event) => event.code === "threw" && event.actionId === "projectName"), true);
});

test("an unconfirmed AppSumo draft points at the paste fallback", () => {
  const listing = appsumoExample as AppSumoPack;
  const recovered = recoverListing(listing, { unconfirmed: ["tagline"] });
  assert.match(recovered.markdown, /## Basic information/);
  assert.match(recovered.markdown, /Product name: Northline/);
  assert.equal(recovered.issues.some((item) => item.code === "paste-fallback"), true);
  assert.match(renderDevpostPaste(pack), /## Inspiration/);
  assert.match(renderDevpostPaste(pack), /Project name: Northline/);
});
