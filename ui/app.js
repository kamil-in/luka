// The page: a screen for each firmware playing (up to four), one front panel that plays the
// chosen screen's firmware, and the firmware list behind the menu button. Talks to a
// transport and nothing else: the desktop app's (transport-tauri.js) or a browser's
// (web/transport-web.js), whichever is here.

import * as web from "./web/transport-web.js";
import { connectMidi } from "./midi-controller.js";

const $ = (id) => document.getElementById(id);
const status = (text, bad = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("bad", bad);
};

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

let send = () => {};
let slots = [];   // a screen each: { n, el, ctx, image, pending, firmware, loading, muted, paused, levels, pot }
let selected = 0; // the screen the panel plays
let query = "";   // what the search box holds
let builds = [];

const cur = () => slots[selected];
/// A screen whose firmware takes what the panel does: one is loaded there, and it is playing.
const live = (s) => !!s && !!s.firmware && !s.paused;

// ------------------------------------------------------------------ light and dark

// The system's choice until the user makes one; then theirs, kept in this browser.
const root = document.documentElement;
const system = matchMedia("(prefers-color-scheme: dark)");
const theme = () => root.dataset.theme || (system.matches ? "dark" : "light");
function showTheme() { $("theme").textContent = theme() === "dark" ? "light" : "dark"; } // (what a press switches to)
$("theme").addEventListener("click", () => {
  const next = theme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("luka.theme", next); } catch { /* lasts until the page closes, then */ }
  showTheme();
});
system.addEventListener("change", showTheme);
showTheme();

// ------------------------------------------------------------------ the screens

function makeSlots(count) {
  slots = Array.from({ length: count }, (_, n) => {
    const canvas = el("canvas", { width: 240, height: 240 });
    const s = { n, canvas, ctx: canvas.getContext("2d"), pending: null, firmware: null, loading: null, muted: false, paused: false, levels: null, pot: 800 };
    s.image = s.ctx.createImageData(240, 240);
    s.name = el("span", { className: "name" });
    s.mute = el("button", { className: "text mute", type: "button", onclick: () => send({ type: "mute", slot: n, muted: !s.muted }) });
    // (stop holds the firmware where it is, still loaded; the list's unload takes it away.
    // A stopped firmware is left alone by the panel: see `live`)
    s.stop = el("button", { className: "text run", type: "button", onclick: () => { if (n === selected && !s.paused) releaseAll(); send({ type: "pause", slot: n, paused: !s.paused }); } });
    s.choose = el("button", { className: "choose", type: "button", textContent: "choose firmware", onclick: () => { select(n); menu(true); } });
    s.el = el("article", { className: "slot" },
      el("div", { className: "glass" }, canvas, s.choose),
      el("div", { className: "bar" }, el("span", { className: "num", textContent: String(n + 1) }), s.name),
      el("div", { className: "ctl" }, s.mute, s.stop));
    s.el.addEventListener("pointerdown", () => select(n));
    return s;
  });
  $("slots").replaceChildren(...slots.map((s) => s.el));
  slots.forEach(drawSlot);
  showSelected();
}

function drawSlot(s) {
  const busy = !!(s.firmware || s.loading);
  s.el.classList.toggle("empty", !busy);
  s.el.classList.toggle("muted", s.muted);
  s.el.classList.toggle("paused", !!s.firmware && s.paused);
  s.el.classList.toggle("selected", s.n === selected);
  s.name.textContent = s.firmware ? s.firmware.repo : s.loading ? "loading…" : "empty";
  s.name.hidden = !busy;
  s.choose.hidden = busy;
  s.mute.hidden = !s.firmware;
  s.mute.textContent = s.muted ? "unmute" : "mute";
  s.stop.hidden = !s.firmware;
  s.stop.textContent = s.paused ? "play" : "stop";
  if (s.n === selected) drawStage();
}

/// The big screen: the chosen slot's firmware, copied from its small screen.
const stageCtx = $("stage-canvas").getContext("2d");
function drawStage() {
  const s = cur();
  if (!s) return;
  stageCtx.clearRect(0, 0, 240, 240);
  if (s.firmware) stageCtx.drawImage(s.canvas, 0, 0);
  const stage = $("stage");
  stage.classList.toggle("empty", !s.firmware && !s.loading);
  stage.classList.toggle("paused", !!s.firmware && s.paused);
  $("stage-name").textContent = s.firmware ? s.firmware.repo : s.loading ? "loading…" : "";
}
$("stage-choose").addEventListener("click", () => menu(true));

