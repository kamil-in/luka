# Hand-off: Luka (the FM-1 adapter)

Written 2026-11-14, at the end of the conversation that built everything below. Read this
first in a new conversation; it is the state of the project, not a design wish list.

## What this is

An app for playing community firmwares for the M-VAVE FM-1 pocket synth without the
device. A user pastes a firmware's GitHub link; the app fetches it once and plays it, with
the device's screen, keys, knobs and sound. Two clients share one UI: a Tauri desktop app
and a web app.

Decisions the owner made, which still stand:

- **Emulator only** for now (no flashing of a real device).
- **Not tied to thefirmwarehub.com in any way**: no hub ids, files, lists or calls.
- **Modular**: fetching, playing and display are separate modules, and the UI must be
  replaceable (Tauri now, web now, anything later).
- **No CLI.** Each module is a library with tests; do not add command-line front ends.
- **Web is likely the primary client.**
- **Performance matters more than polish**, especially clean audio.

## Layout

```
crates/fma-fetch     link -> release -> package on disk (library.json + packages/)
crates/fma-player    Emulator trait; Fm1Emu wraps the fm1-emu crates
crates/fma-display   protocol (Command/Event), Transport trait, Player, Session (native)
crates/fma-wasm      Player behind plain wasm exports, for the browser
apps/desktop         Tauri shell: a Transport + sound card output (cpal)
apps/web-server      static files + GitHub proxy (/api/resolve, /api/download) + /native/
ui/                  shared front panel: index.html, style.css, app.js
ui/transport-tauri.js          desktop transport
ui/web/transport-web.js        web transport (library in IndexedDB, routes to a player)
ui/web/player-worklet.js       emulator in the audio thread
ui/web/native-worklet.js       a firmware's own browser build in the audio thread
ui/web/native-kinds.js         which family a build is, from its exports (shared: Node tools + worklet)
tools/build-web.ps1            builds the wasm player
tools/fetch-native.mjs         downloads firmwares' own browser builds
tools/import-builds.mjs        takes firmwares/dist/*.wasm into .cache/native + manifest (what the page lists)
firmwares/                     owner's clones of the firmware repos + build scripts + dist/ + per-build docs
tools/native-builds.json       which file in which repo, chosen by hand
```

Dependencies only go downward in that list. `ui/app.js` talks to a transport and nothing
else; a new client is a new transport file plus whatever sits behind it.

The emulator is `joakimeriksson/fm1-emu` (MIT), a git dependency pinned to commit
`883e10f8` in the root `Cargo.toml`. It has no documented library API; `fm1emu.rs` follows
what its own native player and web build do.

## Running it

Windows, PowerShell. Rust stable (1.99), Node 24, the `wasm32-unknown-unknown` target is
installed. No npm, no bundler: the UI is plain HTML/CSS/JS modules.

```
# desktop
cargo run --release -p fma-desktop

# web: build the wasm player once (and after changing fma-wasm/display/player), then serve
tools\build-web.ps1
cargo run --release -p fma-web-server        # http://127.0.0.1:8787  (PORT or --port to change)

# optional: the firmwares' own browser builds, into .cache/native/
node tools\fetch-native.mjs

# tests (the emulator ones must be optimised, and need .cache/firmware/felucca-1.8.2.fwsc)
cargo test --release -p fma-fetch -p fma-player -p fma-display -p fma-desktop -p fma-web-server
cargo test -p fma-fetch --test live -- --ignored --nocapture      # hits GitHub
```

`.claude/launch.json` has a `web` entry for the preview pane. If a server will not rebuild
("failed to remove file ... fma-web-server.exe"), an old `fma-web-server` process is still
running: stop it first.

Desktop app data: `%APPDATA%\dev.luka.desktop` (library, packages, saves).
Web app data: the browser's IndexedDB database `fma`, plus `localStorage["fma.clock"]`.

## What works, and how it was checked

| Piece | State | Checked by |
|---|---|---|
| fetch: link forms, latest/prerelease, several packages, cache, SHA-256 | done | unit tests + live GitHub test |
| player: boot, screen, audio, input, LEDs, saves | done | tests against Felucca 1.8.2 |
| display: protocol, pacing, auto-save, error events | done | unit tests + real-firmware session test |
| desktop app | done; **owner confirmed sound is clean** | driven over DevTools protocol + owner's ears |
| web app, emulated | done; **owner confirmed clean at 120 MHz** | measured in the preview pane + owner's ears |
| web app, native browser builds | 6 of 10 play | started each, screenshots, load meter; **nobody has listened** |
| redesigned UI (light and dark) | done | screenshots in both schemes |

