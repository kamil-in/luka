# Firmware Interface Specification: ZEN-1

> **Repository**: [aceyprime/zen-1](https://github.com/aceyprime/zen-1)  
> **Author**: aceyprime  
> **License**: GPL-3.0  
> **Interface Family**: `zen`  
> **Source Shim**: `web/emu/zen1_web.c`  
> **Build Instructions**: `web/emu/build.sh`  
> **Binary Artifact**: `dist/zen-1.wasm` (635.6 KB, SHA-256: `ed28f4ce98de581e...`)  

## Overview

East-Asian traditional and microtonal instrument emulation firmware (koto, shakuhachi, erhu) with ornament articulation and microtonal cents pitch bending.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `zen` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 46 exported WebAssembly functions |
| **Imported Symbols** | `wasi_snapshot_preview1.clock_time_get` |

## Exported Interface Functions

### Runtime

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `emscripten_stack_get_current` | `-> uint32_t` | Get current WebAssembly execution stack pointer |
| `setThrew` | `(uint32_t th, uint32_t val)` | Emscripten exception unwind helper |

### Articulation

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_bend` | `(int32_t cents)` | Pitch bend depth in microtonal cents |
| `web_bend_cents` | `-> int32_t` | Get active pitch bend value in cents |
| `web_ornament` | `(uint32_t type, uint32_t depth)` | Trigger traditional East-Asian ornament (shakuhachi meri/kari, koto oshide) |

### Display

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_blits` | `-> uint32_t` | Incrementing screen blit/draw counter (redraw when changed) |
| `web_fb` | `-> uint16_t*` | Pointer to 240x240 RGB565 framebuffer in panel byte order |

### Lifecycle

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_boot` | `void` | Initialize and power on the virtual synthesizer engine |

### Patches

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_builtin` | `-> uint32_t` | Number of factory built-in preset patches |
| `web_custom` | `-> uint8_t*` | Pointer to user custom preset bank buffer |
| `web_npatch` | `-> uint32_t` | Total number of sound preset patches available |
| `web_patch` | `-> uint32_t` | Get active sound preset patch index |
| `web_patch_get` | `(uint32_t patch)` | Get pointer to patch parameter data structure |
| `web_patch_set` | `(uint32_t patch)` | Switch active preset patch by index |

### Input

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_buttons` | `(uint32_t mask)` | Button state bitmask (bits 0..13: FX..REC, OCT-, OCT+) |
| `web_enc` | `(uint32_t role, int32_t clicks)` | Turn rotary encoder by role with detent step count (+/-) |
| `web_key` | `(uint32_t key, uint32_t vel, uint32_t at)` | Single key event with velocity and arrival timestamp (MONK-1) |
| `web_key_level` | `(uint32_t key, uint32_t level)` | Analog strike/pressure level on key |
| `web_keys` | `(uint32_t mask)` | 27-key keyboard state bitmask (bits 0..26 for notes F3..G5) |
| `web_master` | `(uint32_t level)` | Set MASTER volume level (felucca: 0..1023, x0x: 0..4096) |

### Diagnostics

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_cpu` | `-> uint32_t (%)` | Internal CPU usage estimate in percent |
| `web_panic` | `void` | All notes off and sound engine reset |
| `web_peak` | `-> float` | Current voice peak amplitude level |

### Tuning

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_key_cents` | `(uint32_t key)` | Microtonal cents offset for specific keyboard key |

### Status

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_label` | `(uint32_t id)` | Pointer to UI display label string |
| `web_patch_ja` | `(uint32_t patch)` | Pointer to Japanese / Kanji preset name string |

### LEDs

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_lit_buttons` | `-> uint32_t` | Bitmask of fully illuminated button LEDs (bit 14: PLAY green) |
| `web_lit_keys` | `-> uint32_t` | Bitmask of fully illuminated key LEDs (27 keys) |

### Engine

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_mode` | `(uint32_t mode)` | Set synthesis mode / traditional instrument model |
| `web_nvoices` | `-> uint32_t` | Number of active polyphonic/monophonic voice channels |

### Storage

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_nobj` | `-> uint32_t` | Number of independent storage object slots (e.g. presets, patterns) |
| `web_store` | `(uint32_t slot)` | Pointer to storage object slot buffer |
| `web_store_len` | `(uint32_t slot)` | Current byte length of stored object (-1 if empty) |
| `web_store_max` | `-> uint32_t` | Maximum allowable byte length per storage object |
| `web_store_set_len` | `(uint32_t slot, int32_t len)` | Set byte length of stored object after writing data |
| `web_store_writes` | `-> uint32_t` | Incrementing counter of storage object write commits |

### Synth

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_note` | `(uint32_t note, uint32_t vel, int32_t cents)` | Play note with velocity and microtonal articulation |

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

### Parameters

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_param` | `(uint32_t param, int32_t val)` | Modify synthesis parameter by ID and value |
| `web_param_get` | `(uint32_t param)` | Get parameter value for active patch |
| `web_param_hi` | `(uint32_t param)` | Maximum allowable value for parameter |
| `web_param_lo` | `(uint32_t param)` | Minimum allowable value for parameter |
| `web_param_name` | `(uint32_t param)` | Pointer to parameter name string |

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

