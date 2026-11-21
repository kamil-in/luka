// A second kind of player for the web client: a firmware's own browser build. Some
// firmware authors compile their source straight to WebAssembly against a stand-in for the
// FM-1 and publish it; that runs many times lighter than emulating the chip the firmware
// was built for (player-worklet.js), which stays the way to play everything else.
//
// This file is the adapter: the same messages in and out as player-worklet.js, so the page
// does not know which kind plays, and inside, one firmware family's exported functions.
//
//   "felucca"  Felucca's browser build and its forks' (web/emu/felucca_web.c in their
//              repositories): buttons and keys as bit masks by printed label, encoders by
//              role, the screen as RGB565 in the panel's byte order, the lights as masks,
//              storage as a 1 MiB flash image.
//   "x0x"      X0X's and the builds made after it (web/emu/x0x_web.c; AMB-1, Niagara Drift,
//              MONK-1): the same masks, roles and screen under other names, MASTER as
//              0..4096, storage as a few named objects, and for MONK-1 each key on its own
//              with how hard it landed. Also the later builds of other authors (Loom,
//              Fimba, Aisling, SATIE-1, Nachtfahrt, Frasil, Zen-1, Mutable Dreams).
//   "melodee"  Melodee's (web/emu/melodee_web.c): this panel's own ids for buttons, keys and
//              encoders, the screen in the panel's byte order, MASTER 0..1023, no storage.
//   "sim"      OberVave's and S1Vave's (web/sim/sim.c): sim_* names, buttons and keys one at
//              a time by this panel's own ids, the screen in the host's byte order, the
//              state as nine blobs, an init that takes the sample rate.
//   "asyncify" GR!MM's and Arctic Scream's (firmware/src/fm1_web.c): the firmware's main loop
//              never returns, so it runs as a coroutine (Binaryen's Asyncify): once the
//              frames asked for are there it calls the host's `web_yield`, which unwinds
//              it back to `web_run`; the next block rewinds into it. Panel ids as they are,
//              the screen in host byte order, settings as one small buffer.
//   "coralflower"  CoralFlower's (tools/emu/web/emu_web.c): felucca's labels, roles and byte
//              order under its own names; it reads the WASI clock, so that is real here;
//              the lights as one array of levels, the 1 MiB flash staged in before boot and
//              kept whole, MIDI in as USB-MIDI packets.
//   "mpyre"    M-PYRE's (firmware/host/emu.c): emu_* names, felucca's labels and roles, keys
//              as one mask, the screen in the panel's byte order and drawn by a UI step the
//              host calls every 16 ms (`emu_ui`), sound in blocks of its own size, MASTER as
//              volume 0..4096, its four sample slots loaded after init from a sound pack (the
//              author's page inlines it; tools carry it here as the wasm's custom section
//              "luka.pack"), and its songs as five projects (four SAVE slots, the working one).
//              It has its own small path: see `Mpyre` below.
//   "demake"   demake's (web/dmk_web.c): see `Demake` below.
//   "viscera"  viscera's tape looper (its site's emulator): see `Viscera` below.
//
// They differ in names more than in kind, so there is one adapter, which asks a build what
// it has (`pick`); `style` (ui/web/native-kinds.js) only settles the few things that differ.
//
// The build itself is not part of this project: the page fetches it from its author's site
// when it is played, and it stays under its author's licence.
//
//   page -> here   {type: "start", id, sha256: save key, wasm: ArrayBuffer, save, style}
//                  {type: "stop"} | {type: "input", input} | {type: "stats"} | {type: "dispose"}
//                  {type: "pause", paused}: the firmware is held where it is (no sound, its
//                  time standing still) until it is let go; `start` may carry `paused` too
//   here -> page   as player-worklet.js
//
// One processor plays one firmware; the page makes one for each firmware playing at once.

const clock = globalThis.performance ? () => globalThis.performance.now() : () => Date.now();

// Our ids (crates/fma-player/src/panel.rs) to this family's: a button's label bit (FX ..
// REC, then OCT-, OCT+), an encoder's role (SELECT, ALGORITHM, PRESETS, KNOB 1..4).
const label = (id) => (id >= 2 ? id - 2 : 12 + id);
const role = (id) => (id === 6 ? 2 : id >= 2 ? id + 1 : id);
// A change of the buttons or keys is held this long in the device's time before the next
// goes in: the device reads its panel once a frame, and a click can be shorter than that.
const HOLD_MS = 24;
const SCREEN_EVERY = 1 / 30, SAVE_AFTER = 1; // seconds
// What our panel takes for an LED: the share of time it is lit (0.08 is fully lit).
const LIT = 0.08, MID = 0.05, DIM = 0.02;

/// A build's MIDI IN as one function of a message's three bytes, whichever way the build takes it,
/// by how many arguments its function has (null: it has none):
///   3  (status, data1, data2)       Felucca's forks, Melodee, the sim builds, the asyncify ones
///   2  (port, USB-MIDI packet)      fm1-base's (the x0x family): port 0 is USB
///   1  (USB-MIDI packet)            CoralFlower
/// A USB-MIDI packet: the code index (the status's high nibble), then status, data1, data2.
function midiIn(f) {
  if (!f) return null;
  const packet = (st, d1, d2) => (((st >> 4) & 15) | st << 8 | d1 << 16 | d2 << 24) >>> 0;
  if (f.length === 1) return (st, d1, d2) => f(packet(st, d1, d2));
  if (f.length === 2) return (st, d1, d2) => f(0, packet(st, d1, d2));
  return (st, d1, d2) => f(st, d1, d2);
}

