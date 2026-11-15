# Luka: Technical Documentation

How Luka is built, how to build and run it from source, and how to work on it. For what it is and how to
play it, see the [README](README.md).

**Contents:** [Architecture](#architecture--principles) · [Repository layout](#repository-layout) ·
[Prerequisites](#prerequisites) · [Getting the firmwares](#getting-the-firmwares) ·
[Running](#running-the-application) · [Hosting on GitHub Pages](#static-site--github-pages) ·
[MIDI controllers](#midi-controllers) · [Firmware families](#supported-firmware-families) ·
[Tests](#running-tests) · [Audio notes](#audio-notes)

---

## Architecture & Principles

Two clients share a single front-panel UI (`ui/`), which is the same page in both:

1. **Web App**: runs in the browser. Served by a small local server (`apps/web-server`) while developing, or as a
   static site (GitHub Pages).
2. **Desktop App**: a Tauri window around the same page, which reads the builds from disk.

Luka plays each firmware's **own browser build**: many authors compile their firmware's source to WebAssembly and
publish it. Played that way a firmware costs about 1% of a core.

* **Independent of External Hubs**: no firmware hub services or IDs.
* **Modular Separation**: fetching (`fma-fetch`), playing (`fma-player`) and display/protocol (`fma-display`) are separate crates. The UI talks only to a transport (`Command` and `Event` messages), so a new client is a new transport file.
* **Browser builds**: `ui/web/native-worklet.js` adapts each build's exported functions to one set of messages. `ui/web/native-kinds.js` works out from a build's exports which family it is (used both at import time and when a build starts).
* **Emulator kept**: `.fwsc` packages can still be emulated (`fm1-emu` core, in Rust natively and in WebAssembly for the browser). The current page does not offer them; the code and tests remain.
* **Audio-First Performance**: browser builds and the emulator run inside an `AudioWorklet` at 44.1 kHz, one tick per 128-frame block, so there is no timer jitter.
* **MIDI is its own module** (`ui/midi/`): it imports nothing from the page, and the page joins it in `ui/midi-controller.js`.

### How the page works

* **Four screens**, one for each firmware playing. Each has the firmware's name, **mute** and **stop** / **play**. Stop holds the firmware where it is, still loaded and silent; play lets it go on.
* **One front panel** (27 keys, 14 buttons, 8 knobs, LEDs) plays the chosen screen. It is greyed out while that screen is empty or its firmware is stopped.
* **The firmware list** is a drawer behind the menu button, sorted a to z, with a search box (every word must match the name or repository).
* **Load** puts a firmware on the chosen screen if it is empty, otherwise on the first empty one; with all four taken, unload one first.
* Firmwares that **play by themselves** from power on are loaded **stopped**. Which ones do is measured when the builds are imported (`tools/self-start.mjs`).
* What a firmware saves is kept per browser (IndexedDB) or per desktop window.

---

## Repository Layout

```
crates/fma-fetch         Link resolution, GitHub release downloading, package caching
crates/fma-player        Emulator trait, panel ids, fm1-emu wrapper
crates/fma-display       Command/Event protocol, Transport trait, player pacing, native Session
crates/fma-wasm          The emulator compiled to wasm for the browser
apps/desktop             Desktop client (Tauri); Rust commands that read the builds from disk and open links
apps/web-server          Static server + GitHub proxy + the builds at /native/
ui/                      The front panel: index.html, style.css, app.js (plain HTML/CSS/JS, no bundler)
ui/web/transport-web.js  The transport both clients use: list, storage, routing to a player
ui/web/native-worklet.js A firmware's own browser build, in the audio thread (all families)
ui/web/native-kinds.js   Which family a build is, from its exports
ui/web/player-worklet.js The emulator in the audio thread
ui/transport-tauri.js    The first desktop transport (Rust emulator + sound card); not used by the page at present
ui/midi/                 MIDI controllers (own module; learned controls, profiles): see ui/midi/README.md
ui/midi-controller.js    The page's side of MIDI: the button, the list of controls to learn
tools/build-web.ps1      Builds the wasm emulator (fma-wasm)
tools/build-pages.mjs    Builds the static site for GitHub Pages into _site/
tools/pages-sw.js        The service worker that keeps firmware builds in the browser
tools/import-builds.mjs  Takes firmwares/dist/*.wasm into .cache/native and writes the list the app shows
tools/self-start.mjs     Runs a build with nothing pressed, to see whether it plays by itself (used by both import tools)
tools/fetch-native.mjs   Alternative: downloads the builds from the authors' sites
tools/native-builds.json Catalog for fetch-native.mjs
tests/midi/              Tests for the MIDI module (node --test)
firmwares/               Clones of the firmware repositories, build scripts, dist/ and per-build interface docs
docs/                    Images for the README
```

---

## Prerequisites

* **Operating System**: Windows (PowerShell)
* **Rust**: stable, with the wasm target:
  ```powershell
  rustup target add wasm32-unknown-unknown
  ```
* **Node.js**: 20+ (24 recommended), for the tools only
* **Git** on `PATH`

---

## Getting the firmwares

The app lists whatever is in `.cache/native/` (git-ignored). To fill it:

```powershell
# 1. Clone/update the firmware repositories and collect their browser builds into firmwares/dist/
#    (also double-clickable: firmwares\build-all.cmd)
.\firmwares\build-firmwares.ps1

# 2. Copy them into .cache/native and write the list the app shows
node tools\import-builds.mjs
```

Step 1 also writes the interface specifications to [`firmwares/INTERFACES.md`](firmwares/INTERFACES.md) and [`firmwares/docs/`](firmwares/docs/). `node tools\fetch-native.mjs` is an alternative to both steps for the builds listed in `tools/native-builds.json` (it downloads them from the authors' sites). The import merges with what is already in the cache.

---

## Running the Application

### Web App

```powershell
cargo run --release -p fma-web-server        # http://127.0.0.1:8787  (PORT or --port to change)
```

The emulator's wasm (`tools\build-web.ps1`) is only needed for emulating packages. Open `http://127.0.0.1:8787`.

*Data*: the browser's `IndexedDB` database `fma`, plus `localStorage` (`luka.theme`, `fma.clock`, `luka.midi.learned`).

### Static Site / GitHub Pages

The web application is fully client-side and can be hosted statically (e.g. GitHub Pages). The published site is at
<https://kamil-in.github.io/luka/>.

```powershell
node tools/build-pages.mjs                  # builds static site to _site/
```

The bundle is trimmed for a static host: no emulator wasm and no desktop transport, a compact list, hints that start the page's load chain at once, and a service worker (`tools/pages-sw.js`) that keeps each firmware's wasm in the browser (the file's address carries its hash), since Pages fixes its own caching at 10 minutes. The page and list are fetched network first, with the kept copy when offline.

When pushed to GitHub on branch `master`, `.github/workflows/deploy-pages.yml` automatically builds and publishes the web application to GitHub Pages.

### Desktop App (Tauri)

```powershell
cargo run --release -p fma-desktop
```

It reads the builds from `.cache/native` (found from the working directory or the program's folder; `FMA_NATIVE` points elsewhere), so run the import first. Sound goes through the window's Web Audio.

*Data*: `%APPDATA%\dev.luka.desktop` (the window's storage and, for the emulator path, packages and saves).

If a build fails with "failed to remove file ... .exe", an old copy of the program is still running: stop it first.

---

## MIDI controllers

A controller is used by **learning** it: nothing in the code knows a make or model. The page turns MIDI on by itself,
a **midi** button in the bar lists the controls to learn, and notes play the panel's keys with no setup. The whole
design (the manager, the rules that turn messages into page actions, the learn step, how to add a controller that
needs more than rules) is described in [`ui/midi/README.md`](ui/midi/README.md). Tests:

```powershell
node --test tests/midi/midi.test.mjs
```

Web MIDI is a Chromium feature (Chrome, Edge, Opera); the page asks for plain MIDI, not system-exclusive.

---

## Supported Firmware Families

All 20 listed firmwares play. A build's family decides which adapter code path handles it:

| Family | Firmwares | Notes |
|---|---|---|
| `felucca` | FMini-1, Skiff | masks by printed label, 1 MiB flash image |
| `x0x` | AMB-1, X0X, Niagara Drift, MONK-1, Loom, Mutable Dreams, FRASIL, ZEN-1, FiMba-1, Aisling, SATIE-1, Nachtfahrt | `web_fb` + `web_blits`, named storage objects |
| `melodee` | Melodee | this panel's own ids, no storage |
| `sim` | OberVave, S1Vave | `sim_*` names, state as blobs |
| `asyncify` | GR!MM, Arctic Scream | main loop run as a coroutine by the worklet |
| `coralflower` | CoralFlower | felucca-like, real WASI clock, 1 MiB flash staged before boot |

Felucca itself publishes no browser build and SLOOP is a sound engine without a panel: neither is listed. A browser build is whatever its author last published, and builds keep their authors' licences (mostly GPL-3.0).

---

## Running Tests

Release mode is needed for the emulator tests (they also need `.cache/firmware/felucca-1.8.2.fwsc`):

```powershell
cargo test --release -p fma-fetch -p fma-player -p fma-display -p fma-desktop -p fma-web-server

# Live GitHub resolution tests (network)
cargo test -p fma-fetch --test live -- --ignored --nocapture

# The MIDI module
node --test tests/midi/midi.test.mjs
```

---

## Audio Notes

* **Browser builds** (both clients): each firmware playing is an audio worklet node of its own behind its own gain (the mute), all in the one audio thread; 128 frames per block, `AudioContext` fixed at 44.1 kHz so nothing is resampled. Their outputs are added as they are, with no limiter. `fma.stats()` in the console shows the audio thread's load, in total and per screen (`fma.stats(0)` to `fma.stats(3)` for one).
* **Emulator, web**: the default clock is 120 MHz with automatic step-down (240, 160, 120, 100, 80, 60) when blocks run late; `?mhz=N`, `?latency=N` and `?native=0` are switches for experiments.
* **Emulator, desktop (Rust)**: `Session` paces with `try_recv` and short sleeps, and the sound output corrects drift from a smoothed buffer level. `FMA_AUDIO_LOG=1` prints buffer statistics once a second. Do not change these without measuring.

---

## License

GNU General Public License v3.0 (GPL-3.0-only). See [LICENSE](LICENSE). See [THIRD-PARTY.md](THIRD-PARTY.md) for third-party notices (including `joakimeriksson/fm1-emu`, MIT-licensed and GPL-compatible). Community firmware binaries remain under their authors' licences; credits are in the [README](README.md#credits).
