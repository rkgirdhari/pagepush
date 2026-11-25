// Page Push: sanitized DOM skeleton capture for Facebook research fixtures.
//
// Paste into DevTools on a logged-in Facebook view you manage (or run through a browser tool).
// It never reads cookies, storage, scripts, hidden inputs' values, or network data. It walks the
// visible DOM, keeps only the attributes the shim binds on (role, aria-*, placeholder, maxlength,
// type, contenteditable, data-lexical-editor), and redacts before returning:
//   - the Page name you pass in (replaced by the fixture name "Northline Canoe Co.")
//   - emails, URLs, phone-like and other long digit runs, and Facebook ids
//   - element ids, classes, hrefs, srcs, and every value/text of a form control
// Review the output yourself before committing it.
(function capture(pageName, fixtureName = "Northline Canoe Co.") {
  const KEEP_ATTRS = ["role", "aria-label", "aria-checked", "aria-selected", "aria-expanded", "aria-haspopup", "aria-modal",
    "aria-multiline", "aria-autocomplete", "aria-required", "aria-disabled", "placeholder", "maxlength", "type",
    "contenteditable", "data-lexical-editor", "accept", "multiple"];
  const INTERACTIVE = "input,textarea,select,button,a[role],[role],[contenteditable='true'],h1,h2,h3,label,[aria-label]";
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = (pageName || "").replace(/,?\s*LLC\.?$/i, "").trim();
  const nameRe = base ? new RegExp(`${esc(base)}(?:,?\\s*LLC\\.?)?`, "gi") : null;
  function redact(text) {
    if (!text) return text;
    let t = String(text).replace(/\s+/g, " ").trim();
    if (nameRe) t = t.replace(nameRe, fixtureName);
    t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "user@example.com");
    t = t.replace(/https?:\/\/\S+/g, "https://example.com/");
    t = t.replace(/\b(?:www\.)?[\w-]+\.(?:com|net|org|io|co)\b\S*/gi, "example.com");
    t = t.replace(/\+?\d[\d ().-]{6,}\d/g, "+1 555 0100");
    t = t.replace(/\d{5,}/g, "00000");
    return t.slice(0, 160);
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && (r.width > 0 || r.height > 0 || el.tagName === "INPUT");
  }
  function ownText(el) {
    if (el.matches("input,textarea,select,[contenteditable='true']")) return ""; // never control contents
    return redact((el.innerText || "").split("\n").filter(Boolean).slice(0, 2).join(" / "));
  }
  function labelledBy(el) {
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    return redact(ids.map((id) => document.getElementById(id)?.innerText || "").join(" "));
  }
  function context(el) {
    const dialog = el.closest("[role='dialog']");
    const head = dialog?.querySelector("h1,h2,h3,[role='heading']");
    return head ? redact(head.innerText) : null;
  }
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!visible(el)) continue;
    if (el.matches("input[type='hidden']")) {
      // Captcha response fields matter for gating; record only their name, never the value.
      const n = el.getAttribute("name") || "";
      if (/captcha|turnstile/i.test(n)) out.push({ tag: "input", type: "hidden", name: n });
      continue;
    }
    const node = { tag: el.tagName.toLowerCase() };
    for (const a of KEEP_ATTRS) {
      const v = el.getAttribute(a);
      if (v != null) node[a] = a.startsWith("aria-label") || a === "placeholder" ? redact(v) : v;
    }
    const lb = labelledBy(el);
    if (lb) node.labelledBy = lb;
    const text = ownText(el);
    if (text) node.text = text;
    const dlg = context(el);
    if (dlg) node.dialog = dlg;
    if (el.matches("input[type='file']")) node.hasFiles = (el.files?.length ?? 0) > 0;
    const key = JSON.stringify(node);
    if (seen.has(key) || Object.keys(node).length === 1) continue;
    seen.add(key);
    out.push(node);
  }
  const path = location.pathname.replace(/\d{5,}/g, "00000");
  const query = [...new URLSearchParams(location.search).keys()].filter((k) => k !== "id").map((k) => `${k}=${redact(new URLSearchParams(location.search).get(k))}`);
  return { capturedAt: new Date().toISOString().slice(0, 10), path, query, title: redact(document.title), count: out.length, nodes: out };
})
