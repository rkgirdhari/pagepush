// Loads the sanitized live captures in test/fixtures/facebook/ and wires stand-ins for the React
// and Lexical behaviour seen live: async re-renders, Save/Post enabling after an edit, chips
// replacing listbox options, and radio rows with nested indicators.
import { readFileSync } from "node:fs";
import { load } from "./helpers.ts";
import { wireLexical } from "./facebook-helpers.ts";

export const later = (fn: () => void): void => { setTimeout(fn, 5); };

export function fixture(name: string): Document {
  const doc = load(readFileSync(`test/fixtures/facebook/${name}.html`, "utf8"));
  doc.querySelectorAll("[data-lexical-editor='true']").forEach((el) => {
    wireLexical(el);
    // Post enables once React has seen text in the composer.
    el.addEventListener("beforeinput", () => later(() => doc.getElementById("fb-post")?.setAttribute("aria-disabled", "false")));
  });
  // Each editor's Save enables a render after any edit inside it.
  doc.querySelectorAll("[data-enables]").forEach((save) => {
    const region = save.closest("section, [data-step], [role='dialog']") ?? doc.body;
    region.addEventListener("input", () => later(() => save.setAttribute("aria-disabled", "false")));
  });
  wireCategories(doc);
  wireOptionRows(doc);
  return doc;
}

/**
 * Picking an option adds a "Selected values" chip with a Remove button and drops that option from
 * the list (live, the list is re-queried as the next value is typed).
 */
export function wireCategories(doc: Document): void {
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
      option.remove();
      (doc.getElementById("fb-category") as HTMLInputElement).value = "";
    }));
  });
}

/** A click anywhere on an option row selects it; the row and its nested indicator flip together. */
export function wireOptionRows(doc: Document): void {
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
