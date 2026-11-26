# Firmware Interface Specification: Arctic Scream

> **Repository**: [PolarPatch/Arctic-scream-FM-1](https://github.com/PolarPatch/Arctic-scream-FM-1)  
> **Author**: PolarPatch  
> **License**: GPL-3.0  
> **Interface Family**: `asyncify`  
> **Source Shim**: `firmware/src/fm1_web.c`  
> **Build Instructions**: `web/build_web.sh`  
> **Binary Artifact**: `dist/Arctic-scream-FM-1.wasm` (652.8 KB, SHA-256: `97497dcdca507a94...`)  

## Overview

Glacial noise, harsh industrial textures, and sub-zero drone synthesizer with coroutine execution loop based on GR!MM.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `asyncify` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 42 exported WebAssembly functions |
| **Imported Symbols** | `env.web_ticks`, `env.web_yield` |

## Exported Interface Functions

### Asyncify

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `asyncify_get_state` | `-> uint32_t` | Binaryen Asyncify: query coroutine unwind/rewind state |
| `asyncify_start_rewind` | `(void* data)` | Binaryen Asyncify: restore execution context and rewind stack |
| `asyncify_start_unwind` | `(void* data)` | Binaryen Asyncify: initiate stack unwinding |
| `asyncify_stop_rewind` | `void` | Binaryen Asyncify: complete stack rewinding |
| `asyncify_stop_unwind` | `void` | Binaryen Asyncify: finalize stack unwinding |
| `web_async_buf` | `-> void*` | Pointer to Binaryen Asyncify coroutine call stack buffer |
| `web_async_size` | `-> uint32_t` | Size of Binaryen Asyncify coroutine call stack buffer |

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
| `web_take` | `(uint32_t n)` | Extract n frames of rendered audio from internal ring buffer |
| `web_want_frames` | `-> uint32_t` | Number of audio frames requested by the engine |

### Input

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_buttons` | `(uint32_t mask)` | Button state bitmask (bits 0..13: FX..REC, OCT-, OCT+) |
| `web_enc` | `(uint32_t role, int32_t clicks)` | Turn rotary encoder by role with detent step count (+/-) |
| `web_keys` | `(uint32_t mask)` | 27-key keyboard state bitmask (bits 0..26 for notes F3..G5) |
| `web_master` | `(uint32_t level)` | Set MASTER volume level (felucca: 0..1023, x0x: 0..4096) |

### Status

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_env_text` | `-> char*` | Text readout of envelope settings |
| `web_knob_text` | `(uint32_t knob)` | Text label of selected knob parameter |
| `web_lfo_text` | `-> char*` | Text readout of LFO settings |
| `web_meta` | `-> char*` | Pointer to patch metadata string buffer |
| `web_ready` | `-> uint32_t (bool)` | Whether sound engine initialization is complete |

### Display

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_fb` | `-> uint16_t*` | Pointer to 240x240 RGB565 framebuffer in panel byte order |
| `web_screen_draws` | `-> uint32_t` | Incrementing screen redraw counter (redraw when changed) |

### LEDs

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_lit_buttons` | `-> uint32_t` | Bitmask of fully illuminated button LEDs (bit 14: PLAY green) |
| `web_lit_keys` | `-> uint32_t` | Bitmask of fully illuminated key LEDs (27 keys) |

### MIDI

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_midi` | `(uint32_t status, uint32_t d1, uint32_t d2)` | Send 3-byte MIDI channel message (status, data1, data2) |

### Timing

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_now_ms` | `-> uint32_t (ms)` | Get current firmware running time in milliseconds |

### Diagnostics

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_panic` | `void` | All notes off and sound engine reset |

### Engine

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_run` | `(uint32_t ticks)` | Execute synthesizer coroutine loop for specified tick count |

### Sequencer

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_seq_state` | `-> uint32_t` | Current step sequence playback state and trigger mask |

### Storage

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_settings` | `-> uint8_t*` | Pointer to settings and preset configuration buffer |
| `web_settings_len` | `-> uint32_t` | Byte length of stored settings data |
| `web_settings_set_len` | `(uint32_t len)` | Set byte length of stored settings data |
| `web_settings_writes` | `-> uint32_t` | Counter of committed settings writes |

### SysEx

| Function | Signature / Return | Description |
| :--- | :--- | :--- |
| `web_sysex_busy` | `-> uint32_t (bool)` | Whether SysEx transmission/reception is currently busy |
| `web_sysex_in` | `-> uint8_t*` | Buffer for incoming SysEx command messages |
| `web_sysex_in_buf` | `-> uint8_t*` | Pointer to SysEx input buffer |
| `web_sysex_out_buf` | `-> uint8_t*` | Pointer to SysEx output buffer |
| `web_sysex_out_clear` | `void` | Clear outgoing SysEx buffer |
| `web_sysex_out_len` | `-> uint32_t` | Length of pending outgoing SysEx message |

## Imported Host Dependencies

This WebAssembly module requires the host environment (browser AudioWorklet / JS engine) to provide the following imports:

| Import Name | Role |
| :--- | :--- |
| `env.web_ticks` | Asyncify timer tick counter |
| `env.web_yield` | Asyncify coroutine yield hook (AudioWorklet) |

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

