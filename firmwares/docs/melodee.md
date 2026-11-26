# Firmware Interface Specification: Melodee

> **Repository**: [keremimo/melodee](https://github.com/keremimo/melodee)  
> **Author**: Kerem Kilic (@keremimo)  
> **License**: GPL-3.0  
> **Interface Family**: `melodee`  
> **Source Shim**: `web/emu/melodee_web.c`  
> **Build Instructions**: `web/emu/build.sh`  
> **Binary Artifact**: `dist/melodee.wasm` (1099.5 KB, SHA-256: `2bb0ff68d9183c9c...`)  

## Overview

FM-1 melodic synth/sequencer firmware with custom sound engine, 909 drums, scale quantizer, and visual UI.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `melodee` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 15 exported WebAssembly functions |
| **Imported Symbols** | None (self-contained) |

## Exported Interface Functions

### Runtime

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `emscripten_stack_get_current` | `-> uint32_t` | Get current WebAssembly execution stack pointer |

### Lifecycle

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_boot` | `void` | Initialize and power on the virtual synthesizer engine |

### Input

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_buttons` | `(uint32_t mask)` | Button state bitmask (bits 0..13: FX..REC, OCT-, OCT+) |
| `web_encoder` | `(uint32_t enc, int32_t clicks)` | Turn rotary encoder by index with step count (+/-) |
| `web_keys` | `(uint32_t mask)` | 27-key keyboard state bitmask (bits 0..26 for notes F3..G5) |
| `web_master` | `(uint32_t level)` | Set MASTER volume level (felucca: 0..1023, x0x: 0..4096) |

### Display

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_fb` | `-> uint16_t*` | Pointer to 240x240 RGB565 framebuffer in panel byte order |
| `web_fb_gen` | `-> uint32_t` | Framebuffer generation counter |

### LEDs

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_led_buttons` | `-> uint32_t` | Button LED state mask |
| `web_led_keys` | `-> uint32_t` | Key LED state mask |

### MIDI

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_midi_in` | `(uint32_t status, uint32_t d1, uint32_t d2)` | Send 3-byte MIDI channel message (status, data1, data2) |

### Timing

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_now` | `-> uint32_t (ms)` | Get current firmware running time in milliseconds |

### Audio

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_out_l` | `-> float*` | Pointer to float32 left audio channel buffer (normalized -1.0 .. 1.0) |
| `web_out_r` | `-> float*` | Pointer to float32 right audio channel buffer (normalized -1.0 .. 1.0) |
| `web_render` | `(uint32_t n)` | Render n stereo frames (up to 1024) into the audio output buffers |

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

