import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../../models/qwen3-0.6b-q8.json" with { type: "json" };
import type { CopyRunner, ModelResult } from "./copy.ts";

export interface CandleOptions {
  command?: string;
  commandArgs?: string[];
  modelPath?: string;
  tokenizerPath?: string;
  timeoutMs?: number;
  /** Unit tests point the paths at small stand-in files. */
  skipSizeCheck?: boolean;
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function pinnedModelPaths(): { model: string; tokenizer: string; bytes: number; tokenizerBytes: number } {
  return {
    model: path.join(repoRoot, "models", "weights", manifest.file),
    tokenizer: path.join(repoRoot, "models", "weights", manifest.tokenizerFile),
    bytes: manifest.bytes,
    tokenizerBytes: manifest.tokenizerBytes,
  };
}

export function candleRunner(options: CandleOptions = {}): CopyRunner {
  return {
    complete(input) {
      return runCandle(input, options);
    },
  };
}

export async function runCandle(
  input: { system: string; user: string; maxTokens: number },
  options: CandleOptions = {},
): Promise<ModelResult> {
  const pinned = pinnedModelPaths();
  const modelPath = options.modelPath ?? pinned.model;
  const tokenizerPath = options.tokenizerPath ?? pinned.tokenizer;
  const model = await describe(modelPath);
  if (!model) return { ok: false, code: "weights", message: "The Qwen3 GGUF is not on disk. Run npm run model:pull." };
  if (!options.skipSizeCheck && model.size !== pinned.bytes) {
    return { ok: false, code: "weights", message: "The Qwen3 GGUF does not match the pinned size." };
  }
  const tokenizer = await describe(tokenizerPath);
  if (!tokenizer) return { ok: false, code: "tokenizer", message: "tokenizer.json is not on disk. Run npm run model:pull." };
  if (!options.skipSizeCheck && tokenizer.size !== pinned.tokenizerBytes) {
    return { ok: false, code: "tokenizer", message: "tokenizer.json does not match the pinned size." };
  }

  const command = options.command ?? path.join(repoRoot, "native", "candle-drafter", "target", "release", "candle-drafter");
  const args = options.command
    ? (options.commandArgs ?? [])
    : ["--model", modelPath, "--tokenizer", tokenizerPath, ...(options.commandArgs ?? [])];
  return spawnJson(command, args, input, options.timeoutMs ?? 180_000);
}

function spawnJson(
  command: string,
  args: string[],
  input: { system: string; user: string; maxTokens: number },
  timeoutMs: number,
): Promise<ModelResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolve({ ok: false, code: "runtime", message: "The Candle drafter could not be started." });
      return;
    }
    let stdout = "";
    let settled = false;
    const finish = (result: ModelResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, code: "timeout", message: "The Candle drafter exceeded its time limit." });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 1_000_000) stdout += chunk;
    });
    child.on("error", () => {
      finish({ ok: false, code: "runtime", message: "The Candle drafter could not be started." });
    });
    child.on("exit", () => {
      finish(interpretModelOutput(stdout));
    });
    try {
      child.stdin.write(JSON.stringify({
        system: input.system,
        user: input.user,
        max_tokens: input.maxTokens,
      }));
      child.stdin.end();
    } catch {
      finish({ ok: false, code: "runtime", message: "The Candle drafter could not be started." });
    }
  });
}

export function interpretModelOutput(stdout: string): ModelResult {
  const line = stdout.trim().split("\n").find((item) => item.trim().startsWith("{"));
  if (!line) return { ok: false, code: "protocol", message: "The Candle drafter returned no JSON." };
  try {
    const parsed = JSON.parse(line) as { ok?: boolean; text?: unknown; code?: unknown; message?: unknown };
    if (parsed.ok === true && typeof parsed.text === "string") return { ok: true, text: parsed.text };
    const code = parsed.code;
    if (code === "weights" || code === "tokenizer" || code === "timeout" || code === "protocol" || code === "runtime") {
      return { ok: false, code, message: typeof parsed.message === "string" ? parsed.message : "The Candle drafter failed." };
    }
    return { ok: false, code: "protocol", message: "The Candle drafter returned an unexpected payload." };
  } catch {
    return { ok: false, code: "protocol", message: "The Candle drafter returned invalid JSON." };
  }
}

async function describe(file: string): Promise<{ size: number } | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? { size: info.size } : null;
  } catch {
    return null;
  }
}
