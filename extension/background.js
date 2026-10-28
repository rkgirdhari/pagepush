// Page Push — background service worker
// Opens the side panel on toolbar click and proxies requests to the optional
// local Axum/Candle daemon at 127.0.0.1:8080 (fetch() cannot be called
// directly from the side panel under Manifest V3's CSP for cross-origin
// http:// loopback requests reliably, so we centralize it here).

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("[Page Push] sidePanel behavior error:", err));

const DEFAULT_DAEMON_ENDPOINT = "http://127.0.0.1:8080/api/v1/health";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PAGEPUSH_DAEMON_REQUEST") return undefined;

  const endpoint = message.endpoint || DEFAULT_DAEMON_ENDPOINT;
  const options = {
    method: message.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-PagePush-Client": "Page-Push-Extension/1.0.0"
    }
  };
  if (message.body) {
    options.body = JSON.stringify(message.body);
  }

  fetch(endpoint, options)
    .then(async (res) => {
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      sendResponse({ ok: res.ok, status: res.status, data });
    })
    .catch((err) => {
      sendResponse({
        ok: false,
        status: 0,
        error: `Local daemon unreachable (${err.message}). Using built-in offline templates.`
      });
    });

  return true; // keep the message channel open for the async fetch above
});
