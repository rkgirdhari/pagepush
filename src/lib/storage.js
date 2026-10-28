// Thin wrapper around chrome.storage.local. Tokens are encrypted at rest (AES-256-GCM);
// everything else (templates, history, settings) is stored as plain JSON since it never
// contains Facebook credentials. See decision point in spec section 3: MVP keeps tokens
// local-only (privacy-first, no backend cost) with background refresh in service-worker.js.

import { STORAGE_KEYS } from "./constants.js";
import { generateKey, exportKey, importKey, encryptString, decryptString } from "./crypto.js";

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

async function getOrCreateCryptoKey() {
  const stored = await storageGet(STORAGE_KEYS.CRYPTO_KEY);
  if (stored[STORAGE_KEYS.CRYPTO_KEY]) {
    return importKey(stored[STORAGE_KEYS.CRYPTO_KEY]);
  }
  const key = await generateKey();
  const exported = await exportKey(key);
  await storageSet({ [STORAGE_KEYS.CRYPTO_KEY]: exported });
  return key;
}

/** Persist the { pageId: { accessToken, expiresAt, pageName, ... } } map, encrypted. */
export async function saveTokens(tokenMap) {
  const key = await getOrCreateCryptoKey();
  const payload = await encryptString(key, JSON.stringify(tokenMap));
  await storageSet({ [STORAGE_KEYS.ENCRYPTED_TOKENS]: payload });
}

export async function loadTokens() {
  const stored = await storageGet(STORAGE_KEYS.ENCRYPTED_TOKENS);
  const payload = stored[STORAGE_KEYS.ENCRYPTED_TOKENS];
  if (!payload) return {};
  try {
    const key = await getOrCreateCryptoKey();
    const plaintext = await decryptString(key, payload);
    return JSON.parse(plaintext);
  } catch (err) {
    console.error("Page Push: failed to decrypt stored tokens", err);
    return {};
  }
}

export async function clearTokens() {
  await storageRemove(STORAGE_KEYS.ENCRYPTED_TOKENS);
}

export async function saveConnectedPages(pages) {
  await storageSet({ [STORAGE_KEYS.CONNECTED_PAGES]: pages });
}

export async function loadConnectedPages() {
  const stored = await storageGet(STORAGE_KEYS.CONNECTED_PAGES);
  return stored[STORAGE_KEYS.CONNECTED_PAGES] || [];
}

export async function setActivePageId(pageId) {
  await storageSet({ [STORAGE_KEYS.ACTIVE_PAGE_ID]: pageId });
}

export async function getActivePageId() {
  const stored = await storageGet(STORAGE_KEYS.ACTIVE_PAGE_ID);
  return stored[STORAGE_KEYS.ACTIVE_PAGE_ID] || null;
}

export async function saveTemplates(templates) {
  await storageSet({ [STORAGE_KEYS.TEMPLATES]: templates });
}

export async function loadTemplates() {
  const stored = await storageGet(STORAGE_KEYS.TEMPLATES);
  return stored[STORAGE_KEYS.TEMPLATES] || [];
}

export async function appendHistory(entry) {
  const stored = await storageGet(STORAGE_KEYS.HISTORY);
  const history = stored[STORAGE_KEYS.HISTORY] || [];
  history.unshift({ ...entry, id: entry.id || crypto.randomUUID(), at: entry.at || Date.now() });
  // Cap history length so storage.local stays well under its quota.
  const trimmed = history.slice(0, 500);
  await storageSet({ [STORAGE_KEYS.HISTORY]: trimmed });
  return trimmed;
}

export async function loadHistory() {
  const stored = await storageGet(STORAGE_KEYS.HISTORY);
  return stored[STORAGE_KEYS.HISTORY] || [];
}

export async function loadSettings(defaults) {
  const stored = await storageGet(STORAGE_KEYS.SETTINGS);
  return { ...defaults, ...(stored[STORAGE_KEYS.SETTINGS] || {}) };
}

export async function saveSettings(settings) {
  await storageSet({ [STORAGE_KEYS.SETTINGS]: settings });
}

export async function savePendingCapture(capture) {
  await storageSet({ [STORAGE_KEYS.PENDING_CAPTURE]: capture });
}

export async function takePendingCapture() {
  const stored = await storageGet(STORAGE_KEYS.PENDING_CAPTURE);
  await storageRemove(STORAGE_KEYS.PENDING_CAPTURE);
  return stored[STORAGE_KEYS.PENDING_CAPTURE] || null;
}
