// node --test tests/midi
import test from "node:test";
import assert from "node:assert/strict";
import { ruleFromKnob, ruleFromButton, describeMessage } from "../../ui/midi/index.js";
import { MidiManager, createMapper, learnedProfile, genericProfile, userProfiles, validateController } from "../../ui/midi/index.js";


// ---------------------------------------------------------------- the mapping

test("notes become keys by an offset, inside a range", () => {
  const map = createMapper([{ from: { type: "note" }, to: { type: "key", offset: -39, idRange: [14, 40] } }]);
  assert.deepEqual(map([0x90, 53, 100]), [{ type: "key", id: 14, down: true, velocity: 100 }]);
  assert.deepEqual(map([0x80, 53, 0]), [{ type: "key", id: 14, down: false, velocity: null }]);
  assert.deepEqual(map([0x90, 53, 0]), [{ type: "key", id: 14, down: false, velocity: null }]); // note on, velocity 0 = off
  assert.deepEqual(map([0x90, 30, 100]), []); // below the panel
});

test("a table, a channel filter, and first rule wins", () => {
  const map = createMapper([
    { from: { type: "note", channel: 10, range: [36, 37] }, to: { type: "key", table: { 36: 0, 37: 1 } } },
    { from: { type: "note" }, to: { type: "key", offset: 0 } },
  ]);
  assert.equal(map([0x99, 37, 90])[0].id, 1);   // channel 10
  assert.equal(map([0x90, 37, 90])[0].id, 37);  // channel 1: the second rule
});

test("cc to analog, scaled", () => {
  const map = createMapper([{ from: { type: "cc", number: 70 }, to: { type: "analog", channel: 4 } }]);
  assert.deepEqual(map([0xb0, 70, 127]), [{ type: "analog", channel: 4, value: 1023 }]);
  assert.deepEqual(map([0xb0, 70, 0]), [{ type: "analog", channel: 4, value: 0 }]);
  assert.deepEqual(map([0xb0, 71, 5]), []);
});

test("encoder modes", () => {
  const rule = (mode) => createMapper([{ from: { type: "cc", number: 1 }, to: { type: "encoder", id: 2, mode } }]);
  const abs = rule("absolute");
  assert.deepEqual(abs([0xb0, 1, 10]), []);                       // first value: no change known
  assert.deepEqual(abs([0xb0, 1, 13]), [{ type: "encoder", id: 2, clicks: 3 }]);
  assert.deepEqual(abs([0xb0, 1, 12]), [{ type: "encoder", id: 2, clicks: -1 }]);
  assert.deepEqual(rule("binary-offset")([0xb0, 1, 66]), [{ type: "encoder", id: 2, clicks: 2 }]);
  assert.deepEqual(rule("binary-offset")([0xb0, 1, 64]), []);
  assert.deepEqual(rule("twos")([0xb0, 1, 127]), [{ type: "encoder", id: 2, clicks: -1 }]);
  assert.deepEqual(rule("signed")([0xb0, 1, 0x41]), [{ type: "encoder", id: 2, clicks: -1 }]);
});

test("cc as a button, and bytes passed through", () => {
  const map = createMapper([{ from: { type: "cc", number: 64 }, to: { type: "key", id: 9 } }, { from: { type: "any" }, to: { type: "midi" } }]);
  assert.deepEqual(map([0xb0, 64, 127]), [{ type: "key", id: 9, down: true, velocity: null }]);
  assert.deepEqual(map([0xe0, 0, 64]), [{ type: "midi", bytes: [0xe0, 0, 64] }]);
});

// ---------------------------------------------------------------- the manager, with a fake browser

function fakeAccess(ports) {
  const mk = (list) => new Map(list.map(([id, name]) => [id, { id, name, state: "connected", onmidimessage: null }]));
  const sent = [];
  const outputs = new Map();
  for (const [id, name] of ports.outputs ?? []) outputs.set(id, { id, name, state: "connected", send: (b) => sent.push([...b]) });
  const access = { inputs: mk(ports.inputs ?? []), outputs, onstatechange: null, sent, lastRequest: null };
  return access;
}
const play = (port, bytes) => port.onmidimessage({ data: Uint8Array.from(bytes) });

