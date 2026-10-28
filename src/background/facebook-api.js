// Thin client around the Facebook Graph API endpoints used by Page Push
// (spec section 3: /page/posts and /page/photos). Every function here takes an
// explicit access token rather than reaching into storage, so it stays testable
// and side-effect free.

import { FACEBOOK_GRAPH_BASE } from "../lib/constants.js";

export class FacebookApiError extends Error {
  constructor(message, { code, type, fbtraceId, status } = {}) {
    super(message);
    this.name = "FacebookApiError";
    this.code = code;
    this.type = type;
    this.fbtraceId = fbtraceId;
    this.status = status;
  }

  /** A short, user-facing suggestion based on the Graph API error code/type. */
  get suggestion() {
    switch (this.code) {
      case 190:
        return "Your Page connection expired. Reconnect this Page from the extension options.";
      case 200:
      case 10:
        return "Missing permission for this action. Reconnect the Page and grant all requested permissions.";
      case 368:
        return "Facebook flagged this as a possible policy violation. Review Community Standards and edit the post.";
      case 100:
        return "Facebook rejected the request parameters (e.g. bad image URL or malformed field). Check the post content.";
      case 4:
      case 17:
        return "You've hit a Facebook API rate limit. Wait a bit and try again.";
      case 506:
        return "Facebook flagged this as a likely duplicate post. Edit the text slightly and retry.";
      default:
        return "Check your connection and try again. If this keeps happening, reconnect the Page.";
    }
  }
}

async function graphFetch(path, { method = "GET", params = {}, accessToken } = {}) {
  const url = new URL(`${FACEBOOK_GRAPH_BASE}${path}`);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    body.set(key, String(value));
  }
  body.set("access_token", accessToken);

  let response;
  if (method === "GET") {
    for (const [key, value] of body.entries()) url.searchParams.set(key, value);
    response = await fetch(url.toString(), { method: "GET" });
  } else {
    response = await fetch(url.toString(), {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) {
    const err = json.error || {};
    throw new FacebookApiError(err.message || `Facebook API request failed (${response.status})`, {
      code: err.code,
      type: err.type,
      fbtraceId: err.fbtrace_id,
      status: response.status,
    });
  }
  return json;
}

/** List Pages the authenticated user manages (used for Multi-Page support / the connect flow). */
export async function listManagedPages(userAccessToken) {
  const json = await graphFetch("/me/accounts", {
    method: "GET",
    params: { fields: "id,name,access_token,picture,category" },
    accessToken: userAccessToken,
  });
  return json.data || [];
}

/**
 * Publish or draft a text post to a Page.
 * scheduledPublishTime: unix seconds in the future for Phase 2 scheduling; when provided
 * Facebook holds the post unpublished until that time.
 * published=false is used both for "Save draft" and as a requirement of scheduling.
 */
export async function createPagePost(pageId, pageAccessToken, { message, link, published = true, scheduledPublishTime } = {}) {
  const params = { message };
  if (link) params.link = link;
  if (!published) params.published = false;
  if (scheduledPublishTime) {
    params.published = false;
    params.scheduled_publish_time = scheduledPublishTime;
  }
  return graphFetch(`/${pageId}/feed`, { method: "POST", params, accessToken: pageAccessToken });
}

/** Upload a photo to the Page, optionally attaching it unpublished to a later post (Phase 2). */
export async function createPagePhoto(pageId, pageAccessToken, { url, base64, altText, caption, published = true, scheduledPublishTime } = {}) {
  const params = { caption, published: published && !scheduledPublishTime };
  if (altText) params.alt_text_custom = altText;
  if (url) params.url = url;
  if (scheduledPublishTime) {
    params.published = false;
    params.scheduled_publish_time = scheduledPublishTime;
  }
  if (base64 && !url) {
    // Graph API photo uploads from raw bytes require multipart/form-data; base64 data URLs
    // are passed through a FormData Blob here instead of urlencoded params.
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) form.set(key, String(value));
    }
    const blob = await (await fetch(base64)).blob();
    form.set("source", blob, "upload.jpg");
    form.set("access_token", pageAccessToken);
    const response = await fetch(`${FACEBOOK_GRAPH_BASE}/${pageId}/photos`, { method: "POST", body: form });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.error) {
      const err = json.error || {};
      throw new FacebookApiError(err.message || `Facebook photo upload failed (${response.status})`, {
        code: err.code,
        type: err.type,
        fbtraceId: err.fbtrace_id,
        status: response.status,
      });
    }
    return json;
  }
  return graphFetch(`/${pageId}/photos`, { method: "POST", params, accessToken: pageAccessToken });
}

/** Debug-token endpoint to check expiry and surface "reconnect" prompts before a post fails. */
export async function inspectToken(inputToken, appAccessToken) {
  return graphFetch("/debug_token", {
    method: "GET",
    params: { input_token: inputToken },
    accessToken: appAccessToken || inputToken,
  });
}

/** Exchange a short-lived user token for a long-lived one (~60 days) per spec's refresh requirement. */
export async function exchangeForLongLivedToken(shortLivedToken, appId, appSecret) {
  return graphFetch("/oauth/access_token", {
    method: "GET",
    params: {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    },
    accessToken: shortLivedToken,
  });
}

/** Phase 3 analytics snapshot: basic reach/engagement for a Page's recent posts. */
export async function getPageInsights(pageId, pageAccessToken, metrics = ["page_impressions", "page_engaged_users"]) {
  return graphFetch(`/${pageId}/insights`, {
    method: "GET",
    params: { metric: metrics.join(","), period: "day" },
    accessToken: pageAccessToken,
  });
}