The project is under git (branch `master`). `spike/` was deleted.

## Audio: the hard-won part

Three faults were found and fixed. Do not undo these without measuring.

1. **Desktop, static and tiny gaps.** The session waited on its command queue with a
   timeout, which on Windows is only as fine as the 16 ms system timer, so audio arrived in
   lumps. Fix: while a firmware plays, `Session` uses `try_recv` + `thread::sleep`
   (`session.rs`). And the sound output's drift correction follows the buffer's *average*
   level, not its instantaneous one (`apps/desktop/src/audio.rs`). `FMA_AUDIO_LOG=1`
   prints buffer statistics once a second.
2. **Web, same symptom.** A worker on a timer feeding an audio worklet did not hold up.
   Fix: the emulator runs *inside* the audio worklet, one tick per 128-frame block, with
   the AudioContext at 44.1 kHz so nothing is resampled. This is how fm1-emu's own page
   works. Output latency hint is 60 ms; JIT compiles are capped at 16 per block.
3. **Web, still stuttering at the device's full clock.** Emulating 240 MHz in WebAssembly
   took ~61% of a core with 7% of blocks late; at 120 MHz, 35% and 0.3%. The web default
   is now **120 MHz**, with automatic step-down (240, 160, 120, 100, 80, 60) when blocks
   run late, remembered per browser. Desktop stays at 240.

Address switches on the web client, for experiments: `?mhz=N` (fixes the clock, disables
step-down), `?latency=N` (ms), `?native=0` (emulate even if a browser build exists).
`fma.stats()` in the console returns the audio thread's load figures.

I cannot hear. Every audio claim above is either a measurement or the owner's report.
Ask the owner to listen after any change to the audio path.

## Native browser builds (the newest work)

Some firmware authors compile their own source to WebAssembly and publish it. Played that
way a firmware costs about 1% of a core, against 35% emulated. `native-worklet.js` adapts
such a build to the same messages the emulator's worklet speaks.