function onFrame(rgba, slot = 0) {
  const s = slots[slot];
  if (!s || rgba.length !== s.image.data.length) return;
  // (several frames between two repaints: only the last is drawn)
  if (!s.pending) requestAnimationFrame(() => { if (!s.pending) return; s.image.data.set(s.pending); s.ctx.putImageData(s.image, 0, 0); s.pending = null; if (s.n === selected) drawStage(); });
  s.pending = rgba;
}

/// The panel plays another screen's firmware: what was held is let go first.
function select(n) {
  if (n === selected || !slots[n]) return;
  releaseAll();
  selected = n;
  slots.forEach(drawSlot);
  showSelected();
  drawBuilds();
}

/// The panel as the chosen screen's firmware has it: its lights, where its MASTER stands,
/// and whether it takes anything at all.
function showSelected() {
  const s = cur();
  if (!s) return;
  paintLeds();
  document.querySelector("[data-pot]").style.setProperty("--turn", `${-135 + 270 * s.pot / 1023}deg`);
  $("device").classList.toggle("locked", !live(s));
  $("playing-into").textContent = !s.firmware ? `screen ${s.n + 1} is empty.`
    : s.paused ? `${s.firmware.repo} is stopped: press its play.` : `playing ${s.firmware.repo}${s.muted ? " (muted)" : ""}.`;
}

// ------------------------------------------------------------------ events

const leds = new Map(); // key id -> element
function paintLeds() {
  const levels = cur()?.levels;
  // (a fully lit LED is on about 8 % of the time: the device scans them)
  // and many firmwares keep every LED faintly on: squared, so faint stays faint
  for (const [id, elm] of leds) elm.style.setProperty("--led", levels ? (Math.min(1, (levels[id] || 0) / 0.08) ** 2).toFixed(2) : 0);
}

function onEvent(e) {
  const slot = e.slot ?? 0, s = slots[slot];
  switch (e.type) {
    case "builds": builds = [...e.builds].sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base", numeric: true })); drawBuilds(); break; // a to z
    case "started":
      if (!s) break;
      Object.assign(s, { firmware: e.firmware, loading: null, muted: !!e.muted, paused: !!e.paused, levels: null });
      status(`Screen ${slot + 1}: ${e.firmware.repo} ${e.firmware.version} (${e.info.identity}) is loaded`
        + (e.save_restored ? ", with what it saved last time" : "") + (e.paused ? ". It plays by itself, so it waits for its play" : ""));
      send({ type: "input", slot, input: { type: "analog", channel: 4, value: s.pot } }); // the machine starts without knowing where the pot stands
      drawSlot(s);
      drawBuilds();
      if (slot === selected) showSelected();
      break;
    case "leds":
      if (!s) break;
      s.levels = e.levels;
      if (slot === selected) paintLeds();
      break;
    case "stopped":
      if (!s) break;
      if (slot === selected) releaseAll();
      Object.assign(s, { firmware: null, loading: null, muted: false, paused: false, levels: null, pending: null });
      s.ctx.clearRect(0, 0, 240, 240);
      status(e.reason ? `Screen ${slot + 1}: the firmware stopped after ${(e.at_ms / 1000).toFixed(1)} s: ${e.reason}` : `Screen ${slot + 1}: unloaded`, !!e.reason);
      drawSlot(s);
      drawBuilds();
      if (slot === selected) showSelected();
      break;
    case "paused":
      if (!s) break;
      s.paused = e.paused;
      drawSlot(s);
      if (slot === selected) showSelected();
      break;
    case "muted":
      if (!s) break;
      s.muted = e.muted;
      drawSlot(s);
      if (slot === selected) showSelected();
      break;
    case "error":
      if (e.slot !== undefined && s && s.loading) { s.loading = null; drawSlot(s); drawBuilds(); } // (it did not start)
      status(e.message, true);
      break;
    case "notice": status(e.message); break;
  }
}

// ------------------------------------------------------------------ the firmware list

