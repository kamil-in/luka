// Build the static GitHub Pages bundle for Luka.
// Copies UI files and imports the firmware builds from firmwares/dist/ into the target directory (_site by default).

import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { identify } from "../ui/web/native-kinds.js";
import { playsMidiNotes, selfStarts } from "./self-start.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, process.argv[2] || "_site");

console.log(`Building static web app in ${outDir}...`);

// 1. Clean and prepare output dir
if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

// 2. Copy UI files: ui/ -> outDir/
cpSync(join(root, "ui"), outDir, { recursive: true });

// 3. Prepare outDir/native/
const nativeOut = join(outDir, "native");
mkdirSync(nativeOut, { recursive: true });

const dist = join(root, "firmwares", "dist");
const distManifest = join(dist, "manifest.json");
if (!existsSync(distManifest)) {
  throw new Error(`firmwares/dist/manifest.json not found at ${distManifest}`);
}

const listed = JSON.parse(readFileSync(distManifest, "utf8")).builds;
const skip = new Set(["Felucca"]);
const imported = [];

for (const b of listed) {
  const distFile = join(dist, b.file);
  if (skip.has(b.id) || !existsSync(distFile)) continue;
  const bytes = readFileSync(distFile);
  let module;
  try {
    module = new WebAssembly.Module(bytes);
  } catch (e) {
    console.log(`${b.name.padEnd(20)} NOT WEBASSEMBLY: ${e.message}`);
    continue;
  }
  const exports = WebAssembly.Module.exports(module).filter((e) => e.kind === "function").map((e) => e.name).filter((n) => !n.startsWith("_")).sort();
  const imports = [...new Set(WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`))].sort();
  const { family, style, note } = identify(exports, imports);
  const autostarts = await selfStarts(bytes, style);
  const midi_notes = await playsMidiNotes(bytes, style);

  // Copy wasm file to native directory
  copyFileSync(distFile, join(nativeOut, b.file));

  imported.push({
    id: b.id,
    name: b.name,
    repo: b.repo,
    branch: b.branch,
    path: `firmwares/dist/${b.file}`,
    commit: b.commit || "0000000",
    source: b.url,
    file: b.file,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    family,
    style,
    note,
    autostarts,
    midi_notes,
  });
  console.log(`${b.name.padEnd(20)} ${String(Math.round(bytes.length / 1024)).padStart(5)} KB  ${family.padEnd(11)} ${style ? "plays" : "listed only: " + note}${autostarts ? "  (starts by itself)" : ""}`);
}

// (compact, and without each build's lists of exports and imports, which the page never reads)
writeFileSync(join(nativeOut, "manifest.json"), JSON.stringify({
  built_at: new Date().toISOString(),
  builds: imported,
}));

// 4. Make it fast on a static host
// - no emulator wasm (3 MB) and no desktop transport: this page plays the browser builds only
//   (the emulator path, ui/web/player-worklet.js, is not reachable from the page).
rmSync(join(outDir, "transport-tauri.js"), { force: true });
// - the start-up chain (page, app.js, transport, list) is asked for at once instead of in turn
// - a service worker keeps each firmware's wasm between visits (tools/pages-sw.js)
copyFileSync(join(root, "tools", "pages-sw.js"), join(outDir, "sw.js"));
const indexFile = join(outDir, "index.html");
const html = readFileSync(indexFile, "utf8");
const sheet = '  <link rel="stylesheet" href="style.css">';
if (!html.includes(sheet)) throw new Error("index.html changed: the hints have nowhere to go");
const hints = `  <link rel="modulepreload" href="web/transport-web.js">
  <link rel="modulepreload" href="web/mixbus.js">
  <link rel="preload" as="fetch" crossorigin href="native/manifest.json">
  <meta name="luka-sw" content="sw.js">
`;
writeFileSync(indexFile, html.replace(sheet, hints + sheet));

console.log(`\nStatic bundle built successfully in ${outDir} (${imported.length} firmwares).`);
