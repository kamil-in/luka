# FM-1 Firmware Interface Catalog & Specification

This document provides the complete interface documentation for all 35 community firmwares built for the M-VAVE FM-1 pocket synthesizer, detailing their WebAssembly export and import contracts, control schemas, and audio/video interfaces.

## Firmware Summary Matrix (35 Firmwares)

| Firmware | Repository | Style Family | Wasm Size | Exports | Detailed Spec |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FMini-1** | [ruppert/fmini-1](https://github.com/ruppert/fmini-1) | `felucca` | 787.5 KB | 29 | [FMini-1 Interface](docs/fmini-1.md) |
| **Melodee** | [keremimo/melodee](https://github.com/keremimo/melodee) | `melodee` | 1099.5 KB | 15 | [Melodee Interface](docs/melodee.md) |
| **Skiff** | [illuminus5/skiff](https://github.com/illuminus5/skiff) | `felucca` | 1060.6 KB | 32 | [Skiff Interface](docs/skiff.md) |
| **Felucca** | [hugelton/Felucca](https://github.com/hugelton/Felucca) | `felucca (emulated / felucca_web core)` | 787.5 KB | 29 | [Felucca Interface](docs/Felucca.md) |
| **AMB-1** | [charlesvestal/fm1-amb](https://github.com/charlesvestal/fm1-amb) | `x0x` | 115.8 KB | 35 | [AMB-1 Interface](docs/fm1-amb.md) |
| **OberVave** | [zvenson/obervave](https://github.com/zvenson/obervave) | `sim` | 235.1 KB | 28 | [OberVave Interface](docs/obervave.md) |
| **GR!MM** | [GRiMMBIENT/grimm](https://github.com/GRiMMBIENT/grimm) | `asyncify` | 697.3 KB | 41 | [GR!MM Interface](docs/grimm.md) |
| **X0X** | [charlesvestal/fm1-x0x](https://github.com/charlesvestal/fm1-x0x) | `x0x` | 544.2 KB | 34 | [X0X Interface](docs/fm1-x0x.md) |
| **Niagara Drift (OMNI)** | [evanyerburgh/niagara-drift](https://github.com/evanyerburgh/niagara-drift) | `x0x` | 373.0 KB | 30 | [Niagara Drift (OMNI) Interface](docs/niagara-drift.md) |
| **MONK-1** | [charlesvestal/fm1-monk](https://github.com/charlesvestal/fm1-monk) | `x0x` | 254.6 KB | 29 | [MONK-1 Interface](docs/fm1-monk.md) |
| **Loom** | [charlesvestal/fm1-loom](https://github.com/charlesvestal/fm1-loom) | `x0x` | 1115.2 KB | 52 | [Loom Interface](docs/fm1-loom.md) |
| **Mutable Dreams** | [kidbee85-beep/mutable-dreams](https://github.com/kidbee85-beep/mutable-dreams) | `dream` | 836.7 KB | 47 | [Mutable Dreams Interface](docs/mutable-dreams.md) |
| **FRASIL** | [styvesgoupil/frasil](https://github.com/styvesgoupil/frasil) | `frasil` | 668.3 KB | 58 | [FRASIL Interface](docs/frasil.md) |
| **CoralFlower** | [FicusFicusov/CoralFlower](https://github.com/FicusFicusov/CoralFlower) | `coralflower` | 609.9 KB | 36 | [CoralFlower Interface](docs/CoralFlower.md) |
| **S1Vave** | [AndrewGG88/S1Vave](https://github.com/AndrewGG88/S1Vave) | `sim` | 178.9 KB | 28 | [S1Vave Interface](docs/S1Vave.md) |
| **ZEN-1** | [aceyprime/zen-1](https://github.com/aceyprime/zen-1) | `zen` | 635.6 KB | 46 | [ZEN-1 Interface](docs/zen-1.md) |
| **Arctic Scream** | [PolarPatch/Arctic-scream-FM-1](https://github.com/PolarPatch/Arctic-scream-FM-1) | `asyncify` | 652.8 KB | 42 | [Arctic Scream Interface](docs/Arctic-scream-FM-1.md) |
| **FiMba-1** | [jadamsowers/fm1-fimba](https://github.com/jadamsowers/fm1-fimba) | `x0x` | 88.4 KB | 29 | [FiMba-1 Interface](docs/fm1-fimba.md) |
| **Aisling** | [stephencummins/fm1-aisling](https://github.com/stephencummins/fm1-aisling) | `x0x` | 412.6 KB | 33 | [Aisling Interface](docs/fm1-aisling.md) |
| **SATIE-1** | [OCKM-STUDIO/SATIE-1](https://github.com/OCKM-STUDIO/SATIE-1) | `x0x` | 467.2 KB | 23 | [SATIE-1 Interface](docs/SATIE-1.md) |
| **Nachtfahrt** | [FartyPants/fm1-nachtfahrt](https://github.com/FartyPants/fm1-nachtfahrt) | `x0x` | 447.4 KB | 27 | [Nachtfahrt Interface](docs/fm1-nachtfahrt.md) |
| **OG Synth** | [mikejohnsonbeats/OG-Synth-source](https://github.com/mikejohnsonbeats/OG-Synth-source) | `x0x` | 1063.4 KB | 164 | [OG Synth Interface](docs/OG-Synth-source.md) |
| **ATEK 303** | [animatek/FM1-Animatek](https://github.com/animatek/FM1-Animatek) | `x0x` | 131.7 KB | 35 | [ATEK 303 Interface](docs/FM1-Animatek.md) |
| **JIANT** | [juanjiant-bit/JIANT](https://github.com/juanjiant-bit/JIANT) | `felucca` | 1216.3 KB | 68 | [JIANT Interface](docs/JIANT.md) |
| **Golana** | [Gadlele/Golana](https://github.com/Gadlele/Golana) | `felucca` | 501.2 KB | 29 | [Golana Interface](docs/Golana.md) |
| **LOAF BREAKER** | [FLEXOR-R/loaf-breaker](https://github.com/FLEXOR-R/loaf-breaker) | `x0x` | 825.2 KB | 35 | [LOAF BREAKER Interface](docs/loaf-breaker.md) |
| **Blop** | [OSR-Experiment/OSR-1](https://github.com/OSR-Experiment/OSR-1) | `x0x` | 1387.0 KB | 33 | [Blop Interface](docs/OSR-1.md) |
| **JAMTRACK** | [Philip-Bos/jamtrack-fm1](https://github.com/Philip-Bos/jamtrack-fm1) | `x0x` | 563.1 KB | 35 | [JAMTRACK Interface](docs/jamtrack-fm1.md) |
| **PERF-1** | [deamonSLINKY/PERF-1](https://github.com/deamonSLINKY/PERF-1) | `x0x` | 865.5 KB | 65 | [PERF-1 Interface](docs/PERF-1.md) |
| **M-PYRE** | [HistoryOfSky/m-pyre](https://github.com/HistoryOfSky/m-pyre) | `mpyre` | 1162.4 KB | 18 | [M-PYRE Interface](docs/m-pyre.md) |
| **Chimera Vocal** | [shan-sherif/fm-1-chimera-vocal](https://github.com/shan-sherif/fm-1-chimera-vocal) | `x0x` | 382.3 KB | 41 | [Chimera Vocal Interface](docs/fm-1-chimera-vocal.md) |
| **Demake** | [InigoHernandez/demake-synth](https://github.com/InigoHernandez/demake-synth) | `demake` | 625.3 KB | 16 | [Demake Interface](docs/demake-synth.md) |
| **viscera** | [De-Pattern/viscera](https://github.com/De-Pattern/viscera) | `viscera` | 202.9 KB | 51 | [viscera Interface](docs/viscera.md) |
| **SLOOP 3** | [isod89/sloop3-fm1](https://github.com/isod89/sloop3-fm1) | `none (no browser build: installer and editor only)` | N/A | 0 | [SLOOP 3 Interface](docs/sloop3-fm1.md) |
| **JamesOS** | [aarongrando/JamesOS](https://github.com/aarongrando/JamesOS) | `none (no browser build)` | N/A | 0 | [JamesOS Interface](docs/JamesOS.md) |

---

## Interface Families Overview

### 1. The `felucca` Family
* **Firmwares**: FMini-1, Skiff, Felucca, CoralFlower
* **Frame Buffer**: 240x240 RGB565 via `web_screen()` or `web_fb()`, revision checked by `web_screen_draws()` or `web_lcd_writes()`. Byte order matches device SPI panel.
* **Controls**: Buttons and keys via bitmasks (`web_buttons`, `web_keys`, `web_keys_tap`). Encoders by functional role (`web_enc`). Master pot 0..1023 (`web_master`, `web_master_get`).
* **LEDs**: Multi-state masks (`web_lit_*`, `web_dim_*`, `web_breath_*`, `web_anim_levels`, `web_play_green`).
* **Storage**: 1 MiB raw NOR flash image (`web_nor`, `web_nor_size`, `web_flash`, `web_flash_stage`, `web_nor_erase`, `web_flash_writes_count`).

### 2. The `x0x` Family
* **Firmwares**: X0X, AMB-1, Niagara Drift, MONK-1, Loom, Aisling, Nachtfahrt, FiMba-1, SATIE-1, LOAF BREAKER, Blop, JAMTRACK, PERF-1
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

### 9. The `mpyre` Family
* **Firmwares**: M-PYRE
* **Execution**: `emu_init()`, then `emu_render()` returns `emu_block_frames()` interleaved stereo floats; the host calls `emu_ui()` every 16 ms (it returns 1 when the screen was drawn).
* **Frame Buffer**: 240x240 RGB565 at `emu_screen()`, in the panel's byte order.
* **Controls**: `emu_button(label, down)` (FX..REC, OCT-, OCT+), `emu_keys(mask)`, `emu_knob(role, steps)`, `emu_volume(0..4096)`. A press and its release a UI step apart.
* **LEDs**: `emu_led_keys(0|1|2)` (lit, dim, faint) and `emu_led_buttons()`.
* **Samples**: four 0x14000-byte slots loaded through `emu_buffer()` + `emu_slot(k)`, then `emu_reset_tracks()`; the author's page inlines them (Luka carries them as the wasm's `luka.pack` custom section).
* **Storage**: five projects (four SAVE slots, the working one): `emu_proj_get(i)` / `emu_proj_put(i, len)` through `emu_buffer()`, `emu_proj_changed()` counts slot changes.

### 10. The `demake` Family
* **Firmwares**: Demake
* **Execution**: `w_init(seed)`, `w_render()` fills 128 frames of 16-bit stereo at `w_audio()`. MASTER is applied by the host (output gain).
* **Frame Buffer**: `w_frame(ms)` draws 240x240 at 4 bits a pixel; `w_palette()` gives its 16 colours as 0xRRGGBB.
* **Controls**: `w_key(k, down)`, `w_button(label, down)` (FX..REC, OCT-, OCT+), `w_encoder(role, delta)`, `w_midi(s, d1, d2)`.
* **LEDs**: `w_leds()`: 27 keys then 14 buttons, 0..255.
* **Storage**: a 64 KiB store at `w_store()`, given back before `w_init`; `w_store_gen()` counts saves.

### 11. The `viscera` Family
* **Firmwares**: viscera
* **Execution**: `init()`, `render(live)` (128 frames, stereo floats at `output_buffer()`; a live input at `input_buffer()`). MASTER is the host's (output gain).
* **Controls**: `control(keys, buttons, enc0..enc6, ms)`: the whole panel at once (buttons OCT- OCT+ FX..REC; encoders SELECT, ALGORITHM, KNOB 1-4, PRESETS as deltas), called every 50 ms too. It returns the host's requests (1 keep a project, 2 give one back; the slot in `host_arg()`).
* **Frame Buffer**: `paint(ms)`, then 240x240 RGB565 at `screen()`, host byte order. **LEDs**: `leds()`: 14 buttons then 27 keys (2 lit, 1 glow).
* **Storage**: its settings (`device()`, `device_changed()`) and projects in eight slots the host keeps (`project()`, `project_seal`, `project_check`).

