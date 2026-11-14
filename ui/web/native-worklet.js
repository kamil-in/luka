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
    if (this.writes !== this.saved) this.keep();
    const at_ms = this.now();
    this.x = null;
    if (tell) this.port.postMessage({ type: "events", events: [{ type: "stopped", reason: null, at_ms }] });
  }

  told(data) {
    switch (data.type) {
      case "start": {
        this.stop(true);
        if (!["felucca", "x0x", "melodee", "sim", "asyncify", "coralflower"].includes(data.style)) throw new Error(`no adapter for a "${data.style}" build`);
        const sim = data.style === "sim", asy = data.style === "asyncify", cf = data.style === "coralflower", ids = sim || asy || data.style === "melodee"; // (ids: this panel's own, as they are)
        // (whatever a build asks of its host, it gets a function that does nothing)
        const module = new WebAssembly.Module(data.wasm), imports = {};
        for (const i of WebAssembly.Module.imports(module)) if (i.kind === "function") (imports[i.module] ??= {})[i.name] = () => 0;
        // (an asyncify build's two: its coroutine's yield, and the 24 MHz clock its CPU meter reads)
        if (asy) Object.assign(imports.env ??= {}, { web_yield: () => this.yieldNow(), web_ticks: () => (clock() * 24000) >>> 0 });
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
        this.midi = cf
          ? (st, d1, d2) => x.web_midi_in((((st >> 4) & 15) | st << 8 | d1 << 16 | d2 << 24) >>> 0) // (a USB-MIDI packet)
          : this.pick("web_midi", "web_midi_in", "sim_midi");
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

  /// Held: the firmware is not run (silence, and its clock stands still) until let go.
  hold(paused) {
    if (paused === this.paused) return;
    if (paused) this.heldAt = currentTime; else this.idle += currentTime - this.heldAt;
    this.paused = paused;
  }

  input(i) {
    const x = this.x;
    if (!x) return;
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
    const draws = this.draws ? this.draws() : this.drawn + 1;
    if (draws !== this.drawn) {
      this.drawn = draws;
      const fb = new Uint16Array(mem, this.screen(), 240 * 240), rgba = new Uint8ClampedArray(240 * 240 * 4);
      for (let p = 0, o = 0; p < fb.length; p++, o += 4) {
        const v = fb[p], c = this.swap ? (v >> 8 | v << 8) & 0xffff : v; // the panel's byte order
        const r = c >> 11, g = c >> 5 & 63, b = c & 31;
        rgba[o] = r << 3 | r >> 2;
        rgba[o + 1] = g << 2 | g >> 4;
        rgba[o + 2] = b << 3 | b >> 2;
        rgba[o + 3] = 255;
      }
      this.port.postMessage({ type: "frame", rgba }, [rgba.buffer]);
    }

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
      if (this.queue.length && this.now() - this.nextOk >= 0) {
        this.queue.shift()();
        this.nextOk = this.now() + HOLD_MS;
      }
      const n = left.length, began = clock();
      this.render(n);
      const took = clock() - began;
      this.stats.busyMs += took;
      if (took >= 1000 * n / sampleRate) this.stats.slowBlocks++;
      this.stats.slowestMs = Math.max(this.stats.slowestMs, took);
      this.stats.made += n;
      left.set(new Float32Array(x.memory.buffer, this.outL(), n));
      if (right) right.set(new Float32Array(x.memory.buffer, this.outR(), n));
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
