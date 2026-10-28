// Converts raw AI-chat output into Facebook-friendly text.
// Pure functions, no browser/DOM APIs, so they can be unit tested with node:test
// and reused identically in the side panel, content scripts, and background worker.

const UNICODE_BOLD_MAP = buildUnicodeMap(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  [
    ...codePointRange(0x1d400, 26), // bold A-Z
    ...codePointRange(0x1d41a, 26), // bold a-z
    ...codePointRange(0x1d7ce, 10), // bold 0-9
  ]
);

const UNICODE_ITALIC_MAP = buildUnicodeMap(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  [
    ...codePointRange(0x1d434, 26), // italic A-Z
    ...codePointRange(0x1d44e, 26), // italic a-z (note: italic h is 0x210e, special-cased below)
  ]
);
// The mathematical italic small h collides with Planck's constant symbol; fix it.
UNICODE_ITALIC_MAP.set("h", "\u210e");

function codePointRange(start, count) {
  return Array.from({ length: count }, (_, i) => String.fromCodePoint(start + i));
}

function buildUnicodeMap(chars, glyphs) {
  const map = new Map();
  for (let i = 0; i < chars.length; i++) {
    map.set(chars[i], glyphs[i]);
  }
  return map;
}

function toUnicodeStyle(text, map) {
  return Array.from(text)
    .map((ch) => map.get(ch) || ch)
    .join("");
}

// Phrases AI assistants commonly prepend before the actual content. Case-insensitive,
// matched only at the very start of the text (optionally after whitespace).
const AI_PREAMBLE_PATTERNS = [
  /^certainly!?\s*/i,
  /^sure!?,?\s*(here'?s?|here is)?\s*/i,
  /^of course!?\s*/i,
  /^absolutely!?\s*/i,
  /^here'?s? (is )?(a |an |your )?(.*?)(caption|post|draft|copy|content)[:\-]?\s*/i,
  /^here is (a |an |your )?(.*?)(caption|post|draft|copy|content)[:\-]?\s*/i,
  // Leftover noun phrase after a preceding intro word (e.g. "Sure, ") has already
  // been stripped, as in "Sure, a post: ..." -> "a post: ...".
  /^(a |an |your )?(caption|post|draft|copy|content)[:\-]\s*/i,
  /^i'?d be happy to help.*?[:\-]\s*/i,
  /^as an ai( language model)?,?.*?[:\-]\s*/i,
  /^chatgpt said:?\s*/i,
  /^claude said:?\s*/i,
  /^\*\*(chatgpt|claude|assistant)\*\*:?\s*/i,
];

/** Strip a single leading AI preamble sentence, e.g. "Certainly! Here is your caption:" */
export function stripAiPreamble(text) {
  let result = text;
  let changed = true;
  // Loop because some outputs stack two phrases, e.g. "Sure! Here's a caption:".
  let guard = 0;
  while (changed && guard < 5) {
    changed = false;
    for (const pattern of AI_PREAMBLE_PATTERNS) {
      const next = result.replace(pattern, "");
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
    guard++;
  }
  return result.trimStart();
}

/** Strip common chat UI headers/footers that get copy-pasted along with the content. */
export function stripChatArtifacts(text) {
  return text
    .replace(/^#{1,6}\s*(chatgpt|claude|gemini)\s*$/gim, "")
    .replace(/^you said:?\s*$/gim, "")
    .replace(/^(chatgpt|claude|gemini) said:?\s*$/gim, "")
    .replace(/^copy code$/gim, "")
    .trim();
}

/**
 * Convert markdown emphasis/headers/bullets into Facebook-friendly text.
 * style "unicode" renders bold/italic markdown as Unicode glyphs (e.g. bold becomes
 * mathematical bold characters); style "plain" just removes the markup.
 */
export function markdownToFacebookText(text, style = "unicode") {
  let result = text;

  // Headers: "## Title" -> "Title" (optionally bolded for emphasis).
  result = result.replace(/^#{1,6}\s*(.+)$/gm, (_, title) =>
    style === "unicode" ? toUnicodeStyle(title.trim(), UNICODE_BOLD_MAP) : title.trim()
  );

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => {
    const inner = a ?? b;
    return style === "unicode" ? toUnicodeStyle(inner, UNICODE_BOLD_MAP) : inner;
  });

  // Italic: *text* or _text_ (single marker, not already consumed by bold above).
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, (_, a, b) => {
    const inner = a ?? b;
    return style === "unicode" ? toUnicodeStyle(inner, UNICODE_ITALIC_MAP) : inner;
  });

  // Bullet points: "- item" / "* item" -> "• item" (Facebook renders these on separate lines).
  result = result.replace(/^[ \t]*[-*+]\s+/gm, "• ");

  // Numbered lists: keep the number, drop markdown-specific dot styling quirks.
  result = result.replace(/^[ \t]*(\d+)\.\s+/gm, "$1. ");

  // Inline code / code fences: drop backticks, keep content.
  result = result.replace(/```[a-z]*\n?([\s\S]*?)```/g, "$1").replace(/`([^`]+)`/g, "$1");

  // Links in markdown form [text](url) -> "text: url" so the URL stays crawlable by
  // Facebook's link preview while the label remains readable.
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1: $2");

  return result;
}

/** Collapse 3+ consecutive blank lines into exactly one, but preserve intentional breaks. */
export function collapseExcessiveWhitespace(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "")) // trailing spaces per line
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Extract the first URL in the text (the one Facebook will generate a link preview for). */
export function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/[^\s)]+/);
  return match ? match[0] : null;
}

/**
 * Full pipeline: raw AI/editor output -> Facebook-ready post text.
 * This is the single entry point the UI and content scripts should call.
 */
export function formatForFacebook(rawText, { style = "unicode" } = {}) {
  let text = rawText || "";
  text = stripChatArtifacts(text);
  text = stripAiPreamble(text);
  text = markdownToFacebookText(text, style);
  text = collapseExcessiveWhitespace(text);
  return {
    text,
    firstUrl: extractFirstUrl(text),
    length: text.length,
  };
}
