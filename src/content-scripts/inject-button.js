// Injects an inline "Push to Page" button next to the latest AI response (spec
// section 7: "Content script: Runs on AI chat sites to add 'Push to Page' buttons
// inline") and wires up the right-click "Push to Page" path via text selection.

(function init() {
  const POLL_INTERVAL_MS = 1500;
  const BUTTON_CLASS = "page-push-inline-button";

  function getAdapter() {
    return window.__pagePushAdapters ? window.__pagePushAdapters.getActiveAdapter() : null;
  }

  function buildButton(node, adapter) {
    if (node.querySelector(`.${BUTTON_CLASS}`)) return; // already injected for this node

    const button = document.createElement("button");
    button.className = BUTTON_CLASS;
    button.type = "button";
    button.textContent = "\ud83d\udcf2 Push to Page";
    button.title = "Send this to your Facebook Page with Page Push";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      capture(node, adapter);
    });

    const wrapper = document.createElement("div");
    wrapper.className = "page-push-button-wrapper";
    wrapper.appendChild(button);
    const anchor = adapter.anchorForButton(node) || node;
    anchor.style.position = anchor.style.position || "relative";
    anchor.appendChild(wrapper);
  }

  function capture(node, adapter) {
    const text = window.__pagePushAdapters.extractTextFromNode(node);
    const images = adapter.imageOnly ? window.__pagePushAdapters.extractImagesFromNode(node) : [];
    chrome.runtime.sendMessage({
      type: "CAPTURE_FROM_PAGE",
      rawText: text,
      image: images[0] ? { url: images[0] } : null,
    });
  }

  function tick() {
    const adapter = getAdapter();
    if (!adapter) return;
    const node = adapter.getLatestResponseNode();
    if (node) buildButton(node, adapter);
  }

  setInterval(tick, POLL_INTERVAL_MS);
  tick();

  // Support "highlight -> right-click -> Push to Page" (handled by the background
  // context menu); nothing to do here besides existing, since chrome.contextMenus
  // reads selectionText directly. This listener lets the background push a toast
  // back for quick visual confirmation when a capture completes from this tab.
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "CAPTURE_CONFIRMED") {
      showToast("Sent to Page Push \u2014 open the side panel to review.");
    }
  });

  function showToast(text) {
    const toast = document.createElement("div");
    toast.className = "page-push-toast";
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
})();
