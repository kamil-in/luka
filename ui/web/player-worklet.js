// The web client's player, in the audio thread: what the native Session is on a desktop,
// with the sound card as its clock. For each block of audio the browser asks for (128
// frames), the machine (crates/fma-wasm) is run for the time that block stands for and its
// audio played. Nothing here waits on a timer, so nothing arrives late; and the page's
// audio runs at the firmware's own rate, so the samples are played as they were made.
// (fm1-emu's own page works this way; a worker on a timer, tried first, did not hold up.)
//
//   page -> here   {type: "module", bytes}
//                  {type: "start", id, sha256, package: ArrayBuffer, save: Uint8Array|null, options}
//                  {type: "stop"} | {type: "input", input} | {type: "stats"}
//   here -> page   {type: "started", id, info, save_restored} | {type: "failed", message}
//                  {type: "events", events} | {type: "frame", rgba} | {type: "save", sha256, bytes}
//                  {type: "stats", stats}

const RATE = 44100;        // what the firmware makes
const SIZE = 1 << 15;      // frames the buffer holds (a power of two)
const MOST = RATE * 0.2;   // more than this in it and the oldest goes

// The host side of the emulator's WebAssembly JIT, as ./jit.js (a worklet does not import
// modules everywhere). From fm1-emu, MIT, Copyright (c) 2026 Joakim Eriksson: THIRD-PARTY.md.
function jitImports(exports) {
  let next;
  return {
    fm1_jit_compile(ptr, len, hRead, hWrite, hOp) {
      try {
        const x = exports();
        const bytes = new Uint8Array(x.memory.buffer, ptr, len).slice();
        const table = x.__indirect_function_table;
        const env = { memory: x.memory, h_read: table.get(hRead), h_write: table.get(hWrite), h_op: table.get(hOp) };
        const run = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env }).exports.run;
        if (next === undefined || next >= table.length) { next = table.length; table.grow(256); }
        const slot = next++;
        table.set(slot, run);
        return slot;
      } catch (e) {
        return 0;
      }
    },
  };
}

// (the finer clock where the audio thread has one)
const clock = globalThis.performance ? () => globalThis.performance.now() : () => Date.now();

