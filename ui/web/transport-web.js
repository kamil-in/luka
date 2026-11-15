// The web page's transport: the same commands in and events out as every client
// (crates/fma-display/src/protocol.rs), with the work done where a browser can do it.
//
//   the library   here, in the browser's own storage (IndexedDB): packages, their index,
//                 and what each firmware saved. GitHub is asked through the server
//                 (apps/web-server), since a page may not download a release's files itself.
//   the player    in the audio thread (player-worklet.js): the emulator compiled to
//                 WebAssembly, run by the sound card's clock, its audio played as it is made.

export const available = () => typeof indexedDB !== "undefined" && typeof AudioWorkletNode !== "undefined" && typeof WebAssembly !== "undefined";

// ------------------------------------------------------------------ storage

// (opened on first use)
let opened;
const db = () => opened ??= new Promise((resolve, reject) => {
  const open = indexedDB.open("fma", 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore("firmwares", { keyPath: "id" }); // the index: a Firmware each
    open.result.createObjectStore("packages");                     // id -> ArrayBuffer
    open.result.createObjectStore("saves");                        // the package's sha256 -> Uint8Array
  };
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
});

async function store(name, mode, run) {
  const tx = (await db()).transaction(name, mode);
  const request = run(tx.objectStore(name));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error || request.error);
  });
}
const get = (name, key) => store(name, "readonly", (s) => s.get(key));
const put = (name, value, key) => store(name, "readwrite", (s) => s.put(value, key));
const del = (name, key) => store(name, "readwrite", (s) => s.delete(key));
const firmwares = async () => (await store("firmwares", "readonly", (s) => s.getAll())).sort((a, b) => a.added_at - b.added_at);

