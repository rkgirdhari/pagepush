# Page Push

Capture text and images from ChatGPT, Claude, Notion, or Canva and push them straight
to your Facebook Page — formatted, previewed, and posted in one click.

This repo contains the Phase 1 ("Essential Loop") + most of Phase 2 ("Power User
Layer") MVP described in the product spec: capture, format, preview, post/draft,
schedule, multi-Page support, templates, and history.

## Project structure

```
manifest.json               Chrome Manifest V3 definition
icons/                       Toolbar icons (placeholder; see scripts/generate_icons.py)
src/
  background/
    service-worker.js        Message router, context menu, alarms wiring
    auth.js                  Facebook OAuth (chrome.identity) + token lifecycle
    facebook-api.js           Graph API client (posts, photos, insights) + error mapping
    scheduler.js              chrome.alarms-backed scheduled publishing
  content-scripts/
    site-adapters.js          Per-site selectors (ChatGPT, Claude, Notion, Canva, Gemini)
    inject-button.js          Inline "Push to Page" button injection
    styles.css
  sidepanel/                  Main compose UI (the "golden path")
  options/                    Connected Pages, plan, preferences
  lib/                        Pure, testable modules shared across contexts
    formatter.js              AI-output -> Facebook-ready text pipeline
    content-checks.js         Character limit / hashtag / density / policy warnings
    timing.js                 Posting-cadence guardrails
    storage.js                chrome.storage.local wrapper (encrypts tokens)
    crypto.js                 AES-256-GCM helpers
    constants.js               Shared limits, scopes, endpoints
tests/                        node:test unit tests for src/lib/*
scripts/generate_icons.py     Zero-dependency placeholder icon generator
```

## Setting up a Facebook App (required before real posting works)

Until you plug in a real Facebook App ID and pass App Review, the "Connect a Page"
flow in the extension will fail with a Facebook-side error. See
`LAUNCH_CHECKLIST.md` for the full list of steps; at minimum:

1. Create an app at [developers.facebook.com](https://developers.facebook.com/apps).
2. Add the Facebook Login product and register the redirect URI printed by
   `chrome.identity.getRedirectURL("facebook")` for your loaded extension.
3. Put the App ID into `FACEBOOK_APP_ID` in `src/background/auth.js`.
4. Add yourself as an app Role/Tester so you can test in Development Mode before
   App Review.

## Loading the extension locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository's root directory.
4. Click the Page Push toolbar icon on `chatgpt.com`, `claude.ai`, `notion.so`, or
   `canva.com` to open the side panel, or highlight text and right-click →
   **Push to Page**.

## Running tests

Pure logic (formatting, content checks, timing) is covered with Node's built-in test
runner — no dependencies required:

```bash
npm test
```

## Regenerating icons

```bash
npm run icons
```

## Security & privacy notes

- Facebook Page access tokens are encrypted at rest (AES-256-GCM) in
  `chrome.storage.local` and never leave the device (see `src/lib/crypto.js` /
  `src/lib/storage.js`). There is no backend server in this MVP.
- No post content is logged or transmitted anywhere except directly to
  `graph.facebook.com` when you explicitly publish/draft/schedule.
- See `PRIVACY_POLICY.md` for the full policy (host this publicly before Facebook
  App Review and Chrome Web Store submission).

## Known limitations of this MVP

- Phase 3 features (bulk CSV scheduling, Instagram cross-posting, approval
  workflows) are not implemented; `getPageInsights()` exists in
  `facebook-api.js` but isn't wired into the UI yet.
- The "policy scanner" in `content-checks.js` is a small heuristic keyword list,
  not a replacement for Facebook's own moderation.
- Link-preview validation (`checkLinkPreview`) is best-effort and will frequently
  fail silently for sites with strict CORS policies, since the request is made
  directly from the browser with no backend to proxy around CORS.
