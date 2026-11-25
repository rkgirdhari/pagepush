# Page Push Privacy Policy

_Version 1.0.0. Last updated: 2026-11-25._

Page Push ("the extension") is a manual-assist browser extension. It helps a person fill in the
setup and settings forms of a Facebook Business Page that they already administer and have open in
their own browser. Every change it makes is a draft until that person reviews it on the page and
clicks **Approve & Commit** in the side panel.

Page Push has no server. The developer receives no data from it.

## What the extension stores, and where

Everything below stays on your device in the browser's local extension storage
(`chrome.storage.local`). Page Push never uses `chrome.storage.sync`, so nothing is copied to other
devices or to your Google account.

| Data | Why |
| --- | --- |
| The client pack: Page name, categories, bio, website, phone, email, address, city, ZIP, hours, action button, launch post text, and whether the profile and cover photos are required | The values you want drafted into the Facebook form |
| The current plan, its hash, and per-field progress (drafted / committed, with times and the page address) | Lets Approve & Commit check that the page still matches what you reviewed, and resume after the panel reloads |
| The pre-flight checklist (page reviewed, profile picture and cover photo uploaded) | Gates Approve & Commit |
| Sprint receipt entries: for each Approve & Commit, the plan hash, the time you approved, the tier, the Facebook page address without tracking parameters, the view type, which fields were drafted and committed (by name), the checklist as ticked, and any refusal reason | A delivery record for the client; see "Sprint receipts" |
| The name of the local Ollama model you chose, if you use Ollama | Remembers your choice |

## What the extension never does

- It does not read, store, or fill passwords, two-factor codes, session cookies, or access tokens.
  You sign in to Facebook yourself. Packs that look like they hold a credential are refused.
- It does not post to personal profiles or timelines. It refuses views that do not show a Business
  Page you manage, except Facebook's own Page creation screen.
- It does not create, save, publish, or submit anything without your click on **Approve & Commit**
  for that exact plan. One click approves one commit; it cannot be replayed.
- It does not run on a schedule or in the background, and it does not imitate human typing,
  randomize its timing, or hide that a tool is filling the form.
- It does not upload images. You attach profile pictures and cover photos yourself.
- It does not send analytics, telemetry, crash reports, page content, or pack data to any server.
- It does not sell, rent, or share data with anyone.
- It does not load or run remote code.

## What the extension reads

On `facebook.com` pages, the content script reads the visible form labels, field values, buttons,
and option lists of the page you have open, so it can match them to your pack, verify what was
drafted, and notice if a field changes after drafting. It does not read other tabs, your browsing
history, messages, or friends lists, and it keeps none of the page content beyond the plan and
progress described above.

When you click **Approve & Commit**, the values you approved are already in Facebook's own form in
your tab, and Page Push clicks Facebook's Save, Post, or Create a Page button once. Facebook then
handles that data under its own [Privacy Policy](https://www.facebook.com/privacy/policy/).

## Optional local Ollama

If you run [Ollama](https://ollama.com) on your computer, the side panel can draft the Page bio and
launch post with a model there (by default `qwen3`). It does so only when you click **Check / Load
Model** or **Draft Copy with Ollama**, and only over `http://localhost:11434` (or `127.0.0.1`) on
your own machine:

- **Check / Load Model** asks Ollama for its version and installed models, asks Ollama to download
  the chosen model if it is missing (Ollama fetches it from its own model library), and loads it.
- **Draft Copy with Ollama** sends these pack facts to the local model: Page name, categories, bio,
  launch notes, website, city, action button, and hours. Phone, email, and street address are not
  sent. A pack that looks like it holds a password, key, or token is not sent at all.

The drafted copy goes into your pack for you to read and edit. It reaches Facebook only after you
plan the view, draft it, and click **Approve & Commit**. With Ollama stopped or not installed,
**Draft from facts (offline)** builds the copy from your pack with no model and no network.

## Sprint receipts

Each Approve & Commit adds an entry to a local sprint receipt. **Download sprint receipt** saves it
as a JSON file on your computer; nothing is sent anywhere. The receipt names fields but does not
contain their values, and it carries a SHA-256 hash of its own contents so later edits can be
detected. Exported files are ordinary files; you decide who receives them.

## Permissions and why

- `sidePanel`: shows the pack editor, plan inspector, checklist, Approve & Commit, and receipt export.
- `storage`: keeps the data listed above in `chrome.storage.local`.
- Host access to `https://*.facebook.com/*`: lets the content script read and fill the Business Page
  form you have open. It runs only on Facebook.
- Host access to `http://localhost:11434/*` and `http://127.0.0.1:11434/*`: lets the side panel reach
  a local Ollama on your own computer when you click an Ollama button. These are not remote servers.

## Deleting your data

Click **Clear All Local Data** in the side panel, then click it again to confirm. That erases
everything Page Push stored in this browser: packs, plans, progress, the checklist, receipt entries,
and settings. Uninstalling the extension also removes its storage. Downloaded receipt files are
ordinary files on your computer; delete them like any other file. Models you downloaded with Ollama
are managed by Ollama (`ollama rm <model>`).

## Children

Page Push is a business tool and is not directed at children.

## Changes to this policy

This document and its "Last updated" date change whenever Page Push's data handling changes. The
change is also listed in `CHANGELOG.md`.

## Contact

Questions about this policy can go to the developer contact listed on the Chrome Web Store page for
Page Push.