async function sha256(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ GitHub, through the server

async function api(path, params) {
  let response;
  try {
    response = await fetch(`/api/${path}?${new URLSearchParams(params)}`);
  } catch {
    throw new Error("could not reach the server");
  }
  if (response.ok) return response;
  const said = await response.json().catch(() => null);
  throw new Error(said && said.error || `the server answered ${response.status}`);
}
const resolve = async (link) => (await api("resolve", { link })).json();

// ------------------------------------------------------------------ the transport

// The output's buffer. The machine is run a block (2.9 ms) at a time in the audio thread,
// and a block now and then takes longer than that to run (hot code being compiled, most of
// all): the buffer is what covers it. The least a browser offers (10 ms) is too little.
const LATENCY_MS = 60;

// The emulated chip's clock in a browser: half the device's 240 MHz. The emulator is about
// half as fast here as it is natively, and at the full clock a block of audio takes too
// long to make, too often (heard as static and gaps). The clock is the firmware's own
// speed too: one that needs all of 240 MHz will be short of time at this.
const CLOCK_MHZ = 120;

// A machine that does not keep up even with that is given a slower clock, a step at a
// time, and the page remembers it (per browser) for the next play. Judged every WATCH_MS
// once the firmware makes audio: too heavy is a block in 70 taking longer to make than to
// play, or the machine taking 85 % of real time, twice running. (Measured on one laptop:
// 1 in 14 late at 240 MHz, which is heard; 1 in 340 at 120 MHz, which is not.)
const CLOCKS = [240, 160, 120, 100, 80, 60];
const WATCH_MS = 2000;
const TOO_LATE = 1 / 70, TOO_BUSY = 85;
// A firmware this fresh has nothing to lose: it is started again at the slower clock.
// Later it may hold unsaved work, so the user is told and the next play is slower.
const FRESH_MS = 12000;

// Firmwares whose authors publish a browser build of their own source: the firmware's code
// running directly, many times lighter than emulating the chip. The server has the ones
// that were fetched (tools/fetch-native.mjs) and a manifest of them; they are not part of
// this project. `style`: which adapter of native-worklet.js speaks to a build (none: it
// is listed, and cannot be played yet).
// A web page asks its server (/native/); the desktop window asks the program (the commands
// native_manifest and native_file of apps/desktop), which reads the same files from disk.
const tauriCore = () => globalThis.__TAURI__?.core;
let fetched;
const builds = () => fetched ??= (async () => {
  try {
    if (tauriCore()) return JSON.parse(await tauriCore().invoke("native_manifest")).builds || [];
    const response = await fetch(new URL("../native/manifest.json", import.meta.url));
    return response.ok ? (await response.json()).builds || [] : [];
  } catch { return []; }
})();
/// A build's bytes.
async function buildFile(build) {
  if (tauriCore()) {
    try { return await tauriCore().invoke("native_file", { file: build.file }); }
    catch (e) { throw new Error(`${build.name}'s browser build could not be loaded (${e})`); }
  }
  // (the hash in the address is what lets the service worker keep the file for good)
  const url = new URL(`../native/${build.file}`, import.meta.url);
  if (build.sha256) url.searchParams.set("v", build.sha256.slice(0, 16));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${build.name}'s browser build could not be loaded (the server answered ${response.status})`);
  return response.arrayBuffer();
}
/// As the protocol's `Build`.
const listed = (b) => ({ id: b.id, name: b.name, repo: b.repo, commit: b.commit, size: b.size, playable: !!b.style, autostarts: !!b.autostarts });
/// The entry a build stands as while it plays, where a library's firmware would.
const standIn = (b) => ({
  id: `build:${b.id}`, owner: b.repo.split("/")[0], repo: b.name, description: null, license: null, version: b.commit.slice(0, 7), title: null,
  prerelease: false, page_url: `https://github.com/${b.repo}`, asset: b.path, size: b.size, sha256: b.sha256, file: "", added_at: 0,
});

const remembered = () => { try { return Number(localStorage.getItem("fma.clock")) || 0; } catch { return 0; } };
const remember = (mhz) => { try { localStorage.setItem("fma.clock", String(mhz)); } catch { /* not kept, then */ } };

// Several firmwares play at once, each in a slot of its own (0 .. SLOTS-1). The commands
// `start`, `start_build`, `stop`, `input`, `mute` and `pause` name theirs as `slot` (none: 0),
// and what a slot's firmware says (`started`, `stopped`, `leds`, `muted`, `paused`, its errors,
// its frames) comes back with it. `stop` empties a slot; `pause` holds its firmware where it
// is, loaded but not running (and a firmware can be started that way: `paused` on its start). A slot is one audio worklet node behind a gain of its own (its mute); all of
// them run in the one audio thread. The emulator is too heavy for that: one plays at a time.
export const SLOTS = 4;

export async function connect({ onEvent, onFrame }) {
  let context = null;     // the sound, once something has played
  const modules = {};     // kind -> its worklet file, loaded (a promise)
  const slots = Array.from({ length: SLOTS }, () => null); // each: { kind, id, muted, paused, started, node, gain, asked }
  let now = null;         // the emulated firmware watched: { slot, entry, id, mhz, fixed, since, bad, warm, told, timer }
  let after = null;       // a notice to give once the firmware started again has started

  const slotOf = (c) => {
    const slot = c.slot ?? 0;
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) throw new Error(`there is no slot ${slot}`);
    return slot;
  };

  const slotStats = (slot) => new Promise((done) => {
    const s = slots[slot];
    if (!s || !s.node) return done(null);
    s.asked.push(done);
    s.node.port.postMessage({ type: "stats" });
  });

  /// How the players fared since the last ask: one slot's, or (no slot named) all of them
  /// together, the loads and late blocks added up, with each slot's own under `slots`.
  async function stats(slot) {
    if (slot !== undefined) return slotStats(slot);
    const each = await Promise.all(slots.map((_, i) => slotStats(i)));
    const live = each.filter(Boolean);
    if (!live.length) return null;
    const sum = (k) => live.reduce((a, s) => a + (s[k] || 0), 0);
    return {
      ...live[0], load: sum("load"), busyMs: sum("busyMs"), slowBlocks: sum("slowBlocks"),
      slowestMs: Math.max(...live.map((s) => s.slowestMs || 0)), playing: live.length, slots: each,
    };
  }

  function unwatch(entry) {
    if (!now || (entry && now.entry !== entry)) return;
    clearInterval(now.timer);
    now = null;
  }

  /// Empty a slot: its node is told to stop (it saves first) and run no more, and is dropped.
  function free(slot) {
    const s = slots[slot];
    if (!s) return;
    slots[slot] = null;
    unwatch(s);
    for (const done of s.asked) done(null);
    if (s.node) {
      s.node.port.postMessage({ type: "dispose" });
      s.node.disconnect();
      s.gain.disconnect();
    }
    // (said here, not when the node answers: what replaces it may start before that)
    if (s.started) onEvent({ type: "stopped", reason: null, at_ms: 0, slot });
  }

  /// Is the machine keeping up with what plays? If not, a slower clock.
  async function watch() {
    const playing = now;
    if (!playing || playing.fixed) return;
    const s = await slotStats(playing.slot);
    if (!s || now !== playing) return;
    // (not before there is audio, nor in the stretch right after: the start is heavy by itself)
    if (!s.made) { playing.warm = false; playing.bad = 0; return; }
    if (!playing.warm) { playing.warm = true; return; }
    const heavy = s.load >= TOO_BUSY || s.slowBlocks / Math.max(1, s.blocks) >= TOO_LATE;
    playing.bad = heavy ? playing.bad + 1 : 0;
    const slower = CLOCKS.find((c) => c < playing.mhz);
    if (playing.bad < 2 || !slower || playing.told) return;
    remember(slower);
    const name = (await get("firmwares", playing.id))?.repo || "this firmware";
    if (performance.now() - playing.since < FRESH_MS) {
      after = `This machine could not keep up with ${name} at ${playing.mhz} MHz: it now runs at ${slower} MHz`;
      send({ type: "start", id: playing.id, slot: playing.slot });
    } else {
      playing.told = true;
      onEvent({ type: "notice", message: `This machine is not keeping up with ${name} at ${playing.mhz} MHz. Stop and play it again to run it at ${slower} MHz.` });
    }
  }

  /// What a slot's node says, for as long as the slot is still that node's (`entry`): a node
  /// already replaced is only heard for what its firmware stored.
  const heard = (entry, slot) => ({ data }) => {
    const mine = slots[slot] === entry;
    switch (data.type) {
      case "frame": if (mine) onFrame(data.rgba, slot); break;
      case "events":
        for (const e of data.events) {
          if (slots[slot] !== entry) break;
          if (e.type === "stopped") { entry.started = false; free(slot); } // (the slot is empty again)
          onEvent({ ...e, slot });
        }
        break;
      case "save": put("saves", data.bytes, data.sha256).catch((e) => onEvent({ type: "error", command: "save", slot, message: `what the firmware stored could not be kept: ${e.message}` })); break;
      case "started":
        if (!mine) break;
        entry.started = true;
        if (entry.kind === "emulator") {
          unwatch();
          now = { slot, entry, id: data.id, mhz: data.mhz, fixed: data.fixed, since: performance.now(), bad: 0, warm: false, told: false, timer: setInterval(watch, WATCH_MS) };
        }
        (data.id.startsWith("build:") ? builds().then((all) => standIn(all.find((b) => `build:${b.id}` === data.id))) : get("firmwares", data.id)).then((firmware) => {
          if (slots[slot] !== entry) return;
          onEvent({ type: "started", slot, firmware, info: data.info, save_restored: data.save_restored, muted: entry.muted, paused: entry.paused });
          if (after) onEvent({ type: "notice", message: after });
          after = null;
        });
        break;
      case "failed":
        onEvent({ type: "error", command: "start", slot, message: data.message });
        if (mine && !entry.started) free(slot); // (nothing started: the slot is not kept)
        break;
      case "stats": {
        // (and what the browser says of its own output, where it says: Chrome counts the
        // times it had to fill in for audio that came too late)
        const playout = context.playoutStats, done = entry.asked.shift();
        done && done({
          ...data.stats, baseLatencyMs: Math.round(context.baseLatency * 1000), outputLatencyMs: Math.round((context.outputLatency || 0) * 1000),
          browserGlitches: playout ? playout.fallbackFramesEvents : null, browserGlitchMs: playout ? Math.round(playout.fallbackFramesDuration) : null,
        });
        break;
      }
    }
  };

  /// A slot taken for `id`, with a player of one kind ("emulator": player-worklet.js;
  /// "native": native-worklet.js) of its own; what the slot held is stopped. The sound is
  /// made on the first play (a browser allows audio only after a click), and runs at the
  /// firmware's rate, so nothing is resampled. Null: the slot went to another meanwhile.
  async function player(kind, slot, id, muted = false, paused = false) {
    if (!context) {
      // (?latency=N: the output's buffer in milliseconds, for trying others)
      const latency = Number(new URLSearchParams(location.search).get("latency")) || LATENCY_MS;
      context = new AudioContext({ sampleRate: 44100, latencyHint: latency / 1000 });
    }
    free(slot);
    const entry = slots[slot] = { kind, id, muted: !!muted, paused: !!paused, started: false, node: null, gain: null, asked: [] };
    try {
      const [file, name] = kind === "native" ? ["./native-worklet.js", "fma-native"] : ["./player-worklet.js", "fma-player"];
      const [bytes] = await Promise.all([
        kind === "native" ? null : fetch(new URL("../fma_wasm.wasm", import.meta.url)).then((r) => { if (!r.ok) throw new Error("the player could not be loaded"); return r.arrayBuffer(); }),
        modules[kind] ??= context.audioWorklet.addModule(new URL(file, import.meta.url)),
      ]);
      if (slots[slot] !== entry) return null;
      const node = new AudioWorkletNode(context, name, { numberOfInputs: 0, outputChannelCount: [2] });
      const gain = new GainNode(context, { gain: entry.muted ? 0 : 1 });
      node.port.onmessage = heard(entry, slot);
      node.onprocessorerror = () => {
        onEvent({ type: "error", command: "start", slot, message: "the player stopped working: reload the page" });
        if (slots[slot] === entry) free(slot);
      };
      node.connect(gain).connect(context.destination);
      if (bytes) node.port.postMessage({ type: "module", bytes }, [bytes]);
      entry.node = node;
      entry.gain = gain;
      if (context.state !== "running") await context.resume();
      return slots[slot] === entry ? entry : null;
    } catch (e) {
      delete modules[kind]; // (asked for again on the next play)
      if (slots[slot] === entry) free(slot);
      throw e;
    }
  }

  /// `id` plays in one slot at a time: two of one firmware would store over each other.
  function elsewhere(id, slot, name) {
    const at = slots.findIndex((s, i) => s && i !== slot && s.id === id);
    if (at >= 0) throw new Error(`${name} is already playing, in slot ${at + 1}`);
  }

  async function install(release, asset) {
    const id = `${release.owner}/${release.repo}@${release.tag}#${asset.name}`;
    let firmware = await get("firmwares", id);
    if (!firmware || !(await get("packages", id))) {
      const bytes = await (await api("download", { url: asset.url })).arrayBuffer();
      if (!bytes.byteLength) throw new Error(`${asset.name} is empty`);
      firmware = {
        id, owner: release.owner, repo: release.repo, description: release.description, license: release.license,
        version: release.tag, title: release.title, prerelease: release.prerelease, page_url: release.page_url,
        asset: asset.name, size: bytes.byteLength, sha256: await sha256(bytes), file: "", added_at: Math.floor(Date.now() / 1000),
      };
      await put("packages", bytes, id);
      await put("firmwares", firmware);
    }
    onEvent({ type: "added", firmware });
    onEvent({ type: "library", firmwares: await firmwares() });
  }

  /// Play a browser build, as `id` (a library firmware's, or the build's own).
  async function startBuild(build, id, slot, { muted, paused }) {
    elsewhere(id, slot, build.name);
    const entry = await player("native", slot, id, muted, paused);
    if (!entry) return;
    try {
      const wasm = await buildFile(build);
      // (what it stores is kept under the firmware, whichever way it was started)
      const key = `native:${build.repo}`.toLowerCase();
      const save = (await get("saves", key)) || null;
      if (slots[slot] !== entry) return;
      entry.node.port.postMessage({ type: "start", id, sha256: key, wasm, save, style: build.style, paused: entry.paused }, [wasm]);
    } catch (e) {
      if (slots[slot] === entry) free(slot);
      throw e;
    }
  }

  const here = async (id) => {
    const firmware = await get("firmwares", id);
    if (!firmware) throw new Error(`${id} is not in the library`);
    return firmware;
  };

  async function run(c) {
    switch (c.type) {
      case "list_library": onEvent({ type: "library", firmwares: await firmwares() }); break;
      case "resolve": onEvent({ type: "choose", release: await resolve(c.link) }); break;
      case "add": {
        const release = await resolve(c.link);
        if (release.assets.length === 1) await install(release, release.assets[0]);
        else onEvent({ type: "choose", release });
        break;
      }
      case "install": {
        const asset = c.release.assets.find((a) => a.name === c.asset);
        if (!asset) throw new Error(`release ${c.release.tag} has no package ${c.asset}`);
        await install(c.release, asset);
        break;
      }
      case "check_update": {
        const firmware = await here(c.id);
        const latest = await resolve(`https://github.com/${firmware.owner}/${firmware.repo}`);
        onEvent({ type: "update", id: c.id, release: latest.tag !== firmware.version ? latest : null });
        break;
      }
      case "remove": {
        await here(c.id);
        await del("packages", c.id);
        await del("firmwares", c.id);
        onEvent({ type: "removed", id: c.id });
        onEvent({ type: "library", firmwares: await firmwares() });
        break;
      }
      case "start": {
        const slot = slotOf(c);
        const firmware = await here(c.id);
        const params = new URLSearchParams(location.search);
        // Its author's own browser build, where there is one (?native=0: emulate it anyway)
        const repo = `${firmware.owner}/${firmware.repo}`.toLowerCase();
        const native = params.get("native") === "0" ? null : (await builds()).find((b) => b.style && b.repo.toLowerCase() === repo);
        if (native) {
          after = `${firmware.repo} is playing as its author's own browser build, which may be another version than ${firmware.version}`;
          await startBuild(native, c.id, slot, c);
          break;
        }
        elsewhere(c.id, slot, firmware.repo);
        // (one emulated firmware at a time: another would not fit in the audio thread)
        slots.forEach((s, i) => { if (s && s.kind === "emulator" && i !== slot) free(i); });
        const entry = await player("emulator", slot, c.id, c.muted, c.paused);
        if (!entry) break;
        try {
          const bytes = await get("packages", c.id);
          if (!bytes || (await sha256(bytes)) !== firmware.sha256) throw new Error(`${firmware.repo}'s stored package is damaged: remove it and add it again`);
          const save = (await get("saves", firmware.sha256)) || null;
          // The clock: the command's own, or the address's (?mhz=N, for trying), and then it
          // is left alone; otherwise what this machine was found to keep up with.
          const asked = c.options?.clock_mhz || Number(params.get("mhz"));
          const mhz = asked || remembered() || CLOCK_MHZ;
          const options = { jit: true, ...c.options, clock_mhz: mhz };
          if (slots[slot] !== entry) break;
          entry.node.port.postMessage({ type: "start", id: c.id, sha256: firmware.sha256, package: bytes, save, options, fixed: !!asked, paused: entry.paused });
        } catch (e) {
          if (slots[slot] === entry) free(slot);
          throw e;
        }
        break;
      }
      case "list_builds": onEvent({ type: "builds", builds: (await builds()).map(listed) }); break;
      case "start_build": {
        const slot = slotOf(c);
        const build = (await builds()).find((b) => b.id === c.id);
        if (!build) throw new Error(`there is no browser build ${c.id}`);
        if (!build.style) throw new Error(`${build.name}'s browser build cannot be played yet: this client does not speak its interface`);
        await startBuild(build, `build:${build.id}`, slot, c);
        break;
      }
      case "stop": {
        const slot = slotOf(c), s = slots[slot];
        if (!s) break;
        if (s.started) s.node.port.postMessage({ type: "stop" }); // (it answers `stopped`, which empties the slot)
        else { free(slot); onEvent({ type: "stopped", reason: null, at_ms: 0, slot }); } // (still loading)
        break;
      }
      case "input": {
        const s = slots[slotOf(c)];
        if (s && s.started) s.node.port.postMessage({ type: "input", input: c.input });
        break;
      }
      // A slot's firmware held where it is, or let go (it stays loaded either way). -> `paused`
      case "pause": {
        const slot = slotOf(c), s = slots[slot];
        if (!s) break;
        s.paused = !!c.paused;
        if (s.started) s.node.port.postMessage({ type: "pause", paused: s.paused }); // (not started yet: its start carries it)
        onEvent({ type: "paused", slot, paused: s.paused });
        break;
      }
      // A slot's sound, off or on (its firmware runs on either way). -> `muted`
      case "mute": {
        const slot = slotOf(c), s = slots[slot];
        if (!s) break;
        s.muted = !!c.muted;
        if (s.gain) s.gain.gain.setTargetAtTime(s.muted ? 0 : 1, context.currentTime, 0.015); // (a short fade, not a click)
        onEvent({ type: "muted", slot, muted: s.muted });
        break;
      }
    }
  }

  const send = (command) => run(command).catch((e) => onEvent({ type: "error", command: command.type, slot: command.slot, message: e.message || String(e) }));
  /// `stats`: how the players fared since the last ask (for measuring: see player-worklet.js).
  return { stats, send, slots: SLOTS };
}
