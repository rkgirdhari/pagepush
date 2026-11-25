// Local-only persistence. Everything goes to chrome.storage.local under one key; nothing is
// ever written to chrome.storage.sync, and nothing leaves the browser.
import type { FacebookPack } from "../browser.ts";
import type { Checklist, PanelState, ProgressEntry, Session } from "./panel-state.ts";
import type { ReceiptEntry } from "./receipt.ts";

export const STORAGE_KEY = "pagepush.v1";

/** The slice of chrome.storage.StorageArea Page Push uses. */
export interface LocalArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  clear(): Promise<void>;
}

export interface Saved {
  version: 1;
  pack: FacebookPack;
  checklist: Checklist;
  progress: ProgressEntry[];
  /** The last plan, kept so the panel can resume it after a reload if the tab still holds it. */
  session: Session | null;
  /** Sprint receipt entries, one per Approve & Commit. Older saves without it load as empty. */
  receipts?: ReceiptEntry[];
  savedAt: string;
}

export function toSaved(state: PanelState, at = new Date()): Saved {
  return {
    version: 1,
    pack: state.pack,
    checklist: state.checklist,
    progress: state.progress,
    session: state.session,
    receipts: state.receipts ?? [],
    savedAt: at.toISOString(),
  };
}

export async function load(area: LocalArea): Promise<Saved | null> {
  try {
    const found = (await area.get(STORAGE_KEY))[STORAGE_KEY] as Saved | undefined;
    if (!found || found.version !== 1 || !found.pack) return null;
    return found;
  } catch {
    return null;
  }
}

export async function save(area: LocalArea, state: PanelState): Promise<void> {
  await area.set({ [STORAGE_KEY]: toSaved(state) });
}

/** Clear All Local Data: wipes this extension's local storage area, not just Page Push's key. */
export async function clearAll(area: LocalArea): Promise<void> {
  await area.clear();
}

/** A debounced saver so typing in the pack form does not write on every keystroke. */
export function saver(area: LocalArea, delayMs = 300): { schedule(state: PanelState): void; flush(): Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PanelState | null = null;
  const flush = async (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    const state = pending;
    pending = null;
    if (state) await save(area, state);
  };
  return {
    schedule(state) {
      pending = state;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void flush(); }, delayMs);
    },
    flush,
  };
}
