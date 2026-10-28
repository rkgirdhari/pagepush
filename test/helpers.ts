import { Window } from "happy-dom";

export function load(html: string): Document {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
}

export function wireTags(doc: Document, inputId: string): void {
  const input = doc.getElementById(inputId) as HTMLInputElement;
  input.addEventListener("keydown", (event) => {
    const key = (event as { key?: string }).key;
    if (key !== "Enter") return;
    const chip = doc.createElement("li");
    chip.setAttribute("data-tag", input.value);
    input.closest("[data-widget]")?.querySelector("[data-tags]")?.appendChild(chip);
    input.value = "";
  });
}

export function wireInvite(doc: Document, inputId: string, buttonId: string): void {
  const input = doc.getElementById(inputId) as HTMLInputElement;
  const list = doc.getElementById("mates")!;
  doc.getElementById(buttonId)!.addEventListener("click", () => {
    const chip = doc.createElement("li");
    chip.setAttribute("data-tag", input.value);
    list.appendChild(chip);
    input.value = "";
  });
}

export function wireTokens(doc: Document): void {
  doc.querySelectorAll("[role='combobox']").forEach((node) => {
    const input = node as HTMLInputElement;
    const listId = input.getAttribute("aria-controls");
    const list = listId ? doc.getElementById(listId) : null;
    if (!list) return;
    list.querySelectorAll("[role='option']").forEach((option) => {
      option.addEventListener("click", () => {
        option.setAttribute("aria-selected", "true");
        const chipsId = input.getAttribute("data-chips");
        const chips = chipsId ? doc.getElementById(chipsId) : null;
        if (chips) {
          const chip = doc.createElement("li");
          chip.setAttribute("data-tag", option.getAttribute("data-slug") ?? "");
          chip.textContent = option.textContent;
          chips.appendChild(chip);
        }
        input.value = "";
      });
    });
  });
}

export function wireGrowth(doc: Document): void {
  doc.getElementById("add-tier")?.addEventListener("click", () => {
    const tier = doc.querySelector("[data-tier]");
    const button = doc.getElementById("add-tier");
    if (!tier || !button?.parentElement) return;
    const copy = tier.cloneNode(true) as Element;
    clearInputs(copy);
    button.parentElement.insertBefore(copy, button);
    doc.querySelectorAll("[data-feature]").forEach((row) => {
      const cell = row.querySelector("[data-value]")?.parentElement;
      if (!cell || !cell.parentElement) return;
      const extra = cell.cloneNode(true) as Element;
      clearInputs(extra);
      cell.parentElement.appendChild(extra);
    });
  });
  cloneBefore(doc, "add-feature", "[data-feature]");
  cloneBefore(doc, "add-story", "[data-story]");
  cloneBefore(doc, "add-faq", "[data-faq]");
}

function cloneBefore(doc: Document, buttonId: string, selector: string): void {
  doc.getElementById(buttonId)?.addEventListener("click", () => {
    const row = doc.querySelector(selector);
    const button = doc.getElementById(buttonId);
    if (!row || !button?.parentElement) return;
    const copy = row.cloneNode(true) as Element;
    clearInputs(copy);
    button.parentElement.insertBefore(copy, button);
  });
}

function clearInputs(root: Element): void {
  root.removeAttribute("id");
  root.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  root.querySelectorAll("input, textarea").forEach((node) => {
    const input = node as HTMLInputElement;
    if (input.type === "checkbox" || input.type === "radio") input.checked = false;
    else input.value = "";
  });
}

export function attachFiles(doc: Document, id: string, names: string[]): void {
  const input = doc.getElementById(id) as HTMLInputElement;
  const view = doc.defaultView!;
  const transfer = new view.DataTransfer();
  for (const name of names) transfer.items.add(new view.File(["x"], name, { type: "image/png" }));
  input.files = transfer.files;
}

export function devpostHtml(options: { captcha?: boolean; password?: boolean; category?: boolean; taglineMax?: number } = {}): string {
  if (options.password) {
    return `<label for="email">Email</label><input id="email"><label for="password">Password</label><input id="password" type="password">`;
  }
  const captcha = options.captcha
    ? `<div class="g-recaptcha" data-sitekey="test"></div><textarea name="g-recaptcha-response"></textarea>`
    : "";
  const category = options.category
    ? `<label for="newness">Is your project new?</label><select id="newness" required><option value="">Choose</option><option>Yes</option><option>No</option></select>`
    : "";
  return `
    <label for="name">Project name</label><input id="name" maxlength="60">
    <label for="tagline">Project tagline</label><input id="tagline" maxlength="${options.taglineMax ?? 140}">
    <label for="story">Project story</label><textarea id="story"></textarea>
    <div data-widget>
      <label for="built">Built with</label>
      <input id="built">
      <ul data-tags></ul>
    </div>
    <label>Try it out <input type="url" id="try-1"></label>
    <label>Try it out <input type="url" id="try-2"></label>
    <label for="video">Video demo link</label><input id="video" type="url">
    <label for="repo">URL to your code repository</label><input id="repo" type="url">
    <label for="thumb">Thumbnail</label><input id="thumb" type="file">
    <label for="gallery">Image gallery</label><input id="gallery" type="file">
    <section aria-label="Team">
      <label for="mate">Teammate email</label>
      <input id="mate" type="email">
      <button type="button" id="invite">Invite</button>
      <ul id="mates"></ul>
    </section>
    <label for="table">Table number</label><input id="table">
    ${category}
    <label><input id="terms" type="checkbox"> Agree to the hackathon terms and conditions</label>
    <button type="button" id="submit-entry">Submit</button>
    ${captcha}
  `;
}

