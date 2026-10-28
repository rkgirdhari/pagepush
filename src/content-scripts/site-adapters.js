// Per-site selectors for "detects text/images from the active tab" (spec Phase 1).
// Each adapter just needs to answer: where do AI responses live, and how do we grab
// the latest one? Selectors are necessarily brittle against upstream DOM changes;
// keep them isolated here so a site redesign only requires editing one object.
//
// Exposed as `window.__pagePushAdapters` (content scripts share a page-local global,
// not ES modules, since manifest.json loads them as classic scripts for broad
// compatibility with injected-page timing).

(function registerAdapters() {
  const adapters = [
    {
      name: "chatgpt",
      hostTest: (host) => host.includes("chatgpt.com") || host.includes("chat.openai.com"),
      getLatestResponseNode: () => {
        const turns = document.querySelectorAll('[data-message-author-role="assistant"]');
        return turns.length ? turns[turns.length - 1] : null;
      },
      anchorForButton: (node) => node,
    },
    {
      name: "claude",
      hostTest: (host) => host.includes("claude.ai"),
      getLatestResponseNode: () => {
        const turns = document.querySelectorAll('[data-testid="chat-message"], .font-claude-message');
        return turns.length ? turns[turns.length - 1] : null;
      },
      anchorForButton: (node) => node,
    },
    {
      name: "notion",
      hostTest: (host) => host.includes("notion.so"),
      getLatestResponseNode: () => document.querySelector(".notion-page-content"),
      anchorForButton: (node) => node,
    },
    {
      name: "canva",
      hostTest: (host) => host.includes("canva.com"),
      // Canva is primarily an image surface; text capture is best-effort only.
      getLatestResponseNode: () => document.querySelector('[data-testid="design-page"], main'),
      anchorForButton: (node) => node,
      imageOnly: true,
    },
    {
      name: "gemini",
      hostTest: (host) => host.includes("gemini.google.com"),
      getLatestResponseNode: () => {
        const turns = document.querySelectorAll("model-response, .model-response-text");
        return turns.length ? turns[turns.length - 1] : null;
      },
      anchorForButton: (node) => node,
    },
  ];

  function getActiveAdapter() {
    const host = window.location.host;
    return adapters.find((a) => a.hostTest(host)) || null;
  }

  function extractTextFromNode(node) {
    if (!node) return "";
    // Clone so we can strip UI chrome (buttons, icons) without touching the live DOM.
    const clone = node.cloneNode(true);
    clone.querySelectorAll("button, svg, [role='toolbar'], .copy-button").forEach((el) => el.remove());
    return clone.innerText || clone.textContent || "";
  }

  function extractImagesFromNode(node) {
    if (!node) return [];
    return Array.from(node.querySelectorAll("img"))
      .filter((img) => img.naturalWidth > 64 && img.naturalHeight > 64)
      .map((img) => img.src);
  }

  window.__pagePushAdapters = { getActiveAdapter, extractTextFromNode, extractImagesFromNode };
})();
