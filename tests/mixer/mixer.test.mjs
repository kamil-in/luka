// The mixer's state and knobs (ui/mixer.js). Run: node --test tests/mixer/mixer.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { LABELS, defaults, valueOf, withValue, turned, fromPosition, positionOf, angleOf, command, text, sane, createPickup } from "../../ui/mixer.js";

test("the knobs: the four volumes on top, master leftmost below, then filter, delay, reverb", () => {
  assert.deepEqual(LABELS, ["vol 1", "vol 2", "vol 3", "vol 4", "master", "filter", "delay", "reverb"]);
  const s = defaults();
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => valueOf(s, i)), [1, 1, 1, 1, 1, 0, 0, 0]); // as it sounded before
});

test("each knob tells the transport what it sets", () => {
  const s = withValue(withValue(defaults(), 2, 0.5), 6, 0.25);
  assert.deepEqual(command(s, 2), { type: "mix", slot: 2, volume: 0.5 });
  assert.deepEqual(command(s, 4), { type: "fx", master: 1 });
  assert.deepEqual(command(s, 6), { type: "fx", delay: 0.25 });
});

test("values stay in range; the filter goes -1..1", () => {
  let s = withValue(defaults(), 0, 3);
  assert.equal(valueOf(s, 0), 1);
  s = withValue(s, 0, -1);
  assert.equal(valueOf(s, 0), 0);
  s = withValue(s, 5, -2);
  assert.equal(valueOf(s, 5), -1);
  s = withValue(s, 7, Number.NaN);
  assert.equal(valueOf(s, 7), 0);
});

test("clicks turn a knob; 40 clicks end to end", () => {
  let s = withValue(defaults(), 1, 0);
  for (let k = 0; k < 20; k++) s = turned(s, 1, 1);
  assert.equal(valueOf(s, 1), 0.5);
  s = turned(s, 1, 100);
  assert.equal(valueOf(s, 1), 1);
  s = turned(s, 1, -100);
  assert.equal(valueOf(s, 1), 0);
});

test("the filter stops at off on its way from one side to the other", () => {
  let s = withValue(defaults(), 5, 0.04);
  s = turned(s, 5, -3);                 // would pass zero: stops there
  assert.equal(valueOf(s, 5), 0);
  s = turned(s, 5, -3);                 // from zero it goes on
  assert.ok(valueOf(s, 5) < 0);
  assert.equal(text(s, 5), "lp 15");
  assert.equal(text(withValue(s, 5, 0.5), 5), "hp 50");
  assert.equal(text(withValue(s, 5, 0), 5), "off");
});

test("positions and angles: the filter's middle is off and points up", () => {
  assert.equal(fromPosition(5, 0.5), 0);
  assert.equal(fromPosition(0, 0.25), 0.25);
  const s = defaults();
  assert.equal(angleOf(s, 5), 0);
  assert.equal(angleOf(s, 0), 135);
  assert.equal(positionOf(withValue(s, 5, -1), 5), 0);
});

test("a stored state is read back safely", () => {
  assert.deepEqual(sane(null), defaults());
  assert.deepEqual(sane({ volumes: [0.5, "x"], fx: { reverb: 0.3, filter: 7 } }), { volumes: [0.5, 1, 1, 1], fx: { master: 1, filter: 1, delay: 0, reverb: 0.3 } });
});

test("pickup: a knob that says where it stands takes over only once it reaches the value", () => {
  const p = createPickup();
  assert.equal(p.take("mix:0", 0.2, 0.8), null);   // far below: held back
  assert.equal(p.take("mix:0", 0.5, 0.8), null);   // still below
  assert.equal(p.take("mix:0", 0.85, 0.8), 0.85);  // passed it: follows
  assert.equal(p.take("mix:0", 0.3, 0.8), 0.3);    // and keeps following
  p.release("mix:0");                               // moved some other way
  assert.equal(p.take("mix:0", 0.31, 0.8), null);
  assert.equal(p.take("mix:0", 0.79, 0.8), 0.79);  // near enough
});

test("pickup: from above too, and release of all at once", () => {
  const p = createPickup();
  assert.equal(p.take("a", 0.9, 0.4), null);
  assert.equal(p.take("a", 0.39, 0.4), 0.39);
  assert.equal(p.take("b", 0.4, 0.4), 0.4);         // already there
  p.release();
  assert.equal(p.take("a", 0.1, 0.9), null);
  assert.equal(p.take("b", 0.1, 0.9), null);
});
