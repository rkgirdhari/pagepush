export type Phase = "draft" | "commit";

export type ControlKind =
  | "text"
  | "textarea"
  | "url"
  | "email"
  | "date"
  | "select"
  | "checkbox"
  | "tags"
  | "tokens"
  | "lines"
  | "file"
  | "button"
  | "pricing"
  | "features"
  | "faq"
  | "invites";

export interface FieldSchema {
  id: string;
  labels: string[];
  path: string;
  control: ControlKind;
  required?: boolean;
  phase?: Phase;
  step?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  itemMaxLength?: number;
  itemMinWords?: number;
  pattern?: string;
  enum?: string[];
  format?: "email" | "url" | "date" | "video";
  match?: "exact" | "all-words";
  words?: string[];
  pick?: "first" | "last";
  addLabel?: string;
  writesTo?: string;
  notes?: string;
  /** A token must be one of the options already on the page. */
  taxonomy?: boolean;
}

export interface PlatformSchema {
  id: string;
  version: string;
  title: string;
  offer: {
    name: string;
    priceUsd: number;
    promise: string;
  };
  sources: { title: string; url: string }[];
  fields: FieldSchema[];
  rules?: Record<string, unknown>;
}

export interface PlanIssue {
  level: "error" | "warning";
  fieldId: string;
  code: string;
  message: string;
}

export interface Gate {
  code: "captcha" | "file";
  fieldId?: string;
  message: string;
  controlId?: string;
  /** How many files must already be on the input before commit. Defaults to 1. */
  minFiles?: number;
}

export interface Action {
  id: string;
  phase: Phase;
  kind: string;
  label: string;
  controlId: string;
  sectionId?: string;
  value: unknown;
  preview: string;
}

export interface FillPlan {
  platform: string;
  offer: PlatformSchema["offer"];
  pageUrl: string;
  actions: Action[];
  deferred: string[];
  errors: PlanIssue[];
  warnings: PlanIssue[];
  gates: Gate[];
  preview: string[];
  planHash: string;
}

export interface ConfirmToken {
  planHash: string;
  approvedAt: string;
}

export interface ApplyResult {
  applied: string[];
  unconfirmed: string[];
}

export interface Control {
  id: string;
  element: Element;
  labels: string[];
  rawLabels: string[];
  required: boolean;
  maxLength: number | null;
  tag: string;
  type: string;
  role: string;
  disabled: boolean;
  editable: boolean;
}
