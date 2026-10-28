// AES-256-GCM encryption helpers for "tokens encrypted at rest" (spec section 7: Security).
// Uses the Web Crypto API, available in both the MV3 service worker and extension pages.
// The symmetric key itself lives in chrome.storage.local (not sync) so it never leaves the
// device; see storage.js for how the key is generated/retrieved.

const ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH_BYTES = 12;

/** Generate a new non-extractable-by-default-but-exportable AES-256 key. */
export async function generateKey() {
  return crypto.subtle.generateKey({ name: ALGO, length: KEY_LENGTH }, true, ["encrypt", "decrypt"]);
}

export async function exportKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bufferToBase64(raw);
}

export async function importKey(base64Key) {
  const raw = base64ToBuffer(base64Key);
  return crypto.subtle.importKey("raw", raw, ALGO, true, ["encrypt", "decrypt"]);
}

/**
 * Encrypt a plaintext string (typically a JSON-serialized object containing tokens).
 * Returns a self-contained payload { iv, ciphertext } both base64-encoded.
 */
export async function encryptString(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);
  return {
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext),
  };
}

export async function decryptString(key, payload) {
  const iv = base64ToBuffer(payload.iv);
  const ciphertext = base64ToBuffer(payload.ciphertext);
  const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
