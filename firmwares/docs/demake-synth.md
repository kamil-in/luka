# Firmware Interface Specification: Demake

> **Repository**: [InigoHernandez/demake-synth](https://github.com/InigoHernandez/demake-synth)  
> **Author**: Iñigo Hernández  
> **License**: GPL-3.0  
> **Interface Family**: `demake`  
> **Source Shim**: `web/dmk_web.c`  
> **Build Instructions**: `web/build.sh (committed build: web/dmk.wasm)`  
> **Binary Artifact**: `dist/demake-synth.wasm` (625.3 KB, SHA-256: `7038ecc7addd60ac...`)  

## Overview

An ambient lofi machine on 64 of its author's pedal recordings: three synths, each with a piano roll, eight patterns and its own effects.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `demake` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 16 exported WebAssembly functions |
| **Imported Symbols** | None (self-contained) |

## Exported Interface Functions

### Runtime

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `emscripten_stack_get_current` | `-> uint32_t` | Get current WebAssembly execution stack pointer |
| `setThrew` | `(uint32_t th, uint32_t val)` | Emscripten exception unwind helper |

### Other

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `w_audio` | `void` | Exported WebAssembly runtime function |
| `w_button` | `void` | Exported WebAssembly runtime function |
| `w_encoder` | `void` | Exported WebAssembly runtime function |
| `w_frame` | `void` | Exported WebAssembly runtime function |
| `w_init` | `void` | Exported WebAssembly runtime function |
| `w_key` | `void` | Exported WebAssembly runtime function |
| `w_latency` | `void` | Exported WebAssembly runtime function |
| `w_leds` | `void` | Exported WebAssembly runtime function |
| `w_midi` | `void` | Exported WebAssembly runtime function |
| `w_midi_take` | `void` | Exported WebAssembly runtime function |
| `w_palette` | `void` | Exported WebAssembly runtime function |
| `w_render` | `void` | Exported WebAssembly runtime function |
| `w_store` | `void` | Exported WebAssembly runtime function |
| `w_store_gen` | `void` | Exported WebAssembly runtime function |

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