test("an unknown device is left alone; a generic one connects and maps", async () => {
  const access = fakeAccess({ inputs: [["i1", "Some Keyboard"], ["i2", "Other Thing"]] });
  const inputs = [], status = [];
  const manager = new MidiManager({ requestAccess: async (o) => { access.lastRequest = o; return access; }, onInput: (e, id) => inputs.push([id, e]), onStatus: (s) => status.push(s.type) });
  manager.register(genericProfile({ id: "kb", match: { input: "keyboard" }, rules: [{ from: { type: "note" }, to: { type: "key", offset: -39 } }] }));
  assert.equal(await manager.start(), true);
  assert.deepEqual(access.lastRequest, { sysex: false });
  assert.deepEqual(manager.profiles(), [{ id: "kb", name: "kb", connected: true }]);
  play(access.inputs.get("i1"), [0x90, 60, 80]);
  assert.deepEqual(inputs, [["kb", { type: "key", id: 21, down: true, velocity: 80 }]]);
  assert.equal(access.inputs.get("i2").onmidimessage, null);
  assert.ok(status.includes("connected"));
});

test("a device that arrives later is connected, and one that leaves is let go", async () => {
  const access = fakeAccess({});
  const status = [];
  const manager = new MidiManager({ requestAccess: async () => access, onStatus: (s) => status.push(s.type) });
  manager.register(genericProfile({ id: "kb", match: { input: "pad" }, rules: [{ from: { type: "any" }, to: { type: "midi" } }] }));
  await manager.start();
  assert.deepEqual(manager.profiles()[0].connected, false);
  access.inputs.set("i9", { id: "i9", name: "My PAD", state: "connected", onmidimessage: null });
  access.onstatechange();
  await new Promise((r) => setImmediate(r));
  assert.equal(manager.profiles()[0].connected, true);
  access.inputs.get("i9").state = "disconnected";
  access.onstatechange();
  assert.equal(manager.profiles()[0].connected, false);
  assert.ok(status.includes("disconnected"));
});

test("no MIDI, or MIDI refused: start says false", async () => {
  const status = [];
  const m1 = new MidiManager({ requestAccess: async () => { throw new Error("no"); }, onStatus: (s) => status.push(s.type) });
  assert.equal(await m1.start(), false);
  assert.ok(status.includes("unavailable"));
});

// ---------------------------------------------------------------- user-made controllers

test("user controllers: validated, stored, and turned into profiles", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const users = userProfiles(storage);
  assert.throws(() => users.save({ id: "x" }), /match\.input/);
  users.save({ id: "mine", name: "Mine", match: { input: "Mine" }, rules: [{ from: { type: "cc", number: 7 }, to: { type: "analog", channel: 4 } }] });
  users.save({ id: "mine", name: "Mine v2", match: { input: "Mine" }, rules: [{ from: { type: "cc", number: 7 }, to: { type: "analog", channel: 4 } }] }); // replaces
  assert.equal(users.list().length, 1);
  assert.equal(users.profiles()[0].name, "Mine v2");
  users.remove("mine");
  assert.deepEqual(users.profiles(), []);
  assert.deepEqual(validateController({ id: "a", match: { input: "a" }, rules: [{ from: { type: "zzz" }, to: { type: "key" } }] }).length, 1);
});

// ---------------------------------------------------------------- actions, raw messages, learning

test("actions: a button press, an encoder's clicks, a raw message", () => {
  const map = createMapper([
    { from: { type: "note", number: 12 }, to: { type: "action", name: "nav-right" } },
    { from: { type: "cc", number: 30 }, to: { type: "action", mode: "twos", up: "nav-right", down: "nav-left" } },
    { from: { type: "raw", bytes: [0xf0, 0x7d, 0x01, 0x02, 0xf7] }, to: { type: "action", name: "nav-left" } },
  ]);
  assert.deepEqual(map([0x90, 12, 100]), [{ type: "action", name: "nav-right" }]);
  assert.deepEqual(map([0x80, 12, 0]), []);          // the release is nothing
  assert.deepEqual(map([0xb0, 30, 2]), [{ type: "action", name: "nav-right" }, { type: "action", name: "nav-right" }]);
  assert.deepEqual(map([0xb0, 30, 127]), [{ type: "action", name: "nav-left" }]);
  assert.deepEqual(map([0xf0, 0x7d, 0x01, 0x02, 0xf7]), [{ type: "action", name: "nav-left" }]);
  assert.deepEqual(map([0xf0, 0x7d, 0x01, 0x03, 0xf7]), []);
});

