# Page Push submission layer

Page Push fills high-stakes forms the person already has open. Facebook stays a separate proof of concept. The offers in this package are a **Hackathon Submission Sprint** ($25, one project pack across the hackathon forms on screen) and an **AppSumo Application Service** ($200, one partner listing).

A run has four steps:

1. The person signs in and opens the submission form.
2. `planDevpost` or `planAppSumo` reads that page and builds a plan from the pack.
3. `executeDraft` writes the draft. Invites, the terms checkbox, and submit are not in this step.
4. The phone shows `plan.preview`. `approve(plan)` is the tap. `executeCommit` checks that hash, re-reads the draft, then runs the commit actions.

The shim writes a draft in one pass. Anything that sends email, accepts terms, or submits waits for that tap. Devpost's reCAPTCHA stays on the page until the person solves it. A confirm token does not clear it, and a token for one hackathon does not submit another.

Files the browser will not accept from a script (thumbnails, the AppSumo hero, screenshots, redemption-code CSVs) stay on the file input. Attach them before commit. The shim does not read or store codes, licensing private keys, or account passwords. Trust-signal URLs (Stripe ARR, company LinkedIn, G2, Capterra) stay manual. Headquarters, categories, and "alternative to" values have to be chosen from the options already on the page.

## Layout

| Path | What it is |
| --- | --- |
| `schemas/schema_devpost.json` | Hackathon field map, limits, and the $25 offer |
| `schemas/schema_appsumo.json` | Listing field map, `writesTo` paths from the AppSumo brief, and the $200 offer |
| `examples/` | A Northline pack for each platform |
| `src/shims/devpost.ts` | Plan a page, or a sprint across several open hackathon pages |
| `src/shims/appsumo.ts` | Plan the partner editor, plus `renderListingPaste` when the editor is not open |
| `src/plan.ts` | Label binding, limits, and the plan hash |
| `src/execute.ts` | Draft, phone confirm, commit |

AppSumo also documents an official MCP at `https://appsumo.com/mcp/` (`update_submission`). `writesTo` on each field is the path that tool expects. This package fills the editor that is already open. It does not call the MCP.

## Binding

Controls are found by their visible label, the same strings Devpost's help center and the AppSumo listing brief publish. Devpost does not publish input `name` attributes, so the shim does not depend on them. An unknown required question on a hackathon page blocks that page until the pack has an answer. An optional unknown question is left alone and named in `plan.warnings`.

Repeated rows (pricing tiers, feature stories, FAQ pairs) are the nearest `fieldset`, `tr`, `li`, or element marked `data-tier`, `data-feature`, `data-story`, or `data-faq` around the labelled input. The shim clicks the section's add button (`Add tier`, `Add feature`, `Add story`, `Add FAQ`) until the row count matches the pack. It does not invent a row the page refused to add.

Tag widgets get each value and an Enter key. Taxonomy widgets get a click on the matching option. If the option is not in the list, the field is left empty.

## Limits that bite

Devpost, from the help center (checked October 2026):

- Project name, 60 characters.
- Hackathon tagline, 140 characters, tightened when the live input's `maxlength` is lower. The portfolio elevator pitch is a different cap and is not this sprint.
- Built with, 1 to 25 tags.
- Demo video, a public `https` URL on YouTube, Vimeo, or Youku. The participant-facing error is "Must be a valid YouTube, Vimeo, or Youku url."
- Project story is one markdown field. `project.storySections` is composed under the headings Devpost already prompts: Inspiration, What it does, How we built it, and the rest.
- Teammate invites send email, so they are commit actions.

AppSumo, from the listing brief:

- Product name 3–50, tagline 3–100, unique selling proposition 15–40, intro up to 205, exactly two TL;DR bullets of up to 128 characters and at least three words.
- 2–4 feature stories. Pricing is Codes or Licensing, 1–10 tiers, prices from $1 to $9,999. An entry tier over $49 is a warning, not a block.
- Founder narrative is at least two paragraphs. Founded is a full day (`YYYY-MM-DD`), not a year.
- Copy warnings follow the brief's voice rules: no em dash, no exclamation mark, no emoji, and none of the filler words listed in the schema.
- `renderListingPaste` returns the brief's markdown shape plus any submit-time gaps. Images are named as "attach in the Media section." The shim does not pretend it uploaded them.

## Use

```ts
import { approve, executeCommit, executeDraft, planDevpost } from "./src/index.ts";

const plan = planDevpost(document, pack, pageUrl);
const draft = executeDraft(document, plan);
if (draft.unconfirmed.length === 0 && plan.errors.length === 0) {
  // plan.preview is the phone screen. approve() is what the tap handler calls.
  executeCommit(document, plan, approve(plan));
}
```

`planDevpostSprint` does the same across `{ url, document }[]` for forms the person already opened. Each hackathon has its own terms flag and its own confirm. The sprint does not sign in, does not create the project, and does not walk a hackathon index.

Check the label strings against a live logged-in page before using a plan on a real account. The fixtures in `test/` are the label contract from the published docs, not a copy of Devpost's or AppSumo's markup.

## When a write or a draft fails

`executeDraft` keeps going if one field does not stick or throws. That field id is in `unconfirmed`. Pass `{ trace }` to record phase, code, and field id. The trace does not store what was written.

`executeCommit` still refuses the whole commit on the first failure. `CommitRefused.applied` lists commit actions that already ran, so a later failure still tells you which invites went out. Fix the page before tapping confirm again.

If AppSumo fields come back unconfirmed, `recoverListing` returns the same markdown as `renderListingPaste` plus a `paste-fallback` warning. `renderDevpostPaste` is the hackathon copy block for the same situation. Neither one clicks submit.

## Local Qwen3 draft

Copy drafts can come from a Candle runner pinned to Hugging Face `Qwen/Qwen3-0.6B-GGUF`, file `Qwen3-0.6B-Q8_0.gguf` (Q8_0, 639,446,688 bytes, the only GGUF in that repo). The tokenizer is `Qwen/Qwen3-0.6B` `tokenizer.json`. Checksums and revisions are in `models/qwen3-0.6b-q8.json`. The weights are not in git.

```bash
npm run model:pull
rustup toolchain install stable --profile minimal
npm run model:build
```

`npm run model:build` compiles `native/candle-drafter` with Rust 1.88 or newer (the crate's `rust-toolchain.toml` selects stable). The binary reads the GGUF through Candle's quantized Qwen3 loader, samples greedily, and stops when the reply contains one JSON object.

`draftCopy` asks the local process for JSON, then checks length, voice, and that every content word, URL, email, date, and dollar amount already appeared in the facts. A slogan such as "reliable and affordable" is rejected when those words are not in the facts. A timeout, a missing file, invalid JSON, or a rejected field falls back to sentences from those facts. Facts that look like a private key, an API key, or redemption codes are not sent. The drafter does not fill the page and does not call `executeCommit`. Headquarters, taxonomy slugs, and prices stay in the pack you typed. `PAGE_PUSH_QWEN_SMOKE=1 npm test` runs one real completion when the weights and the release binary are both on disk. Ordinary `npm test` does not.

```ts
import { candleRunner, draftCopy } from "./src/index.ts";

const draft = await draftCopy({
  platform: "appsumo",
  facts: "Northline tracks retainer hours for agencies. Clients see burn before the month ends.",
  fields: [
    { id: "tagline", maxLength: 100, minLength: 3 },
    { id: "usp", maxLength: 40, minLength: 15 },
  ],
}, candleRunner());
```
