# Page Push

A local-first Chrome/Edge browser extension that helps you set up and run a
Facebook Business Page, built for Hammurabi Coding Company.

Meta's Graph API deliberately blocks third-party apps from creating Pages or
changing core profile settings, to cut down on spam and abuse. Page Push
works around that limitation the way a human assistant would: it runs as a
Manifest V3 extension inside your own already-logged-in browser session, and
only acts on the page's DOM when you explicitly press a button. It never
calls Meta's API on your behalf and never performs an action without your
click.

## What's in this repo

```
extension/          Manifest V3 browser extension (load this unpacked)
  manifest.json      Extension manifest
  background.js      Service worker: opens the side panel, proxies local daemon calls
  content_facebook.js  Facebook DOM bridge (Lexical editor + React input shims)
  sidepanel.html     Side panel UI ("Question & Do" wizard)
  sidepanel.js        Side panel controller logic
  icons/              16/48/128px toolbar icons

daemon/              Optional companion Rust service (axum + tower-http)
  Cargo.toml
  src/main.rs         HTTP server with offline template-based copy generation
  src/qwen3.rs         Optional local Qwen3 GGUF inference backend (Candle)
```

The extension is fully self-contained and works with **zero** backend —
`sidepanel.js` includes built-in offline templates for drafting your bio and
launch post. The `daemon/` directory is an optional companion you can run
locally on `127.0.0.1:8080` for higher-quality generated copy (and, if you
build it with the `qwen3-gguf` feature, local LLM inference via a quantized
Qwen3 GGUF model through [Candle](https://github.com/huggingface/candle)).
The extension auto-detects whether the daemon is running and falls back to
its offline templates when it isn't.

## How it works

1. **Question & Do wizard** — You answer a few questions (company name,
   focus, website) in the side panel. Page Push drafts a Facebook-compliant
   bio (≤255 characters) and a launch post, either from its built-in offline
   templates or from the local daemon if it's running.
2. **Scan the page** — With your Facebook Page open in the active tab, click
   "Scan Facebook tab." The content script walks the visible DOM and builds
   a small semantic map of interactive elements (inputs, Lexical rich-text
   editors, and buttons), keyed by `aria-label` / `placeholder` / visible
   text rather than Facebook's constantly-changing, obfuscated CSS class
   names.
3. **Fill fields one click at a time** — Each detected field gets a "Fill"
   or "Click" button in the side panel. Pressing it is the only thing that
   ever touches the live page. Nothing runs automatically or in the
   background.

### Why Facebook needs special handling

Facebook's frontend mixes a few patterns that break naive automation:

- **Lexical rich-text editors** (`"What's on your mind?"`, bio fields) are
  `contenteditable` divs backed by Meta's Lexical framework. Setting
  `.innerText` directly desyncs Lexical's internal editor state and your
  text disappears on the next keystroke. Page Push selects the existing
  content and uses `document.execCommand('insertText', ...)`, falling back
  to a synthetic `ClipboardEvent('paste')` when needed.
- **React-controlled `<input>`/`<textarea>` fields** ignore a plain
  `el.value = "..."` assignment because React tracks the value through its
  own instrumented setter. Page Push calls the native DOM property setter
  directly (bypassing React's override) before dispatching `input`/`change`
  events, so React picks up the change as if you'd typed it.
- **Obfuscated atomic CSS classes** (e.g. `x1i10hfl xjbqb8w`) change
  frequently and are useless as stable selectors, so Page Push never reads
  or matches on class names — only on `role`, `aria-label`, `placeholder`,
  and visible text.

## Installing the extension

1. Clone this repository.
2. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer
   mode**.
3. Click **Load unpacked** and select the `extension/` folder.
4. Pin **Page Push** to your toolbar, open your Facebook Page, and click the
   toolbar icon to open the side panel.

No build step, no Node.js, no bundler — it's vanilla Manifest V3.

## Running the optional local daemon

The daemon is entirely optional. Without it, the extension still works using
its built-in offline templates.

```bash
cd daemon
cargo run
```

This starts an HTTP server on `http://127.0.0.1:8080` with CORS locked down
to extension origins (`chrome-extension://...`) and the loopback address
itself — it will not accept requests from arbitrary web pages.

### Optional: local Qwen3 GGUF inference

To generate copy with a local quantized Qwen3 model instead of the built-in
templates, build with the `qwen3-gguf` feature and point it at a GGUF model
and tokenizer:

```bash
cd daemon
export HCC_QWEN3_GGUF=/path/to/qwen3-1.7b-q4_k_m.gguf
export HCC_QWEN3_TOKENIZER=/path/to/tokenizer.json
cargo run --features qwen3-gguf
```

> **Note:** the `qwen3-gguf` feature pulls in Candle's full dependency tree,
> some of which requires a recent Rust toolchain (1.85+). The default build
> (no features) only needs a stable Rust 1.80+ toolchain and has no GPU/ML
> dependencies at all.

## Privacy & security notes

- The content script only runs on `facebook.com` / `business.facebook.com`
  and only reads/writes the DOM when you click a button in the side panel.
- The daemon binds to `127.0.0.1` only and restricts CORS to the extension's
  own origin — it is not reachable from the network or from arbitrary
  websites.
- No telemetry, no external API calls, no data leaves your machine unless
  you explicitly configure the daemon to forward to another endpoint.

## License

MIT — see [LICENSE](LICENSE).