test("rules can be a function, read at each message", () => {
  let rules = [];
  const map = createMapper(() => rules);
  assert.deepEqual(map([0x90, 1, 1]), []);
  rules = [{ from: { type: "note" }, to: { type: "action", name: "x" } }];
  assert.deepEqual(map([0x90, 1, 1]), [{ type: "action", name: "x" }]);
});

test("learn: a knob's way of counting is worked out from what it sent", () => {
  const name = "knob-1";
  assert.equal(ruleFromKnob([[0xb0, 30, 65], [0xb0, 30, 66], [0xb0, 30, 65]], { name }).to.mode, "binary-offset");
  assert.equal(ruleFromKnob([[0xb0, 30, 1], [0xb0, 30, 127], [0xb0, 30, 2]], { name }).to.mode, "twos");
  assert.equal(ruleFromKnob([[0xb0, 30, 0], [0xb0, 30, 40], [0xb0, 30, 127]], { name }).to.mode, "absolute"); // a position, swept
  assert.equal(ruleFromKnob([[0xb0, 30, 20], [0xb0, 30, 90]], { name }).to.mode, "absolute");
  assert.deepEqual(ruleFromKnob([[0xb2, 9, 1]], { name }).from, { type: "cc", channel: 3, number: 9 });
  assert.equal(ruleFromKnob([[0xb2, 9, 1]], { name }).to.name, "knob-1");
  assert.equal(ruleFromKnob([[0x90, 60, 100], [0xf8]], { name }), null); // a note is no knob; the clock is nothing
});

test("a knob action carries how far it turned, and where an absolute one stands", () => {
  const rel = createMapper([{ from: { type: "cc", number: 5 }, to: { type: "action", mode: "twos", name: "knob-2" } }]);
  assert.deepEqual(rel([0xb0, 5, 3]), [{ type: "action", name: "knob-2", delta: 3 }]);
  assert.deepEqual(rel([0xb0, 5, 126]), [{ type: "action", name: "knob-2", delta: -2 }]);
  const abs = createMapper([{ from: { type: "cc", number: 6 }, to: { type: "action", mode: "absolute", name: "knob-0" } }]);
  assert.deepEqual(abs([0xb0, 6, 50]), [{ type: "action", name: "knob-0", delta: 0, value: 50 }]); // first: where it stands
  assert.deepEqual(abs([0xb0, 6, 54]), [{ type: "action", name: "knob-0", delta: 4, value: 54 }]);
});

test("learn: a button, as a note, a controller or a system message", () => {
  assert.deepEqual(ruleFromButton([[0xf8], [0x90, 5, 90]], "nav-left"), { from: { type: "note", channel: 1, number: 5 }, to: { type: "action", name: "nav-left" } });
  assert.deepEqual(ruleFromButton([[0xb0, 20, 0], [0xb0, 20, 127]], "nav-right").from, { type: "cc", channel: 1, number: 20 });
  assert.deepEqual(ruleFromButton([[0xf0, 1, 2, 0xf7]], "nav-right").from, { type: "raw", bytes: [0xf0, 1, 2, 0xf7] });
  assert.equal(ruleFromButton([[0x80, 5, 0]], "nav-right"), null);
  assert.match(describeMessage([0xb0, 30, 2]), /^cc 30 = 2/);
});

test("the traffic tap sees every message, from every port", async () => {
  const access = fakeAccess({ inputs: [["a", "Pad One"]] });
  const seen = [];
  const manager = new MidiManager({ requestAccess: async () => access, onTraffic: (t) => seen.push(t) });
  manager.register(genericProfile({ id: "p", match: { input: "pad" }, rules: [{ from: { type: "any" }, to: { type: "midi" } }] }));
  await manager.start();
  play(access.inputs.get("a"), [0xb0, 1, 2]);
  assert.deepEqual(seen, [{ profile: "p", port: "Pad One", bytes: [0xb0, 1, 2] }]);
});

// ---------------------------------------------------------------- any controller, learned

