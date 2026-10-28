import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../models/qwen3-0.6b-q8.json", import.meta.url), "utf8"));
const dir = path.join(root, "models", "weights");
await mkdir(dir, { recursive: true });

const files = [
  {
    name: manifest.file,
    bytes: manifest.bytes,
    sha256: manifest.sha256,
    url: `https://huggingface.co/${manifest.repo}/resolve/${manifest.revision}/${manifest.file}`,
  },
  {
    name: manifest.tokenizerFile,
    bytes: manifest.tokenizerBytes,
    sha256: manifest.tokenizerSha256,
    url: `https://huggingface.co/${manifest.tokenizerRepo}/resolve/${manifest.tokenizerRevision}/${manifest.tokenizerFile}`,
  },
];

for (const file of files) {
  const destination = path.join(dir, file.name);
  if (await matches(destination, file)) {
    process.stdout.write(`${file.name} already matches the pin\n`);
    continue;
  }
  await resetIfCorrupt(destination, file.bytes);
  process.stdout.write(`downloading ${file.url}\n`);
  await download(file.url, destination);
  if (!(await matches(destination, file))) {
    throw new Error(`${file.name} did not match the pinned size and sha256`);
  }
  process.stdout.write(`${file.name} verified\n`);
}

async function matches(destination, file) {
  try {
    const info = await stat(destination);
    if (info.size !== file.bytes) return false;
  } catch {
    return false;
  }
  return (await sha256(destination)) === file.sha256;
}

async function resetIfCorrupt(destination, bytes) {
  try {
    const info = await stat(destination);
    if (info.size >= bytes) await unlink(destination);
  } catch {
    // A missing file is what curl will create.
  }
}

function sha256(destination) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(destination)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "curl",
      ["-fL", "--retry", "3", "--retry-delay", "2", "-C", "-", "-o", destination, url],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`curl exited ${code}`));
    });
  });
}
