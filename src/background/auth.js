// Facebook OAuth flow (spec section 3: "The Authentication Flow").
// Uses chrome.identity.launchWebAuthFlow so the redirect stays entirely client-side \u2014
// no token-exchange backend required for MVP, matching the "local storage, no backend
// cost" decision point.
//
// NOTE: FACEBOOK_APP_ID must be filled in once a Facebook App is created in
// developers.facebook.com. Until App Review passes, the app runs in Development Mode
// and only admins/testers added to the app can complete this flow.

import { FACEBOOK_OAUTH_DIALOG, FACEBOOK_SCOPES } from "../lib/constants.js";
import { listManagedPages } from "./facebook-api.js";
import { saveTokens, loadTokens, saveConnectedPages, loadConnectedPages } from "../lib/storage.js";

const FACEBOOK_APP_ID = "__YOUR_FACEBOOK_APP_ID__";

function getRedirectUrl() {
  return chrome.identity.getRedirectURL("facebook");
}

function launchWebAuthFlow(url) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        reject(new Error(chrome.runtime.lastError?.message || "OAuth flow was cancelled."));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

function parseTokenFromRedirect(redirectUrl) {
  const hash = redirectUrl.split("#")[1] || "";
  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const expiresIn = Number(params.get("expires_in") || 0);
  if (!accessToken) {
    const queryParams = new URLSearchParams(redirectUrl.split("?")[1] || "");
    throw new Error(queryParams.get("error_description") || "Facebook did not return an access token.");
  }
  return { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
}

/**
 * Step 1-3 of the spec's auth flow: launch OAuth, let the user pick a Page in the
 * native Facebook dialog's permission screen, then fetch every Page they admin and
 * store each Page's own access token (encrypted) rather than only the user token.
 */
export async function connectFacebookPages() {
  const redirectUri = getRedirectUrl();
  const authUrl = new URL(FACEBOOK_OAUTH_DIALOG);
  authUrl.searchParams.set("client_id", FACEBOOK_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("scope", FACEBOOK_SCOPES.join(","));

  const redirectUrl = await launchWebAuthFlow(authUrl.toString());
  const { accessToken: userAccessToken, expiresAt } = parseTokenFromRedirect(redirectUrl);

  const pages = await listManagedPages(userAccessToken);
  if (pages.length === 0) {
    throw new Error("No Facebook Pages found for this account. You must be an admin of at least one Page.");
  }

  const tokens = await loadTokens();
  for (const page of pages) {
    tokens[page.id] = {
      accessToken: page.access_token,
      // Page tokens derived from a long-lived user token are themselves long-lived
      // (~60 days); we still track expiry so the UI can prompt a reconnect in time.
      expiresAt,
      pageName: page.name,
    };
  }
  await saveTokens(tokens);

  const existing = await loadConnectedPages();
  const merged = mergePages(existing, pages);
  await saveConnectedPages(merged);

  return merged;
}

function mergePages(existing, incoming) {
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const page of incoming) {
    byId.set(page.id, {
      id: page.id,
      name: page.name,
      category: page.category,
      picture: page.picture?.data?.url,
    });
  }
  return Array.from(byId.values());
}

/** Spec: "Token refresh handled silently". Checks expiry and flags Pages needing reconnect. */
export async function getExpiringPages(withinDays = 7) {
  const tokens = await loadTokens();
  const pages = await loadConnectedPages();
  const threshold = Date.now() + withinDays * 24 * 60 * 60 * 1000;
  return pages.filter((p) => {
    const t = tokens[p.id];
    return !t || !t.expiresAt || t.expiresAt < threshold;
  });
}

export async function disconnectPage(pageId) {
  const tokens = await loadTokens();
  delete tokens[pageId];
  await saveTokens(tokens);
  const pages = await loadConnectedPages();
  await saveConnectedPages(pages.filter((p) => p.id !== pageId));
}

export async function getPageToken(pageId) {
  const tokens = await loadTokens();
  return tokens[pageId] || null;
}
