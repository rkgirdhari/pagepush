export interface TraceEvent {
  phase: "draft" | "commit" | "model";
  code: string;
  actionId?: string;
  fieldId?: string;
}

export interface RunOptions {
  trace?: (event: TraceEvent) => void;
}

export function formatTrace(events: TraceEvent[]): string {
  return events
    .map((event) => [event.phase, event.code, event.actionId, event.fieldId].filter(Boolean).join(" "))
    .join("\n");
}
