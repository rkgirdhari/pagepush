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
