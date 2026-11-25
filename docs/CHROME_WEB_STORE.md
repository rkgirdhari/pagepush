# Chrome Web Store submission notes (v1.0.0)

Copy for the Developer Dashboard. Every statement here matches `manifest.json`,
`PRIVACY_POLICY.md`, and the code; `npm run lint` fails the build if the manifest's permissions
drift from this list.

## Single purpose

> Page Push helps a person set up and update a Facebook Business Page they manage: it drafts the
> details from a client pack into the Facebook form the person has open, and the person reviews
> the page and clicks Approve & Commit before anything is created, saved, or posted.

## Short description (132 characters max)

> Manual-assist form fill for Facebook Business Page setup. You review every draft and approve before anything is saved or posted.

## Listing description

> Page Push is a side panel for people who set up Facebook Business Pages for clients. Fill in a
> client pack once (Page name, categories, bio, contact details, hours, action button, launch
> post), open the Facebook Page view in your own signed-in browser, and Page Push drafts those
> details into Facebook's form.
>
> Nothing is created, saved, or posted until you read the page and click Approve & Commit. Each
> approval is tied to the exact plan you reviewed and is used once. If a field changes after
> drafting, a captcha appears, or a required photo is missing, Page Push refuses and tells you why.
>
> - Works on Facebook Business Page creation, About details, the action button, and the Page post composer.
> - Three sprint tiers: Essentials, Standard Business, and Full Launch + Post.
> - Optional bio and launch-post drafting: offline from your facts, or with a model running on your own computer through Ollama.
> - Downloadable sprint receipt for each client: what was drafted, what was committed, and when you approved it.
> - Everything stays in your browser's local storage. Clear All Local Data erases it.
>
> Page Push is a form-fill assistant, not an automation bot. It never signs in for you, never
> stores passwords, never runs in the background or on a schedule, never posts through an API, and
> never imitates human typing. It is not affiliated with or endorsed by Meta.

## Permission justifications

| Permission | Justification for the dashboard |
| --- | --- |
| `sidePanel` | The whole user interface is a side panel: the client pack editor, the plan of what will be drafted on the open Facebook view, the pre-flight checklist, the Approve & Commit button, and the sprint receipt download. |
| `storage` | Saves the client pack, the current plan and progress, the checklist, sprint receipt entries, and the chosen local model name in `chrome.storage.local` so work survives closing the panel. Nothing is synced (`chrome.storage.sync` is never used) and nothing leaves the device. |
| Host `https://*.facebook.com/*` | The content script reads the labels and fields of the Facebook Business Page form the user has open, drafts the pack values into it, checks they stuck, watches for edits after drafting, and clicks Facebook's Save / Post / Create a Page button once when the user approves. It runs only on facebook.com. |
| Host `http://localhost:11434/*`, `http://127.0.0.1:11434/*` | Optional. When the user clicks Check / Load Model or Draft Copy with Ollama, the side panel calls the Ollama server running on the user's own computer to list, download, load, and run a local model for drafting the Page bio and launch post. These addresses are the user's own machine, not a remote service. |

No other permissions: no `tabs`, `scripting`, `downloads`, `nativeMessaging`, `alarms`,
`identity`, `cookies`, or optional permissions. The receipt download uses a `data:` link, which
needs no permission.

## Remote code

> No. All JavaScript is bundled in the package. The extension does not load or evaluate remote code
> (`npm run lint` rejects `eval`, `new Function`, and network calls outside the local Ollama client).

## Data use disclosures

What the dashboard asks, and the answers:

| Data type | Collected? | Notes |
| --- | --- | --- |
| Personally identifiable information | No (not transmitted) | The client pack can hold a business phone, email, and address. It stays in `chrome.storage.local` on the user's device and is typed into Facebook only when the user approves. |
| Health, financial, authentication information | No | Packs that look like they hold a password, key, or token are refused. |
| Personal communications | No | |
| Location | No | A business address in the pack is user-entered and stays on the device. |
| Web history | No | |
| User activity | No | No analytics, clicks, or keystroke logging. |
| Website content | No (not transmitted) | Facebook form labels and values are read on the open tab to draft and verify; they are not stored beyond the plan and not sent anywhere. |

Certifications to tick:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

"Collected" here follows the store's definition (transmitted off the device). Page Push transmits
nothing off the device. The only network calls go to the user's own `localhost:11434` when the user
clicks an Ollama button; that server is software the user installed and controls.

## Privacy policy URL

Host `PRIVACY_POLICY.md` at a public URL (for example the repository's GitHub Pages site or a raw
link on the default branch after the release is merged) and paste it into the dashboard. The
listing must link the same version that ships.

## Screenshots to capture (1280 x 800)

1. The client pack with the tier picker.
2. The plan inspector on a Facebook About editor (sanitized test Page).
3. The drafted Facebook form beside the panel, before approval.
4. Approve & Commit enabled after the review tick.
5. The sprint receipt download and the Ollama drafting card.

Use a test Business Page; blur or avoid any real names and contact details.

## Reviewer notes (for the "notes to reviewer" field)

> To test: sign in to Facebook, open a Business Page you manage (or facebook.com/pages/creation/
> on a personal profile), open the Page Push side panel, click "Start a blank pack", fill in a Page
> name and category, then Plan → Draft. Nothing is saved until you tick "I read every drafted
> field" and click Approve & Commit. Ollama is optional; without it, "Draft from facts (offline)"
> works with no setup.