test("a learned profile listens to every input, also ones plugged in later, and lets go of ones that leave", async () => {
  const access = fakeAccess({ inputs: [["a", "Some Controller"]] });
  const events = [], seen = [];
  const manager = new MidiManager({ requestAccess: async () => access, onInput: (e) => events.push(e), onTraffic: (t) => seen.push(t.port) });
  manager.register(learnedProfile({ rules: () => [{ from: { type: "cc", number: 1 }, to: { type: "action", mode: "twos", name: "knob-3" } }] }));
  await manager.start();
  await new Promise((r) => setImmediate(r));
  play(access.inputs.get("a"), [0xb0, 1, 2]);
  assert.deepEqual(events.splice(0), [{ type: "action", name: "knob-3", delta: 2 }]);
  // another input appears
  access.inputs.set("b", { id: "b", name: "Another Port", state: "connected", onmidimessage: null });
  access.onstatechange();
  play(access.inputs.get("b"), [0xb0, 1, 127]);
  assert.deepEqual(events.splice(0), [{ type: "action", name: "knob-3", delta: -1 }]);
  assert.deepEqual(seen, ["Some Controller", "Another Port"]);
  // it leaves
  access.inputs.get("b").state = "disconnected";
  access.onstatechange();
  assert.equal(access.inputs.get("b").onmidimessage, null);
  assert.equal(manager.profiles()[0].connected, true); // the first one is still there
});

test("learned buttons: a press does the action, a release nothing", async () => {
  const access = fakeAccess({ inputs: [["a", "Pads"]] });
  const events = [];
  const rules = [
    ruleFromButton([[0x99, 36, 100]], "nav-left"),
    ruleFromButton([[0x99, 37, 100]], "nav-right"),
    ruleFromButton([[0xb0, 20, 127]], "play"),
  ];
  const manager = new MidiManager({ requestAccess: async () => access, onInput: (e) => events.push(e) });
  manager.register(learnedProfile({ rules }));
  await manager.start();
  const port = access.inputs.get("a");
  play(port, [0x99, 36, 90]); play(port, [0x89, 36, 0]); play(port, [0x99, 37, 90]); play(port, [0xb0, 20, 127]); play(port, [0xb0, 20, 0]);
  assert.deepEqual(events.map((e) => e.name), ["nav-left", "nav-right", "play"]);
});

test("a note rule to `note` gives the note itself, any octave, for the firmware's MIDI IN", () => {
  const map = createMapper([{ from: { type: "note" }, to: { type: "note" } }]);
  assert.deepEqual(map([0x90, 48, 90]), [{ type: "note", note: 48, channel: 1, down: true, velocity: 90 }]);  // C3: not folded
  assert.deepEqual(map([0x93, 96, 20]), [{ type: "note", note: 96, channel: 4, down: true, velocity: 20 }]);  // C7, channel 4
  assert.deepEqual(map([0x80, 48, 64]), [{ type: "note", note: 48, channel: 1, down: false, velocity: 0 }]);
  assert.deepEqual(map([0x90, 48, 0]), [{ type: "note", note: 48, channel: 1, down: false, velocity: 0 }]);   // note on at 0 = off
  // (C3 and C4 stay an octave apart: the order of a tune is kept)
  assert.equal(map([0x90, 60, 90])[0].note - map([0x90, 48, 90])[0].note, 12);
});

test("notes outside the panel's keys are moved by octaves until they are on them", () => {
  const map = createMapper([{ from: { type: "note" }, to: { type: "key", offset: -39, idRange: [14, 40], fold: 12 } }]);
  const id = (n) => map([0x90, n, 90])[0].id;
  assert.equal(id(53), 14);   // F3, the lowest
  assert.equal(id(79), 40);   // G5, the highest
  assert.equal(id(60), 21);   // in range: pitch as it is
  assert.equal(id(36), 21);   // C2: up two octaves, still a C
  assert.equal(id(48), 21);   // C3: up an octave
  assert.equal(id(108), 33);  // C8: down, still a C
  assert.equal(map([0x80, 36, 0])[0].down, false);
  // without fold it is still dropped
  const strict = createMapper([{ from: { type: "note" }, to: { type: "key", offset: -39, idRange: [14, 40] } }]);
  assert.deepEqual(strict([0x90, 36, 90]), []);
});
