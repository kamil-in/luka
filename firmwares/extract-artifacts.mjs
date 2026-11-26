// Node.js script to reliably retrieve, extract, and verify web native WASM artifacts
// for every FM-1 community firmware in ARTIFACT_MAP.
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
    ref: 'origin/gh-pages:arctic.wasm', // (grimm.wasm until 2.0; arctic.wasm from 2.1)
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
  {
    id: 'OG-Synth-source',
    name: 'OG Synth',
    type: 'web',
    url: 'https://ogsynth.cc/emulator/app.wasm',
  },
  {
    id: 'FM1-Animatek',
    name: 'ATEK 303',
    type: 'git',
    ref: 'origin/gh-pages:atek303/play/app.wasm',
  },
  {
    id: 'JIANT',
    name: 'JIANT',
    type: 'web',
    url: 'https://juanjiant-bit.github.io/JIANT/emu/felucca.wasm',
  },
  {
    id: 'Golana',
    name: 'Golana',
    type: 'web-html-b64',
    url: 'https://gadlele.github.io/Golana/try/',
  },
  {
    // (built by its Pages workflow, not kept in the repository)
    id: 'loaf-breaker',
    name: 'LOAF BREAKER',
    type: 'web',
    url: 'https://flexor-r.github.io/loaf-breaker/emu/app.wasm',
  },
  {
    id: 'OSR-1',
    name: 'Blop',
    type: 'git',
    ref: 'origin/gh-pages:emu/app.wasm',
  },
  {
    id: 'jamtrack-fm1',
    name: 'JAMTRACK',
    type: 'local',
    path: 'companion/emulator/app.wasm',
  },
  {
    id: 'PERF-1',
    name: 'PERF-1',
    type: 'git',
    ref: 'origin/gh-pages:emu/amb.wasm',
  },
  {
    // (the page inlines the wasm and the sound pack; the pack goes into the wasm's "luka.pack" section)
    id: 'm-pyre',
    name: 'M-PYRE',
    type: 'local-html-pack',
    path: 'docs/emu/index.html',
    wasmVar: 'WASM_B64',
    packVar: 'PACK_B64',
  },
  // Added 2026-11-21 (SLOOP 3 and JamesOS publish no browser build: cloned and documented only)
  {
    // (fm1-base's emulator, built by its Pages workflow)
    id: 'fm-1-chimera-vocal',
    name: 'Chimera Vocal',
    type: 'web',
    url: 'https://shan-sherif.github.io/fm-1-chimera-vocal/emu/app.wasm',
  },
  {
    id: 'demake-synth',
    name: 'Demake',
    type: 'local',
    path: 'web/dmk.wasm',
  },
  {
    // (the site's build: newer than the copy in site/emulator/)
    id: 'viscera',
    name: 'viscera',
    type: 'web',
    url: 'https://de-pattern.github.io/viscera/emulator/viscera.wasm',
  },
  // Added 2026-11-26
  {
    // (publishes no browser build: build-firmwares.ps1 builds fm1-base's web emulator, with patches/h1/,
    // when emcc is installed; without it the build already in dist/ stays)
    id: 'h1',
    name: 'h1',
    type: 'local',
    path: 'app/build/emu/app.wasm',
  },
];

// A WebAssembly custom section (engines skip it): how a build carries what its page inlined
// beside it, such as M-PYRE's sound pack (read by ui/web/native-worklet.js as "luka.pack").
function leb(n) {
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
function withSection(wasm, name, payload) {
  const nameBytes = Buffer.from(name, 'utf8');
  const body = Buffer.concat([leb(nameBytes.length), nameBytes, payload]);
  return Buffer.concat([wasm, Buffer.from([0]), leb(body.length), body]);
}

// A page that inlines its build as base64 in a JS string (`const NAME = "..."`).
function inlined(html, name) {
  const m = html.match(new RegExp(`const ${name}\\s*=\\s*"([A-Za-z0-9+/=]*)"`));
  return m ? Buffer.from(m[1], 'base64') : null;
}

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

  // A page in the repo that inlines the wasm and a sound pack as JS strings (M-PYRE)
  if (item.type === 'local-html-pack') {
    const src = join(repoDir, item.path);
    if (existsSync(src)) {
      const html = readFileSync(src, 'utf8');
      const wasm = inlined(html, item.wasmVar), pack = inlined(html, item.packVar);
      if (wasm && pack && pack.length) {
        writeFileSync(outPath, withSection(wasm, 'luka.pack', pack));
        return true;
      }
      console.warn(`  [WARN] ${item.id}: ${item.path} has no ${wasm ? item.packVar : item.wasmVar}`);
    }
  }

  // If web binary or web HTML with base64 wasm
  // (fetched again every run, so an author's newer publish comes in; the last copy stays if the fetch fails)
  if (item.type === 'web' || item.type === 'web-html-b64') {
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
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.subarray(0, 4).toString('latin1') !== '\0asm') throw new Error('not WebAssembly');
        writeFileSync(outPath, buf);
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
