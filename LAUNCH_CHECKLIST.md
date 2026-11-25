# Launch Checklist: v1.0.0 (Facebook Business Page)

Adapted from `cursor/page-push-mvp-extension-8aa9` (`89d168e`). The Graph API, OAuth, token refresh, and scheduler items from that branch are dropped: v1.0.0 fills the Facebook form the person already has open and never posts through an API or on a timer.

## Engine and extension

- [ ] Facebook Business Page shim and `schemas/schema_facebook.json` wired into `plan`, `bind`, and `apply`.
- [ ] esbuild bundle for the content script and side panel; no `node:` imports in browser bundles.
- [ ] Plan hashing uses the synchronous plain-JS SHA-256, with a parity test against `node:crypto`.
- [ ] Side panel: pack editor, $5 / $15 / $50 starter packs, plan inspector, media pre-flight checklist, Draft, Approve & Commit, copy-paste fallback.
- [ ] Panel-to-page errors (`Receiving end does not exist`, closed or navigated tab) show what to do next.
- [ ] Writes wait for React and Lexical to settle, with explicit timeouts, before verifying.
- [ ] Captcha gate covers reCAPTCHA, hCaptcha, and Cloudflare Turnstile.

## Live Facebook verification (blocking)

- [ ] Capture sanitized DOM snapshots of the logged-in Page creation flow and the Page settings/edit views.
- [ ] Every label string in `schemas/schema_facebook.json` is confirmed against those snapshots.
- [ ] Bio/Intro character limit confirmed on the live page.
- [ ] Launch-post composer (Lexical) keeps the drafted text after blur, re-render, and modal close.
- [ ] A dry run on a test Business Page, end to end, with the receipt exported.

## Chrome Web Store submission

- [ ] Final icon artwork at 16 / 32 / 48 / 128 px in `icons/` (current files come from `cursor/page-push-extension-d6cb` and are placeholders).
- [ ] `PRIVACY_POLICY.md` finalized and hosted at a public URL linked from the listing.
- [ ] Single-purpose statement and per-permission justifications (`sidePanel`, `storage`, `https://*.facebook.com/*`, and `nativeMessaging` if shipped).
- [ ] Data-use disclosure form matches the privacy policy: no data sold, no remote code, no telemetry.
- [ ] Listing copy states plainly that Page Push is a manual-assist form-fill tool and every commit is approved by the person.
- [ ] Screenshots: pack editor, plan preview, drafted Page form, Approve & Commit, receipt export.

## Release gate

- [ ] `npm run typecheck`, `npm test`, ESLint, and the extension build are clean.
- [ ] `cargo clippy` clean for the optional drafter.
- [ ] End-to-end tests load the unpacked MV3 build against the Facebook fixtures.
- [ ] `package.json` and `manifest.json` versions match.
- [ ] `CHANGELOG.md` entry for 1.0.0.
- [ ] Final diff reviewed before anything is pushed or any tag is moved. The existing `extension-v1.0.0` tag points at `56840ea` and is not rewritten.

## After v1.0.0

- [ ] Server-backed phone confirm relay (v1.x). v1.0.0 approves in the side panel.
- [ ] Additional platform shims (YouTube, LinkedIn, GitHub) on the same engine.
