// Optional local Ollama client for copy drafting. Browser-safe: it only uses an injected fetch,
// talks to a local Ollama server (default http://localhost:11434), and runs only when the person
// clicks a button in the side panel. No background polling, no retries on a timer, no cloud calls.
//
// Ollama rejects requests from origins it does not trust with HTTP 403. A Chrome extension's
// origin is chrome-extension://<id>, so on some installs the person must allow it once:
//   Windows:  setx OLLAMA_ORIGINS "chrome-extension://*"   then quit and restart Ollama.
// See docs/OLLAMA.md.
import type { CopyRunner, ModelResult } from "./copy.ts";

export const OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen3";
/** Shown when Ollama answers 403: the extension origin is not in OLLAMA_ORIGINS. */
export const OLLAMA_ORIGINS_HELP =
  'Ollama refused this extension (HTTP 403). On Windows run: setx OLLAMA_ORIGINS "chrome-extension://*" , then quit Ollama from the tray and start it again.';

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
}>;

export type OllamaFailure = { ok: false; code: "unreachable" | "forbidden" | "http" | "timeout" | "protocol"; message: string };

export interface OllamaStatus {
  ok: true;
  version: string;
  models: string[];
  /** The installed tag that satisfies the wanted model, or null when it is not pulled yet. */
  match: string | null;
}

export interface OllamaOptions {
  fetch: FetchLike;
  baseUrl?: string;
  /** Per-request limit for quick calls (version, tags). */
  timeoutMs?: number;
}

/** "qwen3" matches "qwen3:latest" and "qwen3:8b"; "qwen3:8b" matches only itself. */
export function modelMatches(installed: string, wanted: string): boolean {
  const want = wanted.trim().toLowerCase();
  const have = installed.trim().toLowerCase();
  if (!want) return false;
  if (want.includes(":")) return have === want;
  return have === want || have.startsWith(`${want}:`);
}

export async function ollamaStatus(model: string, options: OllamaOptions): Promise<OllamaStatus | OllamaFailure> {
  const base = options.baseUrl ?? OLLAMA_URL;
  const version = await call(options, `${base}/api/version`, { method: "GET" }, options.timeoutMs ?? 4000);
  if (!version.ok) return version;
  const tags = await call(options, `${base}/api/tags`, { method: "GET" }, options.timeoutMs ?? 4000);
  if (!tags.ok) return tags;
  const models = Array.isArray((tags.json as { models?: unknown }).models)
    ? ((tags.json as { models: { name?: unknown; model?: unknown }[] }).models)
        .map((entry) => String(entry.name ?? entry.model ?? ""))
        .filter(Boolean)
    : [];
  const match = models.find((name) => modelMatches(name, model)) ?? null;
  return { ok: true, version: String((version.json as { version?: unknown }).version ?? "unknown"), models, match };
}

export interface PullProgress {
  status: string;
  completed?: number;
  total?: number;
}

/**
 * Pulls a model, reporting Ollama's own progress lines. Runs only on the person's click and can be
 * cancelled with `signal`. Resolves once Ollama reports success.
 */
export async function pullModel(
  model: string,
  options: OllamaOptions & { onProgress?: (progress: PullProgress) => void; signal?: AbortSignal },
): Promise<{ ok: true } | OllamaFailure> {
  const base = options.baseUrl ?? OLLAMA_URL;
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await options.fetch(`${base}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      signal: options.signal,
    });
  } catch (error) {
    return failureFrom(error);
  }
  if (!response.ok) return httpFailure(response.status, await safeText(response));
  let last: PullProgress | null = null;
  const handle = (line: string): OllamaFailure | null => {
    if (!line.trim()) return null;
    let parsed: { status?: unknown; completed?: unknown; total?: unknown; error?: unknown };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      return null;
    }
    if (parsed.error) return { ok: false, code: "http", message: String(parsed.error) };
    last = {
      status: String(parsed.status ?? ""),
      completed: typeof parsed.completed === "number" ? parsed.completed : undefined,
      total: typeof parsed.total === "number" ? parsed.total : undefined,
    };
    options.onProgress?.(last);
    return null;
  };
  try {
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const failed = handle(buffer.slice(0, newline));
          if (failed) return failed;
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }
      const failed = handle(buffer);
      if (failed) return failed;
    } else {
      for (const line of (await response.text()).split("\n")) {
        const failed = handle(line);
        if (failed) return failed;
      }
    }
  } catch (error) {
    return failureFrom(error);
  }
  const final = last as PullProgress | null;
  return final?.status === "success" ? { ok: true } : { ok: false, code: "protocol", message: "Ollama ended the download without reporting success." };
}

/** Loads the model into memory with an empty prompt, so the first draft does not wait for it. */
export async function warmModel(model: string, options: OllamaOptions & { keepAlive?: string }): Promise<{ ok: true } | OllamaFailure> {
  const base = options.baseUrl ?? OLLAMA_URL;
  const result = await call(options, `${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: options.keepAlive ?? "10m" }),
  }, options.timeoutMs ?? 120_000);
  return result.ok ? { ok: true } : result;
}

