// Phase 2 scheduling: a "calendar picker for delayed publication" needs something to
// actually fire the publish at the chosen time. chrome.alarms persists across service
// worker restarts/suspends, which setTimeout would not.

import { getPageToken } from "./auth.js";
import { createPagePost, createPagePhoto, FacebookApiError } from "./facebook-api.js";
import { appendHistory } from "../lib/storage.js";

const ALARM_PREFIX = "pp_scheduled_post_";

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}
function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

/** Queue a post to publish at a future time. Returns the schedule id. */
export async function schedulePost(post, whenEpochMs) {
  const id = crypto.randomUUID();
  const alarmName = `${ALARM_PREFIX}${id}`;
  await storageSet({ [alarmName]: { ...post, id, scheduledFor: whenEpochMs } });
  chrome.alarms.create(alarmName, { when: whenEpochMs });
  return id;
}

export async function cancelScheduledPost(id) {
  const alarmName = `${ALARM_PREFIX}${id}`;
  chrome.alarms.clear(alarmName);
  await storageRemove(alarmName);
}

export async function listScheduledPosts() {
  const all = await storageGet(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ALARM_PREFIX))
    .map(([, value]) => value)
    .sort((a, b) => a.scheduledFor - b.scheduledFor);
}

/** Wire this up in the service worker's chrome.alarms.onAlarm listener. */
export async function handleAlarm(alarm) {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const stored = await storageGet(alarm.name);
  const post = stored[alarm.name];
  if (!post) return;

  try {
    const token = await getPageToken(post.pageId);
    if (!token) throw new Error("Page is no longer connected.");

    let result;
    if (post.image) {
      result = await createPagePhoto(post.pageId, token.accessToken, {
        base64: post.image.dataUrl,
        url: post.image.url,
        altText: post.image.altText,
        caption: post.text,
        published: true,
      });
    } else {
      result = await createPagePost(post.pageId, token.accessToken, {
        message: post.text,
        link: post.link,
        published: true,
      });
    }

    await appendHistory({
      pageId: post.pageId,
      text: post.text,
      status: "published",
      graphId: result.id || result.post_id,
      via: "scheduled",
    });
  } catch (err) {
    const message = err instanceof FacebookApiError ? `${err.message} ${err.suggestion}` : err.message;
    await appendHistory({ pageId: post.pageId, text: post.text, status: "failed", error: message, via: "scheduled" });
  } finally {
    await storageRemove(alarm.name);
  }
}
