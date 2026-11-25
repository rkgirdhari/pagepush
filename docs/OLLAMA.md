# Drafting copy with a local Ollama (optional)

Page Push drafts the Facebook Page **bio** (up to 255 characters, the live editor's limit) and, on
the $50 Full Launch tier, the **launch post**. Two ways, both in the side panel card
"Draft bio & launch post":

- **Draft from facts (offline)** works out of the box. It keeps any bio or post you already wrote,
  and fills empty ones from the pack facts with fixed templates. No model, no network.
- **Draft Copy with Ollama** uses a model running on your own computer through
  [Ollama](https://ollama.com), at `http://localhost:11434`. The default model is `qwen3`; type
  another installed model name (the field suggests what Ollama reports) to switch.

Either way the draft lands in the pack form. Read and edit it there. A pack edit blocks Draft and
Commit until you plan the Facebook view again, so drafted copy reaches Facebook only through
**Plan → Draft → Approve & Commit**, exactly like copy you typed.

## One-click Check / Load Model

The button runs these steps and shows each one under it:

1. `GET /api/version` and `GET /api/tags`: is Ollama running, and is the model installed?
2. `POST /api/pull` (only if the model is missing): Ollama downloads it from its library. Progress is
   shown, and the button turns into **Cancel** while it runs. `qwen3` is several GB.
3. `POST /api/generate` with an empty prompt and `keep_alive: 10m`: loads the model into memory so
   the first draft is quick.

**Draft Copy with Ollama** calls `POST /api/chat` with `format: "json"` and `think: false`, and the
prompt says to use only the pack facts. The answer is then checked like every model draft in Page
Push: it must fit the field (255 characters for the bio, 600 for the launch post draft), may not add
a URL, email, date, or price that is not in the pack, and may only use words from the pack facts plus
a short list of neutral words ("welcome", "follow", "visit", "book", …). A field that fails is set
aside with a note and the offline draft is used for it instead. If the initial Ollama connection
check fails, the panel leaves the pack unchanged; use **Draft from facts (offline)** separately.
These checks are best-effort and do not prove that model-generated statements are true; review them.

Nothing runs in the background: no polling, no scheduled pulls. Every call follows a click.

## Windows: Ollama answers 403

Ollama only accepts requests from origins it trusts. A Chrome extension calls from
`chrome-extension://<extension id>`, which some Ollama versions reject with HTTP 403. The side panel
says so when it happens. To allow it once:

```powershell
setx OLLAMA_ORIGINS "chrome-extension://*"
```

Then quit Ollama from the system tray (right-click the icon, Quit Ollama) and start it again, so it
reads the new variable. `setx` sets it for your user account; new terminals and apps see it, already
open ones do not.

To allow only this extension, use its id from `chrome://extensions` instead of `*`:

```powershell
setx OLLAMA_ORIGINS "chrome-extension://<your-extension-id>"
```

## Not reachable

"Ollama is not reachable at http://localhost:11434" means nothing answered. Start Ollama (it runs as
a tray app on Windows) and check that `http://localhost:11434` in a browser says "Ollama is running".
The offline draft keeps working meanwhile.

## Privacy

The side panel sends the pack facts (Page name, categories, bio, launch notes, website, city, action
button, hours) only to `localhost:11434`. A best-effort check blocks known credential patterns,
but cannot identify every secret. Do not enter credentials in a pack. See `PRIVACY_POLICY.md`.