/// A controller's notes for a build without a MIDI IN: as its note keys (F3..G5, MIDI 53..79).
/// The whole keyboard is moved by octaves, not each note on its own, so a tune keeps its shape:
/// the move changes only when a note does not fit and none is held; while some are, a note
/// that does not fit is folded onto the keys alone.
class NoteKeys {
  constructor() { this.shift = 0; this.held = new Map(); } // note -> key id
  /// The key event for a note message (null: not a note).
  key(st, d1, d2) {
    const kind = st & 0xf0;
    if (kind !== 0x90 && kind !== 0x80) return null;
    const down = kind === 0x90 && d2 > 0;
    if (!down) {
      const id = this.held.get(d1);
      if (id === undefined) return null;
      this.held.delete(d1);
      return { type: "key", id, down: false, velocity: null };
    }
    let id = d1 - 39 + this.shift;
    if (id < 14 || id > 40) {
      if (!this.held.size) { // (the fewest octaves that bring it on)
        if (id < 14) this.shift += 12 * Math.ceil((14 - id) / 12);
        else this.shift -= 12 * Math.ceil((id - 40) / 12);
        id = d1 - 39 + this.shift;
      }
      while (id < 14) id += 12;
      while (id > 40) id -= 12;
    }
    this.held.set(d1, id);
    return { type: "key", id, down: true, velocity: d2 };
  }
}

/// M-PYRE's build, as its author's page drives it (docs/emu/index.html in its repository).
class Mpyre {
  static SLOT = 0x14000;  // a sample slot's bytes; the pack is four
  static UI_EVERY = 705.6; // frames between UI steps: 16 ms at 44.1 kHz
  static KEEP_EVERY = 5;   // seconds between looks at the songs

  static NEEDS = ["emu_init", "emu_render", "emu_block_frames", "emu_ui", "emu_screen", "emu_keys", "emu_button", "emu_knob", "emu_buffer"];

  constructor(module, x, save) {
    this.x = x;
    x.emu_init();
    const pack = WebAssembly.Module.customSections(module, "luka.pack")[0];
    if (pack && pack.byteLength === 4 * Mpyre.SLOT) {
      const bytes = new Uint8Array(pack);
      for (let k = 0; k < 4; k++) {
        new Uint8Array(x.memory.buffer, x.emu_buffer(), Mpyre.SLOT).set(bytes.subarray(k * Mpyre.SLOT, (k + 1) * Mpyre.SLOT));
        x.emu_slot(k);
      }
      x.emu_reset_tracks();
    }
    this.hasPack = !!pack;
    this.n = x.emu_block_frames();
    this.cur = new Float32Array(2 * this.n);
    this.pos = this.n;   // (frames of `cur` used: all, so the first read renders)
    this.acc = 0;        // frames since the last UI step
    this.queue = [];     // panel changes, at most one press per UI step (as the author's page)
    this.wait = false;
    this.keys = 0;
    this.drawn = false;
    this.ledKey = "";
    this.kept = null;    // the songs as last saved
    this.keptAt = 0;
    if (!this.hasPack) throw new Error("this M-PYRE build came without its sound pack: import it again (tools/import-builds.mjs)");
    this.restored = !!save && this.restore(save);
    if (x.emu_volume) x.emu_volume(Math.round(800 * 4096 / 1023));
  }

  /// `n` frames into the two channels; the UI steps as their time comes.
  render(left, right) {
    const x = this.x, N = this.n, c = this.cur;
    for (let i = 0; i < left.length; i++) {
      if (this.pos >= N) {
        c.set(new Float32Array(x.memory.buffer, x.emu_render(), 2 * N));
        this.pos = 0;
        this.acc += N;
        if (this.acc >= Mpyre.UI_EVERY) { this.acc -= Mpyre.UI_EVERY; this.ui(); }
      }
      left[i] = c[2 * this.pos];
      if (right) right[i] = c[2 * this.pos + 1];
      this.pos++;
    }
  }

  /// One UI step: what the panel did (a press and its release a step apart), then the screen.
  ui() {
    const x = this.x;
    while (this.queue.length) {
      const m = this.queue[0];
      if (m.button && !m.down && this.wait) { this.wait = false; break; }
      this.queue.shift();
      if (m.button) x.emu_button(m.b, m.down ? 1 : 0); else x.emu_keys(m.keys >>> 0);
      if (m.button && m.down) { this.wait = true; break; }
    }
    if (x.emu_ui()) this.drawn = true;
  }

  input(i) {
    const x = this.x;
    if (i.type === "key") {
      if (i.id >= 14) {
        const bit = 1 << (i.id - 14);
        this.keys = i.down ? this.keys | bit : this.keys & ~bit;
        this.queue.push({ keys: this.keys });
      } else this.queue.push({ button: true, b: label(i.id), down: !!i.down });
    } else if (i.type === "encoder") x.emu_knob(role(i.id), i.clicks | 0);
    else if (i.type === "analog" && i.channel === 4) x.emu_volume(Math.round(i.value * 4096 / 1023));
  }

  /// The screen when a UI step drew it (null: unchanged), in the panel's byte order.
  screen() {
    if (!this.drawn) return null;
    this.drawn = false;
    return { fb: new Uint16Array(this.x.memory.buffer, this.x.emu_screen(), 240 * 240), swap: true };
  }

  /// The lights as our levels when they changed (null: unchanged). Keys: lit, dim, faint;
  /// buttons by label.
  levels() {
    const x = this.x, m = [x.emu_led_keys(0), x.emu_led_keys(1), x.emu_led_keys(2), x.emu_led_buttons()].map((v) => v >>> 0), key = m.join();
    if (key === this.ledKey) return null;
    this.ledKey = key;
    const levels = new Array(41).fill(0);
    for (let id = 0; id < 14; id++) if (m[3] & 1 << label(id)) levels[id] = LIT;
    for (let k = 0; k < 27; k++) levels[14 + k] = m[0] & 1 << k ? LIT : m[1] & 1 << k ? MID : m[2] & 1 << k ? DIM / 2 : 0;
    return levels;
  }

