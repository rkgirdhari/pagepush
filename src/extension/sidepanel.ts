// Interim side panel for Phase 3: proves the bundled engine runs end to end in the extension.
// Phase 4 replaces it with the pack editor, starter packs, plan inspector, and receipts.
import type { FacebookPack, FillPlan } from "../browser.ts";
import example from "../../examples/facebook-pack.json" with { type: "json" };
import type { ContentReply, PanelRequest } from "./messages.ts";

const packInput = byId<HTMLTextAreaElement>("pack");
const planButton = byId<HTMLButtonElement>("plan");
const draftButton = byId<HTMLButtonElement>("draft");
const commitButton = byId<HTMLButtonElement>("commit");
const statusBox = byId<HTMLDivElement>("status");
const planView = byId<HTMLDivElement>("plan-view");

let shown: FillPlan | null = null;
packInput.value = JSON.stringify(example, null, 2);

planButton.addEventListener("click", async () => {
  let pack: FacebookPack;
  try {
    pack = JSON.parse(packInput.value) as FacebookPack;
  } catch (error) {
    setStatus(`The pack is not valid JSON: ${(error as Error).message}`, "bad");
    return;
  }
  const reply = await send({ type: "pagepush:plan", pack });
  if (!reply) return;
  if (!reply.ok) return setStatus(reply.message, "bad");
  shown = reply.plan ?? null;
  render();
  setStatus(shown?.errors.length ? "The plan has errors. Fix them before drafting." : "Planned. Review it, then Draft.", shown?.errors.length ? "bad" : "good");
});

draftButton.addEventListener("click", async () => {
  if (!shown) return;
  const reply = await send({ type: "pagepush:draft", planHash: shown.planHash });
  if (!reply) return;
  if (!reply.ok) return setStatus(reply.message, "bad");
  const unconfirmed = reply.draft?.unconfirmed ?? [];
  setStatus(
    unconfirmed.length ? `Drafted. These did not stick: ${unconfirmed.join(", ")}. Check them on the page.` : "Drafted. Read the page, then Approve & Commit.",
    unconfirmed.length ? "bad" : "good",
  );
});

commitButton.addEventListener("click", async () => {
  if (!shown) return;
  const reply = await send({ type: "pagepush:commit", planHash: shown.planHash });
  if (!reply) return;
  if (!reply.ok) {
    const applied = reply.applied?.length ? ` Already done: ${reply.applied.join(", ")}.` : "";
    return setStatus(`${reply.message}${applied}`, "bad");
  }
  setStatus("Committed.", "good");
});

async function send(request: PanelRequest): Promise<ContentReply | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https:\/\/([a-z0-9-]+\.)*facebook\.com\//i.test(tab.url)) {
    setStatus("Focus a Facebook Business Page tab, then try again.", "bad");
    return null;
  }
  try {
    return (await chrome.tabs.sendMessage(tab.id, request)) as ContentReply;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    setStatus(
      /Receiving end does not exist|Could not establish connection/i.test(text)
        ? "Page Push is not running in this tab yet. Reload the Facebook tab, then try again."
        : `The tab did not answer: ${text}`,
      "bad",
    );
    return null;
  }
}

function render(): void {
  planView.replaceChildren();
  draftButton.disabled = !shown || shown.errors.length > 0;
  commitButton.disabled = !shown || shown.errors.length > 0;
  if (!shown) return;
  addList("Offer", [`${shown.offer.name} ($${shown.offer.priceUsd})`]);
  addList("Preview", shown.preview);
  addList("Errors", shown.errors.map((item) => item.message), "error");
  addList("Warnings", shown.warnings.map((item) => item.message), "warning");
  addList("Gates", shown.gates.map((gate) => gate.message), "warning");
  addList("Not on this view", shown.deferred);
  const hash = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = "Plan hash";
  const code = document.createElement("code");
  code.textContent = shown.planHash;
  hash.append(heading, code);
  planView.append(hash);
}

function addList(title: string, items: string[], tone?: "error" | "warning"): void {
  if (!items.length) return;
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    if (tone) li.className = tone;
    list.append(li);
  }
  section.append(heading, list);
  planView.append(section);
}

function setStatus(text: string, tone?: "bad" | "good"): void {
  statusBox.textContent = text;
  if (tone) statusBox.dataset.tone = tone;
  else delete statusBox.dataset.tone;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}
