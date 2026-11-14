// The Tauri window's transport. A transport is all a client needs to be one:
//
//   connect({ onEvent(event), onFrame(rgba: Uint8ClampedArray) })  ->  { send(command) }
//
// Commands and events are the protocol's JSON (crates/fma-display/src/protocol.rs); a frame
// is a whole 240x240 screen. Audio is not here: the desktop app plays it itself. Another
// client (a web page) is another file like this one, and nothing else of the UI changes.

export function available() {
  return typeof window.__TAURI__ !== "undefined";
}

export async function connect({ onEvent, onFrame }) {
  const { invoke, Channel } = window.__TAURI__.core;
  await window.__TAURI__.event.listen("fma:event", (e) => onEvent(e.payload));
  const frames = new Channel();
  frames.onmessage = (bytes) => onFrame(new Uint8ClampedArray(bytes));
  await invoke("frames", { channel: frames });
  return { send: (command) => invoke("send", { command }) };
}
