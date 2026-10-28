// Page Push — Facebook DOM bridge (content script)
//
// Facebook's frontend mixes Meta's Lexical rich-text framework, controlled
// React inputs, and heavily obfuscated atomic CSS class names. This script
// distills the live page into a small, stable, semantic map (keyed by
// aria-label / role / placeholder / visible text) and exposes a tiny set of
// gated operations the side panel can trigger one click at a time. Nothing
// here runs autonomously — every action is a direct result of a button you
// press in the side panel.

(() => {
  const ATTR_ID = "data-pagepush-id";
  let nodeRegistry = new Map();

  const style = document.createElement("style");
  style.textContent = `
    [${ATTR_ID}].pagepush-highlight {
      outline: 2px solid #f59e0b !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.45) !important;
      transition: outline 0.15s ease-in-out;
    }
  `;
  document.documentElement.appendChild(style);

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const computed = window.getComputedStyle(el);
    return (
      rect.width > 4 &&
      rect.height > 4 &&
      computed.visibility !== "hidden" &&
      computed.display !== "none" &&
      parseFloat(computed.opacity || "1") > 0.05
    );
  }

  function distillFacebookDom() {
    nodeRegistry.clear();
    document.querySelectorAll(`[${ATTR_ID}]`).forEach((el) => {
      el.removeAttribute(ATTR_ID);
      el.classList.remove("pagepush-highlight");
    });

    const selectors = [
      'div[contenteditable="true"][role="textbox"]',
      'input:not([type="hidden"])',
      "textarea",
      '[role="button"]',
      "button",
      'a[role="link"]'
    ];

    const candidates = document.querySelectorAll(selectors.join(","));
    const distilled = [];
    let nextId = 1;

    for (const el of candidates) {
      const isFileInput = el.tagName === "INPUT" && el.type === "file";
      if (!isFileInput && !isVisible(el)) continue;

      const ariaLabel = (el.getAttribute("aria-label") || "").trim();
      const placeholder = (el.getAttribute("placeholder") || "").trim();
      const role = (el.getAttribute("role") || el.tagName.toLowerCase()).trim();
      const text = (el.innerText || el.value || "").trim().slice(0, 80);

      if (!ariaLabel && !placeholder && !text && !isFileInput) continue;

      const id = nextId++;
      el.setAttribute(ATTR_ID, String(id));
      nodeRegistry.set(id, el);

      const kind =
        el.getAttribute("contenteditable") === "true"
          ? "lexical_editor"
          : isFileInput
          ? "file_input"
          : el.tagName === "INPUT" || el.tagName === "TEXTAREA"
          ? "react_input"
          : "button";

      distilled.push({
        id,
        kind,
        role,
        aria_label: ariaLabel,
        placeholder,
        text: text.replace(/\s+/g, " ")
      });

      if (distilled.length >= 60) break;
    }

    return distilled;
  }

  // Facebook's "What's on your mind?" / Bio editors are Lexical, backed by a
  // contenteditable div. Setting innerText/textContent directly desyncs
  // Lexical's internal editor state, so we route through the input pipeline
  // instead: select-all, then execCommand('insertText'), with a synthetic
  // ClipboardEvent('paste') fallback for editors that reject execCommand.
  function injectLexicalText(el, text) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand("insertText", false, text);

    if (!inserted) {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", text);
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      el.dispatchEvent(pasteEvent);
    }

    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
    );
    return true;
  }

  // Facebook's React-controlled <input>/<textarea> fields ignore a plain
  // `el.value = ...` assignment because React's change detection compares
  // against its own tracked value, not the DOM. Calling the native property
  // setter bypasses React's instrumented setter so the subsequent `input`
  // event is picked up as a real change.
  function injectReactInput(el, value) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();

    const proto =
      el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    return true;
  }

  function injectFileInput(el, base64DataUrl, filename = "pagepush_asset.png") {
    const [header, data] = base64DataUrl.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/png";
    const binary = atob(data);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);

    const file = new File([array], filename, { type: mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function executeAction(action) {
    const el = nodeRegistry.get(Number(action.target_id));
    if (!el) {
      return { ok: false, error: `Element [${action.target_id}] not found. Re-scan the page.` };
    }

    el.classList.add("pagepush-highlight");

    switch (action.op) {
      case "highlight":
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return { ok: true, detail: `Highlighted [${action.target_id}]` };
      case "click":
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.click();
        return { ok: true, detail: `Clicked [${action.target_id}]` };
      case "type_lexical":
        injectLexicalText(el, action.value || "");
        return { ok: true, detail: `Filled Lexical editor [${action.target_id}]` };
      case "type_react":
        injectReactInput(el, action.value || "");
        return { ok: true, detail: `Filled input [${action.target_id}]` };
      case "upload_file":
        injectFileInput(el, action.value, action.filename || "pagepush_asset.png");
        return { ok: true, detail: `Attached file to [${action.target_id}]` };
      default:
        return { ok: false, error: `Unknown op: ${action.op}` };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "PAGEPUSH_DISTILL_DOM") {
      const nodes = distillFacebookDom();
      sendResponse({ ok: true, url: window.location.href, title: document.title, nodes });
      return true;
    }
    if (msg?.type === "PAGEPUSH_EXECUTE_ACTION") {
      sendResponse(executeAction(msg.action));
      return true;
    }
    return undefined;
  });
})();