export type LoadStep = "checking" | "pulling" | "warming" | "ready";

/**
 * The side panel's one-click Check / Load Model: checks reachability, pulls the model when it is
 * missing, then warms it. Every step is reported through `onStep`.
 */
export async function checkAndLoad(
  model: string,
  options: OllamaOptions & { onStep?: (step: LoadStep, detail?: string) => void; onProgress?: (progress: PullProgress) => void; signal?: AbortSignal },
): Promise<OllamaStatus | OllamaFailure> {
  options.onStep?.("checking");
  const status = await ollamaStatus(model, options);
  if (!status.ok) return status;
  let current = status;
  if (!current.match) {
    options.onStep?.("pulling", model);
    const pulled = await pullModel(model, options);
    if (!pulled.ok) return pulled;
    const after = await ollamaStatus(model, options);
    if (!after.ok) return after;
    current = after.match ? after : { ...after, match: model };
  }
  options.onStep?.("warming", current.match ?? model);
  const warmed = await warmModel(current.match ?? model, options);
  if (!warmed.ok) return warmed;
  options.onStep?.("ready", current.match ?? model);
  return current;
}

/**
 * A CopyRunner backed by Ollama's /api/chat. It asks for JSON, turns qwen3 thinking off, and strips
 * any <think> block that comes back anyway. A failure is a ModelResult, never a throw, so the
 * caller falls back to the deterministic draft.
 */
export function ollamaRunner(model: string, options: OllamaOptions & { draftTimeoutMs?: number }): CopyRunner {
  const base = options.baseUrl ?? OLLAMA_URL;
  return {
    async complete(input): Promise<ModelResult> {
      const result = await call(options, `${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          format: "json",
          think: false,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          options: { temperature: 0.2, num_predict: input.maxTokens },
        }),
      }, options.draftTimeoutMs ?? 90_000);
      if (!result.ok) {
        return { ok: false, code: result.code === "timeout" ? "timeout" : result.code === "protocol" ? "protocol" : "runtime", message: result.message };
      }
      const content = (result.json as { message?: { content?: unknown } }).message?.content;
      if (typeof content !== "string") return { ok: false, code: "protocol", message: "Ollama answered without message content." };
      return { ok: true, text: content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() };
    },
  };
}

async function call(
  options: OllamaOptions,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  timeoutMs: number,
): Promise<{ ok: true; json: unknown } | OllamaFailure> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await options.fetch(url, { ...init, signal: controller?.signal });
    if (!response.ok) return httpFailure(response.status, await safeText(response));
    try {
      return { ok: true, json: await response.json() };
    } catch {
      return { ok: false, code: "protocol", message: "Ollama answered with something that is not JSON." };
    }
  } catch (error) {
    return failureFrom(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function httpFailure(status: number, body: string): OllamaFailure {
  if (status === 403) return { ok: false, code: "forbidden", message: OLLAMA_ORIGINS_HELP };
  const detail = body.trim().slice(0, 200);
  return { ok: false, code: "http", message: `Ollama answered HTTP ${status}${detail ? `: ${detail}` : ""}.` };
}

function failureFrom(error: unknown): OllamaFailure {
  if ((error as { name?: string })?.name === "AbortError") {
    return { ok: false, code: "timeout", message: "Ollama took too long to answer." };
  }
  return { ok: false, code: "unreachable", message: `Ollama is not reachable at ${OLLAMA_URL}. Start Ollama, or keep using the offline draft.` };
}

async function safeText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
