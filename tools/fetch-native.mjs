// Download the firmwares' own browser builds listed in tools/native-builds.json, each at
// its branch's latest commit, into .cache/native/ with a manifest the web server serves
// (/native/manifest.json) and the page lists.
//
//   node tools/fetch-native.mjs
//
// The builds are not part of this project and are not committed to it (.cache is ignored):
// each stays under its author's licence, and the manifest says where it came from.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { identify } from "../ui/web/native-kinds.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".cache", "native");
const { builds } = JSON.parse(readFileSync(join(root, "tools", "native-builds.json"), "utf8"));
mkdirSync(out, { recursive: true });

const manifest = [];
for (const b of builds) {
  try {
    // (the branch's commit now, so the file and what the manifest says of it agree)
    const ref = b.branch === "HEAD" ? "HEAD" : `refs/heads/${b.branch}`;
    const commit = execFileSync("git", ["ls-remote", `https://github.com/${b.repo}.git`, ref], { encoding: "utf8" }).split(/\s/)[0];
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`no ${b.branch} branch`);
    const url = `https://raw.githubusercontent.com/${b.repo}/${commit}/${b.path}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} for ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const module = new WebAssembly.Module(bytes);
    const exports = WebAssembly.Module.exports(module).filter((e) => e.kind === "function").map((e) => e.name).filter((n) => !n.startsWith("_")).sort();
    const imports = [...new Set(WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`))].sort();
    const { family, style } = identify(exports, imports);
    writeFileSync(join(out, `${b.id}.wasm`), bytes);
    manifest.push({
      id: b.id, name: b.name, repo: b.repo, branch: b.branch, path: b.path, commit, source: url,
      file: `${b.id}.wasm`, family, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), style, exports, imports,
    });
    console.log(`${b.name.padEnd(14)} ${String(Math.round(bytes.length / 1024)).padStart(5)} KB  ${commit.slice(0, 7)}  ${style || "no adapter yet"}  (${exports.length} exports, ${imports.length} imports)`);
  } catch (e) {
    console.log(`${b.name.padEnd(14)} FAILED: ${e.message}`);
  }
}
writeFileSync(join(out, "manifest.json"), JSON.stringify({ fetched_at: new Date().toISOString(), builds: manifest }, null, 2));
console.log(`\n${manifest.length} of ${builds.length} builds in ${out}`);