function menu(open) {
  if (open !== document.body.classList.contains("menu")) { // (opening or closing: the cursor starts again)
    cursorOn = false;
    if (open) startCursor();
  }
  document.body.classList.toggle("menu", open);
  $("drawer").inert = !open;
  $("menu").setAttribute("aria-expanded", String(open));
  if (open) $("search").focus({ preventScroll: true }); // (it is still sliding in: the page must not scroll to meet it)
}
$("menu").addEventListener("click", () => menu(!document.body.classList.contains("menu")));
$("scrim").addEventListener("click", () => menu(false));
addEventListener("keydown", (e) => { if (e.key === "Escape") menu(false); });

// A link that opens a new tab in a browser opens the system's browser in the desktop window
// (a web view opens nothing of its own).
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[target=_blank]");
  if (!a || !globalThis.__TAURI__) return;
  e.preventDefault();
  globalThis.__TAURI__.core.invoke("open_link", { url: a.href }).catch((err) => status(String(err), true));
});

/// Where the next firmware goes: the chosen screen if it is empty, else the first empty one
/// (-1: all are taken).
function target() {
  const free = (s) => !s.firmware && !s.loading;
  return cur() && free(cur()) ? selected : slots.findIndex(free);
}

/// The firmwares' own browser builds on offer, the ones the search box's text is in.
let shownBuilds = []; // the rows the list shows now (the search box's matches)
let cursor = 0;        // the row a MIDI controller is on, among those
let cursorOn = false;  // shown only once a controller has used the list

/// A firmware's list button: unload it if it is on a screen, else load it where the next one goes.
/// False (and why, in the status line) when it could not be.
function toggleBuild(b) {
  const id = `build:${b.id}`, at = slots.findIndex((s) => (s.firmware ? s.firmware.id : s.loading) === id);
  if (at >= 0) { send({ type: "stop", slot: at }); return true; }
  if (!b.playable) { status(`${b.name} is not supported yet`, true); return false; }
  const to = target();
  if (to < 0) { status("All the screens are taken: unload one first.", true); return false; }
  const s = slots[to];
  s.loading = id;
  select(to);
  drawSlot(s);
  drawBuilds();
  // (one that plays by itself is loaded stopped: it is not sprung on what already plays)
  send({ type: "start_build", id: b.id, slot: to, paused: b.autostarts });
  return true;
}

/// Marks the cursor's row (and brings it into view when asked).
function markCursor(reveal = false) {
  const rows = [...$("builds").children];
  rows.forEach((li, i) => li.classList.toggle("cursor", cursorOn && i === cursor && !li.classList.contains("empty")));
  if (reveal && cursorOn) rows[cursor]?.scrollIntoView({ block: "nearest" });
}

/// On the chosen screen's firmware, else the first row.
function startCursor() {
  const id = cur()?.firmware?.id;
  const i = shownBuilds.findIndex((b) => `build:${b.id}` === id);
  cursor = i >= 0 ? i : 0;
}

function drawBuilds() {
  const words = query.toLowerCase().split(/s+/).filter(Boolean);
  const shown = shownBuilds = builds.filter((b) => words.every((w) => `${b.name} ${b.repo}`.toLowerCase().includes(w)));
  cursor = Math.max(0, Math.min(cursor, shown.length - 1));
  if (!shown.length) {
    $("builds").replaceChildren(el("li", { className: "empty", textContent: builds.length ? "no firmware matches." : "nothing here yet." }));
    return;
  }
  const to = target();
  $("builds").replaceChildren(...shown.map((b) => {
    const id = `build:${b.id}`, at = slots.findIndex((s) => (s.firmware ? s.firmware.id : s.loading) === id), on = at >= 0;
    return el("li", { className: on ? "playing" : b.playable ? "" : "unplayable" },
      el("div", { className: "name", textContent: b.name }),
      el("div", { className: "row" },
        b.playable
          ? el("button", { className: "solid compact", type: "button", textContent: on ? "unload" : "load", disabled: !on && to < 0, onclick: () => toggleBuild(b) })
          : el("span", { className: "meta", textContent: "not supported yet" }),
        el("a", { className: "button compact", href: `https://github.com/${b.repo}`, target: "_blank", rel: "noopener", title: b.repo, textContent: "source" })));
  }));
  markCursor();
}

function search(text) {
  query = text;
  cursor = 0;
  $("search").value = text;
  $("clear").hidden = !text; // the X shows once there is something to clear
  drawBuilds();
}
$("search").addEventListener("input", (e) => search(e.target.value));
// (Escape clears the box first; with nothing in it, it closes the list)
$("search").addEventListener("keydown", (e) => { if (e.key === "Escape" && query) { e.stopPropagation(); search(""); } });
$("clear").addEventListener("click", () => { search(""); $("search").focus(); });

