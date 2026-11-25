// Builds the unpacked Manifest V3 extension into dist/.
//
//   npm run build          one production build
//   npm run build:watch    rebuild on change
//
// Entry boundary: the bundles start from src/extension/*, which import only src/browser.ts.
// The build fails if any bundle pulls in a Node built-in, src/draft/candle.ts, native/, or daemon/.
import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");

const FORBIDDEN_INPUT = [/^node:/, /src[\\/]draft[\\/]candle\.ts$/, /^native[\\/]/, /^daemon[\\/]/, /^models[\\/]weights[\\/]/];

const options = {
  absWorkingDir: root,
  entryPoints: {
    content: "src/extension/content.ts",
    sidepanel: "src/extension/sidepanel.ts",
    background: "src/extension/background.ts",
  },
  outdir: dist,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  charset: "utf8",
  legalComments: "eof",
  sourcemap: watch ? "inline" : false,
  minify: false,
  metafile: true,
  logLevel: "info",
  plugins: [
    {
      name: "copy-static-and-check",
      setup(build) {
        build.onStart(async () => {
          await rm(dist, { recursive: true, force: true });
          await mkdir(dist, { recursive: true });
        });
        build.onEnd(async (result) => {
          if (result.errors.length) return;
          const problems = [];
          for (const input of Object.keys(result.metafile?.inputs ?? {})) {
            if (FORBIDDEN_INPUT.some((pattern) => pattern.test(input))) problems.push(`forbidden input in bundle: ${input}`);
          }
          for (const [file, output] of Object.entries(result.metafile?.outputs ?? {})) {
            for (const name of output.imports ?? []) problems.push(`${file} still imports ${name.path}`);
            const text = await readFile(path.join(root, file), "utf8");
            if (/\brequire\(\s*["']node:|from\s*["']node:/.test(text)) problems.push(`${file} references a node: module`);
          }
          await cp(path.join(root, "src/extension/sidepanel.html"), path.join(dist, "sidepanel.html"));
          await cp(path.join(root, "icons"), path.join(dist, "icons"), { recursive: true });
          await cp(path.join(root, "LICENSE"), path.join(dist, "LICENSE"));
          const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
          await writeFile(path.join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
          for (const ref of manifestFiles(manifest)) {
            if (!(await exists(path.join(dist, ref)))) problems.push(`manifest.json points at ${ref}, which is not in dist/`);
          }
          if (problems.length) {
            for (const problem of problems) console.error(`✖ ${problem}`);
            if (!watch) process.exitCode = 1;
            return;
          }
          const sizes = await Promise.all(
            Object.keys(result.metafile.outputs).map(async (file) => `${path.basename(file)} ${(await stat(path.join(root, file))).size} B`),
          );
          console.log(`✔ dist/ is a loadable unpacked extension (${sizes.join(", ")})`);
        });
      },
    },
  ],
};

function manifestFiles(manifest) {
  return [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...(manifest.content_scripts ?? []).flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ].filter(Boolean);
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log("Watching src/ for changes. Load dist/ as an unpacked extension.");
} else {
  const result = await esbuild.build(options);
  if (result.errors.length) process.exitCode = 1;
}
