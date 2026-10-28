import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripAiPreamble,
  stripChatArtifacts,
  markdownToFacebookText,
  collapseExcessiveWhitespace,
  extractFirstUrl,
  formatForFacebook,
} from "../src/lib/formatter.js";

test("stripAiPreamble removes 'Certainly! Here is your caption:'", () => {
  const input = "Certainly! Here is your caption: Check out our new product launch.";
  assert.equal(stripAiPreamble(input), "Check out our new product launch.");
});

test("stripAiPreamble removes 'Sure, here's a post:'", () => {
  const input = "Sure, here's a post:\nExcited to share some news.";
  assert.equal(stripAiPreamble(input), "Excited to share some news.");
});

test("stripAiPreamble leaves normal content untouched", () => {
  const input = "We just hit 1,000 customers!";
  assert.equal(stripAiPreamble(input), input);
});

test("stripChatArtifacts removes 'ChatGPT' header lines", () => {
  const input = "## ChatGPT\nHere's the actual caption text.";
  assert.equal(stripChatArtifacts(input), "Here's the actual caption text.");
});

test("markdownToFacebookText converts bold to unicode by default", () => {
  const result = markdownToFacebookText("This is **important** news");
  assert.ok(result.includes("𝐢𝐦𝐩𝐨𝐫𝐭𝐚𝐧𝐭"));
  assert.ok(!result.includes("**"));
});

test("markdownToFacebookText plain style strips markdown without unicode", () => {
  const result = markdownToFacebookText("This is **important** news", "plain");
  assert.equal(result, "This is important news");
});

test("markdownToFacebookText converts bullet lists to bullet glyphs", () => {
  const result = markdownToFacebookText("- first\n- second", "plain");
  assert.equal(result, "\u2022 first\n\u2022 second");
});

test("markdownToFacebookText converts headers to bolded text", () => {
  const result = markdownToFacebookText("## Big Announcement", "plain");
  assert.equal(result, "Big Announcement");
});

test("markdownToFacebookText rewrites markdown links as 'text: url'", () => {
  const result = markdownToFacebookText("Read more [here](https://example.com/post)", "plain");
  assert.equal(result, "Read more here: https://example.com/post");
});

test("collapseExcessiveWhitespace collapses 3+ blank lines to one blank line", () => {
  const input = "Line one\n\n\n\nLine two";
  assert.equal(collapseExcessiveWhitespace(input), "Line one\n\nLine two");
});

test("collapseExcessiveWhitespace preserves a single intentional line break", () => {
  const input = "Line one\n\nLine two";
  assert.equal(collapseExcessiveWhitespace(input), input);
});

test("extractFirstUrl finds the first http(s) URL", () => {
  assert.equal(extractFirstUrl("Check this out: https://example.com/page and https://other.com"), "https://example.com/page");
});

test("extractFirstUrl returns null when there is no URL", () => {
  assert.equal(extractFirstUrl("No links here"), null);
});

test("formatForFacebook runs the full pipeline end to end", () => {
  const raw = "Certainly! Here is your caption:\n## Big News\nWe just launched **version 2**!\n\n\n\nMore info: [here](https://example.com)";
  const result = formatForFacebook(raw, { style: "plain" });
  assert.ok(!result.text.includes("Certainly"));
  assert.ok(!result.text.includes("##"));
  assert.ok(!result.text.includes("**"));
  assert.equal(result.firstUrl, "https://example.com");
});
