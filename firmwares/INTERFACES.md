# FM-1 Firmware Interface Catalog & Specification

This document provides the complete interface documentation for all 21 community firmwares built for the M-VAVE FM-1 pocket synthesizer, detailing their WebAssembly export and import contracts, control schemas, and audio/video interfaces.

## Firmware Summary Matrix (21 Firmwares)

| Firmware | Repository | Style Family | Wasm Size | Exports | Detailed Spec |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FMini-1** | [ruppert/fmini-1](https://github.com/ruppert/fmini-1) | `felucca` | 786.4 KB | 29 | [FMini-1 Interface](docs/fmini-1.md) |
| **Melodee** | [keremimo/melodee](https://github.com/keremimo/melodee) | `melodee` | 1008.0 KB | 15 | [Melodee Interface](docs/melodee.md) |
| **Skiff** | [illuminus5/skiff](https://github.com/illuminus5/skiff) | `felucca` | 1058.9 KB | 32 | [Skiff Interface](docs/skiff.md) |
| **Felucca** | [hugelton/Felucca](https://github.com/hugelton/Felucca) | `felucca (emulated / felucca_web core)` | 786.4 KB | 29 | [Felucca Interface](docs/Felucca.md) |
| **AMB-1** | [charlesvestal/fm1-amb](https://github.com/charlesvestal/fm1-amb) | `x0x` | 115.8 KB | 35 | [AMB-1 Interface](docs/fm1-amb.md) |
| **OberVave** | [zvenson/obervave](https://github.com/zvenson/obervave) | `sim` | 235.1 KB | 28 | [OberVave Interface](docs/obervave.md) |
| **GR!MM** | [GRiMMBIENT/grimm](https://github.com/GRiMMBIENT/grimm) | `asyncify` | 697.3 KB | 41 | [GR!MM Interface](docs/grimm.md) |
| **X0X** | [charlesvestal/fm1-x0x](https://github.com/charlesvestal/fm1-x0x) | `x0x` | 533.0 KB | 34 | [X0X Interface](docs/fm1-x0x.md) |
| **Niagara Drift (OMNI)** | [evanyerburgh/niagara-drift](https://github.com/evanyerburgh/niagara-drift) | `x0x` | 366.5 KB | 30 | [Niagara Drift (OMNI) Interface](docs/niagara-drift.md) |
| **MONK-1** | [charlesvestal/fm1-monk](https://github.com/charlesvestal/fm1-monk) | `x0x` | 254.6 KB | 29 | [MONK-1 Interface](docs/fm1-monk.md) |
| **Loom** | [charlesvestal/fm1-loom](https://github.com/charlesvestal/fm1-loom) | `x0x` | 1095.3 KB | 35 | [Loom Interface](docs/fm1-loom.md) |
| **Mutable Dreams** | [kidbee85-beep/mutable-dreams](https://github.com/kidbee85-beep/mutable-dreams) | `dream` | 836.7 KB | 47 | [Mutable Dreams Interface](docs/mutable-dreams.md) |
| **FRASIL** | [styvesgoupil/frasil](https://github.com/styvesgoupil/frasil) | `frasil` | 603.2 KB | 55 | [FRASIL Interface](docs/frasil.md) |
| **CoralFlower** | [FicusFicusov/CoralFlower](https://github.com/FicusFicusov/CoralFlower) | `coralflower` | 609.9 KB | 36 | [CoralFlower Interface](docs/CoralFlower.md) |
| **S1Vave** | [AndrewGG88/S1Vave](https://github.com/AndrewGG88/S1Vave) | `sim` | 178.9 KB | 28 | [S1Vave Interface](docs/S1Vave.md) |
| **ZEN-1** | [aceyprime/zen-1](https://github.com/aceyprime/zen-1) | `zen` | 635.6 KB | 46 | [ZEN-1 Interface](docs/zen-1.md) |
| **Arctic Scream** | [PolarPatch/Arctic-scream-FM-1](https://github.com/PolarPatch/Arctic-scream-FM-1) | `asyncify` | 458.3 KB | 42 | [Arctic Scream Interface](docs/Arctic-scream-FM-1.md) |
| **FiMba-1** | [jadamsowers/fm1-fimba](https://github.com/jadamsowers/fm1-fimba) | `x0x` | 88.4 KB | 29 | [FiMba-1 Interface](docs/fm1-fimba.md) |
| **Aisling** | [stephencummins/fm1-aisling](https://github.com/stephencummins/fm1-aisling) | `x0x` | 351.8 KB | 33 | [Aisling Interface](docs/fm1-aisling.md) |
| **SATIE-1** | [OCKM-STUDIO/SATIE-1](https://github.com/OCKM-STUDIO/SATIE-1) | `x0x` | 467.2 KB | 23 | [SATIE-1 Interface](docs/SATIE-1.md) |
| **Nachtfahrt** | [FartyPants/fm1-nachtfahrt](https://github.com/FartyPants/fm1-nachtfahrt) | `x0x` | 447.1 KB | 27 | [Nachtfahrt Interface](docs/fm1-nachtfahrt.md) |
| **OG Synth** | [mikejohnsonbeats/OG-Synth-source](https://github.com/mikejohnsonbeats/OG-Synth-source) | `x0x` | 990.6 KB | 116 | [OG Synth Interface](docs/OG-Synth-source.md) |
| **ATEK 303** | [animatek/FM1-Animatek](https://github.com/animatek/FM1-Animatek) | `x0x` | 116.6 KB | 35 | [ATEK 303 Interface](docs/FM1-Animatek.md) |
| **JIANT** | [juanjiant-bit/JIANT](https://github.com/juanjiant-bit/JIANT) | `felucca` | 1195.1 KB | 56 | [JIANT Interface](docs/JIANT.md) |
| **Golana** | [Gadlele/Golana](https://github.com/Gadlele/Golana) | `felucca` | 501.2 KB | 29 | [Golana Interface](docs/Golana.md) |

---

## Interface Families Overview

### 1. The `felucca` Family
* **Firmwares**: FMini-1, Skiff, Felucca, CoralFlower
* **Frame Buffer**: 240x240 RGB565 via `web_screen()` or `web_fb()`, revision checked by `web_screen_draws()` or `web_lcd_writes()`. Byte order matches device SPI panel.
* **Controls**: Buttons and keys via bitmasks (`web_buttons`, `web_keys`, `web_keys_tap`). Encoders by functional role (`web_enc`). Master pot 0..1023 (`web_master`, `web_master_get`).
* **LEDs**: Multi-state masks (`web_lit_*`, `web_dim_*`, `web_breath_*`, `web_anim_levels`, `web_play_green`).
* **Storage**: 1 MiB raw NOR flash image (`web_nor`, `web_nor_size`, `web_flash`, `web_flash_stage`, `web_nor_erase`, `web_flash_writes_count`).

### 2. The `x0x` Family
* **Firmwares**: X0X, AMB-1, Niagara Drift, MONK-1, Loom, Aisling, Nachtfahrt, FiMba-1, SATIE-1
* **Frame Buffer**: 240x240 RGB565 via `web_fb()`, tracked by `web_blits()`. Byte order matches device SPI panel.
* **Controls**: Buttons/keys bitmasks; MONK-1 features per-key strike velocity via `web_key(id, vel, at)`. Master pot scaled 0..4096.
* **Storage**: Named object slots (`web_store`, `web_store_len`, `web_store_set_len`, `web_nobj`, `web_store_max`).
* **Speech / Accessibility**: Built-in speech announcer buffers (`web_said_buf`, `web_said_len`, `web_said_clear`, `web_sysex`).
* **Sample Breaks (X0X)**: 22050 Hz 16-bit PCM IMA-ADPCM upload engine (`web_slot_pcm`, `web_slot_zone`).

### 3. The `dream` Family (Braids / Plaits Port)
* **Firmwares**: Mutable Dreams
* **Sound Engines**: Over 50 synthesis models ported from Mutable Instruments Eurorack modules.
* **Controls**: Macro-oscillator navigation via `dream_page`, `dream_track`, `dream_value`, `dream_knob`, and `dream_raw_knob`.
* **Patch Architecture**: Dedicated dream patch system with `dream_patch_data`, `dream_patch_size`, `dream_patch_buffer`, and `dream_bank_browser`.

### 4. The `frasil` Family (Drone / River)
* **Firmwares**: FRASIL
* **Engine Scope**: Ambient frozen drone textures, shimmer reverb, and GLINT FM bells.
* **River Integration**: Web scene shard loading and streaming via `web_scene_buf`, `web_scene_size`, `web_lead_buf`, `web_scene_play`, and `web_scene_take`.
* **Drone Controls**: Latched voices and hold mode with `web_latch`, `web_clear`, `web_hold`, and drone sequencer `web_dseq_buf`.

### 5. The `zen` Family (Microtonal / Traditional Instruments)
* **Firmwares**: ZEN-1
* **Models**: Koto, Shakuhachi, Erhu traditional acoustic modeling with ornament articulation (`web_ornament`).
* **Microtonal Tuning**: Cents-accurate key offsets and pitch bending (`web_key_cents`, `web_bend`, `web_bend_cents`).
* **Preset Architecture**: Factory and user patch banks with bilingual metadata (`web_patch_get`, `web_patch_ja`, `web_custom`).

### 6. The `sim` Family
* **Firmwares**: OberVave, S1Vave
* **Execution**: Compiled with Zig freestanding C toolchain + Binaryen Asyncify.
* **Functions**: Fully namespaced `sim_*` prefix (`sim_init`, `sim_render`, `sim_fb`, `sim_fb_hash`, `sim_button`, `sim_key`, `sim_enc`, `sim_master`, `sim_midi`).
* **Storage**: Direct state snapshot blob (`sim_blob`, `sim_blob_size`, `sim_store_hash`).

### 7. The `asyncify` Family
* **Firmwares**: GR!MM, Arctic Scream
* **Execution**: Emscripten + Binaryen Asyncify coroutine loop (`env.web_yield`, `env.web_ticks`).
* **Audio Scheduling**: `web_run(ticks)` steps coroutine; `web_take(frames)` pulls synthesized audio.
* **Diagnostics & Metadata**: `web_meta`, `web_knob_text`, `web_env_text`, `web_lfo_text`, `web_panic`.

### 8. The `melodee` Family
* **Firmwares**: Melodee
* **Frame Buffer**: `web_fb()`, revision tracked by `web_fb_gen()`. Visual custom UI rendering.
* **Controls**: `web_buttons`, `web_keys`, `web_encoder`, `web_master`, `web_midi_in`.
* **LEDs**: Distinct `web_led_buttons` and `web_led_keys` masks.