  /// The five projects (four SAVE slots, then the working one), each as its length and bytes.
  stored() {
    const x = this.x, parts = [];
    for (let i = 0; i < 5; i++) {
      const n = x.emu_proj_get(i);
      parts.push(n > 0 ? new Uint8Array(x.memory.buffer, x.emu_buffer(), n).slice() : new Uint8Array(0));
    }
    const out = new Uint8Array(20 + parts.reduce((a, p) => a + p.length, 0)), view = new DataView(out.buffer);
    let at = 20;
    parts.forEach((p, i) => { view.setInt32(4 * i, p.length, true); out.set(p, at); at += p.length; });
    return out;
  }

  restore(save) {
    const x = this.x;
    if (save.length < 20) return false;
    const view = new DataView(save.buffer, save.byteOffset, save.byteLength), lens = [0, 1, 2, 3, 4].map((i) => view.getInt32(4 * i, true));
    if (lens.some((l) => l < 0) || 20 + lens.reduce((a, l) => a + l, 0) !== save.length) return false;
    let at = 20, any = false;
    lens.forEach((len, i) => {
      if (len) { new Uint8Array(x.memory.buffer, x.emu_buffer(), len).set(save.subarray(at, at + len)); any = x.emu_proj_put(i, len) || any; }
      at += len;
    });
    return !!any;
  }

  /// The songs, when it is time to look and they changed since the last save (null: not now).
  due(now) {
    if (now - this.keptAt < Mpyre.KEEP_EVERY) return null;
    this.keptAt = now;
    const bytes = this.stored();
    if (this.kept && bytes.length === this.kept.length && bytes.every((b, i) => b === this.kept[i])) return null;
    const first = !this.kept;
    this.kept = bytes;
    return first ? null : bytes; // (what it started with is not a change)
  }
}

/// demake's build (web/dmk_web.c in its repository, as its web/worklet.js drives it): w_* names,
/// felucca's labels and roles (MASTER is not the firmware's: its page turns the output down, and so
/// does this), 128 frames of 16-bit stereo a render, the screen as 4 bits a pixel through a
/// 16-colour palette, the lights as 41 levels (keys, then buttons by label), the songs and sounds as
/// a 64 KiB store given back before init.
class Demake {
  static NEEDS = ["w_init", "w_render", "w_audio", "w_frame", "w_palette", "w_leds", "w_key", "w_button", "w_encoder", "w_store", "w_store_gen"];
  static STORE = 65536;

  constructor(_module, x, save, now) {
    this.x = x;
    this.now = now;
    this.restored = false;
    if (save && save.length === Demake.STORE) { new Uint8Array(x.memory.buffer, x.w_store(), Demake.STORE).set(save); this.restored = true; }
    x.w_init((Math.random() * 4294967296) >>> 0);
    if (x.w_latency) x.w_latency(Math.round(0.06 * 44100) + 128); // (key to sound heard: its recording takes it off)
    this.gen = x.w_store_gen();
    this.gain = 800 / 1023;
    this.ledKey = "";
    this.rgba = new Uint8ClampedArray(240 * 240 * 4);
    this.midi = x.w_midi ? (s, a, b) => x.w_midi(s, a, b) : null;
  }

  render(left, right) {
    const x = this.x;
    for (let at = 0; at < left.length; at += 128) {
      x.w_render();
      const a = new Int16Array(x.memory.buffer, x.w_audio(), 256), g = this.gain / 32768, n = Math.min(128, left.length - at);
      for (let i = 0; i < n; i++) {
        left[at + i] = a[2 * i] * g;
        if (right) right[at + i] = a[2 * i + 1] * g;
      }
    }
    if (x.w_midi_take) for (let k = 0; k < 64 && x.w_midi_take() >= 0; k++); // (its MIDI out: nowhere to go here)
  }

  input(i) {
    const x = this.x;
    if (i.type === "key") { if (i.id >= 14) x.w_key(i.id - 14, i.down ? 1 : 0); else x.w_button(label(i.id), i.down ? 1 : 0); }
    else if (i.type === "encoder") x.w_encoder(role(i.id), i.clicks | 0);
    else if (i.type === "analog" && i.channel === 4) this.gain = i.value / 1023;
  }

  /// The screen, drawn now (its animations need the time), as RGBA.
  screen() {
    const x = this.x, mem = x.memory.buffer;
    const fb = new Uint8Array(mem, x.w_frame(this.now() >>> 0), 28800), pal = new Uint32Array(mem, x.w_palette(), 16), d = this.rgba;
    for (let p = 0; p < 240 * 240; p++) {
      const c = pal[p & 1 ? fb[p >> 1] & 15 : fb[p >> 1] >> 4], o = 4 * p;
      d[o] = c >> 16; d[o + 1] = (c >> 8) & 255; d[o + 2] = c & 255; d[o + 3] = 255;
    }
    return { rgba: d.slice() };
  }

  levels() {
    const l = new Uint8Array(this.x.memory.buffer, this.x.w_leds(), 41), key = l.join();
    if (key === this.ledKey) return null;
    this.ledKey = key;
    const levels = new Array(41).fill(0);
    for (let id = 0; id < 14; id++) levels[id] = l[27 + label(id)] / 255 * LIT;
    for (let k = 0; k < 27; k++) levels[14 + k] = l[k] / 255 * LIT;
    return levels;
  }

  stored() { return new Uint8Array(this.x.memory.buffer, this.x.w_store(), Demake.STORE).slice(); }

  /// The store after a save (null: none since the last look).
  due() {
    const g = this.x.w_store_gen();
    if (g === this.gen) return null;
    this.gen = g;
    return this.stored();
  }
}