Source of the builds: `firmwares/build-firmwares.ps1` (owner's script) clones the repos and
puts each wasm in `firmwares/dist/`; `node tools/import-builds.mjs` copies them into
`.cache/native/` and writes the manifest, deciding each build's family with
`ui/web/native-kinds.js`. Felucca's dist entry is FMini-1's file again and is skipped (Felucca
stays emulated). 24 builds are listed and all play (OG Synth, ATEK 303, JIANT and Golana were added 2026-11-16 from the authors' published sites, since no wasm compiler is installed here; SLOOP was taken out of the list by the owner):

| Family (style) | Builds | State |
|---|---|---|
| felucca | FMini-1, Skiff | play |
| x0x | AMB-1, X0X, Niagara Drift, MONK-1, Loom, Mutable Dreams, FRASIL, ZEN-1, FiMba-1, Aisling, SATIE-1, Nachtfahrt | play (the 8 newest: started, screen drawn, load 0-3%, none late) |
| melodee | Melodee | play; our ids are its ids, MASTER at boot, no storage |
| sim | OberVave, S1Vave | play; sim_* names, per-id buttons/keys, 9-blob save, host byte order screen |
| asyncify | GR!MM, Arctic Scream | play; the loop is a coroutine the worklet drives (`step`/`yieldNow` in native-worklet.js, as the authors' own worklet.js does) |
| coralflower | CoralFlower | play; felucca's labels/roles/byte order under its own names, needs a real WASI `clock_time_get` (a stub that writes nothing hangs it), lights as one 42-entry array, 1 MiB flash staged in before boot |

Checked 2026-11-14 (CoralFlower: starts, screen right, chord-key LEDs lit, GLO opens its Global page, load 3%, key makes sound in Node; asyncify too: both start, GR!MM's screen and its GLO button work, load 0-1%, and in Node a held key makes sound on both): each playing build started from the page, drew its screen, and ran light;
S1Vave's ENV button changed its page and lit its LED; in Node, a held key makes sound on
OberVave, S1Vave and Melodee. **Nobody has listened**, and per-family details the new x0x
builds add (Loom's `web_out_pkts`, Aisling's `web_midi_buf`, Zen-1/Frasil/Mutable Dreams
extra parameters) are not used: they play through the plain x0x path only.

The builds live in `.cache/native/` (git-ignored) with a `manifest.json`; the server serves
them at `/native/`. `fetch-native.mjs` decides `style` from a build's exports.

Open points here:

- **Saving is untested** for the x0x family and the sim builds (OberVave/S1Vave) and Melodee has none (the storage code in `native-worklet.js`
  `stored()`/`restore()` is new).
- **Discovery is manual.** `tools/native-builds.json` (fetch route) and `firmwares/build-firmwares.ps1` (import route) are hand-made lists.
- **Licence.** The builds are GPL-3.0. Serving them from our own server is redistribution
  if that server is ever public. The owner knows; an alternative is fetching each from its
  author's site at play time (they allow cross-site loading), which the first prototype did.
- **Versions.** A browser build is whatever its author last published, not tied to a
  release; the UI says so when it plays one in place of a library firmware.

## To do

Asked for by the owner:

- **The module that identifies each build's interface: done in first form** as
  `ui/web/native-kinds.js` (`identify(exports, imports)` -> family, style, note). Open: it only
  reports and picks an adapter; it does not cover `.fwsc` packages.
- **No adapters missing.** Not done for the asyncify
  builds: their SysEx editor protocol, Arctic Scream's sequencer state (`web_seq_state`), and
  resampling when the browser's rate is not 44.1 kHz (the page asks for 44.1 kHz). Not done for
  CoralFlower: MIDI out (drained nowhere), saving checked only by reading the code.

## Ideas discussed, not built

- **Building firmware source in the browser** (a compiler shipped as wasm). Possible in
  principle; the blockers are the Python generation steps these builds run first, and
  per-repo build recipes. Suggested test, not run: compile Felucca using FMini-1's
  `web/emu/felucca_web.c` (it has a switch for Felucca's full UI).
- **Several emulated firmwares at once** (browser builds: done, see above). Emulated ones
  are limited to one or two; more would need one worker per core with buffered audio.
- **Hosting the web app publicly** needs HTTPS in front of `fma-web-server` (browsers
  require it for the hashing the page uses) and a `GITHUB_TOKEN`, since all visitors share
  the server's GitHub rate limit (60 lookups an hour without one).

## Smaller loose ends

- Window icon is a generated placeholder; no installer (Tauri bundling is off).
- Encoders cannot be pressed in the UI (unknown whether the real knobs click).
- SMK-37 packages load in the emulator but there is no SMK-37 panel.
- The UI font names Neue Haas Grotesk first (licensed, not shipped); Helvetica/Arial stand in.
- `fma-fetch`'s "no package" error lists every file of the release, which can be long.
- `THIRD-PARTY.md` carries fm1-emu's MIT notice (its JIT glue is adapted in
  `player-worklet.js`). Keep it if that code stays.

## Several firmwares at once (2026-11-15)

Up to four browser builds play together. Read this before the "UI" section below, which
describes the page before this change (its list column, big heading and per-row GitHub link
are gone).

- **Transport** (`ui/web/transport-web.js`): four slots. `start_build`, `start`, `stop`,
  `input` and the new `mute` carry `slot` (none: 0); `started`, `stopped`, `leds`, `muted`,
  errors and frames (`onFrame(rgba, slot)`) carry it back. A slot is one worklet node behind
  one gain node; a slot that stops is freed (`dispose` to the worklet, which then returns
  false from `process`). Replacing a slot's firmware makes a new node; the transport itself
  says `stopped` for the old one, so the order of events does not depend on two ports.
  The same firmware cannot be in two slots (they would store over each other). The emulator
  stays one at a time. `connect()` returns `slots` (4); a transport without it gets one screen.
- **Rust protocol**: not changed beyond a doc comment and `Build.autostarts`. The native
  `Session` plays one firmware and ignores a `slot` sent to it.
- **Self-starting builds**: `tools/self-start.mjs` runs a build in Node through
  `native-worklet.js` for 14 s of device time with nothing pressed, and calls it
  self-starting if there is sound (peak >= 0.004) after second 8. Both import tools write
  that as `autostarts` in the manifest. Found: Aisling, AMB-1, Nachtfahrt, SATIE-1, ZEN-1.
  CoralFlower's power-on sound (gone by 5 s) and Mutable Dreams' blip do not count. Pressing
  PLAY stops Aisling, Nachtfahrt and SATIE-1 within about 4 s and AMB-1 after about 20 s;
  ZEN-1's quiet drone ignores it. No build exports a way to prevent it, so the page loads
  them stopped (`paused: true` on `start_build`).
- **Stopped (paused) is not unloaded** (owner's wording, 2026-11-15: the list says
  load/unload, a screen says play/stop). `pause` (`{type, slot, paused}` -> `paused` event)
  makes the worklet skip the firmware: silence, its clock standing still (CoralFlower's WASI
  clock subtracts the time held), the screen frozen. A firmware loaded stopped has drawn
  nothing yet, so its screen is black until its play. `stop` in the protocol still means
  unload (the slot is emptied).
- **Page** (`ui/app.js`, owner's design): four screens in a row, each with number, name,
  mute, stop; **one** panel (8 knobs in a row, 14 buttons in a row, keys) that plays the
  chosen screen (click, or keys 1-4). Changing screen releases what was held; LEDs and the
  MASTER position are each screen's own. A stopped firmware gets nothing from the panel and
  the panel is greyed (owner: "disable any activity for that firmware" until it plays); mute
  is sound only. The list is a drawer behind the menu button; rows are name, load/unload,
  source. Load fills the chosen screen if empty, else the first empty one.
- **Checked** in the preview pane: four at once at 5-7 % total load, 1-2 late blocks in
  ~1400; duplicate and bad-slot errors; mute, stop/play (no frames made while stopped), unload,
  replace; light and dark; 375 px wide. **The owner played four at once and reported no
  issues.** The sum of four outputs has no headroom or limiter: measure the
  peak if the owner reports distortion. The desktop window was not launched after this change.

## UI (changed 2026-11-14)

The app is called **Luka**. Left (a 250px column): a "firmwares" heading (h3), a search box (filters by
name and repo, every word must match; an X appears once there is text, Escape also clears) and
the list of browser builds, sorted a to z by name; only the list scrolls,
the panel on the right stays put (wide layouts; below 1080 px it is one column with the list
capped at 60vh). **The add-a-link form, the library list and the release chooser were removed
from the page** (owner's call): there is no way in the UI to add a firmware by GitHub link any
more, though the transports and `fma-fetch` still support it. The right heading is the playing
firmware's name, empty when none. Play is a compact solid button (stop turns orange on the
playing row); a firmware's meta line links to its GitHub repo. A button in the bar switches
light/dark (`localStorage["luka.theme"]`; none chosen: the system's). Heading font-smoothing is
on h1-h3 only (it has an effect on macOS; Windows ignores it). Scrollbars are flat, square, no
arrows, in the ink colour (so light in the dark theme). The keyboard hint is one line (its
type shrinks with the column to a floor, then it wraps). The desktop window and product name are
"Luka" too; the identifier is `dev.luka.desktop` (renamed 2026-11-15 from `dev.fm1adapter.desktop`; `main.rs` moves the old data folders, in %APPDATA% and %LOCALAPPDATA%, on first start).

**The desktop app now shows and does the same as the web app (2026-11-14).** Its window runs the
web transport (`app.js` prefers `web/transport-web.js` wherever it can run, the web view
included), so the 20 browser builds play there through Web Audio, with saves in the web view's
IndexedDB. Two Rust commands in `apps/desktop/src/main.rs` read what a web server would serve:
`native_manifest` and `native_file` (from `FMA_NATIVE`, or `.cache/native` found from the working
directory or the program's own folder: run `node tools/import-builds.mjs` first). `open_link` opens
GitHub links in the system browser (a web view opens nothing for `target=_blank`; it refuses any
address that is not `https://github.com/...`). **What changed for the desktop:** the Rust emulator
and the sound card output (`cpal`) are no longer used by this page; they, and
`ui/transport-tauri.js`, are kept and still tested, for `.fwsc` packages, but nothing in the UI
reaches them now. Checked by driving the running window over the DevTools protocol (launch with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`): all 20 start and draw at
1-8 % load (a few late blocks in the first second on MONK-1, OberVave, S1Vave), and search, X,
sort, scrolling, theme and links behave as on the web. Not listened to.

## Working with the owner

- Wants a plan before a large piece of work, then builds one module at a time.
- Tests audio by ear and reports back; expects measurements, not guesses, when it is wrong.
- Reference for the visual style: https://aidesign-os.com/modalities (flat, sharp, bold,
  lowercase, pleasant in light mode).
