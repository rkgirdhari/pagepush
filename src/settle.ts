// Bounded waits for React and Lexical to settle after a write.
//
// Facebook re-renders asynchronously: Lexical applies text in a microtask or animation frame,
// typeahead options arrive after a network round trip, and chips appear after a state update.
// Every write therefore checks immediately, then watches DOM mutations and polls (for
// property-only changes such as .value and .checked) until the check passes or the timeout
// ends. A timeout is not an error: the field is reported unconfirmed, never retried blindly.

/** Default wait per write step. Long enough for a typeahead round trip, short enough to feel live. */
export const DEFAULT_SETTLE_MS = 2500;
const POLL_MS = 40;

export interface SettleOptions {
  timeoutMs?: number;
}

/**
 * Resolves true once `check` passes, false when the timeout ends first. With a timeout, it first
 * yields one task so React and Lexical can reconcile the write: a controlled input that snaps back
 * to its own state must not be confirmed by a check that ran before the snap.
 */
export async function settle(doc: Document, check: () => boolean, options: SettleOptions = {}): Promise<boolean> {
  if ((options.timeoutMs ?? DEFAULT_SETTLE_MS) > 0) await nextTask();
  return (await settleFind(doc, () => (safe(check) ? true : undefined), options)) === true;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Resolves with the first non-undefined result of `find`, or undefined when the timeout ends. */
export function settleFind<T>(doc: Document, find: () => T | undefined, options: SettleOptions = {}): Promise<T | undefined> {
  const first = safeFind(find);
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_SETTLE_MS);
  if (first !== undefined || timeoutMs === 0) return Promise.resolve(first);

  return new Promise<T | undefined>((resolve) => {
    let done = false;
    const view = doc.defaultView as (Window & { MutationObserver?: typeof MutationObserver }) | null;
    const Observer = view?.MutationObserver ?? (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
    let observer: MutationObserver | null = null;
    const finish = (value: T | undefined): void => {
      if (done) return;
      done = true;
      observer?.disconnect();
      clearInterval(poll);
      clearTimeout(limit);
      resolve(value);
    };
    const attempt = (): void => {
      const found = safeFind(find);
      if (found !== undefined) finish(found);
    };
    if (typeof Observer === "function") {
      observer = new Observer(attempt);
      observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    }
    const poll = setInterval(attempt, POLL_MS);
    const limit = setTimeout(() => finish(safeFind(find)), timeoutMs);
  });
}

function safe(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function safeFind<T>(find: () => T | undefined): T | undefined {
  try {
    return find();
  } catch {
    return undefined;
  }
}
