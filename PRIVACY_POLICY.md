# Page Push Privacy Policy

_Status: draft for v1.0.0. Finalized in Phase 7 once the receipt export and Clear All Local Data controls ship._
_Last updated: 2026-11-25_

Page Push ("the extension") is a manual-assist browser extension. It helps a person fill in the setup and settings forms of a Facebook Business Page that they already administer and have open in their own browser. Every change it makes is a draft until that person reviews it and clicks **Approve & Commit** in the side panel.

## What the extension stores

Page Push has no backend server. Everything below stays on your device, in the browser's local extension storage (`chrome.storage.local`). It is never written to `chrome.storage.sync` and never sent to us.

| Data | Where it lives | Why |
| --- | --- | --- |
| Project packs (Page name, category, bio, contact details, hours, call-to-action, launch post text) | `chrome.storage.local` | The values you want drafted into the Page form |
| The active plan and its hash | `chrome.storage.local` and the open tab's memory | Lets Approve & Commit check that the page still matches what you reviewed |
| Sprint receipts (plan hash, timestamps, tier, page URL, field ids drafted and committed, media checklist status) | `chrome.storage.local`, and a JSON file only when you click export | A delivery record for the person who ran the sprint |
| Side panel preferences (including the chosen local Ollama model name) | `chrome.storage.local` | Remembers your choices between sessions |

## What the extension never does

- It does not read, store, or fill passwords, two-factor codes, or other sign-in credentials. You sign in to Facebook yourself.
- It does not post to personal profiles or timelines. It only acts on Facebook Business Page setup and settings views.
- It does not publish, save, or submit anything without your click on **Approve & Commit** for that exact plan.
- It does not run on a schedule or in the background, and it does not mimic human typing or hide that a tool is filling the form.
- It does not upload images for you. Profile pictures and cover photos are attached by you; the side panel only tracks a checklist.
- It does not send analytics, telemetry, crash reports, or page content to any server. The only network address it calls on its own behalf is a local Ollama on your own computer, and only when you click an Ollama button (see below).
- It does not sell or share data with third parties.

## What the extension reads

On `facebook.com` pages, the content script reads the visible form labels, field values, and option lists of the page you have open, so it can match them to your project pack and verify what was drafted. It does not read other tabs, your browsing history, or messages.

When you click **Approve & Commit**, the values you approved are entered into Facebook's own form in your tab. Facebook then handles them under its own [Privacy Policy](https://www.facebook.com/privacy/policy/).

## Optional local copy drafter

If you install the optional local drafter (a separate program that runs a small language model on your computer), the side panel can send the facts you typed to that program through Chrome's native messaging. The program runs on your computer, does not use the network, and returns suggested copy that you review before it goes into a pack. Facts that look like keys, passwords, or codes are not sent. If the drafter is not installed, Page Push uses its built-in, rule-based fallback and nothing leaves the browser.

## Optional local Ollama

If you run [Ollama](https://ollama.com) on your computer, the side panel can draft the Page bio and launch post with a model there (by default `qwen3`). This happens only when you click **Check / Load Model** or **Draft Copy with Ollama**. The side panel then talks to `http://localhost:11434` on your own machine: it lists installed models, downloads the chosen model through Ollama if you asked it to load one that is missing (Ollama fetches it from its own model library), loads it into memory, and sends the pack facts (Page name, categories, bio, launch notes, website, city, action button, hours) for drafting. Nothing is sent to Page Push or any other server. Packs that look like they hold a password, key, or token are not sent. The drafted copy goes into your pack for you to read and edit; it reaches Facebook only after you plan the view, draft it, and click **Approve & Commit**. With Ollama stopped or not installed, **Draft from facts (offline)** builds the copy from your pack with no model at all.

## Permissions and why

- `sidePanel`: shows the pack editor, plan preview, and Approve & Commit controls.
- `storage`: keeps packs, plans, and receipts in local extension storage.
- Host access to `https://*.facebook.com/*`: lets the content script read and fill the Business Page form you have open.
- Host access to `http://localhost:11434/*` and `http://127.0.0.1:11434/*`: lets the side panel reach a local Ollama when you click an Ollama button. It is your own computer, not a remote server.
- `nativeMessaging` (only if the optional drafter ships in this build): talks to the local drafter program on your computer.

## Deleting your data

Click **Clear All Local Data** in the side panel to erase everything Page Push stored. Uninstalling the extension also removes its local storage. Exported receipt files are ordinary files on your computer; delete them like any other file.

## Changes to this policy

This document and its "Last updated" date change whenever Page Push's data handling changes.

## Contact

Questions about this policy can go to the developer contact listed on the Chrome Web Store page for Page Push.
