import assert from "node:assert/strict";
import { test } from "node:test";
import { writeAction } from "../src/apply.ts";
import { ensureCount } from "../src/bind.ts";
import { settle, settleFind } from "../src/settle.ts";
import type { Action } from "../src/types.ts";
import { load } from "./helpers.ts";

function action(kind: string, controlId: string, value: unknown): Action {
  return { id: controlId, phase: "draft", kind, label: controlId, controlId, value, preview: "" };
}

test("settle resolves true as soon as a later mutation makes the check pass", async () => {
  const doc = load(`<div id="box"></div>`);
  setTimeout(() => doc.getElementById("box")!.setAttribute("data-ready", "1"), 30);
  const started = Date.now();
  assert.equal(await settle(doc, () => doc.getElementById("box")!.hasAttribute("data-ready"), { timeoutMs: 2000 }), true);
  assert.ok(Date.now() - started < 1000, "did not wait for the full timeout");
});

test("settle gives up after its timeout and never throws from a failing check", async () => {
  const doc = load(`<div></div>`);
  const started = Date.now();
  const result = await settle(doc, () => { throw new Error("boom"); }, { timeoutMs: 80 });
  assert.equal(result, false);
  assert.ok(Date.now() - started >= 70);
  assert.equal(await settleFind(doc, () => undefined, { timeoutMs: 0 }), undefined);
});

test("a Lexical-style editor that applies text a frame later is confirmed, not reported unconfirmed", async () => {
  const doc = load(`<div id="bio" contenteditable="true" data-lexical-editor="true"></div>`);
  const editor = doc.getElementById("bio")!;
  // Lexical reconciles on its own schedule: the DOM text shows up after the input event.
  editor.addEventListener("beforeinput", (event) => {
    const data = (event as InputEvent).data ?? "";
    event.preventDefault();
    setTimeout(() => { editor.textContent = data; }, 40);
  });
  assert.equal(await writeAction(doc, action("textarea", "bio", "Hand-built canoes in Portland."), 1000), true);
  assert.equal(editor.textContent, "Hand-built canoes in Portland.");
});

test("a write the page never accepts is reported false within the settle bound", async () => {
  const doc = load(`<input id="name">`);
  const input = doc.getElementById("name") as HTMLInputElement;
  // A controlled input that snaps back to its own state.
  input.addEventListener("input", () => setTimeout(() => { input.value = ""; }, 0));
  const started = Date.now();
  assert.equal(await writeAction(doc, action("text", "name", "Northline"), 150), false);
  assert.ok(Date.now() - started < 1000);
});

test("checkboxes are toggled with a real click, never by setting .checked", async () => {
  const doc = load(`<label><input type="checkbox" id="terms"> I agree</label>`);
  const box = doc.getElementById("terms") as HTMLInputElement;
  let clicks = 0;
  box.addEventListener("click", () => { clicks += 1; });
  assert.equal(await writeAction(doc, action("checkbox", "terms", true), 500), true);
  assert.equal(box.checked, true);
  assert.equal(clicks, 1, "one genuine click event reached the page's handler");
  // Already checked: no second click that would uncheck it.
  assert.equal(await writeAction(doc, action("checkbox", "terms", true), 500), true);
  assert.equal(clicks, 1);
});

test("React-style switches (role=switch, aria-checked) update only through their click handler", async () => {
  const doc = load(`<div role="switch" aria-checked="false" id="messaging" tabindex="0">Messaging</div>`);
  const toggle = doc.getElementById("messaging")!;
  // State lives in the component: only its onClick flips it, after a render tick.
  toggle.addEventListener("click", () => {
    const next = toggle.getAttribute("aria-checked") !== "true";
    setTimeout(() => toggle.setAttribute("aria-checked", String(next)), 20);
  });
  assert.equal(await writeAction(doc, action("checkbox", "messaging", true), 1000), true);
  assert.equal(toggle.getAttribute("aria-checked"), "true");
});

test("ensureCount waits for a row that renders after the add click, and stops when the page refuses", async () => {
  const doc = load(`
    <section id="faq">
      <label for="q1">Question</label><input id="q1">
      <button type="button" id="add">Add question</button>
    </section>`);
  const section = doc.getElementById("faq")!;
  let made = 1;
  doc.getElementById("add")!.addEventListener("click", () => {
    if (made >= 3) return; // the page caps the list
    made += 1;
    const id = `q${made}`;
    setTimeout(() => {
      const label = doc.createElement("label");
      label.setAttribute("for", id);
      label.textContent = "Question";
      const input = doc.createElement("input");
      input.id = id;
      section.insertBefore(label, doc.getElementById("add"));
      section.insertBefore(input, doc.getElementById("add"));
    }, 30);
  });
  assert.equal((await ensureCount(section, "Question", 3, "Add question", 1000)).length, 3);
  const started = Date.now();
  assert.equal((await ensureCount(section, "Question", 5, "Add question", 120)).length, 3, "never invents a row the page refused");
  assert.ok(Date.now() - started < 1000);
});
