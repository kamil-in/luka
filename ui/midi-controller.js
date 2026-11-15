// The page's side of MIDI: a button in the bar that finds MIDI inputs by itself (when the page
// opens, and whenever one is plugged in), and a list of controls to LEARN: click `learn` beside
// one, then work that control on your controller; what it sent is kept (in this browser) and from
// then on that control does it. Works with any controller: nothing here knows a make.
//
// The module in midi/ knows nothing of the page; this file is the join, and it gets what it needs
// from the page as `host`:
//
//   host.labels                 names of the knobs, in order (how many there are is how many are learned)
//   host.notes                  { offset, range: [lo, hi] }: which panel key a MIDI note is (id = note + offset);
//                               notes outside the keys are moved by octaves until they are on them
//   host.key({ id, down, velocity })
//                               a note played: the panel key goes down or up
//   host.act(name)              "nav-left", "nav-right", "play" or "firm": the page does it
//   host.list({ delta, value }) the list-navigation knob turned (delta clicks, + clockwise)
//   host.knob(i, { delta, value })
//                               knob i turned by `delta` clicks; `value` (0..127) too if the controller's
//                               knob is a position rather than an endless one
//   host.status(text, bad)
//
// The controls, in the order they are learned: navigation left and right, the knobs, play, firm
// (the button for the firmware list) and the knob that moves along that list.

import { MidiManager, learnedProfile, ruleFromKnob, ruleFromButton, describeMessage, isNoise } from "./midi/index.js";

const STORE = "luka.midi.learned";

