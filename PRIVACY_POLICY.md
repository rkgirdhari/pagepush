# Page Push Privacy Policy

_Version 1.0.0. Last updated: 2026-11-25._

Page Push ("the extension") is a manual-assist browser extension. It helps a person fill in the
setup and settings forms of a Facebook Business Page that they already administer and have open in
their own browser. Draft writes values into Facebook's form before approval. Page Push clicks a
final Save, Post, or Create a Page control only after the person reviews and approves the plan;
Facebook's own handling of form data is outside the extension's control.

Page Push has no server. The developer receives no data from it.

## What the extension stores, and where

The extension stores the data below in this browser's local extension storage
(`chrome.storage.local`). Page Push does not use `chrome.storage.sync` to sync it to your Google
account or other devices. Copies exported by you and data handled by Facebook or Ollama are separate.

| Data | Why |
| --- | --- |
| The client pack: Page name, categories, bio, website, phone, email, address, city, ZIP, hours, action button, launch post text, and whether the profile and cover photos are required | The values you want drafted into the Facebook form |
| Up to 20 saved client-pack versions, including pack values and save times | Lets you restore a previous pack; the current pack is saved before a restore unless it matches the newest snapshot |
| The current plan, including planned values and previews, its hash, and per-field progress (drafted or attempted, with times and the page address) | Lets Approve & Commit check that the page still matches what you reviewed, and resume after the panel reloads. Older records may say committed but are unverified |
| The pre-flight checklist (page reviewed, profile picture and cover photo uploaded) | Gates Approve & Commit |
| Sprint receipt entries, including plan hash, approval and completion times, tier, redacted Facebook page address, view type, field IDs and labels, checklist, outcome and any refusal code and message | A record of attempted, partial or refused actions, not confirmation by Facebook; see "Sprint receipts" |
| Archived prior-pack progress and receipt entries, with the Page name and tier when known | Keeps earlier records separate when a pack is replaced; older records may have unknown or mixed ownership |
| The name of the local Ollama model you chose, if you use Ollama | Remembers your choice |

## What the extension never does

- It does not read or fill Facebook sign-in fields, two-factor codes, session cookies, or access tokens.
  You sign in to Facebook yourself. Do not enter credentials in a pack: pack fields and saved
  versions are stored locally as entered. A best-effort check blocks planning and local-model
  drafting when it recognizes credential-like text, but it cannot identify every secret.
- It is designed for Business Pages, not personal profiles or timelines. Outside Facebook's Page
  creation screen, it checks for the pack's Page name and Page-admin signals and refuses views that
  fail those checks. These checks do not independently verify ownership or authorization; confirm
  you are on the intended Page you manage before drafting and approving.
- It does not click Facebook's final Save, Post, or Create a Page controls without your click on
  **Approve & Commit** for that plan. One click approves one commit; it cannot be replayed.
- It does not run on a schedule or in the background, and it does not imitate human typing,
  randomize its timing, or hide that a tool is filling the form.
- It does not upload images. You attach profile pictures and cover photos yourself.
- It does not send analytics, telemetry, or crash reports to the developer. Facebook may receive
  information entered into its own page; optional Ollama requests go to your local Ollama server.
- The developer does not sell or rent your data. Selected pack values are written into Facebook's
  page, and optional model requests are sent to the local Ollama server as described below.
- It does not load or run remote code.

## What the extension reads

On `facebook.com` pages, the content script reads the form labels, field values, buttons,
and option lists of the page you have open, so it can match them to your pack, verify what was
drafted, and notice if a field changes after drafting. It does not inspect other tabs, browsing
history, messages, or friends lists as a feature, and it keeps none of the page content beyond
the plan and progress described above.

