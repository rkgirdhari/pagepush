# Chrome Web Store submission notes (v1.0.0)

Copy for the Developer Dashboard. Every statement here matches `manifest.json`,
`PRIVACY_POLICY.md`, and the code; `npm run lint` fails the build if the manifest's permissions
drift from this list.

## Single purpose

> Page Push helps a person set up and update a Facebook Business Page they manage: it drafts
> client-pack details into the open Facebook form, where Facebook may process them before approval.
> The person reviews and clicks Approve & Commit before Page Push attempts a final Save, Post, or
> Create action. The person must verify the result on Facebook.

## Short description (132 characters max)

> Manual-assist form fill for Facebook Business Pages. Review the draft and approve each final action.

## Listing description

> Page Push is a side panel for people who set up Facebook Business Pages for clients. Fill in a
> client pack once (Page name, categories, bio, contact details, hours, action button, launch
> post), open the Facebook Page view in your own signed-in browser, and Page Push drafts those
> details into Facebook's form.
>
> Draft enters values into Facebook's form before approval, and Facebook may process them then.
> Only after you review and approve the plan does Page Push attempt a final Save, Post, or Create
> action. Attempts do not prove Facebook saved or published anything: check Facebook directly and
> do not retry blindly after an uncertain result. Each approval is tied to the reviewed plan and
> used once.
>
> - Designed for Facebook Business Page creation, About details, the action button, and the Page post composer; live end-to-end verification is still pending.
> - Three sprint tiers: Essentials, Standard Business, and Full Launch + Post.
> - Optional bio and launch-post drafting: offline from your facts, or with a model running on your own computer through Ollama; a real Ollama check is still pending.
> - Save and restore up to 20 client-pack versions locally. Restoring a version requires a fresh plan.
> - Download a sprint receipt with the Page name when attributable, a Facebook URL that may contain a Page ID, field labels, approval details, and possible refusal text. Review it for sensitive information before sharing.
> - Prior-pack progress and receipts are archived locally. Clear All Local Data removes archives and pack versions; downloaded files must be deleted separately. Close other Page Push panels/windows before clearing, as another panel can write stale data back.
>
> Page Push is a form-fill assistant, not an automation bot. It never signs in for you, never
> reads Facebook sign-in fields, never runs on a schedule, never posts through an API, and
> never imitates human typing. It is not affiliated with or endorsed by Meta.

## Permission justifications

| Permission | Justification for the dashboard |
| --- | --- |
| `sidePanel` | The whole user interface is a side panel: the client pack editor, the plan of what will be drafted on the open Facebook view, the pre-flight checklist, the Approve & Commit button, and the sprint receipt download. |
| `storage` | Saves the client pack, saved pack versions, the current plan (including values), progress, checklist, current and archived receipt/progress records, and chosen local model name in `chrome.storage.local` so work survives closing the panel. This storage is not synced (`chrome.storage.sync` is never used). |
| Host `https://*.facebook.com/*` | The content script reads the labels and fields of the Facebook Business Page form the user has open, writes draft pack values into it before final approval, checks the draft, watches for edits, and attempts Facebook's Save / Post / Create a Page control only when the user approves. Facebook's acceptance is not verified. It runs only on facebook.com. |
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
| Personally identifiable information | Publisher must verify disclosure | The pack may contain a business phone, email, and address and is stored locally. Draft enters selected values into Facebook's form before final approval; Facebook may process them. |
| Health, financial, authentication information | No intended collection | Do not enter credentials in a pack. Pack fields are stored locally as entered; a best-effort check blocks recognized credential patterns from planning and model drafting. |
| Personal communications | Publisher must verify disclosure | The pack can contain user-entered launch-post text; the extension does not use Facebook messages as a feature. |
| Location | Publisher must verify disclosure | A user-entered business address and city may be stored in the pack and written into Facebook's form before approval; Facebook may process them. |
| Web history | No intended collection | The extension does not use browser history; plans and progress can include the current Facebook page URL. |
| User activity | Publisher must verify disclosure | No analytics or general clicks/keystroke logging. The extension stores draft/attempt progress, approval times and checklist state. |
| Website content | Publisher must verify disclosure | Facebook form labels and values are read to plan and verify; the plan and receipts may retain labels, URL, planned values, or refusal text. Selected pack values are written into Facebook's form. |

Certifications for the publisher to review before ticking in the dashboard:

- [ ] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [ ] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [ ] I do not use or transfer user data to determine creditworthiness or for lending purposes.

These are draft answers for the publisher to verify against the current Chrome Web Store disclosure
definitions. Pack data is stored locally; the extension writes selected values into Facebook's
page, which may send them to Facebook. Optional network calls go to the user's own
`localhost:11434` when the user clicks an Ollama button.

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
> name and category, then Plan → Draft. Draft enters values into Facebook's form before approval;
> Facebook may process them. After ticking "I read every drafted field", click Approve & Commit to
> attempt the final action. Verify the outcome on Facebook; do not retry blindly if uncertain.
> Ollama is optional; without it, "Draft from facts (offline)" works with no setup. Live Facebook
> end-to-end and real Ollama runs remain release checks.
