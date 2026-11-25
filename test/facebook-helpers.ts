// Facebook fixtures built from the published flow and the d6cb DOM research, not from captured
// Facebook markup. Phase 5 replaces them with sanitized captures of the logged-in views.
import { load, wireTokens } from "./helpers.ts";

export const PAGE_URL = "https://www.facebook.com/profile.php?id=61550000000001";
export const CREATE_URL = "https://www.facebook.com/pages/create/?ref_type=launch_point";

export interface FacebookFixture {
  view: "create" | "page" | "profile";
  pageName?: string;
  captcha?: boolean;
  /** A Lexical root with no editor listening: it ignores every input path. */
  deafComposer?: boolean;
  categories?: [string, string][];
}

const CATEGORIES: [string, string][] = [
  ["software-company", "Software Company"],
  ["consulting-agency", "Consulting Agency"],
  ["bakery", "Bakery"],
];

export function facebookDoc(fixture: FacebookFixture): Document {
  const doc = load(facebookHtml(fixture));
  wireTokens(doc);
  wireRoleRadios(doc);
  if (!fixture.deafComposer) doc.querySelectorAll("[data-lexical-editor='true']").forEach((el) => wireLexical(el));
  return doc;
}

export function facebookHtml(fixture: FacebookFixture): string {
  const turnstile = fixture.captcha
    ? `<div class="cf-turnstile" data-sitekey="test"></div><input type="hidden" name="cf-turnstile-response" value="">`
    : "";
  if (fixture.view === "create") return createView(fixture) + turnstile;
  if (fixture.view === "profile") return profileView() + turnstile;
  return pageView(fixture) + turnstile;
}

function createView(fixture: FacebookFixture): string {
  const options = (fixture.categories ?? CATEGORIES)
    .map(([slug, text]) => `<li role="option" data-slug="${slug}">${text}</li>`)
    .join("");
  return `
    <div role="main">
      <h1>Create a Page</h1>
      <label><span>Page name (required)</span><input id="fb-name" type="text"></label>
      <div data-widget>
        <label for="fb-category">Category (required)</label>
        <input id="fb-category" role="combobox" aria-controls="fb-category-list" data-chips="fb-category-chips">
        <ul id="fb-category-list" role="listbox">${options}</ul>
        <ul id="fb-category-chips"></ul>
      </div>
      <label><span>Bio (optional)</span><textarea id="fb-bio" maxlength="101"></textarea></label>
      <div role="button" tabindex="0" id="fb-create">Create Page</div>
    </div>`;
}

function pageView(fixture: FacebookFixture): string {
  return `
    <div role="navigation"><input type="search" aria-label="Search Facebook" placeholder="Search Facebook"></div>
    <div role="main">
      <h1>${fixture.pageName ?? "Northline Studio"}</h1>
      <a role="link" href="#">Professional dashboard</a>
      <section aria-label="Contact info">
        <input id="fb-website" type="url" aria-label="Website">
        <input id="fb-phone" type="tel" aria-label="Phone number">
        <input id="fb-email" type="email" aria-label="Email">
      </section>
      <section aria-label="Location">
        <input id="fb-address" placeholder="Address">
        <input id="fb-city" placeholder="City/Town">
        <input id="fb-zip" placeholder="ZIP code">
      </section>
      <fieldset role="radiogroup" aria-label="Hours">
        <label><input type="radio" name="hours" id="fb-hours-none"> No hours available</label>
        <label><input type="radio" name="hours" id="fb-hours-always"> Always open</label>
        <label><input type="radio" name="hours" id="fb-hours-selected"> Open on selected hours</label>
      </fieldset>
      <input id="fb-avatar" type="file" aria-label="Add profile picture">
      <input id="fb-cover" type="file" aria-label="Add cover photo">
      <div role="button" tabindex="0" id="fb-save">Save</div>
    </div>
    <div role="dialog" aria-label="Add action button">
      <div role="radiogroup" aria-label="Choose a button">
        <div role="radio" aria-checked="false" id="fb-cta-book">Book now</div>
        <div role="radio" aria-checked="false" id="fb-cta-contact">Contact us</div>
        <div role="radio" aria-checked="false" id="fb-cta-learn">Learn more</div>
      </div>
      <input id="fb-cta-url" type="url" aria-label="Website">
      <div role="button" tabindex="0" id="fb-cta-save">Save</div>
    </div>
    <div role="dialog" aria-label="Create post">
      <div id="fb-composer" contenteditable="true" role="textbox" aria-label="What's on your mind?" data-lexical-editor="true"><p><br></p></div>
      <div role="button" tabindex="0" id="fb-post">Post</div>
    </div>`;
}

function profileView(): string {
  return `
    <div role="main">
      <h1>Rosa Diaz</h1>
      <div role="button" tabindex="0">Add friend</div>
      <div role="button" tabindex="0">Message</div>
    </div>
    <div role="dialog" aria-label="Create post">
      <div id="fb-composer" contenteditable="true" role="textbox" aria-label="What's on your mind?" data-lexical-editor="true"><p><br></p></div>
      <div role="button" tabindex="0" id="fb-post">Post</div>
    </div>`;
}

/**
 * A stand-in for Lexical: it cancels beforeinput and paste, then re-renders its own paragraphs,
 * the way Lexical owns the DOM under its root. Plain DOM writes are not what it renders from.
 */
export function wireLexical(root: Element): void {
  const doc = root.ownerDocument!;
  const render = (text: string): void => {
    root.innerHTML = "";
    for (const line of text.split("\n")) {
      const p = doc.createElement("p");
      if (line) {
        const span = doc.createElement("span");
        span.setAttribute("data-lexical-text", "true");
        span.textContent = line;
        p.appendChild(span);
      } else {
        p.appendChild(doc.createElement("br"));
      }
      root.appendChild(p);
    }
  };
  root.addEventListener("beforeinput", (event) => {
    const data = (event as InputEvent).data;
    if ((event as InputEvent).inputType !== "insertText" || data == null) return;
    event.preventDefault();
    render(data);
  });
  root.addEventListener("paste", (event) => {
    const data = (event as ClipboardEvent).clipboardData?.getData("text/plain");
    if (data == null) return;
    event.preventDefault();
    render(data);
  });
}

export function wireRoleRadios(doc: Document): void {
  doc.querySelectorAll("[role='radio']").forEach((radio) => {
    radio.addEventListener("click", () => {
      radio.closest("[role='radiogroup']")?.querySelectorAll("[role='radio']").forEach((other) => {
        other.setAttribute("aria-checked", other === radio ? "true" : "false");
      });
    });
  });
}

export function countClicks(doc: Document, ids: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of ids) {
    counts[id] = 0;
    doc.getElementById(id)?.addEventListener("click", () => { counts[id]! += 1; });
  }
  return counts;
}
