// Does a browser build make sound by itself, with nothing pressed? Some firmwares are
// generative and play from power on (Aisling, AMB-1, Nachtfahrt, SATIE-1, ZEN-1); the page
// loads those muted, so that starting one beside others is not a surprise. Measured, not
// listed by hand: the build is run here by the page's own adapter (ui/web/native-worklet.js,
// with stand-ins for the few things an audio thread gives it) and its output is watched.
//
//   selfStarts(bytes, style) -> true | false      (false too when the build cannot be run)
//
// A sound at power on that dies away (CoralFlower's, about 5 s) does not count: what is
// looked at is the stretch from FROM_S to UNTIL_S of the device's time.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RATE = 44100, BLOCK = 128;
const FROM_S = 8, UNTIL_S = 14;
const HEARD = 0.004; // a peak above this is sound (ZEN-1's quiet drone is about 0.01)

let Processor;
async function processor() {
  if (Processor) return Processor;
  globalThis.sampleRate = RATE;
  globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => this.said?.(m), onmessage: null }; } };
  globalThis.registerProcessor = (_name, made) => { Processor = made; };
  await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "web", "native-worklet.js")).href);
  return Processor;
}

/// Does the build play a note it is sent over MIDI? Some have a MIDI IN that takes clock or
/// controllers but no notes (Blop); a controller's notes then go to its keys instead. Measured as
/// above: four seconds of nothing, half a second as it was, then half a second after MIDI note 60.
/// False too when it has no MIDI IN or cannot be run.
export async function playsMidiNotes(bytes, style) {
  if (!style) return false;
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map((e) => e.name);
  if (!["web_midi", "web_midi_in", "sim_midi", "w_midi", "midi"].some((n) => exports.includes(n))) return false;
  const p = new (await processor())();
  let failed = false;
  p.said = (m) => { if (m.type === "failed" || (m.type === "events" && m.events.some((e) => e.type === "stopped" && e.reason))) failed = true; };
  globalThis.currentTime = 0;
  const wasm = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  p.port.onmessage({ data: { type: "start", id: "midi-notes", sha256: "midi-notes", wasm, save: null, style, midiNotes: true } });
  const out = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
  let block = 0;
  const energy = (seconds) => {
    let e = 0, peak = 0;
    for (const end = block + seconds * RATE / BLOCK; !failed && block < end; block++) {
      globalThis.currentTime = block * BLOCK / RATE;
      out[0][0].fill(0);
      out[0][1].fill(0);
      p.process([], out);
      for (const channel of out[0]) for (const v of channel) { e += v * v; peak = Math.max(peak, Math.abs(v)); }
    }
    return { e, peak };
  };
  energy(4);
  const before = energy(0.5);
  p.port.onmessage({ data: { type: "input", input: { type: "midi", bytes: [0x90, 60, 100] } } });
  const after = energy(0.5);
  if (failed) return false;
  return before.peak < HEARD ? after.peak >= HEARD : after.e > 1.5 * before.e;
}

export async function selfStarts(bytes, style) {
  if (!style) return false;
  const p = new (await processor())();
  let failed = false;
  p.said = (m) => { if (m.type === "failed" || (m.type === "events" && m.events.some((e) => e.type === "stopped" && e.reason))) failed = true; };
  globalThis.currentTime = 0;
  const wasm = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  p.port.onmessage({ data: { type: "start", id: "self-start", sha256: "self-start", wasm, save: null, style } });
  const out = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
  for (let block = 0; !failed && block * BLOCK < UNTIL_S * RATE; block++) {
    globalThis.currentTime = block * BLOCK / RATE;
    out[0][0].fill(0);
    out[0][1].fill(0);
    p.process([], out);
    if (globalThis.currentTime < FROM_S) continue;
    for (const channel of out[0]) for (const v of channel) if (Math.abs(v) >= HEARD) return true;
  }
  return false;
}
