# Page Push Privacy Policy

_Last updated: 2026-10-28_

Page Push ("the extension", "we") is a browser extension that helps you publish, draft,
and schedule content to Facebook Pages you administer. This policy explains what data
the extension handles and why.

## What we collect

**We do not operate a backend server for the MVP.** Everything below is stored only on
your own device, inside your browser's local extension storage (`chrome.storage.local`),
and is never transmitted to us.

| Data | Where it lives | Why |
| --- | --- | --- |
| Facebook Page access tokens | Encrypted locally (AES-256-GCM) in `chrome.storage.local` | Required to publish/draft/schedule posts via the Facebook Graph API |
| Post text & images you compose | Local storage, in memory during the session | Lets you edit, preview, and submit a post |
| Post history (what/when you posted) | Local storage | Powers the History tab and frequency-cap warnings |
| Saved templates | Local storage | Powers the Templates tab |
| Settings (plan tier, preferences) | Local storage | Remembers your choices between sessions |

## What we never do

- We do not log, transmit, or store your post content on any server we control.
- We do not sell or share data with third parties.
- We do not read content from tabs other than the one you actively capture from.

## Third-party data flow

When you choose to **Post Now**, **Save Draft**, or **Schedule**, the formatted text
and/or image you approved is sent directly from your browser to Facebook's Graph API
(`graph.facebook.com`) using your Page access token. Facebook's own
[Data Policy](https://www.facebook.com/privacy/policy/) governs what happens to that
content once it reaches Facebook's servers.

## Permissions we request and why

- `activeTab` / content scripts on supported AI-chat and editing sites — to detect and
  capture text/images you choose to push.
- `storage` — local, encrypted storage of tokens, history, templates, and settings.
- `contextMenus` — the "Push to Page" right-click action on selected text.
- `identity` — to run the Facebook OAuth login flow.
- `alarms` — to fire scheduled posts and periodic token-expiry checks.
- Host permission for `facebook.com` — required to call the Graph API and complete OAuth.

## Data deletion

Uninstalling the extension, or clicking "Disconnect" for a Page in Settings, removes
the corresponding encrypted tokens from local storage immediately. Clearing your
browser's extension storage removes everything else (history, templates, settings).

## Changes to this policy

We will update this document and its "Last updated" date whenever our data practices
change, and will not reduce protections for previously collected data without notice.

## Contact

Questions about this policy can be directed to the developer contact listed on the
Chrome Web Store listing for Page Push.
