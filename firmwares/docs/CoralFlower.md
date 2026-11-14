# Firmware Interface Specification: CoralFlower

> **Repository**: [FicusFicusov/CoralFlower](https://github.com/FicusFicusov/CoralFlower)  
> **Author**: FicusFicusov  
> **License**: GPL-3.0  
> **Interface Family**: `coralflower`  
> **Source Shim**: `tools/emu/web/emu_web.c`  
> **Build Instructions**: `tools/emu/web/build_web.sh`  
> **Binary Artifact**: `dist/CoralFlower.wasm` (609.9 KB, SHA-256: `e9256f6df64af701...`)  

## Overview

Synthesizer firmware for FM-1 with advanced live arpeggiator, MIDI clock pause, USB audio streaming, and high-performance LCD graphics rendering.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `coralflower` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 36 exported WebAssembly functions |
| **Imported Symbols** | `wasi_snapshot_preview1.clock_time_get`, `wasi_snapshot_preview1.environ_get`, `wasi_snapshot_preview1.environ_sizes_get`, `wasi_snapshot_preview1.fd_close`, `wasi_snapshot_preview1.fd_seek`, `wasi_snapshot_preview1.fd_write`, `wasi_snapshot_preview1.proc_exit` |

## Exported Interface Functions

### Runtime

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `emscripten_stack_get_current` | `-> uint32_t` | Get current WebAssembly execution stack pointer |
| `setThrew` | `(uint32_t th, uint32_t val)` | Emscripten exception unwind helper |

### Audio

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_avail` | `-> uint32_t` | Number of completed audio frames ready to be taken |
| `web_out_l` | `-> float*` | Pointer to float32 left audio channel buffer (normalized -1.0 .. 1.0) |
| `web_out_r` | `-> float*` | Pointer to float32 right audio channel buffer (normalized -1.0 .. 1.0) |
| `web_render` | `(uint32_t n)` | Render n stereo frames (up to 1024) into the audio output buffers |

### Lifecycle

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_boot` | `void` | Initialize and power on the virtual synthesizer engine |

### Other

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_btn_id` | `void` | Exported WebAssembly runtime function |
| `web_enc_dir` | `void` | Exported WebAssembly runtime function |
| `web_enc_id` | `void` | Exported WebAssembly runtime function |
| `web_keymap` | `void` | Exported WebAssembly runtime function |

### Input

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_buttons` | `(uint32_t mask)` | Button state bitmask (bits 0..13: FX..REC, OCT-, OCT+) |
| `web_buttons_tap` | `(uint32_t mask)` | Instantaneous button tap trigger mask |
| `web_enc` | `(uint32_t role, int32_t clicks)` | Turn rotary encoder by role with detent step count (+/-) |
| `web_keys` | `(uint32_t mask)` | 27-key keyboard state bitmask (bits 0..26 for notes F3..G5) |
| `web_keys_tap` | `(uint32_t mask)` | Instantaneous keyboard tap trigger mask |
| `web_master` | `(uint32_t level)` | Set MASTER volume level (felucca: 0..1023, x0x: 0..4096) |
| `web_master_get` | `-> uint32_t` | Read current master volume potentiometer value |

### Diagnostics

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_cpu` | `-> uint32_t (%)` | Internal CPU usage estimate in percent |
| `web_dump` | `void` | Dump internal firmware engine state for diagnostics |

### Display

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_fb` | `-> uint16_t*` | Pointer to 240x240 RGB565 framebuffer in panel byte order |
| `web_lcd_writes` | `-> uint32_t` | Number of LCD screen hardware writes committed |

### Storage

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_flash` | `-> uint8_t*` | Pointer to live flash NOR storage buffer |
| `web_flash_dirty` | `-> uint32_t (bool)` | Whether flash memory contains uncommitted changes |
| `web_flash_size` | `-> uint32_t` | Total capacity of virtual flash storage |
| `web_flash_stage` | `-> uint8_t*` | Pointer to flash memory staging buffer |
| `web_flash_stage_len` | `-> uint32_t` | Length of staged flash data |

### LEDs

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_led` | `(uint32_t index, uint32_t state)` | Direct control over button/key LED by index |
| `web_led_dim` | `(uint32_t index, uint32_t level)` | Direct control over dim LED intensity |
| `web_leds` | `-> uint32_t*` | All LED states snapshot buffer |
| `web_play_green` | `-> uint32_t` | Green LED state on the PLAY/STOP key |

### MIDI

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_midi_in` | `(uint32_t status, uint32_t d1, uint32_t d2)` | Send 3-byte MIDI channel message (status, data1, data2) |
| `web_midi_out_take` | `(uint8_t* buf, uint32_t max)` | Extract outgoing MIDI byte messages from queue |

### Timing

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_ms` | `-> uint32_t (ms)` | Get current engine running time in milliseconds |

### Engine

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_step` | `(uint32_t ticks)` | Advance synthesizer simulation step |

### Status

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_version` | `-> char*` | Firmware build version identifier string |

## Imported Host Dependencies

This WebAssembly module requires the host environment (browser AudioWorklet / JS engine) to provide the following imports:

| Import Name | Role |
| :--- | :--- |
| `wasi_snapshot_preview1.clock_time_get` | WASI system call (clock/io) |
| `wasi_snapshot_preview1.environ_get` | WASI system call (clock/io) |
| `wasi_snapshot_preview1.environ_sizes_get` | WASI system call (clock/io) |
| `wasi_snapshot_preview1.fd_close` | WASI system call (clock/io) |
| `wasi_snapshot_preview1.fd_seek` | WASI system call (clock/io) |
| `wasi_snapshot_preview1.fd_write` | WASI system call (clock/io) |
| `wasi_snapshot_preview1.proc_exit` | WASI system call (clock/io) |

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