/// viscera's build (its site's emulator/worklet.js): a four-track tape looper. control(keys,
/// buttons, seven encoder deltas, ms) takes the whole panel at once, in this panel's own ids
/// (buttons OCT- OCT+ FX .. REC, encoders SELECT, ALGORITHM, KNOB 1..4, PRESETS), and is called
/// every 50 ms too (held buttons' timings move on); the screen is drawn on asking, RGB565 in the
/// host's byte order; the lights 41 (buttons, then keys: 2 lit, 1 glow). It records from a live
/// input this page does not give it, so here it plays what it has. MASTER is the page's (output
/// gain), as on its own page. It keeps its own settings (a device blob) and asks the host to keep
/// and give back projects in eight slots: all of them are kept here as one save.
class Viscera {
  static NEEDS = ["init", "control", "paint", "screen", "leds", "render", "output_buffer", "device", "device_bytes", "device_changed", "device_seal",
    "device_check", "project", "project_bytes", "project_seal", "project_check", "stop_all", "slot_info", "name_buffer", "set_host", "host_arg"];
  static SLOTS = 8;

  constructor(_module, x, save, now) {
    this.x = x;
    this.now = now;
    x.init();
    if (x.intro) x.intro(0);
    this.keys = this.buttons = 0;
    this.enc = new Int32Array(7);
    this.gain = 0.8 * 0.8 * 1.4;
    this.projects = new Array(Viscera.SLOTS).fill(null);
    this.ledKey = "";
    this.lastControl = 0;
    this.restored = !!save && this.restore(save);
    this.devGen = x.device_changed();
    this.dirty = false;
    x.set_host(0, 0, 0); // (no live input here)
    this.tellSlots();
    this.midi = x.midi ? (s, a, b) => x.midi(s, a, b) : null;
  }

  tellSlots() {
    const x = this.x;
    for (let s = 0; s < Viscera.SLOTS; s++) {
      const name = this.projects[s] ? `PROJECT ${s + 1}` : "", b = new Uint8Array(x.memory.buffer, x.name_buffer(), 16);
      b.fill(0);
      for (let i = 0; i < Math.min(11, name.length); i++) b[i] = name.charCodeAt(i) & 127;
      x.slot_info(s, this.projects[s] ? 1 : 0, x.name_buffer());
    }
  }

  /// The panel as it is now, and what changed in it, to the firmware; its asks answered.
  control() {
    const x = this.x, e = this.enc, now = this.now() >>> 0;
    const req = x.control(this.keys >>> 0, this.buttons >>> 0, e[0], e[1], e[2], e[3], e[4], e[5], e[6], now);
    e.fill(0);
    this.lastControl = now;
    if (req === 1) { // keep a project
      const slot = x.host_arg();
      if (slot >= 0 && slot < Viscera.SLOTS) {
        x.project_seal(slot);
        this.projects[slot] = new Uint8Array(x.memory.buffer, x.project(), x.project_bytes()).slice();
        this.dirty = true;
        this.tellSlots();
      }
    } else if (req === 2) { // give one back
      const p = this.projects[x.host_arg()];
      if (p) this.load(p);
    }
  }

  load(bytes) {
    const x = this.x, p = new Uint8Array(x.memory.buffer, x.project(), x.project_bytes());
    if (bytes.length > p.length) return false;
    const keep = p.slice();
    x.stop_all(); p.fill(0); p.set(bytes);
    if (x.project_check() === 1) return true;
    p.set(keep);
    return false;
  }

  render(left, right) {
    const x = this.x;
    if (this.now() - this.lastControl >= 50) this.control();
    for (let at = 0; at < left.length; at += 128) {
      x.render(0);
      const o = new Float32Array(x.memory.buffer, x.output_buffer(), 256), g = this.gain, n = Math.min(128, left.length - at);
      for (let i = 0; i < n; i++) {
        left[at + i] = o[2 * i] * g;
        if (right) right[at + i] = o[2 * i + 1] * g;
      }
    }
  }

  input(i) {
    if (i.type === "key") {
      const bit = 1 << (i.id >= 14 ? i.id - 14 : i.id);
      if (i.id >= 14) this.keys = i.down ? this.keys | bit : this.keys & ~bit;
      else this.buttons = i.down ? this.buttons | bit : this.buttons & ~bit;
    } else if (i.type === "encoder") { if (i.id >= 0 && i.id < 7) this.enc[i.id] += i.clicks | 0; }
    else if (i.type === "analog" && i.channel === 4) { const v = i.value / 1023; this.gain = v * v * 1.4; return; }
    else return;
    this.control();
  }

  screen() {
    const x = this.x;
    x.paint(this.now() >>> 0);
    return { fb: new Uint16Array(x.memory.buffer, x.screen(), 240 * 240), swap: false };
  }

  levels() {
    const l = new Uint8Array(this.x.memory.buffer, this.x.leds(), 41), key = l.join();
    if (key === this.ledKey) return null;
    this.ledKey = key;
    const of = (v) => (v === 2 ? LIT : v === 1 ? DIM : 0);
    const levels = new Array(41).fill(0);
    for (let id = 0; id < 14; id++) levels[id] = of(l[id]);
    for (let k = 0; k < 27; k++) levels[14 + k] = of(l[14 + k]);
    return levels;
  }

