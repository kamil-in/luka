// A controller described by data instead of code: which ports are it, and the rules that turn what
// it sends into panel inputs (see mapping.js). This is how a user adds a controller of their own,
// and the shape such a description is stored in:
//
//   {
//     "id": "my-keystation",
//     "name": "My Keystation",
//     "match": { "input": "Keystation", "output": "Keystation" },   // text or /regex/ source, case-insensitive
//     "rules": [ { "from": { "type": "note" }, "to": { "type": "key", "offset": -39, "idRange": [14, 40] } } ]
//   }
//
// It only listens (and sends nothing): a controller with a screen or lights needs a profile in code.

import { createMapper } from "../mapping.js";

const matcher = (text) => {
  if (!text) return null;
  let re;
  try { re = new RegExp(text, "i"); } catch { re = new RegExp(String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
  return (name) => re.test(name);
};

/// What a description must hold; the problems found (none: fine).
export function validate(spec) {
  const problems = [];
  if (!spec || typeof spec !== "object") return ["not an object"];
  if (!spec.id || typeof spec.id !== "string") problems.push("id: a name for it, in text");
  if (!spec.match?.input) problems.push("match.input: part of the port's name");
  if (!Array.isArray(spec.rules) || !spec.rules.length) problems.push("rules: at least one");
  else spec.rules.forEach((r, i) => {
    if (!["note", "cc", "pitchbend", "raw", "any"].includes(r?.from?.type)) problems.push(`rules[${i}].from.type: note, cc, pitchbend, raw or any`);
    if (!["key", "analog", "encoder", "midi", "action"].includes(r?.to?.type)) problems.push(`rules[${i}].to.type: key, analog, encoder, midi or action`);
  });
  return problems;
}

export function genericProfile(spec) {
  const problems = validate(spec);
  if (problems.length) throw new Error(`controller "${spec?.id ?? "?"}": ${problems.join("; ")}`);
  const input = matcher(spec.match.input), output = matcher(spec.match.output);
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    match: { input, ...(output ? { output } : {}) },
    sysex: false,
    connect(io) {
      const map = createMapper(spec.rules);
      return { onMessage: (bytes) => { for (const event of map(bytes)) io.emit(event); } };
    },
  };
}
