# FM-1 Community Firmwares Automation & Interface Documentation

This directory contains the automated single-click tooling to clone, update, build, and document all 35 community firmwares for the M-VAVE FM-1 pocket synthesizer.

## Single-Click Execution

You can run the entire workflow in **one click**:

1. **Option 1 (Windows Explorer Double-Click)**:
   Double-click `build-all.cmd`. This automatically runs the PowerShell script with `-ExecutionPolicy Bypass` and keeps the terminal window open to display the results.

2. **Option 2 (PowerShell)**:
   Open a terminal in `/firmwares` and run:
   ```powershell
   .\build-firmwares.ps1
   ```

### What the Script Does Automatically

1. **Clones & Updates**: Loops through all 35 community repositories, clones any missing ones, fetches every branch (some builds come from `gh-pages`), switches to each repository's own default branch and fast-forwards it.
2. **Generates / Retrieves Native Web WASM**:
   - Executes repo build instructions if compilation tools (`emcc`, `clang`, `wasi-sdk`, `zig`) are installed on the host.
   - Reliably extracts and verifies the official native web WebAssembly artifact produced by the repo's instructions (from repository paths, build branches, or release artifacts).
   - Places all 33 output WASM binaries in `firmwares/dist/`.
3. **Generates Full Interface Documentation**:
   - Dynamically reflects exported and imported WebAssembly functions from each binary.
   - Generates individual specification documents in `firmwares/docs/<firmware>.md`.
   - Generates the master catalog in `firmwares/INTERFACES.md`.
   - Generates the machine-readable metadata index in `firmwares/dist/manifest.json`.

---

## Repositories Covered (35 Firmwares)

