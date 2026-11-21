# Firmware Interface Specification: viscera

> **Repository**: [De-Pattern/viscera](https://github.com/De-Pattern/viscera)  
> **Author**: De-Pattern  
> **License**: GPL-3.0 (with the FM1 SDK linking permission)  
> **Interface Family**: `viscera`  
> **Source Shim**: `its C core (exports init, control, paint, render)`  
> **Build Instructions**: `published build: https://de-pattern.github.io/viscera/emulator/viscera.wasm`  
> **Binary Artifact**: `dist/viscera.wasm` (195.1 KB, SHA-256: `136b88f66b441a6c...`)  

## Overview

A four-track tape looper in the spirit of a cassette Portastudio: record, overdub and punch in, set each track's speed. Records from a live input, which Luka does not give it yet.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `viscera` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 51 exported WebAssembly functions |
| **Imported Symbols** | None (self-contained) |

## Exported Interface Functions

### Other

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `bounce` | `void` | Exported WebAssembly runtime function |
| `cap` | `void` | Exported WebAssembly runtime function |
| `control` | `void` | Exported WebAssembly runtime function |
| `cpu_set` | `void` | Exported WebAssembly runtime function |
| `device` | `void` | Exported WebAssembly runtime function |
| `device_bytes` | `void` | Exported WebAssembly runtime function |
| `device_changed` | `void` | Exported WebAssembly runtime function |
| `device_check` | `void` | Exported WebAssembly runtime function |
| `device_seal` | `void` | Exported WebAssembly runtime function |
| `event` | `void` | Exported WebAssembly runtime function |
| `gest` | `void` | Exported WebAssembly runtime function |
| `get_param` | `void` | Exported WebAssembly runtime function |
| `has` | `void` | Exported WebAssembly runtime function |
| `host_arg` | `void` | Exported WebAssembly runtime function |
| `init` | `void` | Exported WebAssembly runtime function |
| `input_buffer` | `void` | Exported WebAssembly runtime function |
| `intro` | `void` | Exported WebAssembly runtime function |
| `learn_entry` | `void` | Exported WebAssembly runtime function |
| `leds` | `void` | Exported WebAssembly runtime function |
| `lend` | `void` | Exported WebAssembly runtime function |
| `loop` | `void` | Exported WebAssembly runtime function |
| `lstart` | `void` | Exported WebAssembly runtime function |
| `midi` | `void` | Exported WebAssembly runtime function |
| `name_buffer` | `void` | Exported WebAssembly runtime function |
| `np` | `void` | Exported WebAssembly runtime function |
| `output_buffer` | `void` | Exported WebAssembly runtime function |
| `paint` | `void` | Exported WebAssembly runtime function |
| `param_live` | `void` | Exported WebAssembly runtime function |
| `peak` | `void` | Exported WebAssembly runtime function |
| `pos` | `void` | Exported WebAssembly runtime function |
| `project` | `void` | Exported WebAssembly runtime function |
| `project_bytes` | `void` | Exported WebAssembly runtime function |
| `project_check` | `void` | Exported WebAssembly runtime function |
| `project_seal` | `void` | Exported WebAssembly runtime function |
| `rate` | `void` | Exported WebAssembly runtime function |
| `recording` | `void` | Exported WebAssembly runtime function |
| `render` | `void` | Exported WebAssembly runtime function |
| `reson_level` | `void` | Exported WebAssembly runtime function |
| `reson_pings` | `void` | Exported WebAssembly runtime function |
| `robot` | `void` | Exported WebAssembly runtime function |
| `route` | `void` | Exported WebAssembly runtime function |
| `sat` | `void` | Exported WebAssembly runtime function |
| `screen` | `void` | Exported WebAssembly runtime function |
| `set_host` | `void` | Exported WebAssembly runtime function |
| `set_param` | `void` | Exported WebAssembly runtime function |
| `slot_info` | `void` | Exported WebAssembly runtime function |
| `stop_all` | `void` | Exported WebAssembly runtime function |
| `take` | `void` | Exported WebAssembly runtime function |
| `transport` | `void` | Exported WebAssembly runtime function |
| `usb_buffer` | `void` | Exported WebAssembly runtime function |
| `vu` | `void` | Exported WebAssembly runtime function |

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

