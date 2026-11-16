# Firmware Interface Specification: JIANT

> **Repository**: [juanjiant-bit/JIANT](https://github.com/juanjiant-bit/JIANT)  
> **Author**: juanjiant-bit  
> **License**: GPL-3.0  
> **Interface Family**: `felucca`  
> **Source Shim**: `web/emu/felucca_web.c`  
> **Build Instructions**: `web/emu/build.sh; published build: https://juanjiant-bit.github.io/JIANT/emu/felucca.wasm`  
> **Binary Artifact**: `dist/JIANT.wasm` (1195.1 KB, SHA-256: `8493a65927d72c51...`)  

## Overview

JIANT firmware for the FM-1 (Felucca-derived), with a browser emulator.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `felucca` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 56 exported WebAssembly functions |
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
| `web_additive_edition` | `void` | Exported WebAssembly runtime function |
| `web_beat_samples` | `void` | Exported WebAssembly runtime function |
| `web_bk_buf` | `void` | Exported WebAssembly runtime function |
| `web_bk_len` | `void` | Exported WebAssembly runtime function |
| `web_bk_max` | `void` | Exported WebAssembly runtime function |
| `web_bk_put` | `void` | Exported WebAssembly runtime function |
| `web_ed` | `void` | Exported WebAssembly runtime function |
| `web_ed_buf` | `void` | Exported WebAssembly runtime function |
| `web_ed_reply` | `void` | Exported WebAssembly runtime function |
| `web_gen` | `void` | Exported WebAssembly runtime function |
| `web_gen_count` | `void` | Exported WebAssembly runtime function |
| `web_gen_last` | `void` | Exported WebAssembly runtime function |
| `web_gen_name` | `void` | Exported WebAssembly runtime function |
| `web_mix_skip` | `void` | Exported WebAssembly runtime function |
| `web_play` | `void` | Exported WebAssembly runtime function |
| `web_selected_engine` | `void` | Exported WebAssembly runtime function |
| `web_song_bars` | `void` | Exported WebAssembly runtime function |
| `web_song_cur` | `void` | Exported WebAssembly runtime function |
| `web_song_end` | `void` | Exported WebAssembly runtime function |
| `web_song_play` | `void` | Exported WebAssembly runtime function |
| `web_song_rows` | `void` | Exported WebAssembly runtime function |
| `web_song_select` | `void` | Exported WebAssembly runtime function |
| `web_test_heavy` | `void` | Exported WebAssembly runtime function |
| `web_test_user_preset` | `void` | Exported WebAssembly runtime function |
| `web_trk_live` | `void` | Exported WebAssembly runtime function |

### LEDs

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_anim_levels` | `-> uint8_t*` | Pointer to per-LED animation brightness array (0..64) |
| `web_breath_buttons` | `-> uint32_t` | Bitmask of breathing / pulsating button LEDs |
| `web_breath_keys` | `-> uint32_t` | Bitmask of breathing / pulsating key LEDs |
| `web_dim_buttons` | `-> uint32_t` | Bitmask of dimly glowing button LEDs |
| `web_dim_keys` | `-> uint32_t` | Bitmask of dimly glowing key LEDs |
| `web_dim_level` | `-> uint32_t` | Base glow intensity level for dim LEDs |
| `web_lit_buttons` | `-> uint32_t` | Bitmask of fully illuminated button LEDs (bit 14: PLAY green) |
| `web_lit_keys` | `-> uint32_t` | Bitmask of fully illuminated key LEDs (27 keys) |
| `web_mid_keys` | `-> uint32_t` | Bitmask of medium-brightness key LEDs (drum beats) |

### Lifecycle

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_boot` | `void` | Initialize and power on the virtual synthesizer engine |
| `web_seed` | `(uint32_t seed)` | Seed pseudo-random generator for generative variations |

### Input

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_buttons` | `(uint32_t mask)` | Button state bitmask (bits 0..13: FX..REC, OCT-, OCT+) |
| `web_enc` | `(uint32_t role, int32_t clicks)` | Turn rotary encoder by role with detent step count (+/-) |
| `web_keys` | `(uint32_t mask)` | 27-key keyboard state bitmask (bits 0..26 for notes F3..G5) |
| `web_master` | `(uint32_t level)` | Set MASTER volume level (felucca: 0..1023, x0x: 0..4096) |

### Storage

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_flash_writes_count` | `-> uint32_t` | Number of flash write operations committed |
| `web_nor` | `-> uint8_t*` | Pointer to 1 MiB virtual NOR flash image in linear memory |
| `web_nor_erase` | `void` | Erase virtual NOR flash memory (sets all bytes to 0xFF) |
| `web_nor_size` | `-> uint32_t` | Total size of virtual NOR flash image (1048576 bytes) |

### MIDI

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_midi` | `(uint32_t status, uint32_t d1, uint32_t d2)` | Send 3-byte MIDI channel message (status, data1, data2) |

### Timing

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_now_ms` | `-> uint32_t (ms)` | Get current firmware running time in milliseconds |

### Audio

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_out_l` | `-> float*` | Pointer to float32 left audio channel buffer (normalized -1.0 .. 1.0) |
| `web_out_r` | `-> float*` | Pointer to float32 right audio channel buffer (normalized -1.0 .. 1.0) |
| `web_render` | `(uint32_t n)` | Render n stereo frames (up to 1024) into the audio output buffers |
| `web_sample_rate` | `-> uint32_t` | Nominal output sample rate in Hz (44100 Hz) |

### Status

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_playing` | `-> uint32_t (bool)` | Whether sequencer/song playback is currently running |
| `web_version` | `-> char*` | Firmware build version identifier string |

### Display

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_screen` | `-> uint16_t*` | Pointer to 240x240 RGB565 framebuffer in panel byte order |
| `web_screen_draws` | `-> uint32_t` | Incrementing screen redraw counter (redraw when changed) |

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

