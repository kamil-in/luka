// The front panel and the firmware list. Talks to a transport and nothing else: the
// desktop app's (transport-tauri.js) or a browser's (web/transport-web.js), whichever is here.

import * as tauri from "./transport-tauri.js";
import * as web from "./web/transport-web.js";

const $ = (id) => document.getElementById(id);
const status = (text, bad = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("bad", bad);
};

let send = () => {};
let playing = null; // the firmware's id
let query = ""; // what the search box holds
let builds = [];

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

// ------------------------------------------------------------------ the screen

const ctx = $("screen").getContext("2d");
const image = ctx.createImageData(240, 240);
let pending = null;
function onFrame(rgba) {
  if (rgba.length !== image.data.length) return;
  // (several frames between two repaints: only the last is drawn)
  if (!pending) requestAnimationFrame(() => { image.data.set(pending); ctx.putImageData(image, 0, 0); pending = null; });
  pending = rgba;
}

// ------------------------------------------------------------------ events

const leds = new Map(); // key id -> element
function onEvent(e) {
  switch (e.type) {
    case "builds": builds = [...e.builds].sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base", numeric: true })); drawBuilds(); break; // a to z
    case "started":
      playing = e.firmware.id;
      status(`Playing ${e.firmware.repo} ${e.firmware.version} (${e.info.identity})` + (e.save_restored ? ", with what it saved last time" : ""));
      $("now").textContent = e.firmware.repo;
      setPot(pot); // the machine starts without knowing where the pot stands
      drawBuilds();
      break;
    case "leds":
      // (a fully lit LED is on about 8 % of the time: the device scans them)
      // and many firmwares keep every LED faintly on: squared, so faint stays faint
      for (const [id, el] of leds) el.style.setProperty("--led", (Math.min(1, (e.levels[id] || 0) / 0.08) ** 2).toFixed(2));
      break;
    case "stopped":
      playing = null;
      $("now").textContent = "";
      for (const el of leds.values()) el.style.setProperty("--led", 0);
      status(e.reason ? `The firmware stopped after ${(e.at_ms / 1000).toFixed(1)} s: ${e.reason}` : "Stopped", !!e.reason);
      drawBuilds();
      break;
    case "error": status(e.message, true); break;
    case "notice": status(e.message); break;
  }
}

// ------------------------------------------------------------------ the firmware list

// A link that opens a new tab in a browser opens the system's browser in the desktop window
// (a web view opens nothing of its own).
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[target=_blank]");
  if (!a || !globalThis.__TAURI__) return;
  e.preventDefault();
  globalThis.__TAURI__.core.invoke("open_link", { url: a.href }).catch((err) => status(String(err), true));
});

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/// The firmwares' own browser builds on offer, the ones the search box's text is in.
function drawBuilds() {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = builds.filter((b) => words.every((w) => `${b.name} ${b.repo}`.toLowerCase().includes(w)));
  if (!shown.length) {
    $("builds").replaceChildren(el("li", { className: "empty", textContent: builds.length ? "no firmware matches." : "nothing here yet." }));
    return;
  }
  $("builds").replaceChildren(...shown.map((b) => {
    const on = `build:${b.id}` === playing;
    return el("li", { className: on ? "playing" : b.playable ? "" : "unplayable" },
      el("div", {},
        el("div", { className: "name", textContent: b.name }),
        el("a", { className: "meta", href: `https://github.com/${b.repo}`, target: "_blank", rel: "noopener", textContent: b.repo }),
        el("div", { className: "row" }, b.playable
          ? el("button", { className: "solid compact", textContent: on ? "stop" : "play", onclick: () => send(on ? { type: "stop" } : { type: "start_build", id: b.id }) })
          : el("span", { className: "meta", textContent: "listed only: its interface is not supported yet" }))));
  }));
}

function search(text) {
  query = text;
  $("search").value = text;
  $("clear").hidden = !text; // the X shows once there is something to clear
  drawBuilds();
}
$("search").addEventListener("input", (e) => search(e.target.value));
$("search").addEventListener("keydown", (e) => { if (e.key === "Escape") search(""); });
$("clear").addEventListener("click", () => { search(""); $("search").focus(); });

// ------------------------------------------------------------------ the panel

const input = (i) => send({ type: "input", input: i });

function press(elm, id, down, velocity = null) {
  if (elm.classList.contains("down") === down) return;
  elm.classList.toggle("down", down);
  input({ type: "key", id, down, velocity });
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

// knobs: encoders turn in clicks, the pot holds a value
let pot = 800;
function setPot(v) {
  pot = Math.min(1023, Math.max(0, v));
  document.querySelector("[data-pot]").style.setProperty("--turn", `${-135 + 270 * pot / 1023}deg`);
  input({ type: "analog", channel: 4, value: pot });
}
for (const knob of document.querySelectorAll(".knob")) {
  let angle = 0, dragY = null, carry = 0;
  const turn = (clicks) => {
    if (!clicks) return;
    if (knob.dataset.pot) return setPot(pot + clicks * 32);
    angle += clicks * 15;
    knob.style.setProperty("--turn", `${angle}deg`);
    input({ type: "encoder", id: Number(knob.dataset.enc), clicks });
  };
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

// the computer keyboard: A S D F G H J K L ; ' are white keys from C4, the row above the black
const TYPED = { a: 21, w: 22, s: 23, e: 24, d: 25, f: 26, t: 27, g: 28, y: 29, h: 30, u: 31, j: 32, k: 33, o: 34, l: 35, p: 36, ";": 37, "'": 38, z: 0, x: 1 };
function typed(e, down) {
  if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || (down && e.repeat)) return;
  const id = TYPED[e.key.toLowerCase()];
  if (id === undefined) return;
  e.preventDefault();
  const elm = keys.get(id) || document.querySelector(`[data-key="${id}"]`);
  press(elm, id, down, down ? 100 : null);
}
addEventListener("keydown", (e) => typed(e, true));
addEventListener("keyup", (e) => typed(e, false));

// ------------------------------------------------------------------ start

drawBuilds();
// The web transport everywhere it can run, the desktop window included (which is a web view); the
// Tauri one (the Rust emulator and sound card) is for a window whose page cannot.
const transport = web.available() ? web : tauri.available() ? tauri : null;
if (transport) {
  try {
    const connected = await transport.connect({ onEvent, onFrame });
    send = connected.send;
    globalThis.fma = connected; // for a look from the console
    status("Ready");
    send({ type: "list_builds" });
  } catch (e) {
    status(`Could not start: ${e.message || e}`, true);
  }
} else {
  status("This browser cannot run the player (it needs workers, storage and audio worklets).", true);
}
