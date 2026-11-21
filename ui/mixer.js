// The mixer's state and what the panel's eight knobs do to it when the mix is chosen. No page,
// no sound: app.js draws it and gives it to the transport (`mix`, `fx`; web/mixbus.js plays it).
//
//   knob 0..3  (master, select, presets, algorithm on the device)  the four slots' volumes
//   knob 4..7  (knob 1..4)                                         master, filter, delay, reverb
//
// Values: volumes, master, delay, reverb 0..1; filter -1..1 (below 0 low-pass, above high-pass).
//
// Pickup: a controller's knob that says where it stands (0..127) would make a value jump when the
// same knob is first moved after the mix and a firmware traded it; so it takes over a value only
// once it reaches it (passes it, or comes within PICKUP_NEAR of it). Endless knobs (clicks) are
// never held back.

export const LABELS = ["vol 1", "vol 2", "vol 3", "vol 4", "master", "filter", "delay", "reverb"];
const FX = ["master", "filter", "delay", "reverb"];
const STEPS = 40;            // clicks from one end to the other
const PICKUP_NEAR = 3 / 127; // close enough to take over

export const defaults = () => ({ volumes: [1, 1, 1, 1], fx: { master: 1, filter: 0, delay: 0, reverb: 0 } });

const low = (i) => (i === 5 ? -1 : 0);
const clamp = (v, lo) => Math.min(1, Math.max(lo, v));

/// Knob i's value in a state.
export function valueOf(state, i) {
  return i < 4 ? state.volumes[i] : state.fx[FX[i - 4]];
}

/// The same state with knob i at `v` (kept in its range).
export function withValue(state, i, v) {
  v = clamp(Number(v) || 0, low(i));
  if (i < 4) { const volumes = [...state.volumes]; volumes[i] = v; return { ...state, volumes }; }
  return { ...state, fx: { ...state.fx, [FX[i - 4]]: v } };
}

/// Knob i turned by `clicks` (+ clockwise). The filter stops at its middle (off) on the way through.
export function turned(state, i, clicks) {
  const was = valueOf(state, i), step = (1 - low(i)) / STEPS;
  let v = clamp(was + clicks * step, low(i));
  if (i === 5 && was !== 0 && Math.sign(v) !== Math.sign(was)) v = 0;
  return withValue(state, i, Math.round(v * 1000) / 1000);
}

/// Knob i set from a position 0..1 (an absolute controller knob): the filter's middle is off.
export function fromPosition(i, position) {
  return low(i) + position * (1 - low(i));
}

/// Knob i's value as a position 0..1 (what pickup compares a controller's knob with).
export function positionOf(state, i) {
  const lo = low(i);
  return (valueOf(state, i) - lo) / (1 - lo);
}

/// Knob i's dial angle, as the panel draws knobs (-135..135 degrees).
export function angleOf(state, i) {
  return -135 + 270 * positionOf(state, i);
}

/// What the transport is told for knob i: `{type: "mix", slot, volume}` or `{type: "fx", name: value}`.
export function command(state, i) {
  return i < 4 ? { type: "mix", slot: i, volume: state.volumes[i] } : { type: "fx", [FX[i - 4]]: state.fx[FX[i - 4]] };
}

/// A knob's value to show: percent; the filter as off, or lp / hp and how far.
export function text(state, i) {
  const v = valueOf(state, i);
  if (i === 5) return Math.abs(v) < 0.005 ? "off" : `${v < 0 ? "lp" : "hp"} ${Math.round(Math.abs(v) * 100)}`;
  return `${Math.round(v * 100)}`;
}

/// A state read back (from storage): anything missing or wrong is the default.
export function sane(raw) {
  let s = defaults();
  if (!raw || typeof raw !== "object") return s;
  for (let i = 0; i < 8; i++) {
    const v = i < 4 ? raw.volumes?.[i] : raw.fx?.[FX[i - 4]];
    if (typeof v === "number" && Number.isFinite(v)) s = withValue(s, i, v);
  }
  return s;
}

/// Pickup for knobs that say where they stand. `take(key, position, target)`: position 0..1 is
/// where the controller's knob is, target 0..1 where the value it would move stands; it gives the
/// position to use, or null while the knob has not reached the value yet. `release(key)` (or all,
/// none given): the value was moved some other way, so the knob must reach it again.
export function createPickup() {
  const held = new Map(); // key -> { on: following, last: the knob's last position }
  return {
    take(key, position, target) {
      const k = held.get(key) || { on: false, last: null };
      if (!k.on) {
        const crossed = k.last !== null && (k.last - target) * (position - target) <= 0;
        if (crossed || Math.abs(position - target) <= PICKUP_NEAR) k.on = true;
      }
      k.last = position;
      held.set(key, k);
      return k.on ? position : null;
    },
    // (its last position is forgotten too: where the knob stood before says nothing now)
    release(key) {
      for (const [name, k] of held) if (key === undefined || name === key) { k.on = false; k.last = null; }
    },
  };
}