// (an audio worklet has no TextEncoder or TextDecoder)
function utf8(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode((b & 31) << 6 | bytes[i++] & 63);
    else if (b < 0xf0) s += String.fromCharCode((b & 15) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63);
    else s += String.fromCodePoint((b & 7) << 18 | (bytes[i++] & 63) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63);
  }
  return s;
}
const ascii = (json) => Uint8Array.from(json.replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")), (c) => c.charCodeAt(0));

class Player extends AudioWorkletProcessor {
  constructor() {
    super();
    this.x = null;          // the player's exports
    this.running = false;
    this.sha256 = null;     // of the package playing: what its saves are kept under
    // the audio made and not yet played: a block comes out a frame or two short or long
    // now and then (a firmware hands its audio out in pieces of its own size)
    this.l = new Float32Array(SIZE);
    this.r = new Float32Array(SIZE);
    this.read = 0;
    this.have = 0;
    this.pos = 0;
    this.playing = false;
    // the page's audio at the firmware's rate: frames go out as they came. Otherwise (a
    // browser that would not give that rate) they are resampled, leaning on the buffer's level.
    this.exact = sampleRate === RATE;
    this.target = this.exact ? 256 : RATE * 0.04;
    this.level = this.target;
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
    return { blocks: 0, busyMs: 0, made: 0, silent: 0, dry: 0, low: this.have, high: this.have, slowBlocks: 0, slowestMs: 0, rate: sampleRate };
  }

  put(bytes) {
    if (!bytes || !bytes.length) return [0, 0];
    const ptr = this.x.fma_alloc(bytes.length);
    new Uint8Array(this.x.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  }

  text() {
    return utf8(new Uint8Array(this.x.memory.buffer, this.x.fma_text_ptr(), this.x.fma_text_len()));
  }

  keep(now) {
    const len = this.x.fma_save(now ? 1 : 0);
    if (len) this.port.postMessage({ type: "save", sha256: this.sha256, bytes: new Uint8Array(this.x.memory.buffer, this.x.fma_save_ptr(), len).slice() });
  }

  stop(tell) {
    if (!this.running) return;
    this.running = false;
    this.keep(true);
    const at_ms = this.x.fma_elapsed_ms();
    this.x.fma_stop();
    this.have = 0;
    this.playing = false;
    if (tell) this.port.postMessage({ type: "events", events: [{ type: "stopped", reason: null, at_ms }] });
  }

  told(data) {
    switch (data.type) {
      case "module": {
        let exports;
        exports = new WebAssembly.Instance(new WebAssembly.Module(data.bytes), { env: jitImports(() => exports) }).exports;
        this.x = exports;
        break;
      }
      case "start": {
        if (!this.x) throw new Error("the player has not loaded");
        this.stop(true);
        const options = data.options || {};
        const [pkg, pkgLen] = this.put(new Uint8Array(data.package));
        const [save, saveLen] = this.put(data.save);
        const ok = this.x.fma_start(pkg, pkgLen, save, saveLen, options.clock_mhz || 240, options.jit === false ? 0 : 1);
        const said = JSON.parse(this.text());
        if (!ok) return this.port.postMessage({ type: "failed", message: said });
        this.sha256 = data.sha256;
        this.running = true;
        this.port.postMessage({ type: "started", id: data.id, info: said.info, save_restored: said.save_restored, mhz: options.clock_mhz || 240, fixed: !!data.fixed });
        break;
      }
      case "stop": this.stop(true); break;
      case "input": {
        if (!this.running) break;
        const [ptr, len] = this.put(ascii(JSON.stringify(data.input)));
        this.x.fma_input(ptr, len);
        break;
      }
      case "stats":
        // (load: the share of real time spent running the machine, in percent)
        this.port.postMessage({ type: "stats", stats: { ...this.stats, have: this.have, load: Math.round(100 * this.stats.busyMs / (1000 * this.stats.blocks * 128 / sampleRate || 1)) } });
        this.stats = this.fresh();
        break;
    }
  }

  /// Run the machine for one block's time, and take what came of it.
  tick(frames) {
    const x = this.x, began = clock();
    x.fma_tick(1000 * frames / sampleRate);
    const took = clock() - began;
    this.stats.busyMs += took;
    if (took >= 1000 * frames / sampleRate) this.stats.slowBlocks++; // (it took longer to make than to play)
    this.stats.slowestMs = Math.max(this.stats.slowestMs, took);

    const n = x.fma_audio_len();
    if (n) {
      const samples = new Int16Array(x.memory.buffer, x.fma_audio_ptr(), n);
      for (let i = 0; i + 1 < n; i += 2) {
        if (this.have >= SIZE) { this.read = (this.read + 1) & (SIZE - 1); this.have--; }
        const at = (this.read + this.have++) & (SIZE - 1);
        this.l[at] = samples[i] / 32768;
        this.r[at] = samples[i + 1] / 32768;
      }
      this.stats.made += n >> 1;
      if (this.have > MOST) {
        const drop = this.have - this.target | 0;
        this.read = (this.read + drop) & (SIZE - 1);
        this.have -= drop;
      }
      this.stats.high = Math.max(this.stats.high, this.have);
    }
    const bytes = x.fma_frame_len();
    if (bytes) {
      const rgba = new Uint8ClampedArray(x.memory.buffer, x.fma_frame_ptr(), bytes).slice();
      this.port.postMessage({ type: "frame", rgba }, [rgba.buffer]);
    }
    if (x.fma_text_len() > 2) this.port.postMessage({ type: "events", events: JSON.parse(this.text()) }); // (more than "[]")
    this.keep(false);
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (this.running) {
      try {
        this.tick(left.length);
      } catch (e) {
        this.running = false;
        this.port.postMessage({ type: "events", events: [{ type: "stopped", reason: `the player failed: ${e && e.message || e}`, at_ms: 0 }] });
      }
    }
    this.stats.blocks++;
    const step = RATE / sampleRate;
    for (let i = 0; i < left.length; i++) {
      this.stats.low = Math.min(this.stats.low, this.have);
      if (!this.playing && this.have >= this.target) { this.playing = true; this.pos = 0; this.level = this.target; }
      if (!this.playing || this.have < 2) {
        if (this.running) { this.stats.silent++; if (this.playing) this.stats.dry++; }
        this.playing = false;
        left[i] = 0;
        if (right) right[i] = 0;
        continue;
      }
      const a = this.read;
      if (this.exact) {
        left[i] = this.l[a];
        if (right) right[i] = this.r[a];
        this.read = (a + 1) & (SIZE - 1);
        this.have--;
        continue;
      }
      const b = (a + 1) & (SIZE - 1), t = this.pos;
      left[i] = this.l[a] + (this.l[b] - this.l[a]) * t;
      if (right) right[i] = this.r[a] + (this.r[b] - this.r[a]) * t;
      this.level += (this.have - this.level) / sampleRate;
      const lean = Math.max(-1, Math.min(1, (this.level - this.target) / this.target)) * 0.005;
      this.pos += step * (1 + lean);
      while (this.pos >= 1 && this.have >= 2) {
        this.read = (this.read + 1) & (SIZE - 1);
        this.have--;
        this.pos -= 1;
      }
    }
    return true;
  }
}

registerProcessor("fma-player", Player);
