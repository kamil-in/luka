# Firmware Interface Specification: JamesOS

> **Repository**: [aarongrando/JamesOS](https://github.com/aarongrando/JamesOS)  
> **Author**: Aaron Grando  
> **License**: GPL-3.0  
> **Interface Family**: `none (no browser build)`  
> **Source Shim**: `-`  
> **Build Instructions**: `- (device firmware only)`  
> **Binary Artifact**: `dist/JamesOS.wasm` (0.0 KB, SHA-256: `...`)  

## Overview

A groovebox with three synth tracks, four drum lanes, 24 Plaits engines and a 64-step sequencer. Published as a device firmware and an editor only, so Luka cannot play it yet.

## Architectural Summary

| Attribute | Details |
| :--- | :--- |
| **Interface Family** | `none (no browser build)` |
| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |
| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |
| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |
| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |
| **Exported Functions** | 0 exported WebAssembly functions |
| **Imported Symbols** | None (self-contained) |

## Exported Interface Functions

*Build pending. Run the build script to generate `JamesOS.wasm`.*

## Integration with FM-1 Adapter Player

To play this native build in the web client, `ui/web/native-worklet.js` interfaces with these exports:
1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.
2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.
3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.
4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.