// ------------------------------------------------------------------ the panel

/// Something done on the panel, for the chosen screen's firmware (dropped when it takes nothing).
const input = (i) => { if (live(cur())) send({ type: "input", slot: selected, input: i }); };

function press(elm, id, down, velocity = null) {
  if (elm.classList.contains("down") === down) return;
  elm.classList.toggle("down", down);
  input({ type: "key", id, down, velocity });
}

/// Every button and key held, let go (before the panel turns to another firmware).
function releaseAll() {
  for (const [id, elm] of leds) press(elm, id, false);
}

/// A button or a note key: down while the pointer is, wherever it goes after.
function pressable(elm, id, velocityAt = null) {
  leds.set(id, elm);
  elm.addEventListener("pointerdown", (e) => {
    elm.setPointerCapture(e.pointerId);
    press(elm, id, true, velocityAt ? velocityAt(e) : null);
  });
  for (const up of ["pointerup", "pointercancel", "lostpointercapture"]) elm.addEventListener(up, () => press(elm, id, false));
}

for (const b of document.querySelectorAll(".btn")) pressable(b, Number(b.dataset.key));

// the 27 note keys, F3 (id 14) to G5 (id 40)
const BLACK = new Set([1, 3, 6, 8, 10]); // semitones above C
const keys = new Map();
{
  const semis = [...Array(27).keys()].map((n) => ({ id: 14 + n, black: BLACK.has((n + 5) % 12) }));
  const whites = semis.filter((k) => !k.black).length;
  let white = 0;
  for (const k of semis) {
    const key = el("div", { className: `key ${k.black ? "black" : "white"}` });
    const w = 100 / whites;
    if (k.black) Object.assign(key.style, { left: `${white * w - w * 0.3}%`, width: `${w * 0.6}%` });
    else Object.assign(key.style, { left: `${white++ * w + 0.15}%`, width: `${w - 0.3}%` });
    // lower on the key is louder
    pressable(key, k.id, (e) => { const r = key.getBoundingClientRect(); return Math.round(1 + 126 * Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))); });
    keys.set(k.id, key);
    $("keys").append(key);
  }
}

