// Make the browser builds in firmwares/dist/ (made by firmwares/build-firmwares.ps1) the
// ones the web app lists: copy each into .cache/native/ and describe it in the manifest the
// web server serves (/native/manifest.json). A build is read, not trusted: its exports and
// imports and the kind it is come from the file itself (ui/web/native-kinds.js); the name,
// repository and commit come from firmwares/dist/manifest.json.
//
//   node tools/import-builds.mjs
//
// It merges: builds from other sources (tools/fetch-native.mjs) stay, except where the same
// repository is in dist/, which wins. Like fetch-native, nothing here is committed (.cache
// is ignored); each build stays under its author's licence.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { identify } from "../ui/web/native-kinds.js";
import { selfStarts } from "./self-start.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "firmwares", "dist");
const out = join(root, ".cache", "native");
mkdirSync(out, { recursive: true });

const listed = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8")).builds;
// Felucca's entry is FMini-1's file again, and Felucca stays emulated (its package is the real thing)
const skip = new Set(["Felucca"]);

const manifestPath = join(out, "manifest.json");
const before = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).builds : [];
const imported = [];
for (const b of listed) {
  if (skip.has(b.id) || !existsSync(join(dist, b.file))) continue;
  const bytes = readFileSync(join(dist, b.file));
  let module;
  try { module = new WebAssembly.Module(bytes); } catch (e) { console.log(`${b.name.padEnd(20)} NOT WEBASSEMBLY: ${e.message}`); continue; }
  const exports = WebAssembly.Module.exports(module).filter((e) => e.kind === "function").map((e) => e.name).filter((n) => !n.startsWith("_")).sort();
  const imports = [...new Set(WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`))].sort();
  const { family, style, note } = identify(exports, imports);
  const autostarts = await selfStarts(bytes, style); // (it plays by itself from power on: the page loads it muted)
  copyFileSync(join(dist, b.file), join(out, `${b.id}.wasm`));
  imported.push({
    id: b.id, name: b.name, repo: b.repo, branch: b.branch, path: `firmwares/dist/${b.file}`, commit: b.commit || "0000000",
    source: b.url, file: `${b.id}.wasm`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    family, style, note, autostarts, exports, imports,
  });
  console.log(`${b.name.padEnd(20)} ${String(Math.round(bytes.length / 1024)).padStart(5)} KB  ${family.padEnd(11)} ${style ? "plays" : "listed only: " + note}${autostarts ? "  (starts by itself)" : ""}`);
}

const repos = new Set(imported.map((b) => b.repo.toLowerCase()));
const kept = before.filter((b) => !repos.has(b.repo.toLowerCase()));
writeFileSync(manifestPath, JSON.stringify({ fetched_at: new Date().toISOString(), builds: [...imported, ...kept] }, null, 2));
console.log(`\n${imported.length} imported, ${kept.length} kept from before, in ${out}`);
