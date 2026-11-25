# Facebook DOM research

Source: `extension/content_facebook.js` on `cursor/page-push-extension-d6cb` (`56840ea`, also tagged `extension-v1.0.0`). That script is not carried forward as code. This note keeps what it learned so the Facebook shim can use it inside the engine. The original file stays readable with:

```bash
git show 56840ea:extension/content_facebook.js
```

## What the script actually contains

It is a generic page distiller, not a map of the Business Page setup form. It has no Facebook-specific labels (no "Page name", "Category", "Bio", "Hours", and so on). The Facebook knowledge in it is about **how** to write into Facebook's controls, not **where** those controls are. Label strings for the shim still have to come from live, logged-in captures (Phase 5).

## Candidate controls

The distiller collected, in order:

```text
div[contenteditable="true"][role="textbox"]
input:not([type="hidden"])
textarea
[role="button"]
button
a[role="link"]
```

Notes for the engine:

- `bind.ts` already collects `input, textarea, select, button, [contenteditable='true'], [role='combobox']`. Facebook needs `[role="button"]` (most Facebook buttons are `div`s) and `[role="textbox"]` added, and the Lexical selector above should be treated as the rich-text composer.
- The script keyed each control by `aria-label`, then `placeholder`, then visible text (first 80 characters). Facebook rarely uses `<label for>`, so `placeholder` should be added as a label source for the Facebook shim.
- It skipped elements smaller than 4×4 px, `visibility: hidden`, `display: none`, or opacity ≤ 0.05, except file inputs (which Facebook hides behind a button).
- It capped the map at 60 nodes. The engine should not cap; it binds by label instead.

## Writing into Lexical composers

Setting `textContent` or `innerText` on a Lexical `contenteditable` changes the DOM but not Lexical's editor state, so the text is lost on the next render or on submit. The script's approach:

1. `scrollIntoView`, then `focus()`.
2. Select all of the editor's contents with a `Range` on `window.getSelection()`.
3. `document.execCommand("insertText", false, text)`, which goes through the browser's input pipeline and fires `beforeinput`/`input` that Lexical listens to.
4. If `execCommand` returns `false`, dispatch a synthetic `ClipboardEvent("paste")` carrying a `DataTransfer` with `text/plain`.
5. Dispatch `InputEvent("input", { inputType: "insertText", data: text })`.

The engine's current `setValue` in `src/apply.ts` writes `textContent` for `contenteditable`, which is the failure mode above. Phase 2 replaces it with this sequence, and verification reads the text back after the editor settles (Phase 5).

## Writing into React inputs

React tracks an input's value through an instrumented setter, so `el.value = x` is ignored. The script calls the native setter from `HTMLInputElement.prototype` or `HTMLTextAreaElement.prototype`, then dispatches `input` and `change`, then `blur()`. The engine's `setValue` already uses the prototype setter; it does not `focus()` or `blur()` first, which some Facebook fields need to commit the value.

## Clicks

Buttons got `scrollIntoView` and `el.click()`. The engine's `clickElement` dispatches a `MouseEvent("click")`, which is equivalent for React's delegated handlers.

## Not carried forward

- **Programmatic file upload.** The script built a `File` from a base64 data URL and assigned it to `input.files` through a `DataTransfer`. v1.0.0 keeps avatar and cover uploads manual, tracked by the media pre-flight checklist, consistent with the existing README.
- **Highlight overlay.** It injected a `<style>` tag and an orange outline class. A highlight may return as a side-panel option, but it is not part of binding.
- **Re-scan IDs.** It stamped `data-pagepush-id` numbers that reset on every scan. The engine's `pp-N` element ids, persisted between Draft and Commit (Phase 4), replace this.

## Phase 5 live capture (2026-11-25)