// knobs: encoders turn in clicks, the pot holds a value (each screen's firmware its own)
function setPot(v) {
  const s = cur();
  if (!live(s)) return;
  s.pot = Math.min(1023, Math.max(0, v));
  document.querySelector("[data-pot]").style.setProperty("--turn", `${-135 + 270 * s.pot / 1023}deg`);
  input({ type: "analog", channel: 4, value: s.pot });
}
const knobs = [...document.querySelectorAll(".knob")];
const turns = []; // each knob's turn(clicks), in the panel's order (for a MIDI controller's knobs)
for (const knob of knobs) {
  let angle = 0, dragY = null, carry = 0;
  const turn = (clicks) => {
    if (!clicks || !live(cur())) return;
    if (knob.dataset.pot) return setPot(cur().pot + clicks * 32);
    angle += clicks * 15;
    knob.style.setProperty("--turn", `${angle}deg`);
    input({ type: "encoder", id: Number(knob.dataset.enc), clicks });
  };
  turns.push(turn);
  knob.addEventListener("wheel", (e) => { e.preventDefault(); turn(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  knob.addEventListener("pointerdown", (e) => { knob.setPointerCapture(e.pointerId); dragY = e.clientY; carry = 0; knob.classList.add("turning"); });
  knob.addEventListener("pointermove", (e) => {
    if (dragY === null) return;
    carry += dragY - e.clientY; // up is clockwise
    dragY = e.clientY;
    const clicks = Math.trunc(carry / 8);
    carry -= clicks * 8;
    turn(clicks);
  });
  for (const up of ["pointerup", "pointercancel"]) knob.addEventListener(up, () => { dragY = null; knob.classList.remove("turning"); });
}

// the computer keyboard: 1 to 4 choose a screen; A S D F G H J K L ; ' are white keys from C4,
// the row above the black
const TYPED = { a: 21, w: 22, s: 23, e: 24, d: 25, f: 26, t: 27, g: 28, y: 29, h: 30, u: 31, j: 32, k: 33, o: 34, l: 35, p: 36, ";": 37, "'": 38, z: 0, x: 1 };
function typed(e, down) {
  if (e.target.closest?.("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || (down && e.repeat)) return;
  if (down && e.key >= "1" && e.key <= "9" && slots[Number(e.key) - 1]) { e.preventDefault(); return select(Number(e.key) - 1); }
  const id = TYPED[e.key.toLowerCase()];
  if (id === undefined || (down && !live(cur()))) return;
  e.preventDefault();
  const elm = keys.get(id) || document.querySelector(`[data-key="${id}"]`);
  press(elm, id, down, down ? 100 : null);
}
addEventListener("keydown", (e) => typed(e, true));
addEventListener("keyup", (e) => typed(e, false));

// ------------------------------------------------------------------ start

drawBuilds();

// A page built for a static host (tools/build-pages.mjs) names a service worker, which keeps the
// firmwares' wasm files in the browser between visits. Never in the desktop window.
const worker = document.querySelector('meta[name="luka-sw"]')?.content;
if (worker && "serviceWorker" in navigator && !globalThis.__TAURI__) navigator.serviceWorker.register(worker).catch(() => { /* no caching, then */ });

// The web transport everywhere it can run, the desktop window included (which is a web view); the
// Tauri one (the Rust emulator and sound card) is for a window whose page cannot, and is loaded
// only then (a static host does not carry it).
let transport = web.available() ? web : null;
if (!transport) {
  const tauri = await import("./transport-tauri.js").catch(() => null);
  if (tauri?.available()) transport = tauri;
}
if (transport) {
  try {
    const connected = await transport.connect({ onEvent, onFrame });
    send = connected.send;
    globalThis.fma = connected; // for a look from the console
    makeSlots(connected.slots || 1); // (a transport that plays one firmware has one screen)
    status("Ready");
    send({ type: "list_builds" });
  } catch (e) {
    status(`Could not start: ${e.message || e}`, true);
  }
} else {
  status("This browser cannot run the player (it needs workers, storage and audio worklets).", true);
}

// ------------------------------------------------------------------ MIDI controller

/// The next (or previous) screen that has a firmware on it, round the screens; none: stays.
function step(direction) {
  for (let i = 1; i <= slots.length; i++) {
    const n = (selected + direction * i + slots.length * i) % slots.length;
    if (slots[n].firmware) return select(n);
  }
}

/// The Firm button of a controller: the list is closed, it opens (the cursor shown); open, it loads
/// the cursor's firmware (or unloads it, if it is on a screen) and closes the list. If that could
/// not be done (no screen free), the list stays, and the status line says why.
function firm() {
  if (!document.body.classList.contains("menu")) { menu(true); cursorOn = true; markCursor(true); return; }
  const b = shownBuilds[cursor];
  if (b && toggleBuild(b)) menu(false);
}

connectMidi({
  button: $("midi"),
  host: {
    labels: knobs.map((k) => k.dataset.label), // (what a controller's knobs can be learned as: the panel's, in order)
    notes: { offset: -39, range: [14, 40] },   // the keys are F3 (id 14) to G5 (id 40): MIDI note 53 is F3
    // a note played on a controller: the key goes down (if the firmware takes it) or up, as if clicked
    key({ id, down, velocity }) {
      const elm = keys.get(id) || document.querySelector(`[data-key="${id}"]`);
      if (elm && (!down || live(cur()))) press(elm, id, down, velocity);
    },
    act(name) {
      if (name === "nav-left") step(-1);
      else if (name === "nav-right") step(1);
      else if (name === "play") { const s = cur(); if (s?.firmware) s.stop.click(); } // the chosen screen's play / stop
      else if (name === "firm") firm();
    },
    // the knob that moves along the firmware list (only while it is open)
    list({ delta }) {
      if (!document.body.classList.contains("menu") || !delta || !shownBuilds.length) return;
      cursorOn = true;
      cursor = Math.max(0, Math.min(shownBuilds.length - 1, cursor + delta));
      markCursor(true);
    },
    // knob i of the panel turned by a controller's knob: as if by hand
    knob(i, { delta, value }) {
      if (!knobs[i]) return;
      if (knobs[i].dataset.pot && value !== undefined) setPot(Math.round(value / 127 * 1023)); // (the master: a position says where)
      else turns[i](delta);
    },
    status,
  },
});