function labeledInput(label: string, id: string, attrs = ""): string {
  return `<label for="${id}">${label}</label><input id="${id}" ${attrs}>`;
}

function labeledArea(label: string, id: string): string {
  return `<label for="${id}">${label}</label><textarea id="${id}"></textarea>`;
}

function tokens(label: string, id: string, options: [string, string][]): string {
  const items = options.map(([slug, text]) => `<li role="option" data-slug="${slug}">${text}</li>`).join("");
  return `<div data-widget><label for="${id}">${label}</label><input id="${id}" role="combobox" aria-controls="${id}-list" data-chips="${id}-chips"><ul id="${id}-list" role="listbox">${items}</ul><ul id="${id}-chips"></ul></div>`;
}

function selectBox(label: string, id: string, options: string[]): string {
  const inner = [`<option value="">Choose</option>`, ...options.map((option) => `<option>${option}</option>`)].join("");
  return `<label for="${id}">${label}</label><select id="${id}">${inner}</select>`;
}

export function appsumoHtml(): string {
  return `
    ${labeledInput("Product name", "product-name")}
    ${tokens("Category", "category", [["project-management", "Project management"], ["marketing", "Marketing"]])}
    ${tokens("Subcategory", "subcategory", [["task-management", "Task management"], ["crm", "CRM"]])}
    ${labeledInput("Tagline", "tagline")}
    ${labeledInput("Unique selling proposition", "usp")}
    ${labeledArea("Intro sentence", "intro")}
    ${labeledArea("TL;DR", "tldr")}
    ${tokens("Alternative to", "alternative", [["asana", "Asana"], ["harvest", "Harvest"], ["mondaycom", "Monday"]])}
    ${tokens("Integrations", "integrations", [["slack", "Slack"], ["stripe", "Stripe"], ["google-calendar", "Google Calendar"]])}
    ${tokens("Best for", "best-for", [["freelancers", "Freelancers"], ["small-agencies", "Small agencies"]])}
    ${labeledInput("Icon", "icon", 'type="file"')}
    ${labeledInput("Logo", "logo", 'type="file"')}
    ${labeledInput("Hero image", "hero", 'type="file"')}
    ${labeledInput("Product screenshots", "shots", 'type="file" multiple')}
    <section id="features" aria-label="Highlighted features">
      <h2>Highlighted features</h2>
      ${labeledInput("Section header", "feature-header")}
      <div data-story><label>Title <input></label><label>Bullets <textarea></textarea></label></div>
      <button type="button" id="add-story">Add story</button>
    </section>
    <section id="pricing" aria-label="Pricing">
      <h2>Pricing</h2>
      <label><input type="radio" name="pricing-model" value="codes" checked> Codes</label>
      <label><input type="radio" name="pricing-model" value="licensing"> Licensing</label>
      <div data-tier>
        <label>Tier name <input></label>
        <label>Price <input></label>
        <label>Original price <input></label>
        <label><input type="checkbox"> Mark as Recommended</label>
      </div>
      <button type="button" id="add-tier">Add tier</button>
      <div data-feature>
        <label>Feature <input></label>
        <label>Tooltip <input></label>
        <label>Value <input data-value></label>
      </div>
      <button type="button" id="add-feature">Add feature</button>
    </section>
    ${labeledInput("Headline", "headline")}
    ${labeledArea("Founder narrative", "narrative")}
    ${labeledInput("Founder name", "founder-name")}
    ${labeledInput("Role", "role")}
    ${labeledInput("LinkedIn URL", "founder-linkedin", 'type="url"')}
    ${labeledInput("Founded", "founded")}
    ${tokens("Headquarters", "hq", [["austin-tx", "Austin, TX"], ["remote", "Remote"]])}
    ${selectBox("Team size", "team-size", ["1-10", "11-50", "51-200", "201-500", "501+"])}
    ${selectBox("Stage", "stage", ["Startup", "Growth", "Expansion", "Established"])}
    ${selectBox("Funding", "funding", ["Bootstrapped", "Pre-Seed", "Seed", "Series A", "Series B", "Series C+", "Public Company", "Acquired"])}
    <section id="faq" aria-label="FAQ">
      <h2>FAQ</h2>
      <div data-faq><label>Question <input></label><label>Answer <textarea></textarea></label></div>
      <button type="button" id="add-faq">Add FAQ</button>
    </section>
    ${labeledInput("Support email", "support", 'type="email"')}
    ${labeledArea("Redemption instructions", "steps")}
    ${labeledInput("Redemption URL", "redeem", 'type="url"')}
    ${labeledInput("Webhook URL", "webhook", 'type="url"')}
    ${labeledInput("Redirect URL", "redirect", 'type="url"')}
    ${labeledInput("Private key", "private-key")}
    ${labeledInput("LinkedIn company page", "company-linkedin")}
    ${labeledInput("G2 URL", "g2", 'type="url"')}
    <label for="website">Company website</label><input id="website" value="https://northline.example" disabled>
    <button type="button" id="submit-review">Submit for review</button>
  `;
}

export function readyAppSumo(): Document {
  const doc = load(appsumoHtml());
  wireTokens(doc);
  wireGrowth(doc);
  return doc;
}
