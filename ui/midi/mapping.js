// Turns incoming MIDI messages into panel inputs, by a list of rules. Device-neutral: nothing in
// here knows about a particular controller, and the rules are plain JSON, so a profile can ship
// them and a user can write their own.
//
// What comes out is the same plain objects the panel's own controls make (the protocol's `Input`):
//   { type: "key", id, down, velocity }       a button or a note key
//   { type: "encoder", id, clicks }           an encoder turned (+: clockwise)
//   { type: "analog", channel, value }        a pot, fader or wheel, 0..1023
//   { type: "midi", bytes }                   bytes for the firmware's own MIDI IN
//   { type: "action", name }                  something for the page itself to do ("nav-left", ...)
//   { type: "action", name, delta, value? }   a knob: how far it turned (in clicks) and, if it says
//                                             where it stands (an absolute one), that, 0..127
//
// A rule is { from, to }; the first rule that matches a message wins.
//
//   from: { type: "note" | "cc" | "pitchbend" | "raw" | "any",
//           channel?: 1..16 (none: any),
//           number?: n            one note or controller,
//           range?: [lo, hi],     or a span of them
//           bytes?: [..] }        raw: a message exactly as it is (system-exclusive, for one)
//
//   to (note):      { type: "key", offset: n, idRange?: [lo, hi], fold?: 12 }   id = note + offset; outside
//                        the range it is dropped, or, with `fold`, moved by that many (an octave) until it is in
//                   { type: "key", table: { "36": 0, "37": 1 } }     id by note number
//                   { type: "key", id: n }                           one key for the whole `from`
//   to (cc):        { type: "analog", channel: n, max?: 1023 }       0..127 scaled to 0..max
//                   { type: "encoder", id: n, mode }                 mode: "absolute" (turns by the
//                        change since the last value), "binary-offset" (64 = still, +/- from it),
//                        "twos" (1..63 up, 127..65 down), "signed" (bit 6 is the sign)
//                   { type: "key", id: n }                           down at >= 64
//   to (pitchbend): { type: "analog", channel: n, max?: 1023 }
//   to (any of the above but "any"):
//                   { type: "action", name }                         on a press (a note on, a cc at
//                        >= 64, a raw message)
//                   { type: "action", mode, up, down }               an encoder (modes as above): one
//                        action per click, `up` clockwise, `down` the other way
//                   { type: "action", mode, name }                   a knob (modes as above): one
//                        action, `delta` clicks (and `value` where the mode is "absolute")
//   to (any):       { type: "midi" }                                 the bytes, as they came

const clampId = (id, range, fold) => {
  if (!range) return id;
  if (fold > 0 && range[1] - range[0] >= fold - 1) { while (id < range[0]) id += fold; while (id > range[1]) id -= fold; }
  return id < range[0] || id > range[1] ? null : id;
};

function parse(bytes) {
  const status = bytes[0];
  if (status === 0xf0) return { type: "raw", channel: 0, number: 0, bytes };
  if (status < 0x80 || status >= 0xf0) return null; // data without a status, real-time messages
  const kind = status & 0xf0, channel = (status & 0x0f) + 1, a = bytes[1] ?? 0, b = bytes[2] ?? 0;
  switch (kind) {
    case 0x90: return b === 0 ? { type: "note", channel, number: a, down: false, velocity: 0 } : { type: "note", channel, number: a, down: true, velocity: b };
    case 0x80: return { type: "note", channel, number: a, down: false, velocity: b };
    case 0xb0: return { type: "cc", channel, number: a, value: b };
    case 0xe0: return { type: "pitchbend", channel, number: 0, value: ((b << 7) | a) / 16383 * 127 };
    default: return null;
  }
}

function matches(from, m) {
  if (from.type !== "any" && from.type !== m.type) return false;
  if (from.type === "raw") return Array.isArray(from.bytes) && from.bytes.length === m.bytes.length && from.bytes.every((b, i) => b === m.bytes[i]);
  if (from.channel && from.channel !== m.channel) return false;
  if (from.number !== undefined && from.number !== m.number) return false;
  if (from.range && (m.number < from.range[0] || m.number > from.range[1])) return false;
  return true;
}

const scale = (value127, max = 1023) => Math.round(Math.min(127, Math.max(0, value127)) / 127 * max);

/// A function from a message's bytes to the panel inputs it stands for ([] for none).
/// `rules` is a list, or a function that gives the list (asked at every message, so it can change).
export function createMapper(rules = []) {
  const last = new Map(); // rule -> the last value of an absolute encoder
  return function map(bytes) {
    const m = parse(bytes);
    for (const rule of typeof rules === "function" ? rules() : rules) {
      const to = rule.to;
      if (to.type === "midi" && rule.from.type === "any") return [{ type: "midi", bytes: [...bytes] }];
      if (!m || !matches(rule.from, m)) continue;
      return convert(rule, to, m, last);
    }
    return [];
  };
}

function clicksOf(mode, value, rule, last) {
  switch (mode ?? "absolute") {
    case "absolute": { const was = last.get(rule); last.set(rule, value); return was === undefined ? 0 : value - was; }
    case "binary-offset": return value - 64;
    case "twos": return value < 64 ? value : value - 128;
    case "signed": return value & 0x40 ? -(value & 0x3f) : value & 0x3f;
    default: return 0;
  }
}

function convert(rule, to, m, last) {
  if (to.type === "action") {
    if (to.mode) {
      if (m.type !== "cc") return [];
      const clicks = clicksOf(to.mode, m.value, rule, last);
      if (to.name) { // a knob: one action, however far it went
        const absolute = to.mode === "absolute";
        if (!clicks && !absolute) return [];
        return [{ type: "action", name: to.name, delta: clicks, ...(absolute ? { value: m.value } : {}) }];
      }
      const name = clicks > 0 ? to.up : to.down;
      return name ? Array.from({ length: Math.min(8, Math.abs(clicks)) }, () => ({ type: "action", name })) : [];
    }
    const pressed = m.type === "note" ? m.down : m.type === "cc" ? m.value >= 64 : m.type === "raw";
    return pressed && to.name ? [{ type: "action", name: to.name }] : [];
  }
  if (m.type === "raw") return [];
  if (m.type === "note") {
    let id = to.id;
    if (to.table) id = to.table[m.number];
    else if (to.offset !== undefined) id = clampId(m.number + to.offset, to.idRange, to.fold);
    if (id === undefined || id === null) return [];
    return [{ type: "key", id, down: m.down, velocity: m.down ? m.velocity : null }];
  }
  if (to.type === "analog") return [{ type: "analog", channel: to.channel, value: scale(m.value, to.max) }];
  if (to.type === "key") return [{ type: "key", id: to.id, down: m.value >= 64, velocity: null }];
  if (to.type === "encoder") {
    const clicks = clicksOf(to.mode, m.value, rule, last);
    return clicks ? [{ type: "encoder", id: to.id, clicks }] : [];
  }
  return [];
}
