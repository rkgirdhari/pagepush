// Explicit, local-only snapshots of the client pack. They do not include plans, approvals,
// receipts, or credentials from the browser, and restoring one never writes to Facebook.
import type { FacebookPack } from "../browser.ts";
import { checkPack, packFingerprint } from "./packs.ts";
import { replacePack, type PanelState } from "./panel-state.ts";

export const VERSION_LIMIT = 20;

export interface PackVersion {
  savedAt: string;
  pack: FacebookPack;
}

/** Ignore malformed entries from old or damaged local storage. */
export function readVersions(value: unknown): PackVersion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PackVersion => {
    if (!item || typeof item !== "object") return false;
    const entry = item as PackVersion;
    if (typeof entry.savedAt !== "string" || !Number.isFinite(Date.parse(entry.savedAt))) return false;
    return Boolean(checkPack(entry.pack).pack);
  }).slice(0, VERSION_LIMIT).map((entry) => structuredClone(entry));
}

/** Save a snapshot only on an explicit click or just before a restore; newest first. */
export function saveVersion(state: PanelState, at = new Date()): PanelState {
  const versions = state.versions ?? [];
  if (versions[0] && packFingerprint(versions[0].pack) === packFingerprint(state.pack)) return state;
  const snapshot: PackVersion = { savedAt: at.toISOString(), pack: structuredClone(state.pack) };
  return { ...state, versions: [snapshot, ...versions].slice(0, VERSION_LIMIT) };
}

/** Preserve the current pack, restore only the pack, and require a completely new plan. */
export function restoreVersion(state: PanelState, index: number, at = new Date()): PanelState {
  const version = state.versions?.[index];
  if (!version || !checkPack(version.pack).pack) return state;
  const pack = structuredClone(version.pack);
  const saved = saveVersion(state, at);
  return replacePack(saved, pack);
}
