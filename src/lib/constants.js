// Shared constants used across the extension (background, side panel, options, content scripts).

export const FACEBOOK_GRAPH_VERSION = "v19.0";
export const FACEBOOK_GRAPH_BASE = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;

// Facebook login dialog (OAuth) endpoint used with chrome.identity.launchWebAuthFlow.
export const FACEBOOK_OAUTH_DIALOG = "https://www.facebook.com/v19.0/dialog/oauth";

// Permissions required per the product spec. Keep this list minimal; each scope
// added here increases Facebook App Review scrutiny.
export const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_manage_metadata",
];

export const POST_CHARACTER_LIMIT = 63206;
export const POST_SEE_MORE_FOLD = 125;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB Facebook limit
export const MIN_IMAGE_WIDTH = 600;
export const MIN_IMAGE_HEIGHT = 315;

export const MAX_HASHTAGS_RECOMMENDED = 3;
export const MAX_TEXT_LINES_WITHOUT_BREAK = 5;
export const MAX_POSTS_PER_DAY_RECOMMENDED = 2;
export const MIN_HOURS_BETWEEN_POSTS = 3;

// Facebook Graph API rate limits (per spec section 3).
export const RATE_LIMIT_POSTING_PER_HOUR = 200;
export const RATE_LIMIT_READING_PER_HOUR = 4800;

// Optimal posting windows: local-to-page day/hour ranges, 24h clock.
export const OPTIMAL_POST_WINDOWS = [
  { days: [2, 3, 4], startHour: 8, endHour: 10 }, // Tue-Thu morning
  { days: [2, 3, 4], startHour: 19, endHour: 21 }, // Tue-Thu evening
];

// A light, non-exhaustive keyword list for the compliance "policy scanner".
// This is a heuristic guardrail, not a substitute for Facebook's own review.
export const RESTRICTED_KEYWORD_CATEGORIES = {
  weapons: ["gun for sale", "firearm for sale", "ammunition for sale", "buy a gun"],
  drugs: ["buy weed", "buy cocaine", "buy heroin", "sell drugs", "illegal drugs"],
  medicalClaims: ["cures cancer", "miracle cure", "guaranteed weight loss", "cures covid"],
};

export const STORAGE_KEYS = {
  ENCRYPTED_TOKENS: "pp_encrypted_tokens",
  CRYPTO_KEY: "pp_crypto_key",
  CONNECTED_PAGES: "pp_connected_pages",
  ACTIVE_PAGE_ID: "pp_active_page_id",
  TEMPLATES: "pp_templates",
  HISTORY: "pp_history",
  SETTINGS: "pp_settings",
  PENDING_CAPTURE: "pp_pending_capture",
};

export const DEFAULT_SETTINGS = {
  plan: "free", // "free" | "pro" | "agency"
  warnOnOffHours: true,
  warnOnFrequencyCap: true,
  markdownStyle: "unicode", // "unicode" | "plain"
};

export const PLAN_LIMITS = {
  free: { postsPerWeek: 3, maxPages: 1, scheduling: false, templates: false, analytics: false },
  pro: { postsPerWeek: Infinity, maxPages: 1, scheduling: true, templates: true, analytics: true },
  agency: { postsPerWeek: Infinity, maxPages: Infinity, scheduling: true, templates: true, analytics: true, approvals: true, bulk: true },
};
