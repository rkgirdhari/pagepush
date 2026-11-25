# Launch Checklist: v1.0.0 (Facebook Business Page)

Adapted from `cursor/page-push-mvp-extension-8aa9` (`89d168e`). The Graph API, OAuth, token
refresh, and scheduler items from that branch are dropped: v1.0.0 fills the Facebook form the
person already has open and never posts through an API or on a timer.

Status as of Phase 7 (2026-11-25) on `integration/v1.0.0-facebook`. Ticked items are done and
covered by tests or docs in this branch; unticked items need a person, a real browser, or a
decision before release.

## Engine and extension

- [x] Facebook Business Page shim and `schemas/schema_facebook.json` wired into `plan`, `bind`, and `apply`. (Phase 2)
- [x] esbuild bundle for the content script and side panel; no `node:` imports in browser bundles. (Phase 3, `test/bundle.test.ts`)
- [x] Plan hashing uses the synchronous plain-JS SHA-256, with a parity test against `node:crypto`. (Phase 3)
- [x] Side panel: pack editor, $5 / $15 / $50 starter packs, plan inspector, media pre-flight checklist, Draft, Approve & Commit, copy-paste fallback. (Phase 4)
- [x] Panel-to-page errors (`Receiving end does not exist`, closed or navigated tab) show what to do next. (Phase 4)
- [x] Writes wait for React and Lexical to settle, with explicit timeouts, before verifying. (Phase 5, `src/settle.ts`)
- [x] Captcha gate covers reCAPTCHA, hCaptcha, and Cloudflare Turnstile, including a captcha that appears after planning. (Phase 7 fix)
- [x] Optional local Ollama drafting with an offline default. (Phase 6, `docs/OLLAMA.md`)
- [x] Sprint receipt export with a self-verifying SHA-256, and two-click Clear All Local Data that never touches `chrome.storage.sync`. (Phase 7)

## Live Facebook verification

- [x] Sanitized DOM captures of the Business Dashboard, `/post/create`, the About editors, the Action button dialog, and `/pages/creation/`. (Phase 5, `test/fixtures/facebook/`, `docs/research/facebook-dom.md`)
- [ ] Every label in `schemas/schema_facebook.json` confirmed live. Done for the views above; **hours** are still unverified (Facebook locks them until an address is saved), and older alternate labels stay as fallbacks.
- [x] Bio/Intro character limit confirmed on the live page (255).
- [ ] Launch-post composer (Lexical) keeps the drafted text after blur, re-render, and modal close, on the live page. Fixtures model it; no text has been typed into the live composer.
- [ ] A dry run on a test Business Page, end to end, with the sprint receipt exported. **Needs you**: load `dist/` unpacked, run Plan → Draft → Approve & Commit on a test Page, download the receipt.
- [ ] One real **Check / Load Model** and **Draft Copy with Ollama** against your installed Ollama (tests use a scripted Ollama).

## Chrome Web Store submission

- [ ] Final icon artwork at 16 / 32 / 48 / 128 px in `icons/` (current files are placeholders from `cursor/page-push-extension-d6cb`).
- [x] `PRIVACY_POLICY.md` finalized for 1.0.0.
- [ ] `PRIVACY_POLICY.md` hosted at a public URL and linked from the listing.
- [x] Single-purpose statement and per-permission justifications (`sidePanel`, `storage`, `https://*.facebook.com/*`, `localhost:11434` / `127.0.0.1:11434`). (`docs/CHROME_WEB_STORE.md`)
- [x] Data-use disclosure answers match the privacy policy: nothing transmitted, no data sold, no remote code, no telemetry. (`docs/CHROME_WEB_STORE.md`)
- [x] Listing copy states plainly that Page Push is a manual-assist form-fill tool and every commit is approved by the person.
- [ ] Screenshots: pack editor, plan preview, drafted Page form, Approve & Commit, receipt export (list in `docs/CHROME_WEB_STORE.md`).

## Release gate

- [x] `npm run verify`: typecheck, compliance lint (`scripts/lint.mjs`), full test suite, and the extension build are clean.
- [ ] ESLint. Not installed in this repo; `npm run lint` is a compliance lint, not a style linter. Decide whether to add ESLint before release.
- [ ] `cargo clippy` for the optional Candle drafter. Not run: `native/candle-drafter` is untouched in Phases 5–7 and not part of the extension build.
- [x] End-to-end tests run the bundled side panel and content script together against the Facebook fixtures (`test/e2e.test.ts`, happy-dom). A real-Chrome unpacked run is the dry run above.
- [x] `package.json` and `manifest.json` versions match (enforced by `npm run lint`).
- [x] `CHANGELOG.md` entry for 1.0.0.
- [ ] Final diff reviewed before anything is pushed or any tag is moved. The existing `extension-v1.0.0` tag points at `56840ea` and is not rewritten.

## After v1.0.0

- [ ] Server-backed phone confirm relay (v1.x). v1.0.0 approves in the side panel.
- [ ] Additional platform shims (YouTube, LinkedIn, GitHub) on the same engine.
- [ ] Business hours drafting once the live hours editor is captured.
