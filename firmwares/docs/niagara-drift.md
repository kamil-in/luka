# Firmware Interface Specification: Niagara Drift (OMNI)

> **Repository**: [evanyerburgh/niagara-drift](https://github.com/evanyerburgh/niagara-drift)  
> **Author**: Evan Yerburgh  
> **License**: GPL-3.0  
> **Interface Family**: `x0x`  
> **Source Shim**: `web/emu/omni_web.c`  
> **Build Instructions**: `web/emu/build.sh`  
> **Binary Artifact**: `dist/niagara-drift.wasm` (373.0 KB, SHA-256: `65767c54e09aebe3...`)  

## Overview

Generative drone and ambient sound generator with multilevel LED monitoring and continuous timbre morphing.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `x0x` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 30 exported WebAssembly functions |
| **Imported Symbols** | `wasi_snapshot_preview1.clock_time_get` |

## Exported Interface Functions

### Runtime

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `emscripten_stack_get_current` | `-> uint32_t` | Get current WebAssembly execution stack pointer |
| `setThrew` | `(uint32_t th, uint32_t val)` | Emscripten exception unwind helper |

### Display

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_blits` | `-> uint32_t` | Incrementing screen blit/draw counter (redraw when changed) |
| `web_fb` | `-> uint16_t*` | Pointer to 240x240 RGB565 framebuffer in panel byte order |

### Lifecycle

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_boot` | `void` | Initialize and power on the virtual synthesizer engine |

### LEDs

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_btn_levels` | `-> uint8_t*` | Per-button analog LED brightness values |
| `web_key_levels` | `-> uint8_t*` | Per-key analog LED brightness values |
| `web_keys_lfo` | `-> uint32_t` | LFO modulation applied to key LEDs |
| `web_lit_buttons` | `-> uint32_t` | Bitmask of fully illuminated button LEDs (bit 14: PLAY green) |
| `web_lit_keys` | `-> uint32_t` | Bitmask of fully illuminated key LEDs (27 keys) |

### Input

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_buttons` | `(uint32_t mask)` | Button state bitmask (bits 0..13: FX..REC, OCT-, OCT+) |
| `web_enc` | `(uint32_t role, int32_t clicks)` | Turn rotary encoder by role with detent step count (+/-) |
| `web_keys` | `(uint32_t mask)` | 27-key keyboard state bitmask (bits 0..26 for notes F3..G5) |
| `web_master` | `(uint32_t level)` | Set MASTER volume level (felucca: 0..1023, x0x: 0..4096) |

### Diagnostics

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_cpu` | `-> uint32_t (%)` | Internal CPU usage estimate in percent |

### Storage

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_nobj` | `-> uint32_t` | Number of independent storage object slots (e.g. presets, patterns) |
| `web_store` | `(uint32_t slot)` | Pointer to storage object slot buffer |
| `web_store_len` | `(uint32_t slot)` | Current byte length of stored object (-1 if empty) |
| `web_store_max` | `-> uint32_t` | Maximum allowable byte length per storage object |
| `web_store_set_len` | `(uint32_t slot, int32_t len)` | Set byte length of stored object after writing data |
| `web_store_writes` | `-> uint32_t` | Incrementing counter of storage object write commits |

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

### Speech

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_said_buf` | `-> uint8_t*` | Buffer holding generated speech/announcement text or SysEx |
| `web_said_clear` | `void` | Clear speech announcement buffer after reading |
| `web_said_len` | `-> uint32_t` | Length of valid data in speech announcement buffer |

### SysEx

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_sysex` | `(uint32_t n)` | Process incoming SysEx message of n bytes |
| `web_sysex_buf` | `-> uint8_t*` | Buffer for outgoing SysEx data |

## Imported Host Dependencies

This WebAssembly module requires the host environment (browser AudioWorklet / JS engine) to provide the following imports:

| Import Name | Role |
| :--- | :--- |
| `wasi_snapshot_preview1.clock_time_get` | WASI system call (clock/io) |

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

