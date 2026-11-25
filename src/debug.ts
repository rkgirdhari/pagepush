export interface TraceEvent {
  phase: "draft" | "commit" | "model";
  code: string;
  actionId?: string;
  fieldId?: string;
}

export interface RunOptions {
  trace?: (event: TraceEvent) => void;
  /** Longest wait per write step for the page to settle (ms). Defaults to DEFAULT_SETTLE_MS. */
  settleMs?: number;
}

export function formatTrace(events: TraceEvent[]): string {
  return events
    .map((event) => [event.phase, event.code, event.actionId, event.fieldId].filter(Boolean).join(" "))
    .join("\n");
}
