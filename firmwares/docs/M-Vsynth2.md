# Firmware Interface Specification: M-Vsynth2

> **Repository**: [bk40-home/M-Vsynth2](https://github.com/bk40-home/M-Vsynth2)  
> **Author**: Kris (bk40-home)  
> **License**: GPL-3.0-only (Synth2 parts: MIT)  
> **Interface Family**: `wsim`  
> **Source Shim**: `sim/mv_websim.c (the platform under Emscripten Asyncify)`  
> **Build Instructions**: `sim/build.sh; published build: docs/sim/mvsynth2.wasm (committed, served by its Pages)`  
> **Binary Artifact**: `dist/M-Vsynth2.wasm` (387.3 KB, SHA-256: `f88dc34b58d2e5e2...`)  

## Overview

Synth2, the open-source recreation of Synth1, on eight voices: two oscillators and a sub, five filters, two LFOs, distortions and phasers, EQ, delay, chorus and Synth1's arpeggiator. It plays Synth1's .sy1 patches, with the Synth2 Factory bank built in.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `wsim` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 17 exported WebAssembly functions |
| **Imported Symbols** | `env.emscripten_resize_heap`, `env.emscripten_sleep`, `env.wsim_midi_out`, `env.wsim_sysex_out` |

## Exported Interface Functions

### Asyncify

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `asyncify_get_state` | `-> uint32_t` | Binaryen Asyncify: query coroutine unwind/rewind state |
| `asyncify_start_rewind` | `(void* data)` | Binaryen Asyncify: restore execution context and rewind stack |
| `asyncify_start_unwind` | `(void* data)` | Binaryen Asyncify: initiate stack unwinding |
| `asyncify_stop_rewind` | `void` | Binaryen Asyncify: complete stack rewinding |
| `asyncify_stop_unwind` | `void` | Binaryen Asyncify: finalize stack unwinding |

### Runtime

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `emscripten_stack_get_current` | `-> uint32_t` | Get current WebAssembly execution stack pointer |
| `free` | `(void* p)` | Release memory from malloc |
| `malloc` | `(size_t n)` | Allocate linear memory (the host's Asyncify data and audio buffer) |
| `setThrew` | `(uint32_t th, uint32_t val)` | Emscripten exception unwind helper |

### Lifecycle

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `main` | `(int argc, char** argv)` | The firmware's main loop (never returns): runs until it sleeps (emscripten_sleep), unwound by Asyncify; called again after asyncify_start_rewind to go on |

### Input

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `wsim_btn` | `(int id, int down)` | A panel button held or let go, by the panel's ids (0 OCT-, 1 OCT+, 2 FX .. 13 REC) |
| `wsim_enc` | `(int id, int detents)` | An encoder turned, in detents (+ clockwise); ids 0 SELECT, 1 ALGORITHM, 2..5 KNOB 1..4, 6 PRESETS |
| `wsim_keys` | `(uint32_t mask)` | The 27 note keys as one mask (bit 0 = F3) |

### Display

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `wsim_fb` | `-> uint16_t*` | Pointer to the 240x240 RGB565 framebuffer (host byte order) |

### MIDI

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `wsim_midi` | `(int status, int data1, int data2)` | One MIDI message in, as over USB |
| `wsim_sysex_in` | `(const uint8_t* p, int n)` | One whole SysEx message in (F0 .. F7): the program transfer |

### Audio

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `wsim_pull` | `(float* dst, int max_frames)` | Copy up to max_frames stereo frames (interleaved L R, float -1..1) out of the 2048-frame ring; returns the frames copied |

## Imported Host Dependencies

This WebAssembly module requires the host environment (browser AudioWorklet / JS engine) to provide the following imports:

| Import Name | Role |
| :--- | :--- |
| `env.emscripten_resize_heap` | Host environment function |
| `env.emscripten_sleep` | Host environment function |
| `env.wsim_midi_out` | Host environment function |
| `env.wsim_sysex_out` | Host environment function |

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

