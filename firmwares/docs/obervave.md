# Firmware Interface Specification: OberVave

> **Repository**: [zvenson/obervave](https://github.com/zvenson/obervave)  
> **Author**: Zvenson  
> **License**: GPL-3.0  
> **Interface Family**: `sim`  
> **Source Shim**: `web/sim/sim.c`  
> **Build Instructions**: `web/sim/build.sh`  
> **Binary Artifact**: `dist/obervave.wasm` (235.1 KB, SHA-256: `7e34f28453ab719b...`)  

## Overview

Oberheim-inspired analog modeling synth with coroutine main loop, multi-mode filter, and web simulation harness.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `sim` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 28 exported WebAssembly functions |
| **Imported Symbols** | None (self-contained) |

## Exported Interface Functions

### Asyncify

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `asyncify_get_state` | `-> uint32_t` | Binaryen Asyncify: query coroutine unwind/rewind state |
| `asyncify_start_rewind` | `(void* data)` | Binaryen Asyncify: restore execution context and rewind stack |
| `asyncify_start_unwind` | `(void* data)` | Binaryen Asyncify: initiate stack unwinding |
| `asyncify_stop_rewind` | `void` | Binaryen Asyncify: complete stack rewinding |
| `asyncify_stop_unwind` | `void` | Binaryen Asyncify: finalize stack unwinding |

### Storage

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `sim_blob` | `-> uint8_t*` | Pointer to full synth state snapshot blob |
| `sim_blob_size` | `-> uint32_t` | Total byte length of synth state snapshot blob |
| `sim_store_hash` | `-> uint32_t` | Hash of stored parameters to detect persistent changes |

### Input

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `sim_button` | `(uint32_t id, uint32_t down)` | Set button state by ID (pressed/released) |
| `sim_enc` | `(uint32_t id, int32_t clicks)` | Turn encoder ID by step count (+/-) |
| `sim_key` | `(uint32_t key, uint32_t down)` | Set note key state by ID (pressed/released) |
| `sim_master` | `(uint32_t val)` | Set master volume (0..1023) |
| `sim_note` | `(uint32_t note, uint32_t vel)` | Trigger MIDI note with velocity |

### Display

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `sim_fb` | `-> uint16_t*` | Pointer to 240x240 RGB565 framebuffer in linear memory |
| `sim_fb_hash` | `-> uint32_t` | CRC/Hash of current framebuffer to detect screen redraws |

### LEDs

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `sim_glow_keys` | `-> uint32_t` | Key LED glow level mask |
| `sim_leds_buttons` | `-> uint32_t` | Button LED illumination mask |
| `sim_leds_keys` | `-> uint32_t` | Key LED illumination mask |

### Lifecycle

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `sim_init` | `void` | Initialize OberVave/S1Vave synth engine and voice parameters |

### MIDI

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `sim_midi` | `(uint32_t b1, uint32_t b2, uint32_t b3)` | Send 3-byte raw MIDI message |

### Timing

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `sim_ms` | `-> uint32_t` | Current simulation time in milliseconds |

### Audio

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `sim_out_l` | `-> float*` | Pointer to left audio channel float32 buffer |
| `sim_out_r` | `-> float*` | Pointer to right audio channel float32 buffer |
| `sim_rate` | `-> uint32_t` | Audio engine sample rate in Hz |
| `sim_render` | `(uint32_t n)` | Render n stereo audio frames into output channels |

### Status

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `sim_page` | `-> uint32_t` | Active UI page index |
| `sim_prog` | `-> uint32_t` | Current sound preset program index |

### Diagnostics

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `sim_peak` | `-> float` | Peak audio amplitude value |

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