  /// Its settings, then the eight projects: each a length (4 bytes, 0: none) and its bytes.
  stored() {
    const x = this.x;
    x.device_seal();
    const parts = [new Uint8Array(x.memory.buffer, x.device(), x.device_bytes()).slice(), ...this.projects.map((p) => p || new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((a, p) => a + 4 + p.length, 0)), view = new DataView(out.buffer);
    let at = 0;
    for (const p of parts) { view.setUint32(at, p.length, true); out.set(p, at + 4); at += 4 + p.length; }
    return out;
  }

  restore(save) {
    const x = this.x, view = new DataView(save.buffer, save.byteOffset, save.byteLength), parts = [];
    for (let at = 0; at + 4 <= save.length;) {
      const n = view.getUint32(at, true);
      if (at + 4 + n > save.length) return false;
      parts.push(save.subarray(at + 4, at + 4 + n));
      at += 4 + n;
    }
    if (parts.length !== 1 + Viscera.SLOTS) return false;
    const d = new Uint8Array(x.memory.buffer, x.device(), x.device_bytes());
    if (parts[0].length && parts[0].length <= d.length) {
      const keep = d.slice(); d.fill(0); d.set(parts[0]);
      if (x.device_check() !== 1) d.set(keep);
    }
    parts.slice(1).forEach((p, s) => { this.projects[s] = p.length ? p.slice() : null; });
    return true;
  }

  /// Its settings or a project changed since the last look: all of it, to keep (null: nothing).
  due() {
    const g = this.x.device_changed();
    if (g !== this.devGen) { this.devGen = g; this.dirty = true; }
    if (!this.dirty) return null;
    this.dirty = false;
    return this.stored();
  }
}

/// The builds with a path of their own (not the shared adapter below), by style.
const OWN = { mpyre: Mpyre, demake: Demake, viscera: Viscera };

class Native extends AudioWorkletProcessor {
  constructor() {
    super();
    this.x = null;
    this.saveKey = null;
    this.buttons = 0;
    this.keys = 0;
    this.queue = [];      // changes of the buttons and keys, waiting their turn
    this.nextOk = 0;
    this.drawn = -1;
    this.lastScreen = 0;
    this.leds = "";
    this.writes = 0;      // the flash's write count, and when it last moved
    this.saved = 0;
    this.writesAt = 0;
    this.stats = this.fresh();
    this.port.onmessage = ({ data }) => {
      try {
        this.told(data);
      } catch (e) {
        this.port.postMessage({ type: "failed", message: String(e && e.message || e) });
      }
    };
  }

  fresh() {
    return { blocks: 0, busyMs: 0, made: 0, silent: 0, dry: 0, low: 0, high: 0, slowBlocks: 0, slowestMs: 0, rate: sampleRate };
  }

  /// The first of these functions the build has (undefined: none).
  pick(...names) {
    for (const n of names) if (typeof this.x[n] === "function") return this.x[n];
  }

  nor() {
    return new Uint8Array(this.x.memory.buffer, this.x.web_nor(), this.x.web_nor_size());
  }

  /// What the firmware has stored, as one piece: its flash image, or its objects one after
  /// another (a count, then each one's length, -1 for none, and bytes).
  blobs() { // the sim builds' state: nine blobs of one size
    const x = this.x, size = x.sim_blob_size();
    return [Array.from({ length: 9 }, (_, i) => new Uint8Array(x.memory.buffer, x.sim_blob(i), size)), size];
  }

  /// One block of an asyncify build: the loop runs until the frames asked for are in its ring.
  step(n) {
    const x = this.x;
    x.web_want_frames(n);
    if (!x.web_ready()) {
      if (this.started) { this.rewinding = true; x.asyncify_start_rewind(this.data); }
      this.started = true;
      x.web_run();
      if (x.asyncify_get_state() === 1) x.asyncify_stop_unwind();
    }
    x.web_take();
  }

  /// The coroutine's yield (Asyncify): the first call unwinds the loop back to web_run; the
  /// call made after a rewind ends the rewind and returns into the loop.
  yieldNow() {
    const x = this.x;
    if (this.rewinding) { x.asyncify_stop_rewind(); this.rewinding = false; return; }
    const h = new Int32Array(x.memory.buffer, this.data, 2);
    h[0] = this.data + 8;
    h[1] = this.data + this.dataSize;
    x.asyncify_start_unwind(this.data);
  }

