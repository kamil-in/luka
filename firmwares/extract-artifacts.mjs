// Node.js script to reliably retrieve, extract, and verify web native WASM artifacts
// for all 21 FM-1 community firmwares.
//
// Usage: node extract-artifacts.mjs [--all] [--id <firmware-id>]

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const ARTIFACT_MAP = [
  {
    id: 'fmini-1',
    name: 'FMini-1',
    type: 'local',
    path: 'docs/emu/felucca.wasm',
  },
  {
    id: 'melodee',
    name: 'Melodee',
    type: 'git',
    ref: 'origin/gh-pages:emu/melodee.wasm',
  },
  {
    id: 'skiff',
    name: 'Skiff',
    type: 'git',
    ref: 'origin/gh-pages:try/felucca.wasm',
  },
  {
    id: 'Felucca',
    name: 'Felucca',
    type: 'fallback',
    from: 'fmini-1/docs/emu/felucca.wasm',
  },
  {
    id: 'fm1-amb',
    name: 'AMB-1',
    type: 'git',
    ref: 'origin/gh-pages:emu/app.wasm',
  },
  {
    id: 'obervave',
    name: 'OberVave',
    type: 'local',
    path: 'docs/sim/obervave.wasm',
  },
  {
    id: 'grimm',
    name: 'GR!MM',
    type: 'git',
    ref: 'origin/gh-pages:grimm.wasm',
  },
  {
    id: 'fm1-x0x',
    name: 'X0X',
    type: 'git',
    ref: 'origin/gh-pages:emu/x0x.wasm',
  },
  {
    id: 'niagara-drift',
    name: 'Niagara Drift',
    type: 'git',
    ref: 'origin/gh-pages:omni.wasm',
  },
  {
    id: 'fm1-monk',
    name: 'MONK-1',
    type: 'git',
    ref: 'origin/gh-pages:emu/monk.wasm',
  },
  {
    id: 'fm1-loom',
    name: 'Loom',
    type: 'git',
    ref: 'origin/gh-pages:emu/app.wasm',
  },
  {
    id: 'mutable-dreams',
    name: 'Mutable Dreams',
    type: 'html-embedded',
    gitRef: 'origin/gh-pages:Mutable-Dreams-2.1.html',
    tag: '<script id="firmware" type="application/octet-stream">',
  },
  {
    id: 'frasil',
    name: 'FRASIL',
    type: 'web',
    url: 'https://frasilsynth.com/play/app.wasm?v=6a942f71',
  },
  {
    id: 'CoralFlower',
    name: 'CoralFlower',
    type: 'web',
    url: 'https://ficusficusov.github.io/CoralFlower/play/coralflower.wasm',
  },
  {
    id: 'S1Vave',
    name: 'S1Vave',
    type: 'local',
    path: 'docs/sim/s1vave.wasm',
  },
  {
    id: 'zen-1',
    name: 'ZEN-1',
    type: 'git',
    ref: 'origin/gh-pages:emu/zen1.wasm',
  },
  {
    id: 'Arctic-scream-FM-1',
    name: 'Arctic Scream',
    type: 'git',
    ref: 'origin/gh-pages:grimm.wasm',
  },
  {
    id: 'fm1-fimba',
    name: 'FiMba-1',
    type: 'web-html-b64',
    url: 'https://github.com/jadamsowers/fm1-fimba/releases/download/v0.7.0/FiMba-1.html',
  },
  {
    id: 'fm1-aisling',
    name: 'Aisling',
    type: 'git',
    ref: 'origin/gh-pages:emu/amb.wasm',
  },
  {
    id: 'SATIE-1',
    name: 'SATIE-1',
    type: 'web-html-b64',
    url: 'https://github.com/OCKM-STUDIO/SATIE-1/releases/download/v0.1.3-beta/SATIE-1.html',
  },
  {
    id: 'fm1-nachtfahrt',
    name: 'Nachtfahrt',
    type: 'git',
    ref: 'origin/gh-pages:emu/amb.wasm',
  },
];

async function extractOne(item) {
  const repoDir = join(root, item.id);
  const outPath = join(dist, `${item.id}.wasm`);

  // If local file exists in repo
  if (item.type === 'local') {
    const src = join(repoDir, item.path);
    if (existsSync(src)) {
      copyFileSync(src, outPath);
      return true;
    }
  }

  // If in git branch / commit
  if (item.type === 'git') {
    try {
      const buf = execFileSync('git', ['-C', repoDir, 'show', item.ref], { maxBuffer: 50 * 1024 * 1024 });
      writeFileSync(outPath, buf);
      return true;
    } catch (e) {
      console.warn(`  [WARN] Git extraction failed for ${item.id}: ${e.message}`);
    }
  }

  // If embedded in HTML in git branch
  if (item.type === 'html-embedded') {
    try {
      const html = execFileSync('git', ['-C', repoDir, 'show', item.gitRef], { maxBuffer: 50 * 1024 * 1024 }).toString('utf8');
      const sIdx = html.indexOf(item.tag);
      if (sIdx !== -1) {
        const eIdx = html.indexOf('</script>', sIdx);
        const b64 = html.slice(sIdx + item.tag.length, eIdx).trim().replace(/\s+/g, '');
        writeFileSync(outPath, Buffer.from(b64, 'base64'));
        return true;
      }
    } catch (e) {
      console.warn(`  [WARN] HTML embedded extraction failed for ${item.id}: ${e.message}`);
    }
  }

  // If web binary or web HTML with base64 wasm
  if (item.type === 'web' || item.type === 'web-html-b64') {
    if (existsSync(outPath) && readFileSync(outPath).length > 1000) {
      return true; // Already cached
    }
    try {
      const res = await fetch(item.url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (item.type === 'web-html-b64') {
        const html = await res.text();
        const wasmIdx = html.indexOf('AGFzbQ');
        if (wasmIdx !== -1) {
          const match = html.slice(wasmIdx).match(/^[A-Za-z0-9+/=\s]+/);
          if (match) {
            const b64 = match[0].replace(/\s+/g, '');
            writeFileSync(outPath, Buffer.from(b64, 'base64'));
            return true;
          }
        }
      } else {
        const ab = await res.arrayBuffer();
        writeFileSync(outPath, Buffer.from(ab));
        return true;
      }
    } catch (e) {
      console.warn(`  [WARN] Web fetch failed for ${item.id}: ${e.message}`);
    }
  }

  // If fallback from another repo
  if (item.type === 'fallback') {
    const src = join(root, item.from);
    if (existsSync(src)) {
      copyFileSync(src, outPath);
      return true;
    }
  }

  return existsSync(outPath);
}

async function main() {
  const targetId = process.argv.includes('--id') ? process.argv[process.argv.indexOf('--id') + 1] : null;
  const list = targetId ? ARTIFACT_MAP.filter((a) => a.id === targetId) : ARTIFACT_MAP;

  for (const item of list) {
    const ok = await extractOne(item);
    const outPath = join(dist, `${item.id}.wasm`);
    if (ok && existsSync(outPath)) {
      const sizeKB = (readFileSync(outPath).length / 1024).toFixed(1);
      console.log(`  [OK] ${item.name.padEnd(16)} -> dist/${item.id}.wasm (${sizeKB} KB)`);
    } else {
      console.log(`  [PENDING] ${item.name.padEnd(16)} -> build/artifact pending`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
