// Side panel card for optional copy drafting. The offline, fact-based draft always works; the
// local Ollama path is opt-in and runs only on a click. Drafts land in the pack form for the person
// to read and edit. They reach Facebook only through Plan -> Draft -> Approve & Commit.
import {
  checkAndLoad,
  DEFAULT_OLLAMA_MODEL,
  draftFacebookCopy,
  OLLAMA_URL,
  ollamaRunner,
  ollamaStatus,
  type FacebookCopyOutcome,
  type FacebookPack,
  type FetchLike,
  type OllamaFailure,
  type PullProgress,
} from "../browser.ts";
import type { Banner } from "./panel-state.ts";
import type { LocalArea } from "./storage.ts";

export const OLLAMA_SETTINGS_KEY = "pagepush.ollama.v1";

export interface CopyPanelDeps {
  doc: Document;
  fetch: FetchLike;
  storage: LocalArea;
  pack(): FacebookPack;
  /** Writes drafted copy into the pack form (which drops any current plan). */
  applyCopy(copy: { bio?: string; launchPost?: string }): void;
  setBanner(banner: Banner): void;
}

export interface CopyPanel {
  /** Resolves when the click handlers' work is done; for tests. */
  idle(): Promise<void>;
}

export function wireCopyPanel(deps: CopyPanelDeps): CopyPanel {
  const el = <T extends HTMLElement>(id: string): T => {
    const found = deps.doc.getElementById(id);
    if (!found) throw new Error(`Missing #${id} in sidepanel.html`);
    return found as T;
  };
  const modelInput = el<HTMLInputElement>("ollama-model");
  const modelList = el<HTMLDataListElement>("ollama-models");
  const status = el<HTMLElement>("ollama-status");
  const loadButton = el<HTMLButtonElement>("ollama-load");
  const draftButton = el<HTMLButtonElement>("ollama-draft");
  const offlineButton = el<HTMLButtonElement>("offline-draft");
  const undoButton = el<HTMLButtonElement>("copy-undo");

  let ready: string | null = null;
  let working: Promise<void> = Promise.resolve();
  let pull: AbortController | null = null;
  let undo: { bio?: string; launchPost?: string } | null = null;

  const model = (): string => modelInput.value.trim() || DEFAULT_OLLAMA_MODEL;
  const say = (text: string, tone: "info" | "good" | "warn" | "bad" = "info"): void => {
    status.textContent = text;
    status.dataset.tone = tone;
  };
  const busy = (on: boolean): void => {
    draftButton.disabled = on;
    offlineButton.disabled = on;
    modelInput.disabled = on;
  };
  const run = (task: () => Promise<void>): void => {
    working = working.then(task, task);
  };
  const failed = (failure: OllamaFailure): void => {
    ready = null;
    say(failure.message, failure.code === "unreachable" ? "warn" : "bad");
    deps.setBanner({
      tone: failure.code === "forbidden" ? "bad" : "warn",
      title: failure.code === "forbidden" ? "Ollama refused the extension." : "Local model unavailable.",
      detail: `${failure.message} The offline draft still works.`,
    });
  };

  void (async () => {
    try {
      const saved = (await deps.storage.get(OLLAMA_SETTINGS_KEY))[OLLAMA_SETTINGS_KEY] as { model?: unknown } | undefined;
      if (typeof saved?.model === "string" && saved.model.trim()) modelInput.value = saved.model;
    } catch {
      // Settings are a convenience; the default model is fine.
    }
    if (!modelInput.value) modelInput.value = DEFAULT_OLLAMA_MODEL;
  })();

  modelInput.addEventListener("change", () => {
    ready = null;
    void deps.storage.set({ [OLLAMA_SETTINGS_KEY]: { model: model() } }).catch(() => undefined);
  });

  loadButton.addEventListener("click", () => {
    if (pull) {
      pull.abort();
      return;
    }
    run(async () => {
      busy(true);
      pull = new AbortController();
      loadButton.textContent = "Cancel";
      try {
        const wanted = model();
        const result = await checkAndLoad(wanted, {
          fetch: deps.fetch,
          signal: pull.signal,
          onStep: (step, detail) => {
            if (step === "checking") say(`Checking Ollama at ${OLLAMA_URL}…`);
            if (step === "pulling") say(`Downloading ${detail ?? wanted}. This runs once; you can cancel.`);
            if (step === "warming") say(`Loading ${detail ?? wanted} into memory…`);
          },
          onProgress: (progress) => say(progressText(wanted, progress)),
        });
        if (!result.ok) {
          failed(result);
          return;
        }
        ready = result.match ?? wanted;
        fillModels(modelList, result.models);
        say(`Ready: ${ready} (Ollama ${result.version}).`, "good");
      } finally {
        pull = null;
        loadButton.textContent = "Check / Load Model";
        busy(false);
      }
    });
  });

  draftButton.addEventListener("click", () => {
    run(async () => {
      busy(true);
      try {
        let use = ready;
        if (!use) {
          say(`Checking Ollama at ${OLLAMA_URL}…`);
          const found = await ollamaStatus(model(), { fetch: deps.fetch });
          if (!found.ok) {
            failed(found);
            return;
          }
          if (!found.match) {
            say(`${model()} is not downloaded yet. Click Check / Load Model first.`, "warn");
            return;
          }
          use = found.match;
        }
        say(`Drafting with ${use}…`);
        apply(await draftFacebookCopy(deps.pack(), ollamaRunner(use, { fetch: deps.fetch })), use);
      } finally {
        busy(false);
      }
    });
  });

  offlineButton.addEventListener("click", () => {
    run(async () => apply(await draftFacebookCopy(deps.pack()), null));
  });

  undoButton.addEventListener("click", () => {
    if (!undo) return;
    deps.applyCopy(undo);
    undo = null;
    undoButton.hidden = true;
    say("Restored the bio and post from before the draft.");
  });

  function apply(outcome: FacebookCopyOutcome, used: string | null): void {
    const copy: { bio?: string; launchPost?: string } = {};
    if (outcome.bio != null) copy.bio = outcome.bio;
    if (outcome.launchPost != null) copy.launchPost = outcome.launchPost;
    if (!Object.keys(copy).length) {
      say("Add the Page name (and categories) first; there is nothing to draft from yet.", "warn");
      return;
    }
    const pack = deps.pack();
    undo = { bio: pack.page?.bio ?? "", ...(copy.launchPost != null ? { launchPost: pack.launchPost?.text ?? "" } : {}) };
    undoButton.hidden = false;
    deps.applyCopy(copy);
    const by = outcome.source === "ollama" ? `Drafted with ${used}` : outcome.source === "mixed" ? `Drafted partly with ${used}, partly from the facts` : "Drafted from the pack facts (offline)";
    const warnings = outcome.issues.map((item) => item.message);
    say(warnings.length ? `${by}. ${warnings.join(" ")}` : `${by}.`, outcome.source === "offline" && used ? "warn" : "good");
    deps.setBanner({
      tone: "info",
      title: "Read the drafted copy before planning.",
      detail: "The bio and launch post in the pack were replaced. Edit them as you like; nothing reaches Facebook until Plan, Draft, and Approve & Commit.",
    });
  }

  return { idle: () => working };
}

function progressText(model: string, progress: PullProgress): string {
  if (progress.total && progress.completed != null) {
    const pct = Math.floor((progress.completed / progress.total) * 100);
    return `Downloading ${model}: ${pct}% (${progress.status}).`;
  }
  return `Downloading ${model}: ${progress.status}.`;
}

function fillModels(list: HTMLDataListElement, models: string[]): void {
  list.replaceChildren(...models.map((name) => {
    const option = list.ownerDocument.createElement("option");
    option.value = name;
    return option;
  }));
}