| Firmware | Repository | Branch | Interface Style |
| :--- | :--- | :--- | :--- |
| **FMini-1** | [ruppert/fmini-1](https://github.com/ruppert/fmini-1) | `main` | `felucca` |
| **Melodee** | [keremimo/melodee](https://github.com/keremimo/melodee) | `main` | `melodee` |
| **Skiff** | [illuminus5/skiff](https://github.com/illuminus5/skiff) | `main` | `felucca` |
| **Felucca** | [hugelton/Felucca](https://github.com/hugelton/Felucca) | `main` | `felucca` |
| **AMB-1** | [charlesvestal/fm1-amb](https://github.com/charlesvestal/fm1-amb) | `main` | `x0x` |
| **OberVave** | [zvenson/obervave](https://github.com/zvenson/obervave) | `main` | `sim` |
| **GR!MM** | [GRiMMBIENT/grimm](https://github.com/GRiMMBIENT/grimm) | `main` | `asyncify` |
| **X0X** | [charlesvestal/fm1-x0x](https://github.com/charlesvestal/fm1-x0x) | `main` | `x0x` |
| **Niagara Drift** | [evanyerburgh/niagara-drift](https://github.com/evanyerburgh/niagara-drift) | `main` | `x0x` |
| **MONK-1** | [charlesvestal/fm1-monk](https://github.com/charlesvestal/fm1-monk) | `main` | `x0x` |
| **Loom** | [charlesvestal/fm1-loom](https://github.com/charlesvestal/fm1-loom) | `main` | `x0x` |
| **Mutable Dreams** | [kidbee85-beep/mutable-dreams](https://github.com/kidbee85-beep/mutable-dreams) | `main` | `dream` |
| **FRASIL** | [styvesgoupil/frasil](https://github.com/styvesgoupil/frasil) | `main` | `frasil` |
| **CoralFlower** | [FicusFicusov/CoralFlower](https://github.com/FicusFicusov/CoralFlower) | `main` | `coralflower` |
| **S1Vave** | [AndrewGG88/S1Vave](https://github.com/AndrewGG88/S1Vave) | `master` | `sim` |
| **ZEN-1** | [aceyprime/zen-1](https://github.com/aceyprime/zen-1) | `main` | `zen` |
| **Arctic Scream** | [PolarPatch/Arctic-scream-FM-1](https://github.com/PolarPatch/Arctic-scream-FM-1) | `main` | `asyncify` |
| **FiMba-1** | [jadamsowers/fm1-fimba](https://github.com/jadamsowers/fm1-fimba) | `main` | `x0x` |
| **Aisling** | [stephencummins/fm1-aisling](https://github.com/stephencummins/fm1-aisling) | `main` | `x0x` |
| **SATIE-1** | [OCKM-STUDIO/SATIE-1](https://github.com/OCKM-STUDIO/SATIE-1) | `main` | `x0x` |
| **Nachtfahrt** | [FartyPants/fm1-nachtfahrt](https://github.com/FartyPants/fm1-nachtfahrt) | `main` | `x0x` |
| **OG Synth** | [mikejohnsonbeats/OG-Synth-source](https://github.com/mikejohnsonbeats/OG-Synth-source) | `main` | `x0x` |
| **ATEK 303** | [animatek/FM1-Animatek](https://github.com/animatek/FM1-Animatek) | `main` | `x0x` |
| **JIANT** | [juanjiant-bit/JIANT](https://github.com/juanjiant-bit/JIANT) | `main` | `felucca` |
| **Golana** | [Gadlele/Golana](https://github.com/Gadlele/Golana) | `main` | `felucca` |
| **LOAF BREAKER** | [FLEXOR-R/loaf-breaker](https://github.com/FLEXOR-R/loaf-breaker) | `loaf` | `x0x` |
| **Blop** | [OSR-Experiment/OSR-1](https://github.com/OSR-Experiment/OSR-1) | `main` | `x0x` |
| **JAMTRACK** | [Philip-Bos/jamtrack-fm1](https://github.com/Philip-Bos/jamtrack-fm1) | `main` | `x0x` |
| **PERF-1** | [deamonSLINKY/PERF-1](https://github.com/deamonSLINKY/PERF-1) | `main` | `x0x` |
| **M-PYRE** | [HistoryOfSky/m-pyre](https://github.com/HistoryOfSky/m-pyre) | `main` | `mpyre` |
| **Chimera Vocal** | [shan-sherif/fm-1-chimera-vocal](https://github.com/shan-sherif/fm-1-chimera-vocal) | `main` | `x0x` |
| **Demake** | [InigoHernandez/demake-synth](https://github.com/InigoHernandez/demake-synth) | `main` | `demake` |
| **viscera** | [De-Pattern/viscera](https://github.com/De-Pattern/viscera) | `main` | `viscera` |
| **SLOOP 3** | [isod89/sloop3-fm1](https://github.com/isod89/sloop3-fm1) | `main` | none (no browser build) |
| **JamesOS** | [aarongrando/JamesOS](https://github.com/aarongrando/JamesOS) | `main` | none (no browser build) |

---

## Directory Structure

```
firmwares/
├── build-all.cmd                 # Double-clickable Windows launcher
├── build-firmwares.ps1           # Main PowerShell automation script
├── extract-artifacts.mjs         # Verified WASM artifact extraction & retrieval
├── generate-interface-docs.mjs   # WebAssembly reflection & markdown generator
├── INTERFACES.md                 # Master interface specification and comparison catalog (35 firmwares)
├── README.md                     # This documentation
├── docs/                         # Detailed interface specifications for all 35 firmwares
│   ├── Arctic-scream-FM-1.md
│   ├── CoralFlower.md
│   ├── Felucca.md
│   ├── fm1-aisling.md
│   ├── fm1-amb.md
│   ├── fm1-fimba.md
│   ├── fm1-loom.md
│   ├── fm1-monk.md
│   ├── fm1-nachtfahrt.md
│   ├── fm1-x0x.md
│   ├── fmini-1.md
│   ├── frasil.md
│   ├── grimm.md
│   ├── melodee.md
│   ├── mutable-dreams.md
│   ├── niagara-drift.md
│   ├── obervave.md
│   ├── S1Vave.md
│   ├── SATIE-1.md
│   ├── skiff.md
│   └── zen-1.md
├── dist/                         # Web native WASM binaries & machine-readable manifest
│   ├── *.wasm (33 binaries)
│   └── manifest.json
└── [cloned repositories: 21 firmware source repos]
```
