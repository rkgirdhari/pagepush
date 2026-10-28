// MV3 background service worker. Owns everything that must run without a UI open:
// context menu registration, Facebook API calls, token refresh checks, and scheduled
// post execution. The side panel/popup/content scripts talk to it via chrome.runtime
// messages rather than importing facebook-api.js directly, since only the worker has
// the host permission grant and a stable lifecycle for alarms.

import { connectFacebookPages, disconnectPage, getExpiringPages, getPageToken } from "./auth.js";
import { createPagePost, createPagePhoto, FacebookApiError } from "./facebook-api.js";
import { schedulePost, cancelScheduledPost, listScheduledPosts, handleAlarm } from "./scheduler.js";
import { appendHistory, loadConnectedPages, savePendingCapture, loadHistory } from "../lib/storage.js";
import { formatForFacebook } from "../lib/formatter.js";
import { checkPostingCadence } from "../lib/timing.js";

const CONTEXT_MENU_ID = "page-push-send-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Push to Page \u2192 "%s"',
    contexts: ["selection"],
  });
});

// Spec section 4, step 2: "Clicks Page Push icon \u2192 extension opens side panel."
// No separate popup is used; the toolbar icon opens the panel directly.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText) return;
  const formatted = formatForFacebook(info.selectionText);
  await savePendingCapture({ text: formatted.text, sourceUrl: tab?.url, capturedAt: Date.now() });
  if (chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Daily check so an expiring/expired Page token surfaces as a browser-action badge
// instead of silently failing the next time the user tries to post.
chrome.alarms.create("pp_token_health_check", { periodInMinutes: 60 * 12 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "pp_token_health_check") {
    const expiring = await getExpiringPages();
    chrome.action.setBadgeText({ text: expiring.length > 0 ? String(expiring.length) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#E0245E" });
    return;
  }
  await handleAlarm(alarm);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => {
      console.error("Page Push background error:", err);
      sendResponse({
        ok: false,
        error: err instanceof FacebookApiError
          ? { message: err.message, suggestion: err.suggestion, code: err.code }
          : { message: err.message },
      });
    });
  return true; // keep the message channel open for the async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "CONNECT_PAGES":
      return connectFacebookPages();

    case "DISCONNECT_PAGE":
      return disconnectPage(message.pageId);

    case "LIST_PAGES":
      return loadConnectedPages();

    case "GET_CADENCE_WARNINGS": {
      const history = await loadHistory();
      const pageHistory = history.filter((h) => h.pageId === message.pageId);
      return checkPostingCadence(pageHistory);
    }

    case "PUBLISH_POST":
      return publishPost(message.payload);

    case "SCHEDULE_POST":
      return schedulePost(message.payload, message.whenEpochMs);

    case "CANCEL_SCHEDULED_POST":
      return cancelScheduledPost(message.id);

    case "LIST_SCHEDULED_POSTS":
      return listScheduledPosts();

    case "CAPTURE_FROM_PAGE": {
      // Sent by the content script's inject-button.js when the user clicks
      // "Push to Page" inline on a ChatGPT/Claude/Notion/Canva page.
      const formatted = formatForFacebook(message.rawText);
      await savePendingCapture({
        text: formatted.text,
        image: message.image || null,
        sourceUrl: sender.tab?.url,
        capturedAt: Date.now(),
      });
      if (chrome.sidePanel?.open && sender.tab?.id) {
        await chrome.sidePanel.open({ tabId: sender.tab.id });
      }
      return { captured: true };
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

/**
 * Direct publish / draft mode (spec Phase 1). `published: false` routes to Business
 * Suite drafts instead of going live, matching the "Draft mode" requirement.
 */
async function publishPost({ pageId, text, link, image, published = true }) {
  const token = await getPageToken(pageId);
  if (!token) {
    throw new Error("This Page isn't connected. Reconnect it from the extension options.");
  }

  let result;
  try {
    if (image) {
      result = await createPagePhoto(pageId, token.accessToken, {
        base64: image.dataUrl,
        url: image.url,
        altText: image.altText,
        caption: text,
        published,
      });
    } else {
      result = await createPagePost(pageId, token.accessToken, { message: text, link, published });
    }
  } catch (err) {
    await appendHistory({
      pageId,
      text,
      status: "failed",
      error: err instanceof FacebookApiError ? err.message : String(err),
      via: "manual",
    });
    throw err;
  }

  await appendHistory({
    pageId,
    text,
    status: published ? "published" : "draft",
    graphId: result.id || result.post_id,
    via: "manual",
  });

  return result;
}
