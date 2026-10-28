// "Best practices" guardrails from spec section 6: content quality checks and the
// light compliance policy scanner. All functions return plain, serializable warning
// objects so they can be rendered identically in the side panel UI.

import {
  POST_CHARACTER_LIMIT,
  POST_SEE_MORE_FOLD,
  MAX_HASHTAGS_RECOMMENDED,
  MAX_TEXT_LINES_WITHOUT_BREAK,
  MIN_IMAGE_WIDTH,
  MIN_IMAGE_HEIGHT,
  MAX_IMAGE_BYTES,
  RESTRICTED_KEYWORD_CATEGORIES,
} from "./constants.js";

function warning(code, severity, message) {
  return { code, severity, message }; // severity: "info" | "warn" | "error"
}

export function checkCharacterLimit(text) {
  const warnings = [];
  if (text.length > POST_CHARACTER_LIMIT) {
    warnings.push(
      warning(
        "over_limit",
        "error",
        `Post is ${text.length.toLocaleString()} characters, over Facebook's ${POST_CHARACTER_LIMIT.toLocaleString()} limit by ${(
          text.length - POST_CHARACTER_LIMIT
        ).toLocaleString()}.`
      )
    );
  } else if (text.length > POST_SEE_MORE_FOLD) {
    warnings.push(
      warning(
        "see_more_fold",
        "info",
        `Post is ${text.length} characters \u2014 it will be truncated behind "See more" after ${POST_SEE_MORE_FOLD}.`
      )
    );
  }
  return warnings;
}

export function checkHashtagDensity(text) {
  const hashtags = text.match(/#[\w]+/g) || [];
  if (hashtags.length > MAX_HASHTAGS_RECOMMENDED) {
    return [
      warning(
        "too_many_hashtags",
        "warn",
        `${hashtags.length} hashtags found. More than ${MAX_HASHTAGS_RECOMMENDED} can look spammy and reduce reach.`
      ),
    ];
  }
  return [];
}

export function checkTextDensity(text) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const hasParagraphBreak = text.includes("\n\n");
  if (lines.length > MAX_TEXT_LINES_WITHOUT_BREAK && !hasParagraphBreak) {
    return [
      warning(
        "dense_text",
        "warn",
        `${lines.length} lines of text with no paragraph breaks. Facebook may collapse this awkwardly \u2014 consider adding line breaks.`
      ),
    ];
  }
  return [];
}

/** Heuristic check: does this text *look* like it will render with unpredictable line breaks? */
export function checkFormattingRisk(text) {
  const warnings = [];
  if (/\n{4,}/.test(text)) {
    warnings.push(warning("excess_blank_lines", "info", "Multiple consecutive blank lines detected; Facebook may collapse them."));
  }
  if (/[*_#`]{2,}/.test(text)) {
    warnings.push(warning("leftover_markdown", "warn", "Looks like leftover markdown syntax (*, _, #, or `). Double-check the preview."));
  }
  return warnings;
}

export function checkImageDimensions(width, height) {
  const warnings = [];
  if (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT) {
    warnings.push(
      warning(
        "image_too_small",
        "warn",
        `Image is ${width}\u00d7${height}px. Facebook recommends at least ${MIN_IMAGE_WIDTH}\u00d7${MIN_IMAGE_HEIGHT}px for feed display.`
      )
    );
  }
  return warnings;
}

export function checkImageFileSize(bytes) {
  if (bytes > MAX_IMAGE_BYTES) {
    return [
      warning(
        "image_too_large",
        "error",
        `Image is ${(bytes / (1024 * 1024)).toFixed(1)}MB, over Facebook's 8MB limit. It will be auto-resized before upload.`
      ),
    ];
  }
  return [];
}

/**
 * Light heuristic scan for restricted-content keywords (weapons, drugs, medical claims).
 * This is NOT a substitute for Facebook's own moderation; it only helps users catch
 * obvious policy violations before they get a strike on their Page.
 */
export function scanRestrictedKeywords(text) {
  const lower = text.toLowerCase();
  const warnings = [];
  for (const [category, keywords] of Object.entries(RESTRICTED_KEYWORD_CATEGORIES)) {
    const hit = keywords.find((kw) => lower.includes(kw));
    if (hit) {
      warnings.push(
        warning(
          `restricted_${category}`,
          "warn",
          `Possible restricted content (${category}) detected: "${hit}". Review Facebook's Community Standards before posting.`
        )
      );
    }
  }
  return warnings;
}

/** Validate a URL is reachable and ideally has an Open Graph image, for link preview quality. */
export async function checkLinkPreview(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { method: "GET", mode: "cors" }).catch(() =>
      fetchImpl(url, { method: "GET" })
    );
    if (!response || !response.ok) {
      return [warning("link_unreachable", "warn", `Link returned ${response ? response.status : "an error"} \u2014 Facebook may not generate a preview.`)];
    }
    const html = await response.text();
    const hasOgImage = /<meta[^>]+property=["']og:image["']/i.test(html);
    if (!hasOgImage) {
      return [warning("link_no_og_image", "info", "Link has no Open Graph image tag \u2014 Facebook's preview may look plain.")];
    }
    return [];
  } catch {
    return [warning("link_check_failed", "info", "Could not verify link preview (network or CORS restriction).")];
  }
}

/** Run every text-based check and merge the results. */
export function runAllTextChecks(text) {
  return [
    ...checkCharacterLimit(text),
    ...checkHashtagDensity(text),
    ...checkTextDensity(text),
    ...checkFormattingRisk(text),
    ...scanRestrictedKeywords(text),
  ];
}
