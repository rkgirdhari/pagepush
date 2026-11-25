// Browser entry boundary. Everything exported here is free of Node built-ins and is what the
// extension bundles may import. Node-only modules (src/draft/candle.ts) stay reachable only from
// src/index.ts, and the build fails if a node: import reaches a browser bundle.
export { approve, checkDrift, CommitRefused, executeCommit, executeDraft } from "./execute.ts";
export { formatTrace } from "./debug.ts";
export type { RunOptions, TraceEvent } from "./debug.ts";
export { captchaCleared } from "./bind.ts";
export { validateField } from "./validate.ts";
export { charLength, getPath, labelKey, sha256, stableStringify } from "./util.ts";
export { facebookSchema } from "./schema.ts";
export {
  assessFacebook,
  facebookContext,
  facebookTiers,
  planFacebook,
  prepareFacebookPack,
  tierOffer,
} from "./shims/facebook.ts";
export type { FacebookPack, FacebookTier, MediaNeed, Weekday } from "./shims/facebook.ts";
export type { Action, ApplyResult, ConfirmToken, FieldSchema, FillPlan, Gate, PlanIssue } from "./types.ts";
