// Optional, local copy drafting. A later Draft can write the results to Facebook before approval.
import {
  checkAndLoad, DEFAULT_OLLAMA_MODEL, draftFacebookCopy, OLLAMA_URL, ollamaRunner, ollamaStatus,
  type FacebookCopyOutcome, type FacebookPack, type FetchLike, type OllamaFailure, type PullProgress,
} from "../browser.ts";
import type { Banner } from "./panel-state.ts";
import type { LocalArea } from "./storage.ts";

export const OLLAMA_SETTINGS_KEY = "pagepush.ollama.v1";
export interface CopyPanelDeps {
  doc: Document;
  fetch: FetchLike;
  storage: LocalArea;
  pack(): FacebookPack;
  revision(): number;
  available(): boolean;
  applyCopy(copy: { bio?: string; launchPost?: string }): void;
  setBanner(banner: Banner): void;
}
export interface CopyPanel { idle(): Promise<void>; invalidate(): void; }

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
  let controller: AbortController | null = null;
  let epoch = 0;
  let undo: { revision: number; copy: { bio?: string; launchPost?: string } } | null = null;
  const model = (): string => modelInput.value.trim() || DEFAULT_OLLAMA_MODEL;
  const say = (text: string, tone: "info" | "good" | "warn" | "bad" = "info"): void => {
    status.textContent = text; status.dataset.tone = tone;
  };
  const busy = (on: boolean): void => {
    draftButton.disabled = on; offlineButton.disabled = on; modelInput.disabled = on;
  };
  const current = (revision: number, token: number): boolean =>
    deps.available() && deps.revision() === revision && epoch === token;
  const failed = (failure: OllamaFailure): void => {
    ready = null;
    say(failure.message, failure.code === "unreachable" ? "warn" : "bad");
    deps.setBanner({ tone: failure.code === "forbidden" ? "bad" : "warn", title: failure.code === "forbidden" ? "Ollama refused the extension." : "Local model unavailable.", detail: `${failure.message} The offline draft still works.` });
  };
  // Pull supports abort; other in-flight Ollama requests are fenced and their results discarded.
  const run = (revision: number, token: number, task: (signal: AbortSignal) => Promise<void>): void => {
    working = working.then(async () => {
      if (!current(revision, token)) return;
      const local = new AbortController(); controller = local; busy(true);
      try { await task(local.signal); }
      finally {
        if (controller === local) controller = null;
        if (current(revision, token)) { busy(false); loadButton.textContent = "Check / Load Model"; }
      }
    }).catch(() => { if (current(revision, token)) { busy(false); say("Drafting stopped.", "warn"); } });
  };
  modelInput.value = DEFAULT_OLLAMA_MODEL;
  const settingsRevision = deps.revision();
  const settingsEpoch = epoch;
  void (async () => {
    try {
      const saved = (await deps.storage.get(OLLAMA_SETTINGS_KEY))[OLLAMA_SETTINGS_KEY] as { model?: unknown } | undefined;
      if (deps.revision() === settingsRevision && epoch === settingsEpoch && typeof saved?.model === "string" && saved.model.trim()) modelInput.value = saved.model;
    } catch { /* Default is fine. */ }
  })();
  modelInput.addEventListener("change", () => {
    if (!deps.available()) return;
    ready = null;
    void deps.storage.set({ [OLLAMA_SETTINGS_KEY]: { model: model() } }).catch(() => undefined);
  });
  loadButton.addEventListener("click", () => {
    if (!deps.available()) return;
    if (controller) { controller.abort(); return; }
    const revision = deps.revision(), token = epoch;
    run(revision, token, async (signal) => {
      loadButton.textContent = "Cancel";
      const wanted = model();
      const result = await checkAndLoad(wanted, {
        fetch: deps.fetch, signal,
        onStep: (step, detail) => {
          if (!current(revision, token)) return;
          if (step === "checking") say(`Checking Ollama at ${OLLAMA_URL}…`);
          if (step === "pulling") say(`Downloading ${detail ?? wanted}. This runs once; you can cancel.`);
          if (step === "warming") say(`Loading ${detail ?? wanted} into memory…`);
        },
        onProgress: (progress) => { if (current(revision, token)) say(progressText(wanted, progress)); },
      });
      if (!current(revision, token) || signal.aborted) return;
      if (!result.ok) { failed(result); return; }
      ready = result.match ?? wanted; fillModels(modelList, result.models);
      say(`Ready: ${ready} (Ollama ${result.version}).`, "good");
    });
  });
  draftButton.addEventListener("click", () => {
    if (!deps.available()) return;
    const revision = deps.revision(), token = epoch, pack = structuredClone(deps.pack());
    run(revision, token, async (signal) => {
      let use = ready;
      const fetch = deps.fetch;
      if (!use) {
        say(`Checking Ollama at ${OLLAMA_URL}…`);
        const found = await ollamaStatus(model(), { fetch });
        if (!current(revision, token) || signal.aborted) return;
        if (!found.ok) { failed(found); return; }
        if (!found.match) { say(`${model()} is not downloaded yet. Click Check / Load Model first.`, "warn"); return; }
        use = found.match;
      }
      say(`Drafting with ${use}…`);
      const outcome = await draftFacebookCopy(pack, ollamaRunner(use, { fetch }));
      if (current(revision, token) && !signal.aborted) apply(outcome, use);
    });
  });
  offlineButton.addEventListener("click", () => {
    if (!deps.available()) return;
    const revision = deps.revision(), token = epoch, pack = structuredClone(deps.pack());
    run(revision, token, async () => {
      const outcome = await draftFacebookCopy(pack);
      if (current(revision, token)) apply(outcome, null);
    });
  });
  undoButton.addEventListener("click", () => {
    if (!undo || !deps.available() || undo.revision !== deps.revision()) { undo = null; undoButton.hidden = true; return; }
    const copy = undo.copy; undo = null; undoButton.hidden = true;
    deps.applyCopy(copy);
    say("Restored the bio and post from before the draft.");
  });
  function apply(outcome: FacebookCopyOutcome, used: string | null): void {
    const copy: { bio?: string; launchPost?: string } = {};
    if (outcome.bio != null) copy.bio = outcome.bio;
    if (outcome.launchPost != null) copy.launchPost = outcome.launchPost;
    if (!Object.keys(copy).length) { say("Add the Page name (and categories) first; there is nothing to draft from yet.", "warn"); return; }
    const pack = deps.pack();
    const previous = { bio: pack.page?.bio ?? "", ...(copy.launchPost != null ? { launchPost: pack.launchPost?.text ?? "" } : {}) };
    deps.applyCopy(copy);
    undo = { revision: deps.revision(), copy: previous }; undoButton.hidden = false;
    const by = outcome.source === "ollama" ? `Drafted with ${used}` : outcome.source === "mixed" ? `Drafted partly with ${used}, partly from the facts` : "Drafted from the pack facts (offline)";
    const warnings = outcome.issues.map((item) => item.message);
    say(warnings.length ? `${by}. ${warnings.join(" ")}` : `${by}.`, outcome.source === "offline" && used ? "warn" : "good");
    deps.setBanner({ tone: "info", title: "Read the drafted copy before planning.", detail: "The bio and launch post in the pack were replaced. Edit them as you like. A later Draft writes values into Facebook before final approval; verify the result there." });
  }
  return {
    idle: () => working,
    invalidate() {
      epoch += 1; controller?.abort(); controller = null; ready = null; undo = null;
      undoButton.hidden = true; busy(false); loadButton.textContent = "Check / Load Model";
      working = Promise.resolve();
    },
  };
}
function progressText(model: string, progress: PullProgress): string {
  if (progress.total && progress.completed != null) return `Downloading ${model}: ${Math.floor((progress.completed / progress.total) * 100)}% (${progress.status}).`;
  return `Downloading ${model}: ${progress.status}.`;
}
function fillModels(list: HTMLDataListElement, models: string[]): void {
  list.replaceChildren(...models.map((name) => { const option = list.ownerDocument.createElement("option"); option.value = name; return option; }));
}
