// Local-only persistence. Nothing is written to chrome.storage.sync.
import type { FacebookPack } from "../browser.ts";
import type { Checklist, PanelState, ProgressEntry, Session, RecordArchive } from "./panel-state.ts";
import type { ReceiptEntry } from "./receipt.ts";
import type { PackVersion } from "./version-history.ts";

export const STORAGE_KEY = "pagepush.v1";

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
  session: Session | null;
  receipts?: ReceiptEntry[];
  versions?: PackVersion[];
  archives?: RecordArchive[];
  /** Older saves lack provenance for their records. */
  recordsScoped?: boolean;
  savedAt: string;
}

export function toSaved(state: PanelState, at = new Date()): Saved {
  return {
    version: 1, pack: state.pack, checklist: state.checklist, progress: state.progress,
    session: state.session, receipts: state.receipts ?? [], versions: state.versions ?? [],
    archives: state.archives ?? [], recordsScoped: true, savedAt: at.toISOString(),
  };
}

export async function load(area: LocalArea): Promise<Saved | null> {
  try {
    const found = (await area.get(STORAGE_KEY))[STORAGE_KEY] as Saved | undefined;
    if (!found || found.version !== 1 || !found.pack) return null;
    return found;
  } catch { return null; }
}

export async function save(area: LocalArea, state: PanelState): Promise<void> {
  await area.set({ [STORAGE_KEY]: toSaved(state) });
}

export async function clearAll(area: LocalArea): Promise<void> { await area.clear(); }

/** This saver instance serializes its own writes. Clear fences its queue, not other panels or contexts. */
export function saver(area: LocalArea, delayMs = 300): {
  schedule(state: PanelState): void;
  flush(): Promise<void>;
  write(items: Record<string, unknown>): Promise<void>;
  clear(): Promise<void>;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PanelState | null = null;
  let generation = 0;
  let clearing = false;
  let tail: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>, epoch: number): Promise<void> => {
    const result = tail.then(async () => { if (epoch === generation && !clearing) await work(); });
    tail = result.catch(() => undefined);
    return result;
  };
  const flush = (): Promise<void> => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const snapshot = pending;
    pending = null;
    return snapshot ? enqueue(() => save(area, snapshot), generation) : tail;
  };
  return {
    schedule(state) {
      if (clearing) return;
      pending = structuredClone(state);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { void flush().catch(() => undefined); }, delayMs);
    },
    flush,
    write(items) {
      if (clearing) return Promise.resolve();
      const snapshot = structuredClone(items);
      return enqueue(() => area.set(snapshot), generation);
    },
    async clear() {
      if (clearing) return tail;
      clearing = true;
      generation += 1;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      const result = tail.then(() => area.clear());
      tail = result.catch(() => undefined);
      try { await result; } finally { clearing = false; }
    },
  };
}
