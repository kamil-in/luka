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
stays emulated). 29 builds are listed and all play (2026-11-19: five more, see "Five more firmwares" above; OG Synth, ATEK 303, JIANT and Golana were added 2026-11-16 from the authors' published sites, since no wasm compiler is installed here; SLOOP was taken out of the list by the owner):

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
describes the page before this change, and the layout since moved again: read "Stage layout" below too (its list column, big heading and per-row GitHub link
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

## Stage layout (2026-11-19)

Supersedes the "Page" bullet above (four screens in a row, panel below) and the firmware list's
numbering. Files: `ui/index.html`, `ui/app.js`, `ui/style.css`. **Checked only by measuring boxes
in the preview pane (1024x768); not looked at on screen, not tried at phone width, no wider
window, no dark theme, and the desktop window was not launched. The UI changes are in commit 8286e7c.**

- **One block, `#device`**, a two-column grid centred in the page (horizontally, and vertically
  between the bar and the hints). Left: `#stage`, the chosen slot's firmware as a big square
  (`#stage-canvas`, an h3 `#stage-name` above it: the firmware's repo name, no number). Right:
  `#side`, a fixed 546 px wide, holding in order: the four slots, the 8 knobs, the 14 buttons,
  the keys. All four share that 546 px width.
- **Stage size** is `--stage` on `#device`: window height minus 230 px, or window width minus
  620 px, whichever is less, clamped 260-1000 px. Its canvas is a copy of the chosen slot's small
  canvas: `drawStage()` in `app.js` runs after every painted frame of the chosen slot, on select,
  and in `drawSlot`. The small canvases are the real targets of `onFrame`; the stage only mirrors.
- **Slots** are four fixed 130 px boxes in one row (`#slots`, space-between): a 115x115 preview,
  number + name under it, mute and stop under that. The chosen one has the orange border. An
  empty slot shows a small "choose firmware" button on its preview (opens the list); the stage
  has the same button when the chosen slot is empty. Left-to-right selection: keys 1-4, click, and
  the MIDI nav buttons (`step()` is unchanged: it skips empty slots).
- **Panel**: knobs in one row of 8 (44 px dials, 12 px labels). Buttons are 70x70 squares on a
  fixed grid: oct+ top-left, oct- under it, a 14 px gap, then fx scl env lfo edit glo / home
  save arp seq play rec, six to a row; each is placed by `data-key` in CSS, so the order in the
  HTML does not matter. The keys fill the rest of the right column's height (min 90 px), meant to
  end level with the stage's bottom edge. **At 1024x768 they do not**: the right column is taller
  (570 px) than the stage column (440 px), so the keys end ~130 px lower and the page is exactly
  one screen tall. On a tall window (stage bigger than the right column) they line up.
- **The locked state** (empty or stopped chosen slot) greys `.knobs`, `.buttons` and `#keys`,
  not the whole `#device`, which now also holds the stage and slots.
- **Below 760 px** the grid is one column: stage on top at full width, then the right column at
  full width (buttons on fractional tracks, previews still 130 px boxes). Untested.
- **Firmware list**: no numbers, no playing dot. The row a MIDI controller's Firm button is on
  shows its name on an orange (`--signal`) background.
- **Hints line** is centred.

Open questions for the owner: the keys' bottom edge versus the stage's at small windows (shrink
the spacing, or give the stage a larger minimum); whether 546 px of right column is too wide for
laptops (the stage gives up the width, 404 px at 1024).

## Five more repos, two new adapters, all updated (2026-11-21)

35 repos are followed now; **32 builds play in the app** (Felucca stays emulated; SLOOP 3 and JamesOS
publish no browser build). The full build (`firmwares/build-all.cmd`, then `node tools/import-builds.mjs`)
was run: every repo fetched and fast-forwarded.

- **Chimera Vocal** (shan-sherif/fm-1-chimera-vocal): fm1-base, plays as `x0x`; build from its Pages
  (`emu/app.wasm`).
- **Demake** (InigoHernandez/demake-synth): new family `demake` (class `Demake` in `native-worklet.js`):
  `w_*` names, 4-bit screen through a 16-colour palette, LEDs 41 levels (keys, buttons by label),
  MASTER as the page's output gain (as its own page), 64 KiB store given back before `w_init`, saved
  when `w_store_gen` moves. Build committed in its repo (`web/dmk.wasm`).
- **viscera** (De-Pattern/viscera): new family `viscera` (class `Viscera`): a tape looper.
  `control(keys, buttons, 7 encoder deltas, ms)` in this panel's own ids, called on every input and
  every 50 ms; it asks the host to keep/give back projects in 8 slots (kept here with its device
  settings as one save). **It records from a live input; Luka gives it none yet** (render(0)), so it
  plays only what it makes itself. Build from its site (newer than the repo's `site/emulator/` copy).
- **SLOOP 3** (isod89/sloop3-fm1) and **JamesOS** (aarongrando/JamesOS): cloned, updated and documented,
  not playable: SLOOP 3's page is only an installer, JamesOS has an installer and an editor. Their
  `.fwsc` packages could play through the Rust emulator path (not reachable from the page today).
- M-PYRE's path became the general "own path" (`OWN` in `native-worklet.js`: `startOwn`, a class
  per style with `NEEDS`, `render`, `input`, `screen` -> `{fb, swap}` or `{rgba}`, `levels`,
  `stored`, `due`, `restored`, optional `midi`). `playsMidiNotes` also knows `w_midi` and `midi`.
- **Arctic Scream 2.1** renamed its build: `gh-pages:arctic.wasm` (was `grimm.wasm`); same
  `asyncify` interface. The extractor kept the old copy and warned until fixed.
- Checked: all 32 in Node (start, screen, LEDs; MIDI 21 + Demake take notes); the three new screens
  looked at; Demake's and viscera's saves round-trip in Node; the three on the page together at
  under 1 % load, 1 late block in 4041. Not listened to. READMEs (root: counts, "what to play",
  credits now all 32; `firmwares/README.md`: table and counts) updated.

## The mix: a fifth box, volumes and effects (2026-11-21)

- **Page:** a fifth box "mix" after the four screens (all five 100 px, previews 86 px; at phone
  width they share it). Chosen (click, key 5, or a controller's left/right, which now stops there
  too), the eight knobs are the mixer's: **top four vol 1-4, below master (leftmost), filter,
  delay, reverb**; labels and dials change, the stage draws the mixer (strips, live meters,
  values). Keys and buttons stay with the screen chosen before (dashed orange outline); keys 1-4
  go back. Empty screens say "choose" (the stage keeps "choose firmware"). Kept in
  `localStorage["luka.mix"]`.
- **Same MIDI knobs, other job:** `host.knob(i)` and the mouse/wheel go through one path that asks
  `mixing`. **Pickup** (`ui/mixer.js` `createPickup`): a knob that sends positions (0..127) takes
  over a value only once it passes it (or is within 3/127), for the mix and for a firmware's
  MASTER alike; any switch of screen or mix forgets the knobs' positions. Endless knobs never wait.
- **Sound** (`ui/web/mixbus.js`): each slot's mute gain -> a strip (volume, kept per slot whatever
  plays in it) -> meter; strips -> low-pass -> high-pass -> master -> limiter (compressor at -2 dB,
  20:1, 2 ms) -> speakers, with delay (375 ms, feedback 0.45 through a 3.5 kHz low-pass) and reverb
  (a 2.4 s impulse made in code) as sends after the filters. Volumes and master are v*v (1 = as
  before the mixer). Filter -1..1: low-pass 20 kHz -> 120 Hz left, high-pass 20 Hz -> 6 kHz right,
  stopping at off on the way through. Transport commands `{type:"mix", slot, volume}` and
  `{type:"fx", master?, filter?, delay?, reverb?}`; `connected.levels()`, `connected.bus()`.
  `connected.mixer` tells the page the transport has one (the Tauri one does not: no mix box).
- **Checked:** `tests/mixer/mixer.test.mjs` (9); in the preview pane at 1024x768 and 375 px: boxes
  measured, knobs routed (wheel), every control read back from its audio node (gain 0.56 for 0.75,
  2.58 kHz for low-pass 40 %, high-pass 6 kHz at full right), meters live, load 2 % with two
  firmwares (3 late of 1921 blocks, as before). **Not listened to**: effect amounts, the limiter
  and the reverb's sound are the owner's to judge. Not tried with a controller (pickup is tested in
  Node only). Dark theme only on screen (the mixer view is drawn on the black screen either way).

## MIDI controller notes (2026-11-19, owner reported wrong notes)

- **Cause:** every note outside F3..G5 was folded onto the panel keys on its own (`fold: 12`), so on
  a 25-key controller C3..E3 sounded an octave above F3..G3, and C3 and C4 were one key (a held one
  cut the other). Above G5 the same, downwards.
- **Now:** a controller's notes go to the chosen firmware's **MIDI IN** (`{type: "midi"}` input, the
  protocol's own; `playNote` in `app.js`): the pitch the firmware gives that note, any octave, as on
  the device with a controller. The panel key lights (class `held`). Note-offs follow their note-on's
  screen.
- **Second fault found:** fm1-base builds (the x0x family) take `web_midi_in(port, packet)`, a
  USB-MIDI packet; the adapter called it `(status, d1, d2)`, so they ignored MIDI. `midiIn()` in
  `native-worklet.js` now calls by arity (3 bytes / port+packet / packet). Unnoticed before because
  the page never sent MIDI.
- Builds whose MIDI IN plays no notes (Blop, AMB-1 measured; or none at all) get notes as keys, the
  whole keyboard shifted by octaves (`NoteKeys`). Measured at import: manifest `midi_notes` (21 of 29 true).
- Checked in Node (pitch by autocorrelation: MIDI 48 an octave under 60 on the MIDI builds; a scale
  C3..C5 in order on the key builds, one octave move where 27 keys cannot hold it). **Not checked with
  a controller, not listened to; in the page only up to "no errors"** (the pane could not take a click).

## Five more firmwares, M-PYRE adapter, build pipeline fixes (2026-11-19)

29 browser builds are listed now (30 repos; Felucca stays emulated). New: LOAF BREAKER
(FLEXOR-R/loaf-breaker, MPL-2.0; its build only on its Pages site, fetched from there), Blop
(OSR-Experiment/OSR-1, gh-pages), JAMTRACK (Philip-Bos/jamtrack-fm1, MIT, committed in
`companion/emulator/`), PERF-1 (deamonSLINKY/PERF-1, gh-pages; starts by itself, so it loads
stopped), all `x0x`; and **M-PYRE** (HistoryOfSky/m-pyre), a new family `mpyre`.

- **M-PYRE** (`emu_*`): its own small path in `native-worklet.js` (class `Mpyre`): a UI step
  (`emu_ui`) every 705.6 frames as its page does, a press and its release a step apart, sound in
  its own block size, volume 0..4096, songs as five projects (saved every 5 s when changed and at
  stop; restore checked byte for byte in Node). It needs a 320 KB sound pack its page inlines:
  `extract-artifacts.mjs` (type `local-html-pack`) appends it to the wasm as the custom section
  `luka.pack`, so transports, server, Pages and desktop needed no change. No sound pack: it refuses
  to start and says so.
- **Every build that imports the WASI `clock_time_get` now gets the device's time** (it was a
  stub returning nothing, except for CoralFlower). LOAF BREAKER's, Blop's and JAMTRACK's hosts give it.
- **LOAF BREAKER asks "YOUR MODE" on first start** (a knob, then PLAY); keys are silent until then.
  That is the firmware, not a fault.
- **build-firmwares.ps1**: fetches every branch (gh-pages builds were never updated by a pull of
  main), checks out each repo's *default* branch (`origin/HEAD`; loaf-breaker's is `loaf`), and
  fast-forwards only. **S1Vave had been built from `main` (v1.12.2, Nov 7) since 2026-11-17; its
  default is `master` (v2.0.1, Nov 13)**: now from master. `extract-artifacts.mjs` fetches web
  builds every run (they were cached forever) and refuses a download that is not wasm.
- Checked: all 29 in Node (start, screen, LEDs; a key makes sound on all but X0X, Niagara Drift,
  Loom and LOAF BREAKER before its mode, the same with the previous adapter); M-PYRE and LOAF
  BREAKER on the page at 2 % load together, none late. Nobody has listened.

## Remembered choices, fixes (2026-11-19)

- **Slots are remembered** (`localStorage["luka.slots"]`: each slot's build id, muted, paused, and
  the chosen slot), written on every started/stopped/paused/muted event and on select; `restore()`
  in `app.js` loads them again once the list has arrived. A browser allows sound only after a
  click or key, so unless the page already has that (`navigator.userActivation`,
  `getAutoplayPolicy`) each waits on its screen (`s.waiting`: its name, an orange "play" button on
  its preview and on the stage) and the first click or key anywhere loads them all (`click`, not
  `pointerdown`: a touch counts only once lifted; a press on a play button does nothing else).
  A waiting slot also has `loading` set, so the list and `target()` see it as taken. Nothing is
  written until the restore has happened. Checked: two
  firmwares, one muted, come back after a reload, mute and selection kept.
- **MIDI learn mappings** were already kept (`localStorage["luka.midi.learned"]`, `midi-controller.js`);
  a stored mapping survives a reload. Not checked with a real controller (the preview pane refuses MIDI).
- **Feedback to GitHub issues: built, then removed by the owner** (it needed each user to have a
  GitHub account; issues without one would need a server holding a token, which Pages cannot be).
- **Fixed:** search split on the letter "s" (`/s+/`, from the midi-learn commit); phone width
  (slots were 4x130 px, the page was 544 px wide at 375; rules for <= 600 px are at the end of
  `style.css`); `pages-sw.js` cloned the page's responses too late to cache them offline.

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