const load = () => { try { const v = JSON.parse(localStorage.getItem(STORE) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* until the page closes, then */ } };

/// A rule in a few words.
function ruleText(rule) {
  if (!rule) return "not set";
  const f = rule.from;
  const what = f.type === "raw" ? "system message" : f.type === "note" ? `note ${f.number}` : `control ${f.number}`;
  return rule.to.mode ? `${what} (${rule.to.mode})` : what;
}

const sameControl = (a, b) => JSON.stringify(a.from) === JSON.stringify(b.from);

export function connectMidi({ button, host }) {
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

  // what can be learned: { key, label, hint, action | knob }
  const CONTROLS = [
    { key: "nav-left", label: "navigation left", hint: "press it", action: "nav-left", kind: "button" },
    { key: "nav-right", label: "navigation right", hint: "press it", action: "nav-right", kind: "button" },
    ...host.labels.map((label, i) => ({ key: `knob-${i}`, label, hint: "turn it clockwise, a good way", kind: "knob" })),
    { key: "play", label: "play", hint: "press it", action: "play", kind: "button" },
    { key: "firm", label: "Firm", hint: "press it", action: "firm", kind: "button" },
    { key: "list", label: "list knob", hint: "turn it clockwise, a good way", kind: "knob" },
  ];
  const known = new Set(CONTROLS.map((c) => c.key));

  let assigned = Object.fromEntries(Object.entries(load()).filter(([k]) => known.has(k)));
  let state = "off";        // off | wait (MIDI is on, no input) | on
  let last = null;          // the last thing a controller said
  let learning = null;      // { control, messages, timer, chain }
  let refining = null;      // a knob just learned, still being turned: { control, messages, timer }
  let started = false;

  // ------------------------------------------------------------------ the manager

  const manager = new MidiManager({
    onInput: (event) => {
      if (event.type === "key") return host.key(event);
      if (event.type !== "action") return;
      if (event.name.startsWith("knob-")) host.knob(Number(event.name.slice(5)), event);
      else if (event.name === "list") host.list(event);
      else host.act(event.name);
    },
    onStatus: (s) => {
      if (s.type === "connected") { state = "on"; host.status(`MIDI: ${s.input} connected`); }
      else if (s.type === "disconnected") { state = "wait"; host.status("MIDI: the controller was unplugged"); }
      else if (s.type === "error" || s.type === "warning") host.status(`MIDI: ${s.message}`, true);
      paint();
    },
    onTraffic: ({ bytes }) => {
      if (isNoise(bytes)) return;
      last = bytes;
      if (refining && isSameKnob(bytes, assigned[refining.control.key])) refine(bytes); // (the knob just learned, still turning: not another control's signal)
      else if (learning) heard(bytes);
      paintPop();
    },
  });
  // what is learned comes first; every other note plays the panel's keys
  const noteRule = { from: { type: "note" }, to: { type: "key", offset: host.notes.offset, idRange: host.notes.range, fold: 12 } };
  manager.register(learnedProfile({ rules: () => [...Object.values(assigned), noteRule] }));

  async function start() {
    if (!globalThis.navigator?.requestMIDIAccess) { state = "off"; paint("this browser has no MIDI"); return false; }
    started = true;
    const ok = await manager.start();
    if (!ok) { state = "off"; started = false; paint("MIDI was refused or is unavailable: allow it for this site, then click here"); return false; }
    if (state === "off") state = manager.profiles().some((p) => p.connected) ? "on" : "wait";
    paint();
    return true;
  }

  // ------------------------------------------------------------------ learning

  const ruleOf = (control, messages) => control.kind === "knob" ? ruleFromKnob(messages, { name: control.key }) : ruleFromButton(messages, control.action);
  const isSameKnob = (bytes, rule) => !!rule && rule.from.type === "cc" && (bytes[0] & 0xf0) === 0xb0 && (bytes[0] & 0x0f) + 1 === rule.from.channel && bytes[1] === rule.from.number;

  /// A control is learned the moment it is heard. (A knob's way of counting is guessed from what
  /// it has sent so far, and made surer by what it sends while it goes on turning: see `refine`.)
  function heard(bytes) {
    learning.messages.push(bytes);
    if (ruleOf(learning.control, learning.messages)) finish();
  }

  /// A knob learned from a message or two, still turning: what it sends now sharpens how it counts.
  /// It is over when the knob rests.
  function refine(bytes) {
    const { control } = refining;
    refining.messages.push(bytes);
    clearTimeout(refining.timer);
    refining.timer = setTimeout(() => {
      const text = ruleText(assigned[control.key]);
      refining = null;
      host.status(`MIDI: ${control.label} is now ${text}`);
      paintPop();
    }, 700);
    const rule = ruleFromKnob(refining.messages, { name: control.key });
    if (rule && JSON.stringify(rule) !== JSON.stringify(assigned[control.key])) { assigned = { ...assigned, [control.key]: rule }; save(assigned); }
  }

  function finish() {
    const { control, messages, chain } = learning;
    clearTimeout(learning.timer);
    learning = null;
    const rule = ruleOf(control, messages);
    if (rule) {
      // a control does one thing: whatever else it did is let go
      assigned = Object.fromEntries(Object.entries(assigned).filter(([, r]) => !sameControl(r, rule)));
      assigned[control.key] = rule;
      save(assigned);
      host.status(`MIDI: ${control.label} is now ${ruleText(rule)}`);
      if (refining) clearTimeout(refining.timer);
      refining = control.kind === "knob" ? { control, messages: [...messages], timer: setTimeout(() => { refining = null; paintPop(); }, 700) } : null;
    }
    const next = chain && CONTROLS[CONTROLS.indexOf(control) + 1];
    if (next) learn(next, true); else paintPop();
  }

  function cancel() { if (learning) { clearTimeout(learning.timer); learning = null; } }

  function learn(control, chain = false) {
    cancel();
    const timer = setTimeout(() => { learning = null; host.status(`MIDI: nothing heard for ${control.label}`, true); paintPop(); }, 15000);
    learning = { control, messages: [], timer, chain };
    paintPop();
  }

  // ------------------------------------------------------------------ the button and what opens from it

  const pop = el("div", { id: "midi-pop", hidden: true });
  document.body.append(pop);
  const rows = CONTROLS.map((control) => {
    const text = el("span", { className: "what" });
    const btn = el("button", { type: "button", className: "text", onclick: () => { if (learning?.control === control) { cancel(); paintPop(); } else learn(control); } });
    return { control, text, btn, row: el("div", { className: "row" }, el("span", { className: "label", textContent: control.label }), text, btn) };
  });
  const stateLine = el("p", { className: "state" });
  const lastLine = el("p", { className: "last" });
  const all = el("button", { type: "button", className: "text", textContent: "learn all", onclick: () => learn(CONTROLS[0], true) });
  const reset = el("button", { type: "button", className: "text", textContent: "reset", onclick: () => { cancel(); if (refining) clearTimeout(refining.timer); refining = null; assigned = {}; save(assigned); paintPop(); } });
  pop.append(el("h3", { textContent: "midi" }), stateLine, el("div", { className: "foot" }, all, reset), el("div", { className: "controls" }, ...rows.map((r) => r.row)), lastLine);

  function paintPop() {
    if (pop.hidden) return;
    const inputs = manager.ports().inputs.filter((p) => p.state !== "disconnected");
    stateLine.textContent = state === "off" ? "MIDI is not on" : inputs.length ? `${inputs.length} input${inputs.length > 1 ? "s" : ""}: ${inputs.map((p) => p.name).join(", ")}` : "no MIDI input found: plug the controller in";
    for (const { control, text, btn } of rows) {
      const here = learning?.control === control;
      text.textContent = here ? control.hint + "…" : ruleText(assigned[control.key]);
      btn.textContent = here ? "cancel" : "learn";
    }
    lastLine.textContent = last ? `last: ${describeMessage(last)}` : "last: nothing yet";
  }

  function paint(title) {
    button.dataset.state = state;
    button.title = title ?? (state === "on" ? "a MIDI controller is connected: click to set up its controls" : state === "wait" ? "MIDI is on; no controller found yet" : "MIDI is off: click to turn it on");
    paintPop();
  }

  function open(on) {
    pop.hidden = !on;
    button.setAttribute("aria-expanded", String(on));
    paintPop();
  }

  button.addEventListener("click", async () => {
    if (state === "off") { if (!(await start())) return; }
    open(pop.hidden);
  });
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== button) open(false); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) open(false); });
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  paint();

  // by itself, as the page opens
  start();
  addEventListener("pagehide", () => manager.stop());
}
