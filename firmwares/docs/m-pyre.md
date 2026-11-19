# Firmware Interface Specification: M-PYRE

> **Repository**: [HistoryOfSky/m-pyre](https://github.com/HistoryOfSky/m-pyre)  
> **Author**: History Of Sky  
> **License**: GPL-3.0  
> **Interface Family**: `mpyre`  
> **Source Shim**: `firmware/host/emu.c`  
> **Build Instructions**: `firmware/host/build_web.sh; published build: docs/emu/index.html (wasm and sound pack inlined; the pack is carried as the wasm's "luka.pack" section)`  
> **Binary Artifact**: `dist/m-pyre.wasm` (1162.4 KB, SHA-256: `78c00f605e1421c7...`)  

## Overview

A riffbox for rock and metal: guitar, bass and drum samples, an amp engine with cabinet IRs, pedals and effects, plus SLOOP's synth engines and a 4-track recorder.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `mpyre` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 18 exported WebAssembly functions |
| **Imported Symbols** | None (self-contained) |

## Exported Interface Functions

### Other

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `emu_block_frames` | `void` | Exported WebAssembly runtime function |
| `emu_buffer` | `void` | Exported WebAssembly runtime function |
| `emu_button` | `void` | Exported WebAssembly runtime function |
| `emu_init` | `void` | Exported WebAssembly runtime function |
| `emu_keys` | `void` | Exported WebAssembly runtime function |
| `emu_knob` | `void` | Exported WebAssembly runtime function |
| `emu_led_buttons` | `void` | Exported WebAssembly runtime function |
| `emu_led_keys` | `void` | Exported WebAssembly runtime function |
| `emu_proj_changed` | `void` | Exported WebAssembly runtime function |
| `emu_proj_get` | `void` | Exported WebAssembly runtime function |
| `emu_proj_put` | `void` | Exported WebAssembly runtime function |
| `emu_rate` | `void` | Exported WebAssembly runtime function |
| `emu_render` | `void` | Exported WebAssembly runtime function |
| `emu_reset_tracks` | `void` | Exported WebAssembly runtime function |
| `emu_screen` | `void` | Exported WebAssembly runtime function |
| `emu_slot` | `void` | Exported WebAssembly runtime function |
| `emu_ui` | `void` | Exported WebAssembly runtime function |
| `emu_volume` | `void` | Exported WebAssembly runtime function |

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

