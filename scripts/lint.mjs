// Compliance lint: enforces Page Push's non-negotiable rules on the source and the manifest.
// Runs in `npm run verify`. It is not a style linter; it fails on anything that would break the
// manual-assist, local-only, no-evasion promises the store listing and privacy policy make.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const problems = [];
const fail = (file, message) => problems.push(`${file}: ${message}`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Source text with comments removed, so rules apply to code, not to notes that name the rule. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const ALLOWED_URLS = [/^https:\/\/facebook\.com\b/, /^http:\/\/localhost(:11434)?\b/, /^http:\/\/127\.0\.0\.1:11434\b/];
const FETCH_ALLOWED = new Set(["src/draft/ollama.ts"]);
const INTERVAL_ALLOWED = new Set(["src/settle.ts"]);

for (const file of walk(join(root, "src")).filter((path) => /\.(ts|html)$/.test(path))) {
  const rel = relative(root, file).replace(/\\/g, "/");
  const text = code(readFileSync(file, "utf8"));
  if (/chrome\.storage\.sync/.test(text)) fail(rel, "uses chrome.storage.sync; Page Push stores data in chrome.storage.local only");
  if (/Math\.random|crypto\.getRandomValues/.test(text)) fail(rel, "uses randomness; no randomized typing, timing, or evasion");
  if (/\beval\s*\(|new Function\s*\(/.test(text)) fail(rel, "evaluates code at runtime; MV3 forbids remote or generated code");
  if (/chrome\.alarms|requestIdleCallback/.test(text)) fail(rel, "schedules background work; every action must follow a click");
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(text) && !FETCH_ALLOWED.has(rel)) {
    fail(rel, "makes a network request; only src/draft/ollama.ts may, and only to localhost:11434");
  }
  if (/setInterval\s*\(/.test(text) && !INTERVAL_ALLOWED.has(rel)) fail(rel, "uses setInterval; only the bounded settle wait may poll");
  for (const url of text.match(/https?:\/\/[^\s"'`)<>]+/g) ?? []) {
    if (!ALLOWED_URLS.some((pattern) => pattern.test(url))) fail(rel, `refers to ${url}; only facebook.com and the local Ollama are allowed`);
  }
  if (/storage\.local\.(get|set)\([^)]*password/i.test(text)) fail(rel, "stores something named password");
}

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
if (manifest.manifest_version !== 3) fail("manifest.json", "must be Manifest V3");
if (!same(manifest.permissions ?? [], ["sidePanel", "storage"])) {
  fail("manifest.json", `permissions must be exactly sidePanel and storage, found ${JSON.stringify(manifest.permissions)}`);
}
if (!same(manifest.host_permissions ?? [], ["https://*.facebook.com/*", "http://localhost:11434/*", "http://127.0.0.1:11434/*"])) {
  fail("manifest.json", `host_permissions must be Facebook plus the local Ollama only, found ${JSON.stringify(manifest.host_permissions)}`);
}
for (const script of manifest.content_scripts ?? []) {
  if (!same(script.matches ?? [], ["https://*.facebook.com/*"])) fail("manifest.json", "content scripts may run on facebook.com only");
}
if (manifest.optional_permissions?.length || manifest.optional_host_permissions?.length) fail("manifest.json", "no optional permissions in v1.0.0");
if (manifest.version !== pkg.version) fail("manifest.json", `version ${manifest.version} does not match package.json ${pkg.version}`);

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## [${pkg.version}]`)) fail("CHANGELOG.md", `has no entry for ${pkg.version}`);

if (problems.length) {
  console.error(`Compliance lint found ${problems.length} problem(s):\n${problems.map((item) => `  - ${item}`).join("\n")}`);
  process.exit(1);
}
console.log("Compliance lint passed: local-only storage, no randomness or schedulers, network limited to localhost:11434, manifest permissions as disclosed.");