Captured from a logged-in Business Page while acting as the Page, using
`scripts/capture-skeleton.js`. The script keeps only roles, aria attributes, placeholders,
maxlength, input types, and Lexical markers, and redacts the Page name, emails, URLs, phone-like and
long digit runs before anything leaves the page. It never reads cookies, storage, hidden input values,
or form contents. Editors were only opened and then cancelled; nothing was saved, posted, or typed
except one category search query that was discarded. Fixtures in `test/fixtures/facebook/` are
structural rebuilds of those skeletons with the Page renamed to the fictional "Northline Studio".

| View | What the live DOM showed | What changed in Page Push |
| --- | --- | --- |
| Business Dashboard (`/professional_dashboard/`) | `h1 "Business Dashboard"`; the Page name only as link text and the greeting `h2 "Hi <Page>"`; top nav link `aria-label="Business Dashboard"`. No fillable fields. | "Business Dashboard" and "Manage Page" added to `pageSignals`; the guard accepts the "Hi <Page>" greeting as Page identity. |
| Composer (`/post/create`) | No heading elements. `role=main` whose first text is "Create post"; `div[role=textbox][contenteditable][data-lexical-editor]` labelled "What's on your mind, <Page>?" inside `role=form "Posts"`; `div[role=button][aria-label=Post]` outside the form, `aria-disabled` until there is text. "Boost post" and "Add AI label" are `role=switch`. | The shim adds the Page-named prompt as a label; the guard accepts it as Page identity; `role=main` and `role=form` count as sections, and an unlabelled `main`/`dialog` is named by its first text; commit buttons that are only `aria-disabled` are planned and commit waits for them to enable (or refuses). |
| Page profile (`profile.php?…&sk=about`) | `h1 "Manage Page"` with the Page name as `h2`; "Business Dashboard", "Edit profile", "Advertise", "Meta Business Suite", "Settings". | Covered by the signals above. |
| About > Intro > Edit bio | `<label>` "Introduce yourself" wrapping `<textarea maxlength=255>`; Save is `div[role=button][aria-label=Save]`, disabled until edited. | Bio label added; cap raised from the guessed 101 to the verified 255. |
| About > Category | `input[role=combobox][type=search][aria-label=Categories]` with `aria-controls` → `role=listbox` → `role=option[aria-selected]`; picked values in `span[role=list][aria-label="Selected values"]` with "Remove <name>" buttons; counter "1/3 categories". | Chips are recognised by the Remove button / Selected values list; an already-picked category no longer fails the taxonomy check. |
| About > Links | "Websites, blogs, portfolios" opens `<label>` "Link" → `input[type=text]`, "Link description" (maxlength 150), "Add link". | "Link" added to website labels. |
| About > Contact info | Each item is an add button that opens an inline editor. Phone: `<label>` "Phone number" → `input[type=text]` plus a separate menu button `aria-label="Country code, US+1"`. Email: `<label>` "Email" → `input[type=text]`. | When the pack phone starts with the picker's code, the shim drops it and warns; a different code is warned, not changed. |
| About > Details > Address | "Address" (text), "City/Town" is `input[role=combobox][type=search]`, "ZIP" `maxlength=12`, "Neighborhood", map. Hours: "Add your business address first before adding business hours". | City/Town is never typed into (a typed value would read back but not save); it is listed for the person to pick. ZIP cap confirmed. Hours unverified. |
| Add action button | Profile "…" menu → intro modal ("Try It") → dialog "Action button": 15 `div[role=radio]` rows (title + description run together), each with a nested `role=radio` indicator `aria-labelledby` its title; groups are `role=list`. Two steps: Next → `<label>` "Add website link" → Save. | Nested indicator radios are skipped; option names come from `aria-labelledby`; the dialog itself can be the radio group; labels "Choose an option", "Add website link", and scope "Action button" added. The person clicks Next; Page Push re-plans the link step. |

Not captured: the Page creation view. `/pages/create` and `/pages/creation` both answer "This content
isn't available right now" while acting as a Page; it needs the personal profile, so `pageName`,
`createPage`, and the create-view labels remain the Phase 2 guesses. The launch post's 63,206
character cap is not exposed by the live editor (no `maxlength`) and stays the published figure.