When you click **Draft**, values are entered into Facebook's own form in your tab; Facebook may
process them at that point. When you click **Approve & Commit**, Page Push attempts the applicable
Save, Post, or Create a Page action. Confirm the outcome on Facebook, which handles data under its
own [Privacy Policy](https://www.facebook.com/privacy/policy/).

## Optional local Ollama

If you run [Ollama](https://ollama.com) on your computer, the side panel can draft the Page bio and
launch post with a model there (by default `qwen3`). It does so only when you click **Check / Load
Model** or **Draft Copy with Ollama**, and only over `http://localhost:11434` (or `127.0.0.1`) on
your own machine:

- **Check / Load Model** asks Ollama for its version and installed models, asks Ollama to download
  the chosen model if it is missing (Ollama fetches it from its own model library), and loads it.
- **Draft Copy with Ollama** sends these pack facts to the local model: Page name, categories, bio,
  launch notes, website, city, action button (including its URL), and hours mode. The separate phone,
  email, and street-address fields are not included, but information entered in the included fields
  can be sent. A best-effort check blocks model drafting when the pack matches known credential
  patterns; do not rely on it to detect every secret.

The drafted copy goes into your pack for you to read and edit. After you plan the view, **Draft**
can write it into Facebook's form before final approval, and Facebook may process it at that point.
**Approve & Commit** attempts the final action; confirm the outcome on Facebook. With Ollama stopped
or not installed, **Draft from facts (offline)** builds copy from your pack without a model or network.

## Sprint receipts

After an approval reaches the commit step, a local sprint receipt can record an attempted, partial,
or refused outcome. A click that fails an earlier verification may not be recorded. An attempt is
not proof Facebook saved, created, or published anything; check Facebook directly and do not retry
blindly, particularly after an uncertain or partial result. Legacy committed entries are exported
as attempted, not confirmed.

**Download sprint receipt** saves a JSON file on your computer. It includes the Page name when
attributable, plan hashes, timestamps, tier, field IDs and labels, checklist and any refusal code
and message. Its redacted Facebook URL keeps the path and `id` and `sk` query parameters, so it may
contain a Page ID. Drafted field values are not separately included, but the Page name, URL, labels,
and unredacted refusal text can contain identifying or other sensitive information. Review a receipt
before sharing it. Its SHA-256 checksum can detect accidental changes; it is not a signature and can
be recomputed. Exported files are ordinary files; you decide who receives them.

## Permissions and why

- `sidePanel`: shows the pack editor, plan inspector, checklist, Approve & Commit, and receipt export.
- `storage`: keeps the data listed above in `chrome.storage.local`.
- Host access to `https://*.facebook.com/*`: lets the content script read and fill the Business Page
  form you have open. It runs only on Facebook.
- Host access to `http://localhost:11434/*` and `http://127.0.0.1:11434/*`: lets the side panel reach
  a local Ollama on your own computer when you click an Ollama button. These are not remote servers.

## Deleting your data

When you start a blank pack, import or restore a pack, or change its Page name, existing progress
and receipts are archived locally under the prior pack when present. Archived progress can be
viewed and archived receipts downloaded. Older records without reliable ownership are marked unknown
and may be mixed. In the receipt section, click **Clear current progress and receipts** twice to
clear the current records only; this leaves the pack, plan, checklist, saved versions, and archives.
There is no control to delete an individual archive.

To remove all extension data, wait for other panels' work to finish and close those Page Push
panels/windows first. Then click **Clear All Local Data** in the remaining panel twice and keep the
other panels closed until it finishes. On success, it clears this extension's local storage,
including packs, versions, plans, progress, checklists, receipts, archives, and settings. Each panel
has its own write queue: another open panel can write stale data back after clearing, so multi-panel
erasure is not guaranteed. If clearing fails, retry.
A Facebook action already dispatched may still finish; check Facebook directly. Uninstalling the
extension also removes its storage. Downloaded receipt and pack JSON files are ordinary files on your
computer; delete them separately. Models downloaded with Ollama are managed by Ollama
(`ollama rm <model>`). Clearing local extension data does not erase data already handled by Facebook.

## Children

Page Push is a business tool and is not directed at children.

## Changes to this policy

This document and its "Last updated" date change whenever Page Push's data handling changes. The
change is also listed in `CHANGELOG.md`.

## Contact

Questions about this policy should go to the Page Push publisher. A public publisher contact has not
yet been provided; it must be added before the extension is submitted to the Chrome Web Store.
