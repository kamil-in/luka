// The web client's mixer: where the slots' sound meets before it is heard. Each slot has a
// volume of its own (a strip, kept while firmwares come and go in that slot); all strips go into
// one bus that every slot shares:
//
//   slot's node -> its mute (transport-web.js) -> strip volume -> meter
//                                                      |
//   bus: low-pass -> high-pass ----------------------+-> master -> limiter -> speakers
//                              \-> delay send -> delay (feedback, darker each time) -/
//                              \-> reverb send -> reverb (made here: no file) -------/
//
// All of it is the browser's own audio nodes (they run in its audio thread, beside the worklets,
// for very little). The limiter is a compressor set hard and fast: the four slots summed have no
// headroom of their own.
//
//   createMixBus(context, count) -> { strip(i), setVolume(i, v), setFx({ master, filter, delay, reverb }), levels() }
//     volume, master    0..1, heard as v * v (a fader's taper); 1 is the level as it was before the mixer
//     filter            -1..1: below 0 a low-pass closing, above 0 a high-pass opening, 0 neither
//     delay, reverb     0..1: how much of the mix goes into each

const LOW_OPEN = 20000, LOW_SHUT = 120;   // Hz: the low-pass, wide open and turned fully left
const HIGH_OPEN = 20, HIGH_SHUT = 6000;   // Hz: the high-pass, open and turned fully right
const DELAY_S = 0.375, FEEDBACK = 0.45;   // a dotted eighth at 120 BPM; each repeat a little quieter
const REVERB_S = 2.4;
const GLIDE = 0.02;                       // s: a control's change is a short glide, not a click

/// A stereo reverb's impulse: decaying noise, each side its own, darker as it dies.
function impulse(context) {
  const n = Math.round(REVERB_S * context.sampleRate), ir = context.createBuffer(2, n, context.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n, a = 0.3 + 0.65 * t; // (later, smoothed more: the high end goes first)
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = lp * Math.pow(1 - t, 3) * 2.2;
    }
  }
  return ir;
}

const sweep = (open, shut, amount) => open * Math.pow(shut / open, amount); // (even in pitch, not in Hz)

export function createMixBus(context, count) {
  const node = (make, props = {}) => Object.assign(make, props);
  const set = (param, value) => param.setTargetAtTime(value, context.currentTime, GLIDE);

  const input = context.createGain();
  const low = node(context.createBiquadFilter(), { type: "lowpass" }), high = node(context.createBiquadFilter(), { type: "highpass" });
  low.frequency.value = LOW_OPEN; high.frequency.value = HIGH_OPEN;
  low.Q.value = high.Q.value = 0.9;
  const master = context.createGain();
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
  input.connect(low).connect(high).connect(master).connect(limiter).connect(context.destination);

  // the delay: a send, a line that feeds itself back through a low-pass (each repeat darker)
  const delaySend = context.createGain(), delay = context.createDelay(2), feedback = context.createGain(), tone = node(context.createBiquadFilter(), { type: "lowpass" });
  delaySend.gain.value = 0; delay.delayTime.value = DELAY_S; feedback.gain.value = FEEDBACK; tone.frequency.value = 3500;
  high.connect(delaySend).connect(delay).connect(tone).connect(feedback).connect(delay);
  tone.connect(master);

  // the reverb: a send into a convolver of a made-up room
  const reverbSend = context.createGain(), reverb = node(context.createConvolver(), { buffer: impulse(context) });
  reverbSend.gain.value = 0;
  high.connect(reverbSend).connect(reverb).connect(master);

  // the strips: each slot's volume, then a meter that reads it
  const strips = Array.from({ length: count }, () => {
    const gain = context.createGain(), meter = node(context.createAnalyser(), { fftSize: 1024 });
    gain.connect(meter);
    gain.connect(input);
    return { gain, meter, buf: new Float32Array(1024) };
  });

  return {
    /// Where slot i's sound goes in.
    strip: (i) => strips[i].gain,
    setVolume(i, v) { if (strips[i]) set(strips[i].gain.gain, v * v); },
    setFx({ master: m, filter, delay: d, reverb: r }) {
      if (m !== undefined) set(master.gain, m * m);
      if (filter !== undefined) {
        set(low.frequency, filter < 0 ? sweep(LOW_OPEN, LOW_SHUT, -filter) : LOW_OPEN);
        set(high.frequency, filter > 0 ? sweep(HIGH_OPEN, HIGH_SHUT, filter) : HIGH_OPEN);
      }
      if (d !== undefined) set(delaySend.gain, d * 0.8);
      if (r !== undefined) set(reverbSend.gain, r * 1.2);
    },
    /// Each slot's peak since it was last asked, 0..1 (after its volume).
    levels() {
      return strips.map((s) => {
        s.meter.getFloatTimeDomainData(s.buf);
        let peak = 0;
        for (const v of s.buf) peak = Math.max(peak, Math.abs(v));
        return Math.min(1, peak);
      });
    },
    // (for a look from the console, and the page's checks)
    nodes: { input, low, high, master, limiter, delaySend, reverbSend, strips },
  };
}
