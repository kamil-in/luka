// "Learn": turn what a control sent, while the user worked it, into a rule (mapping.js). For the
// controls whose messages are not known beforehand. Pure functions; the page decides when to
// listen and for how long.

/// Messages that say nothing about a control (the device's clock, its "still here": real-time messages).
export const isNoise = (bytes) => bytes.length === 0 || bytes[0] >= 0xf8;

const ch = (bytes) => (bytes[0] & 0x0f) + 1;

/// How a knob counts, from the values it sent while turned clockwise (a long way, if it has
/// stops): a position sweeps a wide range ("absolute"); an endless encoder sends small steps,
/// around 64 ("binary-offset") or just above zero ("twos"); anything else is taken as a position.
export function modeOf(values) {
  if (!values.length) return "absolute";
  if (values.every((v) => v >= 56 && v <= 72) && values.some((v) => v !== 64)) return "binary-offset";
  if (values.every((v) => v <= 24 || v >= 104)) { // small steps either way round zero
    const steps = values.map((v) => (v >= 104 ? v - 128 : v));
    if (Math.max(...steps) - Math.min(...steps) < 24) return "twos";
  }
  return "absolute";
}

/// A knob turned, as the messages it sent (the first and the others that followed): a rule for it,
/// or null if it was not a controller change. `{ name }`: the knob's action (see mapping.js);
/// or `{ up, down }`: one action per click.
export function ruleFromKnob(messages, { name, up, down }) {
  const cc = messages.filter((m) => !isNoise(m) && (m[0] & 0xf0) === 0xb0);
  if (!cc.length) return null;
  const first = cc[0];
  const mode = modeOf(cc.filter((m) => m[0] === first[0] && m[1] === first[1]).map((m) => m[2]));
  return { from: { type: "cc", channel: ch(first), number: first[1] }, to: name ? { type: "action", mode, name } : { type: "action", mode, up, down } };
}

/// A button pressed: a rule that makes its press the action `name`; or null. A note, a controller
/// change (a press is a value of 64 or more) or system-exclusive (matched exactly).
export function ruleFromButton(messages, name) {
  for (const m of messages) {
    if (isNoise(m)) continue;
    const kind = m[0] & 0xf0;
    if (kind === 0x90 && m[2] > 0) return { from: { type: "note", channel: ch(m), number: m[1] }, to: { type: "action", name } };
    if (kind === 0xb0 && m[2] >= 64) return { from: { type: "cc", channel: ch(m), number: m[1] }, to: { type: "action", name } };
    if (m[0] === 0xf0) return { from: { type: "raw", bytes: [...m] }, to: { type: "action", name } };
  }
  return null;
}

/// One line for people: what a message is.
export function describe(bytes) {
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ").toUpperCase();
  const kind = bytes[0] & 0xf0;
  const what = bytes[0] === 0xf0 ? "sysex" : kind === 0x90 ? `note ${bytes[1]} on` : kind === 0x80 ? `note ${bytes[1]} off` : kind === 0xb0 ? `cc ${bytes[1]} = ${bytes[2]}` : kind === 0xe0 ? "pitch bend" : "";
  return `${what ? what + "  " : ""}[${hex.length > 48 ? hex.slice(0, 48) + "…" : hex}]`;
}