  stored() {
    const x = this.x;
    if (this.cf) return new Uint8Array(x.memory.buffer, x.web_flash(), x.web_flash_size()).slice();
    if (this.asy) return new Uint8Array(x.memory.buffer, x.web_settings(), Math.max(0, x.web_settings_len())).slice();
    if (this.sim) {
      const [all, size] = this.blobs(), out = new Uint8Array(9 * size);
      all.forEach((b, i) => out.set(b, i * size));
      return out;
    }
    if (!x.web_nobj && !x.web_nor) return new Uint8Array(0); // (nothing to keep)
    if (x.web_nor) return this.nor().slice();
    const n = x.web_nobj(), parts = [], lens = new Int32Array(n + 1);
    lens[0] = n;
    for (let o = 0; o < n; o++) {
      const len = lens[o + 1] = x.web_store_len(o);
      if (len > 0) parts.push(new Uint8Array(x.memory.buffer, x.web_store(o), len).slice());
    }
    const out = new Uint8Array(lens.byteLength + parts.reduce((a, p) => a + p.length, 0));
    out.set(new Uint8Array(lens.buffer));
    let at = lens.byteLength;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  /// Give a build what `stored` kept, before it boots. False: it does not fit this build.
  restore(save) {
    const x = this.x;
    if (this.cf) {
      if (save.length !== x.web_flash_size()) return false;
      new Uint8Array(x.memory.buffer, x.web_flash_stage(), save.length).set(save); // (read by the firmware as it boots)
      x.web_flash_stage_len(save.length);
      return true;
    }
    if (this.asy) {
      const b = save.subarray(0, 256);
      if (!b.length) return false;
      new Uint8Array(x.memory.buffer, x.web_settings(), b.length).set(b);
      x.web_settings_set_len(b.length);
      return true;
    }
    if (this.sim) {
      const [all, size] = this.blobs();
      if (save.length !== 9 * size) return false;
      all.forEach((b, i) => b.set(save.subarray(i * size, (i + 1) * size)));
      return true;
    }
    if (x.web_nor) {
      if (save.length !== x.web_nor_size()) return false;
      this.nor().set(save);
      return true;
    }
    if (!x.web_store || save.length < 4) return false;
    const view = new DataView(save.buffer, save.byteOffset, save.byteLength), n = view.getInt32(0, true), max = x.web_store_max();
    if (n !== x.web_nobj() || save.length < 4 + 4 * n) return false;
    const lens = Array.from({ length: n }, (_, o) => view.getInt32(4 + 4 * o, true));
    if (lens.some((l) => l > max) || 4 + 4 * n + lens.reduce((a, l) => a + Math.max(0, l), 0) !== save.length) return false;
    let at = 4 + 4 * n;
    lens.forEach((len, o) => {
      if (len > 0) new Uint8Array(x.memory.buffer, x.web_store(o), len).set(save.subarray(at, at + len));
      x.web_store_set_len(o, len);
      at += Math.max(0, len);
    });
    return true;
  }

  keep() {
    this.saved = this.writes;
    this.port.postMessage({ type: "save", sha256: this.saveKey, bytes: this.stored() });
  }

  stop(tell) {
    if (!this.x) return;
    if (this.mp instanceof Mpyre) { const bytes = this.mp.stored(); if (!this.mp.kept || bytes.some((b, i) => b !== this.mp.kept[i]) || bytes.length !== this.mp.kept.length) this.port.postMessage({ type: "save", sha256: this.saveKey, bytes }); }
    else if (this.mp) { const bytes = this.mp.due(currentTime); if (bytes) this.port.postMessage({ type: "save", sha256: this.saveKey, bytes }); } // (only what changed since the last save)
    else if (this.writes !== this.saved) this.keep();
    const at_ms = this.now();
    this.x = null;
    if (tell) this.port.postMessage({ type: "events", events: [{ type: "stopped", reason: null, at_ms }] });
  }

  told(data) {
    switch (data.type) {
      case "start": {
        this.stop(true);
        this.mp = null;
        this.noteKeys = null;
        this.notesAsKeys = data.midiNotes === false; // (its MIDI IN takes no notes: a controller's go to its keys)
        if (OWN[data.style]) { this.startOwn(data, OWN[data.style]); break; }
        if (!["felucca", "x0x", "melodee", "sim", "asyncify", "coralflower"].includes(data.style)) throw new Error(`no adapter for a "${data.style}" build`);
        const sim = data.style === "sim", asy = data.style === "asyncify", cf = data.style === "coralflower", ids = sim || asy || data.style === "melodee"; // (ids: this panel's own, as they are)
        // (whatever a build asks of its host, it gets a function that does nothing)
        const module = new WebAssembly.Module(data.wasm), imports = {};
        for (const i of WebAssembly.Module.imports(module)) if (i.kind === "function") (imports[i.module] ??= {})[i.name] = () => 0;
        // (an asyncify build's two: its coroutine's yield, and the 24 MHz clock its CPU meter reads)
        if (asy) Object.assign(imports.env ??= {}, { web_yield: () => this.yieldNow(), web_ticks: () => (clock() * 24000) >>> 0 });
        // (a build that reads the WASI clock gets the device's time, as its author's page gives it
        // (LOAF BREAKER, Blop, JAMTRACK); the time held does not count)
        if (imports.wasi_snapshot_preview1?.clock_time_get) imports.wasi_snapshot_preview1.clock_time_get = (_id, _prec, out) => {
          new DataView(this.x.memory.buffer).setBigUint64(out, BigInt(Math.round((currentTime - this.idle) * 1e9)), true);
          return 0;
        };
        // (CoralFlower reads the WASI clock and counts what it prints: a clock that stays at zero stops it)
        if (cf) Object.assign(imports.wasi_snapshot_preview1 ??= {}, {
          clock_time_get: (_id, _prec, out) => { new DataView(this.x.memory.buffer).setBigUint64(out, BigInt(Math.round((currentTime - this.idle) * 1e9)), true); return 0; }, // (the time it was held does not count)
          fd_write: (_fd, iov, n, out) => {
            const dv = new DataView(this.x.memory.buffer);
            let len = 0;
            for (let i = 0; i < n; i++) len += dv.getUint32(iov + 8 * i + 4, true);
            dv.setUint32(out, len, true);
            return 0;
          },
        });
        this.idle = 0;      // seconds spent held (paused), and since when it is
        this.paused = false;
        const x = new WebAssembly.Instance(module, imports).exports;
        this.x = x;
        this.sim = sim;
        this.ids = ids;
        this.asy = asy;
        this.cf = cf;
        this.swap = !sim && !asy; // (the panel's byte order, except for the sim and asyncify builds: theirs is the host's)
        this.render = asy ? (n) => this.step(n) : sim ? x.sim_render : x.web_render;
        this.outL = sim ? x.sim_out_l : x.web_out_l;
        this.outR = sim ? x.sim_out_r : x.web_out_r;
        this.screen = this.pick("web_screen", "web_fb", "sim_fb");
        this.draws = this.pick("web_screen_draws", "web_blits", "web_fb_gen", "sim_fb_hash", "web_lcd_writes");
        this.now = this.pick("web_now_ms", "web_now", "sim_ms", "web_ms") || (() => 0);
        this.wrote = this.pick("web_flash_writes_count", "web_store_writes", "sim_store_hash", "web_settings_writes", "web_flash_dirty") || (() => 0);
        this.enc = this.pick("web_enc", "web_encoder", "sim_enc");
        this.master = this.pick("web_master", "sim_master");
        this.midi = midiIn(this.pick("web_midi", "web_midi_in", "sim_midi"));
        this.led = [
          this.pick("web_lit_buttons", "web_led_buttons", "sim_leds_buttons"), this.pick("web_lit_keys", "web_led_keys", "sim_leds_keys"),
          x.web_dim_buttons, x.web_dim_keys, x.web_breath_buttons, x.web_breath_keys, this.pick("web_mid_keys", "sim_glow_keys"),
        ];
        this.masterMost = x.web_nor || ids || cf ? 1023 : 4096; // MASTER's range, as each kind takes it
        for (const need of sim ? ["sim_init"] : asy ? ["web_run", "web_take", "web_ready", "web_want_frames", "asyncify_start_unwind"] : ["web_boot", "web_buttons"])
          if (typeof x[need] !== "function") { this.x = null; throw new Error(`this build has no ${need}: it is not of the kind expected`); }
        if (!this.render || !this.outL || !this.outR || !this.enc) { this.x = null; throw new Error("this build has no sound or no encoders: it is not of the kind expected"); }
        if (!this.screen || !(sim || x.web_keys || x.web_key)) { this.x = null; throw new Error("this build has no screen or no keys: it is not of the kind expected"); }
        if (x._initialize) x._initialize();
        if (x.web_nor_erase) x.web_nor_erase();
        const restored = !!data.save && this.restore(data.save);
        const volume = Math.round(800 * this.masterMost / 1023);
        if (this.master) this.master(volume);
        if (sim) { if (x.sim_init(sampleRate) !== 0) { this.x = null; throw new Error("the build's sim_init failed"); } }
        else if (asy) { // (no boot call: the first block starts its loop)
          this.data = x.web_async_buf();
          this.dataSize = x.web_async_size();
          this.started = this.rewinding = false;
        } else x.web_boot(data.style === "melodee" ? volume : undefined); // (Melodee takes MASTER at power on)
        this.saveKey = data.sha256;
        this.buttons = this.keys = 0;
        this.queue = [];
        this.nextOk = 0;
        this.drawn = -1;
        this.leds = "";
        this.writes = this.saved = this.wrote();
        this.hold(!!data.paused);
        const rateOf = this.pick("web_sample_rate", "sim_rate"), rate = rateOf ? rateOf() : 44100;
        const info = { identity: "browser build", board: "fm1", sample_rate: rate, screen_width: 240, screen_height: 240 };
        this.port.postMessage({ type: "started", id: data.id, info, save_restored: restored, mhz: 0, fixed: true });
        break;
      }
      case "stop": this.stop(true); break;
      case "dispose": this.stop(true); this.gone = true; break; // (the page is done with this node)
      case "pause": if (this.x) this.hold(!!data.paused); break;
      case "input": this.input(data.input); break;
      case "stats":
        this.port.postMessage({ type: "stats", stats: { ...this.stats, load: Math.round(100 * this.stats.busyMs / (1000 * this.stats.blocks * 128 / sampleRate || 1)) } });
        this.stats = this.fresh();
        break;
    }
  }

  /// A build with a path of its own (OWN): made, given its save, started.
  startOwn(data, Own) {
    const module = new WebAssembly.Module(data.wasm), imports = {};
    for (const i of WebAssembly.Module.imports(module)) if (i.kind === "function") (imports[i.module] ??= {})[i.name] = () => 0;
    const x = new WebAssembly.Instance(module, imports).exports;
    for (const need of Own.NEEDS)
      if (typeof x[need] !== "function") throw new Error(`this build has no ${need}: it is not of the kind expected`);
    if (x._initialize) x._initialize();
    this.idle = 0;
    this.paused = false;
    this.now = () => Math.round((currentTime - this.idle) * 1000);
    const mp = new Own(module, x, data.save || null, () => this.now());
    const restored = !!mp.restored;
    this.x = x;
    this.mp = mp;
    this.saveKey = data.sha256;
    this.hold(!!data.paused);
    const rate = x.emu_rate ? x.emu_rate() : 44100;
    const info = { identity: "browser build", board: "fm1", sample_rate: rate, screen_width: 240, screen_height: 240 };
    this.port.postMessage({ type: "started", id: data.id, info, save_restored: restored, mhz: 0, fixed: true });
  }

  /// Held: the firmware is not run (silence, and its clock stands still) until let go.
  hold(paused) {
    if (paused === this.paused) return;
    if (paused) this.heldAt = currentTime; else this.idle += currentTime - this.heldAt;
    this.paused = paused;
  }

  input(i) {
    const x = this.x;
    if (!x) return;
    // (MIDI for a build without a MIDI IN, or one whose MIDI IN takes no notes: its notes as keys;
    // the rest to its MIDI IN where it has one)
    const midi = this.mp ? this.mp.midi : this.midi; // (this build's MIDI IN, as three bytes; none: undefined)
    if (i.type === "midi" && (!midi || this.notesAsKeys)) {
      for (let k = 0; k + 2 < i.bytes.length; k += 3) {
        const [st, d1, d2] = [i.bytes[k], i.bytes[k + 1], i.bytes[k + 2]];
        const key = (this.noteKeys ??= new NoteKeys()).key(st, d1, d2);
        if (key) this.input(key);
        else if (midi && ((st & 0xf0) !== 0x90 && (st & 0xf0) !== 0x80)) midi(st, d1, d2);
      }
      return;
    }
    if (this.mp) {
      if (i.type === "midi") { for (let k = 0; k + 2 < i.bytes.length; k += 3) midi(i.bytes[k], i.bytes[k + 1], i.bytes[k + 2]); return; }
      return this.mp.input(i);
    }
    if (i.type === "key") {
      const isKey = i.id >= 14, bit = 1 << (isKey ? i.id - 14 : this.ids ? i.id : label(i.id));
      const was = isKey ? this.keys : this.buttons, now = i.down ? was | bit : was & ~bit;
      if (isKey) this.keys = now; else this.buttons = now;
      // (a build that takes its keys one at a time is told which, and how hard it landed)
      if (this.sim) this.queue.push(isKey ? () => x.sim_key(i.id - 14, i.down ? 1 : 0) : () => x.sim_button(i.id, i.down ? 1 : 0));
      else if (isKey && !x.web_keys) this.queue.push(() => x.web_key(i.id - 14, i.down ? i.velocity || 100 : 0, 0));
      else if (isKey) this.queue.push(() => x.web_keys(now >>> 0));
      else this.queue.push(() => x.web_buttons(now >>> 0));
    } else if (i.type === "encoder") {
      this.enc(this.ids ? i.id : role(i.id), i.clicks | 0);
    } else if (i.type === "analog") {
      if (i.channel === 4 && this.master) this.master(Math.round(i.value * this.masterMost / 1023));
    } else if (i.type === "midi" && this.midi) {
      for (let k = 0; k + 2 < i.bytes.length; k += 3) this.midi(i.bytes[k], i.bytes[k + 1], i.bytes[k + 2]);
    }
  }

  /// The screen, the lights and the storage, when they changed.
  publish() {
    const x = this.x, mem = x.memory.buffer;
    if (this.mp) return this.publishMpyre();
    const draws = this.draws ? this.draws() : this.drawn + 1;
    if (draws !== this.drawn) {
      this.drawn = draws;
      this.sendScreen(new Uint16Array(mem, this.screen(), 240 * 240), this.swap);
    }
    this.publishRest(x);
  }

  publishMpyre() {
    const s = this.mp.screen();
    if (s?.rgba) this.port.postMessage({ type: "frame", rgba: s.rgba }, [s.rgba.buffer]);
    else if (s) this.sendScreen(s.fb, s.swap);
    const levels = this.mp.levels();
    if (levels) this.port.postMessage({ type: "events", events: [{ type: "leds", levels }] });
    const bytes = this.mp.due(currentTime);
    if (bytes) this.port.postMessage({ type: "save", sha256: this.saveKey, bytes });
  }

  /// A 240x240 RGB565 screen to the page, as RGBA.
  sendScreen(fb, swap) {
    const rgba = new Uint8ClampedArray(240 * 240 * 4);
    for (let p = 0, o = 0; p < fb.length; p++, o += 4) {
      const v = fb[p], c = swap ? (v >> 8 | v << 8) & 0xffff : v; // the panel's byte order
      const r = c >> 11, g = c >> 5 & 63, b = c & 31;
      rgba[o] = r << 3 | r >> 2;
      rgba[o + 1] = g << 2 | g >> 4;
      rgba[o + 2] = b << 3 | b >> 2;
      rgba[o + 3] = 255;
    }
    this.port.postMessage({ type: "frame", rgba }, [rgba.buffer]);
  }

  /// The lights and the storage, when they changed.
  publishRest(x) {
    if (this.cf) { this.publishLeds(x); this.publishSave(); return; }
    const masks = this.led.map((f) => (f ? f() >>> 0 : 0));
    const key = masks.join(",");
    if (key !== this.leds) {
      this.leds = key;
      const [litB, litK, dimB, dimK, brB, brK, midK] = masks, levels = new Array(41).fill(0);
      const level = (lit, mid, dim) => (lit ? LIT : mid ? MID : dim ? DIM : 0);
      for (let id = 0; id < 14; id++) {
        const bit = 1 << (this.ids ? id : label(id));
        levels[id] = level(litB & bit, brB & bit, dimB & bit);
      }
      if (!this.ids && litB & 1 << 14) levels[12] = LIT; // PLAY's second LED
      for (let k = 0; k < 27; k++) levels[14 + k] = level(litK & 1 << k, (midK | brK) & 1 << k, dimK & 1 << k);
      this.port.postMessage({ type: "events", events: [{ type: "leds", levels }] });
    }

    this.publishSave();
  }

  /// CoralFlower's lights: one array, keys 0..26, buttons in label order, then PLAY's green;
  /// 0 off, 1 dim, 2 lit, 3 middle, 4 faint.
  publishLeds(x) {
    const a = new Uint8Array(x.memory.buffer, x.web_leds(), 42), key = a.join("");
    if (key !== this.leds) {
      this.leds = key;
      const levels = new Array(41).fill(0), of = (v) => (v === 2 ? LIT : v === 3 ? MID : v === 1 ? DIM : v === 4 ? DIM / 2 : 0);
      for (let id = 0; id < 14; id++) levels[id] = of(a[27 + label(id)]);
      if (a[41]) levels[12] = LIT; // PLAY's second LED
      for (let k = 0; k < 27; k++) levels[14 + k] = of(a[k]);
      this.port.postMessage({ type: "events", events: [{ type: "leds", levels }] });
    }
  }

  publishSave() {
    // (a save is taken once the flash has been left alone a while: a write is many small ones)
    const writes = this.wrote();
    if (writes !== this.writes) { this.writes = writes; this.writesAt = currentTime; }
    else if (this.writes !== this.saved && currentTime - this.writesAt >= SAVE_AFTER) this.keep();
  }

  process(_inputs, outputs) {
    if (this.gone) return false; // (lets the browser drop this processor)
    const [left, right] = outputs[0], x = this.x;
    this.stats.blocks++;
    if (!x || this.paused) return true;
    try {
      if (!this.mp && this.queue.length && this.now() - this.nextOk >= 0) {
        this.queue.shift()();
        this.nextOk = this.now() + HOLD_MS;
      }
      const n = left.length, began = clock();
      if (this.mp) this.mp.render(left, right);
      else this.render(n);
      const took = clock() - began;
      this.stats.busyMs += took;
      if (took >= 1000 * n / sampleRate) this.stats.slowBlocks++;
      this.stats.slowestMs = Math.max(this.stats.slowestMs, took);
      this.stats.made += n;
      if (!this.mp) {
        left.set(new Float32Array(x.memory.buffer, this.outL(), n));
        if (right) right.set(new Float32Array(x.memory.buffer, this.outR(), n));
      }
      if (currentTime - this.lastScreen >= SCREEN_EVERY) {
        this.lastScreen = currentTime;
        this.publish();
      }
    } catch (e) {
      this.x = null;
      this.port.postMessage({ type: "events", events: [{ type: "stopped", reason: `the firmware's browser build failed: ${e && e.message || e}`, at_ms: 0 }] });
    }
    return true;
  }
}

registerProcessor("fma-native", Native);
