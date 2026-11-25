# Page Push frontend review and UI/UX map

Reviewed: 2026-11-25 · Extension `integration/v1.0.0-facebook` working tree and separate managed companion website.

## Current experience

| Surface | State | Evidence / limits |
| --- | --- | --- |
| Extension side panel | Implemented | Tier and pack editor, plan inspector, draft/approval controls, checklist, progress and copy-paste fallback. Automated tests use captured fixtures rather than live Facebook. |
| Client-pack version history | Implemented | Up to 20 explicit local snapshots; restoring backs up a distinct current pack and resets active plan and checklist. |
| Drafting and local model | Implemented, live check pending | Offline draft and optional local Ollama; draft writes to Facebook before approval. A real Ollama connection was unavailable during review. |
| Receipts and prior-client archive | Implemented with limitations | Attempts and refusals are not Facebook confirmation; receipts may expose Page identity and refusal text. Older archive ownership may be unknown or mixed. |
| Data deletion | Partial / release blocker | One panel fences its own writes, but another open panel can restore stale local data after Clear All. UI and policy warn users. |
| Companion website | Implemented; unpublished | Static responsive homepage, workflow, setup, privacy page, release status and FAQ. Initial HTML, internal links, manifest, HTTP assets and 404 checked locally. |
| Live release experience | Blocked / pending | No current live Chrome/Facebook end-to-end test, live Lexical or hours check, live Ollama test, store screenshots or public publisher contact/privacy URL. |

## Priorities and risks

### P0 — Safe data and real-world verification

1. Replace independent panel write queues with a coordinated, durable cross-context persistence design and verify clear-versus-write, restart and crash races in real Chrome. Until then keep the explicit warning, close other panels before clearing, and do not promise guaranteed erasure. Release must resolve the risk or explicitly accept it.
2. On a test Facebook Business Page, validate the full Plan → Draft → review → Approve & Commit path, navigation and modal changes, Lexical persistence, business hours and attempted/unverified receipts. Avoid blind retries after uncertain actions.
3. Test real optional Ollama connectivity, model loading and draft review. The automated suite uses stubs and the optional Candle smoke test was skipped.

### P1 — Release and accessibility readiness

1. The publisher reviews privacy and Chrome Web Store data-use disclosures, provides a public contact, creates a public privacy-policy URL, and supplies representative screenshots. Do not imply that a store listing exists.
2. Review the extension and website in real Chrome at narrow/mobile and desktop widths using keyboard and assistive technology; fixture and structural checks do not replace this review.
3. When a real public origin is approved, configure canonical and social-image URLs, validate published responses and sitemap/robots, and publish only on explicit authorization.

### P2 — Incremental product polish

1. Consider individual archive deletion and clearer archive ownership controls after establishing a safe data lifecycle.
2. Capture additional Facebook variants and hours controls only after live verification; document unsupported or manual steps.
3. Add dedicated style/accessibility tooling if the publisher selects it; existing extension lint is a compliance check, not ESLint.

## Delivered implementation slice and acceptance criteria

- Version history is local, explicit, bounded and requires a fresh plan after restore.
- Side-panel messages distinguish draft writes, final-action attempts and Facebook confirmation; receipts disclose possible identifying or refusal content.
- The companion website contains a meaningful initial HTML homepage and privacy route with responsive layout, keyboard-focus styles, clear setup steps and honest release status.
- `npm run verify` completed with 140 tests passing, one optional Candle smoke test skipped and an updated unpacked build; site `check_site.py` verified both HTML responses, navigation targets, metadata, assets, route manifest and 404 locally.
- The managed site is not a public release. Live account behavior, hands-on accessibility, guaranteed multi-panel deletion and publisher/store approvals remain outstanding.

Recommended order: fix cross-panel deletion; execute live Chrome/Facebook and Ollama checks; complete publisher and accessibility review; then decide on publishing and store submission.
