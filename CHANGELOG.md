# Changelog

All notable changes to Page Push. Dates are when the change was committed on
`integration/v1.0.0-facebook`. Nothing here is released until the branch is reviewed, pushed, and
tagged; the existing `extension-v1.0.0` tag is not moved.

## [1.0.0] - Unreleased

The first release of Page Push as a manual-assist tool for **Facebook Business Page setup**,
sold as the Setup Sprint in three tiers: Essentials ($5), Standard Business ($15), and Full
Launch + Post ($50). The person signs in, opens their Page view, reviews every draft, and clicks
Approve & Commit before anything is created, saved, or posted.

### Added
- Facebook Business Page shim and `schemas/schema_facebook.json` on the unified engine
  (`plan → executeDraft → bind → apply → preview → Approve & Commit`), with Lexical-safe writing,
  dialog scoping, and a fail-closed check that the open view is a Business Page the person manages.
  (Phase 2)
- esbuild bundles for the content script, side panel, and service worker, with a browser-safe
  synchronous SHA-256 for plan hashes. (Phase 3)
- Production side panel: pack editor with tier starter packs, plan inspector, pre-flight checklist,
  Plan / Draft / Approve & Commit with drift detection, copy-paste fallback, SPA re-planning, and
  Clear All Local Data. (Phase 4)
- Bounded settle waits (MutationObserver plus polling, 2.5 s per step) so React and Lexical finish
  re-rendering before a write is verified; checkboxes, switches, and radios are changed with real
  clicks. (Phase 5)
- Labels, roles, limits, and admin signals verified against sanitized captures of a live Business
  Page: Business Dashboard, `/post/create` composer, About editors, Action button dialog, and
  `/pages/creation/`. Sanitized fixtures in `test/fixtures/facebook/`. (Phase 5)
- Bio and launch-post drafting: an offline, fact-based draft by default, and optional drafting
  with a local Ollama (`http://localhost:11434`, default `qwen3`) through one-click Check / Load
  Model and Draft Copy with Ollama. Model drafts are kept only if they fit the limits and add no
  link, email, date, price, or claim beyond the pack. (Phase 6)
- Sprint receipts: every Approve & Commit is recorded (plan hash, approval time, tier, view,
  drafted and committed fields, checklist) and can be downloaded as a JSON receipt with a SHA-256
  over its body. (Phase 7)
- Compliance lint (`npm run lint`) enforcing local-only storage, no randomness or schedulers,
  network access limited to the local Ollama, and the disclosed manifest permissions. (Phase 7)
- End-to-end tests that run the bundled side panel and content script together against the
  sanitized Facebook fixtures. (Phase 7)
- `PRIVACY_POLICY.md`, `docs/CHROME_WEB_STORE.md` (single purpose, permission justifications,
  data-use disclosures), `docs/OLLAMA.md`, and `LAUNCH_CHECKLIST.md`. (Phases 1, 6, 7)

### Changed
- Versions aligned to 1.0.0 across `package.json` and `manifest.json`. (Phase 1)
- Bio limit is 255 characters (verified on the live editor), up from a guessed 101. (Phase 5)
- Commit buttons that Facebook keeps `aria-disabled` until the draft registers (Post, Save,
  Create a Page) are planned, and commit waits for them to enable or refuses. (Phase 5)

### Not included
- No Graph API, OAuth, tokens, scheduler, or background posting. No YouTube, LinkedIn, or GitHub
  shims yet. The optional Candle drafter (`native/candle-drafter`) is a developer tool and is not
  part of the extension build.
- Business hours remain unverified on the live page (Facebook locks them until an address is saved).
