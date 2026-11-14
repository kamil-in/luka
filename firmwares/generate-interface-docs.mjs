// Node.js script to inspect web native WASM builds in firmwares/dist/
// and generate comprehensive interface documentation and manifest.json.
//
// Usage: node generate-interface-docs.mjs

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const docsDir = join(root, 'docs');
mkdirSync(dist, { recursive: true });
mkdirSync(docsDir, { recursive: true });

const FIRMWARES = [
  // Original 11 community firmwares
  {
    id: 'fmini-1',
    name: 'FMini-1',
    repo: 'ruppert/fmini-1',
    url: 'https://github.com/ruppert/fmini-1',
    author: 'Leo Kuroshita (@kurogedelic), Hügelton Instruments',
    license: 'GPL-3.0',
    style: 'felucca',
    description: 'Compact 4-track groovebox firmware for FM-1 and SMK-37 with DX7 FM, physical modeling, drums, and sequencer.',
    sourceShim: 'web/emu/felucca_web.c',
    buildScript: 'web/emu/build.sh / web/emu/build_wasi.sh',
    compiler: 'Emscripten (emcc) or WASI-SDK (clang)',
  },
  {
    id: 'melodee',
    name: 'Melodee',
    repo: 'keremimo/melodee',
    url: 'https://github.com/keremimo/melodee',
    author: 'Kerem Kilic (@keremimo)',
    license: 'GPL-3.0',
    style: 'melodee',
    description: 'FM-1 melodic synth/sequencer firmware with custom sound engine, 909 drums, scale quantizer, and visual UI.',
    sourceShim: 'web/emu/melodee_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'skiff',
    name: 'Skiff',
    repo: 'illuminus5/skiff',
    url: 'https://github.com/illuminus5/skiff',
    author: 'illuminus5',
    license: 'GPL-3.0',
    style: 'felucca',
    description: 'Modular synthesizer and patch environment firmware based on Felucca with Skiff Studio web editor integration.',
    sourceShim: 'web/emu/felucca_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'Felucca',
    name: 'Felucca',
    repo: 'hugelton/Felucca',
    url: 'https://github.com/hugelton/Felucca',
    author: 'Hügelton Instruments',
    license: 'GPL-3.0',
    style: 'felucca (emulated / felucca_web core)',
    description: 'The foundation 4-track polyphonic FM/Physical Modeling synthesizer firmware for the M-VAVE FM-1.',
    sourceShim: 'web/emu/felucca_web.c (via fmini-1 -DFELUCCA_FMINI_ONLY=0)',
    buildScript: 'tools/build.py (firmware); web via felucca_web.c',
    compiler: 'JieLi toolchain (pi32v2) for device; Emscripten for web core',
  },
  {
    id: 'fm1-amb',
    name: 'AMB-1',
    repo: 'charlesvestal/fm1-amb',
    url: 'https://github.com/charlesvestal/fm1-amb',
    author: 'Charles Vestal',
    license: 'MPL-2.0',
    style: 'x0x',
    description: 'Ambient generative soundscape synth with speech feedback, drone voices, and generative modulators.',
    sourceShim: 'web/app/amb_api.c',
    buildScript: 'web/app/build.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'obervave',
    name: 'OberVave',
    repo: 'zvenson/obervave',
    url: 'https://github.com/zvenson/obervave',
    author: 'Zvenson',
    license: 'GPL-3.0',
    style: 'sim',
    description: 'Oberheim-inspired analog modeling synth with coroutine main loop, multi-mode filter, and web simulation harness.',
    sourceShim: 'web/sim/sim.c',
    buildScript: 'web/sim/build.sh',
    compiler: 'Zig cc (wasm32-freestanding) + wasm-opt (Binaryen Asyncify)',
  },
  {
    id: 'grimm',
    name: 'GR!MM',
    repo: 'GRiMMBIENT/grimm',
    url: 'https://github.com/GRiMMBIENT/grimm',
    author: 'GRiMMBIENT',
    license: 'GPL-3.0',
    style: 'asyncify',
    description: 'Dark ambient synthesizer and sequencer with coroutine task yielding, speech synthesis, and deep modulation.',
    sourceShim: 'firmware/src/fm1_web.c',
    buildScript: 'web/build_web.sh',
    compiler: 'Emscripten (emcc) + wasm-opt (Binaryen Asyncify)',
  },
  {
    id: 'fm1-x0x',
    name: 'X0X',
    repo: 'charlesvestal/fm1-x0x',
    url: 'https://github.com/charlesvestal/fm1-x0x',
    author: 'Charles Vestal',
    license: 'GPL-3.0',
    style: 'x0x',
    description: 'Classic 303 bass synth, 808/909 drum machines, breakbeats, speech announcer, and TB-3PO algorithmic sequencer.',
    sourceShim: 'web/emu/x0x_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'niagara-drift',
    name: 'Niagara Drift (OMNI)',
    repo: 'evanyerburgh/niagara-drift',
    url: 'https://github.com/evanyerburgh/niagara-drift',
    author: 'Evan Yerburgh',
    license: 'GPL-3.0',
    style: 'x0x',
    description: 'Generative drone and ambient sound generator with multilevel LED monitoring and continuous timbre morphing.',
    sourceShim: 'web/emu/omni_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'fm1-monk',
    name: 'MONK-1',
    repo: 'charlesvestal/fm1-monk',
    url: 'https://github.com/charlesvestal/fm1-monk',
    author: 'Charles Vestal',
    license: 'GPL-3.0',
    style: 'x0x',
    description: 'Monophonic performance synth with per-key strike velocity sensing, aftertouch emulation, and speech readout.',
    sourceShim: 'web/emu/monk_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },

  // Additional 11 community firmwares
  {
    id: 'fm1-loom',
    name: 'Loom',
    repo: 'charlesvestal/fm1-loom',
    url: 'https://github.com/charlesvestal/fm1-loom',
    author: 'Charles Vestal',
    license: 'GPL-3.0',
    style: 'x0x',
    description: 'Loom generative patch weaver and algorithmic pattern synthesizer for FM-1 with polyphonic voice weaving and speech announcer.',
    sourceShim: 'web/emu/loom_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'mutable-dreams',
    name: 'Mutable Dreams',
    repo: 'kidbee85-beep/mutable-dreams',
    url: 'https://github.com/kidbee85-beep/mutable-dreams',
    author: 'Henri David / kidbee85',
    license: 'GPL-3.0 / MPL-2.0',
    style: 'dream',
    description: 'Mutable Instruments Braids and Plaits macro-oscillator models ported to FM-1, featuring 50+ synthesis engines, dream patch banks, and real-time voice morphing.',
    sourceShim: 'base/web/emu/emu_web.c',
    buildScript: 'tools/build.py (firmware); web emulator in HTML/WASM',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'frasil',
    name: 'FRASIL',
    repo: 'styvesgoupil/frasil',
    url: 'https://github.com/styvesgoupil/frasil',
    author: 'Styves Goupil',
    license: 'MPL-2.0 / GPL-3.0',
    style: 'frasil',
    description: 'Drone textures frozen in motion: ambient drone synthesizer with shimmer reverb, freeze, GLINT FM bells, and River community web engine.',
    sourceShim: 'app/web.c / base/web/emu/emu_web.c',
    buildScript: 'build.sh / web AudioWorklet',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'CoralFlower',
    name: 'CoralFlower',
    repo: 'FicusFicusov/CoralFlower',
    url: 'https://github.com/FicusFicusov/CoralFlower',
    author: 'FicusFicusov',
    license: 'GPL-3.0',
    style: 'coralflower',
    description: 'Synthesizer firmware for FM-1 with advanced live arpeggiator, MIDI clock pause, USB audio streaming, and high-performance LCD graphics rendering.',
    sourceShim: 'tools/emu/web/emu_web.c',
    buildScript: 'tools/emu/web/build_web.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'S1Vave',
    name: 'S1Vave',
    repo: 'AndrewGG88/S1Vave',
    url: 'https://github.com/AndrewGG88/S1Vave',
    author: 'AndrewGG88',
    license: 'GPL-3.0',
    style: 'sim',
    description: 'Sequential Circuits Prophet-style polyphonic analog synthesizer emulation with web simulation harness and asyncify coroutine loop.',
    sourceShim: 'web/sim/sim.c',
    buildScript: 'web/sim/build.sh',
    compiler: 'Zig cc (wasm32-freestanding) + wasm-opt (Binaryen Asyncify)',
  },
  {
    id: 'zen-1',
    name: 'ZEN-1',
    repo: 'aceyprime/zen-1',
    url: 'https://github.com/aceyprime/zen-1',
    author: 'aceyprime',
    license: 'GPL-3.0',
    style: 'zen',
    description: 'East-Asian traditional and microtonal instrument emulation firmware (koto, shakuhachi, erhu) with ornament articulation and microtonal cents pitch bending.',
    sourceShim: 'web/emu/zen1_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'Arctic-scream-FM-1',
    name: 'Arctic Scream',
    repo: 'PolarPatch/Arctic-scream-FM-1',
    url: 'https://github.com/PolarPatch/Arctic-scream-FM-1',
    author: 'PolarPatch',
    license: 'GPL-3.0',
    style: 'asyncify',
    description: 'Glacial noise, harsh industrial textures, and sub-zero drone synthesizer with coroutine execution loop based on GR!MM.',
    sourceShim: 'firmware/src/fm1_web.c',
    buildScript: 'web/build_web.sh',
    compiler: 'Emscripten (emcc) + wasm-opt (Binaryen Asyncify)',
  },
  {
    id: 'fm1-fimba',
    name: 'FiMba-1',
    repo: 'jadamsowers/fm1-fimba',
    url: 'https://github.com/jadamsowers/fm1-fimba',
    author: 'J. Adam Sowers',
    license: 'GPL-3.0',
    style: 'x0x',
    description: 'Electric kalimba and mbira physical modeling instrument with wah filter, hall reverb, and standalone web player.',
    sourceShim: 'web/emu/kalimba_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'fm1-aisling',
    name: 'Aisling',
    repo: 'stephencummins/fm1-aisling',
    url: 'https://github.com/stephencummins/fm1-aisling',
    author: 'Stephen Cummins',
    license: 'GPL-3.0',
    style: 'x0x',
    description: 'Celtic dream-harp and ethereal generative acoustic soundscapes with piece composition selector and MIDI tracking.',
    sourceShim: 'web/emu/amb_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'SATIE-1',
    name: 'SATIE-1',
    repo: 'OCKM-STUDIO/SATIE-1',
    url: 'https://github.com/OCKM-STUDIO/SATIE-1',
    author: 'OCKM STUDIO',
    license: 'GPL-3.0',
    style: 'x0x',
    description: 'Erik Satie inspired minimalist piano, ambient tone generator, and generative Gymnopédies engine with pseudo-random seed control.',
    sourceShim: 'web/emu/amb_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },
  {
    id: 'fm1-nachtfahrt',
    name: 'Nachtfahrt',
    repo: 'FartyPants/fm1-nachtfahrt',
    url: 'https://github.com/FartyPants/fm1-nachtfahrt',
    author: 'FartyPants',
    license: 'GPL-3.0',
    style: 'x0x',
    description: 'Nocturnal autobahn drive synth, Berlin-school sequencer, motorik basslines, and dark cinematic synthesizer.',
    sourceShim: 'web/emu/amb_web.c',
    buildScript: 'web/emu/build.sh',
    compiler: 'Emscripten (emcc)',
  },
];

// Well-known function descriptors
const FUNCTION_SPECS = {
  // Common lifecycle / audio
  web_boot: { category: 'Lifecycle', desc: 'Initialize and power on the virtual synthesizer engine' },
  web_render: { category: 'Audio', desc: 'Render n stereo frames (up to 1024) into the audio output buffers', params: 'uint32_t n' },
  web_out_l: { category: 'Audio', desc: 'Pointer to float32 left audio channel buffer (normalized -1.0 .. 1.0)', returns: 'float*' },
  web_out_r: { category: 'Audio', desc: 'Pointer to float32 right audio channel buffer (normalized -1.0 .. 1.0)', returns: 'float*' },
  web_now: { category: 'Timing', desc: 'Get current firmware running time in milliseconds', returns: 'uint32_t (ms)' },
  web_now_ms: { category: 'Timing', desc: 'Get current firmware running time in milliseconds', returns: 'uint32_t (ms)' },
  web_sample_rate: { category: 'Audio', desc: 'Nominal output sample rate in Hz (44100 Hz)', returns: 'uint32_t' },
  web_cpu: { category: 'Diagnostics', desc: 'Internal CPU usage estimate in percent', returns: 'uint32_t (%)' },
  web_playing: { category: 'Status', desc: 'Whether sequencer/song playback is currently running', returns: 'uint32_t (bool)' },
  web_frames: { category: 'Audio', desc: 'Internal audio quantum block size in frames', returns: 'uint32_t' },
  web_out_n: { category: 'Audio', desc: 'Render audio frames into packet buffer', params: 'uint32_t n', returns: 'uint32_t' },
  web_out_pkts: { category: 'Audio', desc: 'Pointer to rendered audio packet ring buffer', returns: 'uint8_t*' },
  web_out_clear: { category: 'Audio', desc: 'Clear audio packet ring buffer' },

  // Video / Screen
  web_screen: { category: 'Display', desc: 'Pointer to 240x240 RGB565 framebuffer in panel byte order', returns: 'uint16_t*' },
  web_fb: { category: 'Display', desc: 'Pointer to 240x240 RGB565 framebuffer in panel byte order', returns: 'uint16_t*' },
  web_screen_draws: { category: 'Display', desc: 'Incrementing screen redraw counter (redraw when changed)', returns: 'uint32_t' },
  web_blits: { category: 'Display', desc: 'Incrementing screen blit/draw counter (redraw when changed)', returns: 'uint32_t' },
  web_fb_gen: { category: 'Display', desc: 'Framebuffer generation counter', returns: 'uint32_t' },
  web_bg: { category: 'Display', desc: 'Set background color / display theme', params: 'uint32_t rgb' },

  // Input
  web_buttons: { category: 'Input', desc: 'Button state bitmask (bits 0..13: FX..REC, OCT-, OCT+)', params: 'uint32_t mask' },
  web_keys: { category: 'Input', desc: '27-key keyboard state bitmask (bits 0..26 for notes F3..G5)', params: 'uint32_t mask' },
  web_key: { category: 'Input', desc: 'Single key event with velocity and arrival timestamp (MONK-1)', params: 'uint32_t key, uint32_t vel, uint32_t at' },
  web_key_vel: { category: 'Input', desc: 'Set velocity for key strikes', params: 'uint32_t key, uint32_t vel' },
  web_key_at: { category: 'Input', desc: 'Get/set key arrival timestamp', params: 'uint32_t key, uint32_t ms' },
  web_touch: { category: 'Input', desc: 'Set aftertouch pressure for held keys', params: 'uint32_t pressure' },
  web_enc: { category: 'Input', desc: 'Turn rotary encoder by role with detent step count (+/-)', params: 'uint32_t role, int32_t clicks' },
  web_encoder: { category: 'Input', desc: 'Turn rotary encoder by index with step count (+/-)', params: 'uint32_t enc, int32_t clicks' },
  web_master: { category: 'Input', desc: 'Set MASTER volume level (felucca: 0..1023, x0x: 0..4096)', params: 'uint32_t level' },
  web_master_get: { category: 'Input', desc: 'Read current master volume potentiometer value', returns: 'uint32_t' },
  web_keys_tap: { category: 'Input', desc: 'Instantaneous keyboard tap trigger mask', params: 'uint32_t mask' },
  web_buttons_tap: { category: 'Input', desc: 'Instantaneous button tap trigger mask', params: 'uint32_t mask' },
  web_midi: { category: 'MIDI', desc: 'Send 3-byte MIDI channel message (status, data1, data2)', params: 'uint32_t status, uint32_t d1, uint32_t d2' },
  web_midi_in: { category: 'MIDI', desc: 'Send 3-byte MIDI channel message (status, data1, data2)', params: 'uint32_t status, uint32_t d1, uint32_t d2' },
  web_midi_buf: { category: 'MIDI', desc: 'Pointer to incoming MIDI stream buffer', returns: 'uint8_t*' },
  web_midi_len: { category: 'MIDI', desc: 'Length of pending MIDI bytes in stream buffer', returns: 'uint32_t' },
  web_midi_clear: { category: 'MIDI', desc: 'Clear incoming MIDI stream buffer' },
  web_midi_out_take: { category: 'MIDI', desc: 'Extract outgoing MIDI byte messages from queue', params: 'uint8_t* buf, uint32_t max', returns: 'uint32_t' },

  // LEDs
  web_lit_buttons: { category: 'LEDs', desc: 'Bitmask of fully illuminated button LEDs (bit 14: PLAY green)', returns: 'uint32_t' },
  web_lit_keys: { category: 'LEDs', desc: 'Bitmask of fully illuminated key LEDs (27 keys)', returns: 'uint32_t' },
  web_dim_buttons: { category: 'LEDs', desc: 'Bitmask of dimly glowing button LEDs', returns: 'uint32_t' },
  web_dim_keys: { category: 'LEDs', desc: 'Bitmask of dimly glowing key LEDs', returns: 'uint32_t' },
  web_dim_level: { category: 'LEDs', desc: 'Base glow intensity level for dim LEDs', returns: 'uint32_t' },
  web_dim_ns: { category: 'LEDs', desc: 'LED dimming pulse duration in nanoseconds', returns: 'uint32_t' },
  web_breath_buttons: { category: 'LEDs', desc: 'Bitmask of breathing / pulsating button LEDs', returns: 'uint32_t' },
  web_breath_keys: { category: 'LEDs', desc: 'Bitmask of breathing / pulsating key LEDs', returns: 'uint32_t' },
  web_mid_keys: { category: 'LEDs', desc: 'Bitmask of medium-brightness key LEDs (drum beats)', returns: 'uint32_t' },
  web_anim_levels: { category: 'LEDs', desc: 'Pointer to per-LED animation brightness array (0..64)', returns: 'uint8_t*' },
  web_led_buttons: { category: 'LEDs', desc: 'Button LED state mask', returns: 'uint32_t' },
  web_led_keys: { category: 'LEDs', desc: 'Key LED state mask', returns: 'uint32_t' },
  web_btn_levels: { category: 'LEDs', desc: 'Per-button analog LED brightness values', returns: 'uint8_t*' },
  web_key_levels: { category: 'LEDs', desc: 'Per-key analog LED brightness values', returns: 'uint8_t*' },
  web_keys_lfo: { category: 'LEDs', desc: 'LFO modulation applied to key LEDs', returns: 'uint32_t' },
  web_play_green: { category: 'LEDs', desc: 'Green LED state on the PLAY/STOP key', returns: 'uint32_t' },
  web_led: { category: 'LEDs', desc: 'Direct control over button/key LED by index', params: 'uint32_t index, uint32_t state' },
  web_led_dim: { category: 'LEDs', desc: 'Direct control over dim LED intensity', params: 'uint32_t index, uint32_t level' },
  web_leds: { category: 'LEDs', desc: 'All LED states snapshot buffer', returns: 'uint32_t*' },

  // Storage - Flash NOR style (Felucca / CoralFlower)
  web_nor: { category: 'Storage', desc: 'Pointer to 1 MiB virtual NOR flash image in linear memory', returns: 'uint8_t*' },
  web_nor_size: { category: 'Storage', desc: 'Total size of virtual NOR flash image (1048576 bytes)', returns: 'uint32_t' },
  web_nor_erase: { category: 'Storage', desc: 'Erase virtual NOR flash memory (sets all bytes to 0xFF)' },
  web_flash: { category: 'Storage', desc: 'Pointer to live flash NOR storage buffer', returns: 'uint8_t*' },
  web_flash_size: { category: 'Storage', desc: 'Total capacity of virtual flash storage', returns: 'uint32_t' },
  web_flash_stage: { category: 'Storage', desc: 'Pointer to flash memory staging buffer', returns: 'uint8_t*' },
  web_flash_stage_len: { category: 'Storage', desc: 'Length of staged flash data', returns: 'uint32_t' },
  web_flash_dirty: { category: 'Storage', desc: 'Whether flash memory contains uncommitted changes', returns: 'uint32_t (bool)' },
  web_flash_writes_count: { category: 'Storage', desc: 'Number of flash write operations committed', returns: 'uint32_t' },
  web_lcd_writes: { category: 'Display', desc: 'Number of LCD screen hardware writes committed', returns: 'uint32_t' },

  // Storage - Object store style (X0X / AMB / Loom / Monk / etc.)
  web_nobj: { category: 'Storage', desc: 'Number of independent storage object slots (e.g. presets, patterns)', returns: 'uint32_t' },
  web_store: { category: 'Storage', desc: 'Pointer to storage object slot buffer', params: 'uint32_t slot', returns: 'uint8_t*' },
  web_store_len: { category: 'Storage', desc: 'Current byte length of stored object (-1 if empty)', params: 'uint32_t slot', returns: 'int32_t' },
  web_store_set_len: { category: 'Storage', desc: 'Set byte length of stored object after writing data', params: 'uint32_t slot, int32_t len' },
  web_store_max: { category: 'Storage', desc: 'Maximum allowable byte length per storage object', returns: 'uint32_t' },
  web_store_writes: { category: 'Storage', desc: 'Incrementing counter of storage object write commits', returns: 'uint32_t' },
  web_obj_buf: { category: 'Storage', desc: 'Pointer to scratch object buffer for import/export', returns: 'uint8_t*' },
  web_restore_object: { category: 'Storage', desc: 'Restore object data into slot', params: 'uint32_t slot, uint32_t len' },

  // Speech / Reader / SysEx
  web_said_buf: { category: 'Speech', desc: 'Buffer holding generated speech/announcement text or SysEx', returns: 'uint8_t*' },
  web_said_len: { category: 'Speech', desc: 'Length of valid data in speech announcement buffer', returns: 'uint32_t' },
  web_said_clear: { category: 'Speech', desc: 'Clear speech announcement buffer after reading' },
  web_reader: { category: 'Speech', desc: 'Accessibility speech reader audio generator engine', params: 'uint32_t rate' },
  web_sysex_in: { category: 'SysEx', desc: 'Buffer for incoming SysEx command messages', returns: 'uint8_t*' },
  web_sysex: { category: 'SysEx', desc: 'Process incoming SysEx message of n bytes', params: 'uint32_t n' },
  web_sysex_buf: { category: 'SysEx', desc: 'Buffer for outgoing SysEx data', returns: 'uint8_t*' },

  // Break loops (X0X)
  web_slot_pcm: { category: 'Breaks', desc: '16-bit mono 22050 Hz PCM buffer for sample uploading', returns: 'int16_t*' },
  web_slot_max: { category: 'Breaks', desc: 'Maximum PCM sample capacity across slot zones', returns: 'uint32_t' },
  web_slot_namebuf: { category: 'Breaks', desc: '8-character null-terminated sample slot name buffer', returns: 'char*' },
  web_slot_clear: { category: 'Breaks', desc: 'Clear sample slot k and free IMA compressed zones', params: 'int32_t slot' },
  web_slot_zone: { category: 'Breaks', desc: 'Encode loop zone z in slot k from PCM buffer', params: 'int32_t slot, int32_t zone, uint32_t n, uint32_t rate', returns: 'int32_t' },
  web_slots_changed: { category: 'Breaks', desc: 'Notify engine that sample slots changed to reload break engine' },

  // OberVave / S1Vave sim_* interface
  sim_init: { category: 'Lifecycle', desc: 'Initialize OberVave/S1Vave synth engine and voice parameters' },
  sim_render: { category: 'Audio', desc: 'Render n stereo audio frames into output channels', params: 'uint32_t n' },
  sim_out_l: { category: 'Audio', desc: 'Pointer to left audio channel float32 buffer', returns: 'float*' },
  sim_out_r: { category: 'Audio', desc: 'Pointer to right audio channel float32 buffer', returns: 'float*' },
  sim_fb: { category: 'Display', desc: 'Pointer to 240x240 RGB565 framebuffer in linear memory', returns: 'uint16_t*' },
  sim_fb_hash: { category: 'Display', desc: 'CRC/Hash of current framebuffer to detect screen redraws', returns: 'uint32_t' },
  sim_button: { category: 'Input', desc: 'Set button state by ID (pressed/released)', params: 'uint32_t id, uint32_t down' },
  sim_key: { category: 'Input', desc: 'Set note key state by ID (pressed/released)', params: 'uint32_t key, uint32_t down' },
  sim_note: { category: 'Input', desc: 'Trigger MIDI note with velocity', params: 'uint32_t note, uint32_t vel' },
  sim_enc: { category: 'Input', desc: 'Turn encoder ID by step count (+/-)', params: 'uint32_t id, int32_t clicks' },
  sim_master: { category: 'Input', desc: 'Set master volume (0..1023)', params: 'uint32_t val' },
  sim_leds_buttons: { category: 'LEDs', desc: 'Button LED illumination mask', returns: 'uint32_t' },
  sim_leds_keys: { category: 'LEDs', desc: 'Key LED illumination mask', returns: 'uint32_t' },
  sim_glow_keys: { category: 'LEDs', desc: 'Key LED glow level mask', returns: 'uint32_t' },
  sim_blob: { category: 'Storage', desc: 'Pointer to full synth state snapshot blob', returns: 'uint8_t*' },
  sim_blob_size: { category: 'Storage', desc: 'Total byte length of synth state snapshot blob', returns: 'uint32_t' },
  sim_store_hash: { category: 'Storage', desc: 'Hash of stored parameters to detect persistent changes', returns: 'uint32_t' },
  sim_ms: { category: 'Timing', desc: 'Current simulation time in milliseconds', returns: 'uint32_t' },
  sim_rate: { category: 'Audio', desc: 'Audio engine sample rate in Hz', returns: 'uint32_t' },
  sim_page: { category: 'Status', desc: 'Active UI page index', returns: 'uint32_t' },
  sim_peak: { category: 'Diagnostics', desc: 'Peak audio amplitude value', returns: 'float' },
  sim_prog: { category: 'Status', desc: 'Current sound preset program index', returns: 'uint32_t' },
  sim_midi: { category: 'MIDI', desc: 'Send 3-byte raw MIDI message', params: 'uint32_t b1, uint32_t b2, uint32_t b3' },

  // GR!MM / Arctic Scream asyncify & settings
  web_run: { category: 'Engine', desc: 'Execute synthesizer coroutine loop for specified tick count', params: 'uint32_t ticks' },
  web_step: { category: 'Engine', desc: 'Advance synthesizer simulation step', params: 'uint32_t ticks' },
  web_ms: { category: 'Timing', desc: 'Get current engine running time in milliseconds', returns: 'uint32_t (ms)' },
  web_take: { category: 'Audio', desc: 'Extract n frames of rendered audio from internal ring buffer', params: 'uint32_t n', returns: 'uint32_t' },
  web_want_frames: { category: 'Audio', desc: 'Number of audio frames requested by the engine', returns: 'uint32_t' },
  web_avail: { category: 'Audio', desc: 'Number of completed audio frames ready to be taken', returns: 'uint32_t' },
  web_settings: { category: 'Storage', desc: 'Pointer to settings and preset configuration buffer', returns: 'uint8_t*' },
  web_settings_len: { category: 'Storage', desc: 'Byte length of stored settings data', returns: 'uint32_t' },
  web_settings_set_len: { category: 'Storage', desc: 'Set byte length of stored settings data', params: 'uint32_t len' },
  web_settings_writes: { category: 'Storage', desc: 'Counter of committed settings writes', returns: 'uint32_t' },
  web_sysex_busy: { category: 'SysEx', desc: 'Whether SysEx transmission/reception is currently busy', returns: 'uint32_t (bool)' },
  web_sysex_in_buf: { category: 'SysEx', desc: 'Pointer to SysEx input buffer', returns: 'uint8_t*' },
  web_sysex_out_buf: { category: 'SysEx', desc: 'Pointer to SysEx output buffer', returns: 'uint8_t*' },
  web_sysex_out_len: { category: 'SysEx', desc: 'Length of pending outgoing SysEx message', returns: 'uint32_t' },
  web_sysex_out_clear: { category: 'SysEx', desc: 'Clear outgoing SysEx buffer' },
  web_panic: { category: 'Diagnostics', desc: 'All notes off and sound engine reset' },
  web_ready: { category: 'Status', desc: 'Whether sound engine initialization is complete', returns: 'uint32_t (bool)' },
  web_meta: { category: 'Status', desc: 'Pointer to patch metadata string buffer', returns: 'char*' },
  web_knob_text: { category: 'Status', desc: 'Text label of selected knob parameter', params: 'uint32_t knob', returns: 'char*' },
  web_env_text: { category: 'Status', desc: 'Text readout of envelope settings', returns: 'char*' },
  web_lfo_text: { category: 'Status', desc: 'Text readout of LFO settings', returns: 'char*' },
  web_async_buf: { category: 'Asyncify', desc: 'Pointer to Binaryen Asyncify coroutine call stack buffer', returns: 'void*' },
  web_async_size: { category: 'Asyncify', desc: 'Size of Binaryen Asyncify coroutine call stack buffer', returns: 'uint32_t' },
  web_seq_state: { category: 'Sequencer', desc: 'Current step sequence playback state and trigger mask', returns: 'uint32_t' },

  // SLOOP preview_* interface
  preview_init: { category: 'Lifecycle', desc: 'Initialize SLOOP audio preview engine' },
  preview_render: { category: 'Audio', desc: 'Render audio block into preview buffer', params: 'uint32_t frames' },
  preview_buffer: { category: 'Audio', desc: 'Pointer to stereo interleaved float32 audio output buffer', returns: 'float*' },
  preview_frames: { category: 'Audio', desc: 'Internal audio block size in frames', returns: 'uint32_t' },
  preview_rate: { category: 'Audio', desc: 'Preview engine sample rate in Hz (44100 Hz)', returns: 'uint32_t' },
  preview_play: { category: 'Transport', desc: 'Start or stop pattern preview playback', params: 'uint32_t playing' },
  preview_position: { category: 'Transport', desc: 'Current playback position step index', returns: 'uint32_t' },
  preview_panic: { category: 'Transport', desc: 'Stop all voices and clear delay/reverb buffers' },
  preview_track: { category: 'Track', desc: 'Configure track parameter', params: 'uint32_t track, uint32_t param, uint32_t val' },
  preview_param: { category: 'Sound', desc: 'Set synth voice parameter', params: 'uint32_t param, uint32_t val' },
  preview_global: { category: 'Sound', desc: 'Set global audio parameter (tempo, swing, master FX)', params: 'uint32_t param, uint32_t val' },
  preview_select: { category: 'Sequencer', desc: 'Select active step for parameter locking', params: 'uint32_t step' },
  preview_step: { category: 'Sequencer', desc: 'Set step trigger mask and microtiming', params: 'uint32_t step, uint32_t track, uint32_t mask' },
  preview_locks: { category: 'Sequencer', desc: 'Apply parameter lock to step', params: 'uint32_t step, uint32_t track, uint32_t param, uint32_t val' },
  preview_fm6: { category: 'FM Engine', desc: 'Configure 6-operator FM synth parameter', params: 'uint32_t op, uint32_t param, uint32_t val' },
  preview_sample: { category: 'Sampler', desc: 'Configure sample slice / loop parameter', params: 'uint32_t slot, uint32_t param, uint32_t val' },
  preview_kit: { category: 'Drums', desc: 'Load drum kit preset index', params: 'uint32_t kit' },
  preview_hit: { category: 'Drums', desc: 'Trigger drum pad on track with velocity', params: 'uint32_t track, uint32_t vel' },
  preview_note: { category: 'Synth', desc: 'Trigger synth note on track with pitch and velocity', params: 'uint32_t track, uint32_t note, uint32_t vel' },

  // Mutable Dreams (Braids / Plaits engine)
  dream_command: { category: 'Engine', desc: 'Execute dream macro-oscillator command', params: 'uint32_t cmd, uint32_t arg' },
  dream_page: { category: 'Navigation', desc: 'Set or query active UI page index', params: 'int32_t page', returns: 'uint32_t' },
  dream_track: { category: 'Track', desc: 'Select active synthesizer track/macro model', params: 'uint32_t track' },
  dream_value: { category: 'Parameters', desc: 'Get/set parameter value for active voice model', params: 'uint32_t param, int32_t val', returns: 'int32_t' },
  dream_bank_name: { category: 'Patches', desc: 'Pointer to null-terminated name string of sound bank', params: 'uint32_t bank', returns: 'char*' },
  dream_bank_browser: { category: 'Patches', desc: 'Open or advance sound bank browser selection', params: 'int32_t delta' },
  dream_knob: { category: 'Input', desc: 'Apply relative knob delta to active dream parameter', params: 'uint32_t knob, int32_t delta' },
  dream_raw_knob: { category: 'Input', desc: 'Set absolute knob potentiometer position (0..4095)', params: 'uint32_t knob, uint32_t val' },
  dream_input_edge: { category: 'Input', desc: 'Signal button edge transition (press/release)', params: 'uint32_t btn, uint32_t state' },
  dream_patch_data: { category: 'Patches', desc: 'Pointer to active dream patch binary data in memory', returns: 'uint8_t*' },
  dream_patch_size: { category: 'Patches', desc: 'Byte length of dream patch data structure', returns: 'uint32_t' },
  dream_patch_buffer: { category: 'Patches', desc: 'Pointer to scratch buffer for importing/exporting patches', returns: 'uint8_t*' },
  dream_patch_apply: { category: 'Patches', desc: 'Apply loaded patch data to current synth engine voices' },

  // FRASIL (Drone / River engine)
  web_scene_buf: { category: 'Scenes', desc: 'Pointer to scene data buffer for loading River shards', returns: 'uint8_t*' },
  web_scene_size: { category: 'Scenes', desc: 'Expected byte size of scene data structure', returns: 'uint32_t' },
  web_lead_buf: { category: 'Scenes', desc: 'Pointer to LEAD voice settings buffer', returns: 'uint8_t*' },
  web_lead_size: { category: 'Scenes', desc: 'Byte size of LEAD voice settings structure', returns: 'uint32_t' },
  web_lead_none: { category: 'Scenes', desc: 'Reset LEAD voice settings to default MOSS sound' },
  web_scene_play: { category: 'Transport', desc: 'Start playing the loaded scene shard' },
  web_scene_stop: { category: 'Transport', desc: 'Stop playing current scene and release held drone voices' },
  web_scene_over: { category: 'Scenes', desc: 'Convert scene shard from older firmware revision layout', params: 'uint32_t n' },
  web_scene_take: { category: 'Scenes', desc: 'Commit currently buffered scene and lead settings into engine' },
  web_scene_edited: { category: 'Scenes', desc: 'Whether current scene has unsaved parameter modifications', returns: 'uint32_t (bool)' },
  web_lead_edited: { category: 'Scenes', desc: 'Whether LEAD voice has unsaved parameter modifications', returns: 'uint32_t (bool)' },
  web_param: { category: 'Parameters', desc: 'Modify synthesis parameter by ID and value', params: 'uint32_t param, int32_t val' },
  web_latch: { category: 'Drones', desc: 'Latch active drone key notes', params: 'uint32_t mask' },
  web_clear: { category: 'Drones', desc: 'Clear all latched drone notes' },
  web_hold: { category: 'Drones', desc: 'Toggle drone hold mode state', params: 'uint32_t hold' },
  web_live_size: { category: 'Live', desc: 'Size of live session performance telemetry block', returns: 'uint32_t' },
  web_live: { category: 'Live', desc: 'Pointer to live telemetry buffer (LFO and current levels)', returns: 'uint8_t*' },
  web_dseq_buf: { category: 'Sequencer', desc: 'Pointer to drone chord sequencer step buffer', returns: 'uint8_t*' },
  web_dseq_step: { category: 'Sequencer', desc: 'Current active drone sequencer step index', returns: 'uint32_t' },
  web_value: { category: 'Parameters', desc: 'Read current synthesis parameter value', params: 'uint32_t param', returns: 'int32_t' },

  // ZEN-1 (Microtonal / Traditional instruments)
  web_mode: { category: 'Engine', desc: 'Set synthesis mode / traditional instrument model', params: 'uint32_t mode' },
  web_patch: { category: 'Patches', desc: 'Get active sound preset patch index', returns: 'uint32_t' },
  web_patch_set: { category: 'Patches', desc: 'Switch active preset patch by index', params: 'uint32_t patch' },
  web_patch_get: { category: 'Patches', desc: 'Get pointer to patch parameter data structure', params: 'uint32_t patch', returns: 'uint8_t*' },
  web_param_get: { category: 'Parameters', desc: 'Get parameter value for active patch', params: 'uint32_t param', returns: 'int32_t' },
  web_param_lo: { category: 'Parameters', desc: 'Minimum allowable value for parameter', params: 'uint32_t param', returns: 'int32_t' },
  web_param_hi: { category: 'Parameters', desc: 'Maximum allowable value for parameter', params: 'uint32_t param', returns: 'int32_t' },
  web_param_name: { category: 'Parameters', desc: 'Pointer to parameter name string', params: 'uint32_t param', returns: 'char*' },
  web_note: { category: 'Synth', desc: 'Play note with velocity and microtonal articulation', params: 'uint32_t note, uint32_t vel, int32_t cents' },
  web_ornament: { category: 'Articulation', desc: 'Trigger traditional East-Asian ornament (shakuhachi meri/kari, koto oshide)', params: 'uint32_t type, uint32_t depth' },
  web_bend: { category: 'Articulation', desc: 'Pitch bend depth in microtonal cents', params: 'int32_t cents' },
  web_peak: { category: 'Diagnostics', desc: 'Current voice peak amplitude level', returns: 'float' },
  web_nvoices: { category: 'Engine', desc: 'Number of active polyphonic/monophonic voice channels', returns: 'uint32_t' },
  web_label: { category: 'Status', desc: 'Pointer to UI display label string', params: 'uint32_t id', returns: 'char*' },
  web_custom: { category: 'Patches', desc: 'Pointer to user custom preset bank buffer', returns: 'uint8_t*' },
  web_key_cents: { category: 'Tuning', desc: 'Microtonal cents offset for specific keyboard key', params: 'uint32_t key', returns: 'int32_t' },
  web_npatch: { category: 'Patches', desc: 'Total number of sound preset patches available', returns: 'uint32_t' },
  web_builtin: { category: 'Patches', desc: 'Number of factory built-in preset patches', returns: 'uint32_t' },
  web_patch_ja: { category: 'Status', desc: 'Pointer to Japanese / Kanji preset name string', params: 'uint32_t patch', returns: 'char*' },
  web_key_level: { category: 'Input', desc: 'Analog strike/pressure level on key', params: 'uint32_t key, uint32_t level' },
  web_bend_cents: { category: 'Articulation', desc: 'Get active pitch bend value in cents', returns: 'int32_t' },

  // Aisling & SATIE-1
  web_piece: { category: 'Pieces', desc: 'Select or query active composition piece index', params: 'int32_t piece', returns: 'uint32_t' },
  web_piece_name: { category: 'Pieces', desc: 'Pointer to name string of piece composition', params: 'uint32_t piece', returns: 'char*' },
  web_seed: { category: 'Lifecycle', desc: 'Seed pseudo-random generator for generative variations', params: 'uint32_t seed' },
  web_satie_state: { category: 'Status', desc: 'Pointer to internal Gymnopédie generative engine state', returns: 'uint8_t*' },
  web_version: { category: 'Status', desc: 'Firmware build version identifier string', returns: 'char*' },
  web_dump: { category: 'Diagnostics', desc: 'Dump internal firmware engine state for diagnostics' },

  // Emscripten & Binaryen Runtime
  setThrew: { category: 'Runtime', desc: 'Emscripten exception unwind helper', params: 'uint32_t th, uint32_t val' },
  emscripten_stack_get_current: { category: 'Runtime', desc: 'Get current WebAssembly execution stack pointer', returns: 'uint32_t' },
  asyncify_start_unwind: { category: 'Asyncify', desc: 'Binaryen Asyncify: initiate stack unwinding', params: 'void* data' },
  asyncify_stop_unwind: { category: 'Asyncify', desc: 'Binaryen Asyncify: finalize stack unwinding' },
  asyncify_start_rewind: { category: 'Asyncify', desc: 'Binaryen Asyncify: restore execution context and rewind stack', params: 'void* data' },
  asyncify_stop_rewind: { category: 'Asyncify', desc: 'Binaryen Asyncify: complete stack rewinding' },
  asyncify_get_state: { category: 'Asyncify', desc: 'Binaryen Asyncify: query coroutine unwind/rewind state', returns: 'uint32_t' },
};

function getCommit(repoDir) {
  try {
    return execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getBranch(repoDir) {
  try {
    return execFileSync('git', ['-C', repoDir, 'branch', '--show-current'], { encoding: 'utf8' }).trim() || 'main';
  } catch {
    return 'main';
  }
}

console.log('Analyzing WASM builds and generating interface documentation...\n');

const manifestBuilds = [];
const docSummaries = [];

for (const fw of FIRMWARES) {
  const repoDir = join(root, fw.id);
  const wasmPath = join(dist, `${fw.id}.wasm`);
  const commit = existsSync(repoDir) ? getCommit(repoDir) : 'unknown';
  const branch = existsSync(repoDir) ? getBranch(repoDir) : 'main';

  let exportsList = [];
  let importsList = [];
  let size = 0;
  let sha256 = '';
  let available = false;

  if (existsSync(wasmPath)) {
    const bytes = readFileSync(wasmPath);
    size = bytes.length;
    sha256 = createHash('sha256').update(bytes).digest('hex');
    available = true;

    try {
      const module = new WebAssembly.Module(bytes);
      exportsList = WebAssembly.Module.exports(module)
        .filter((e) => e.kind === 'function')
        .map((e) => e.name)
        .filter((n) => !n.startsWith('_'))
        .sort();

      importsList = [
        ...new Set(WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`)),
      ].sort();
    } catch (err) {
      console.warn(`  Warning: Failed to reflect ${fw.id}.wasm: ${err.message}`);
    }
  }

  manifestBuilds.push({
    id: fw.id,
    name: fw.name,
    repo: fw.repo,
    url: fw.url,
    author: fw.author,
    license: fw.license,
    branch,
    commit,
    style: fw.style,
    file: `${fw.id}.wasm`,
    size,
    sha256,
    available,
    exports_count: exportsList.length,
    imports_count: importsList.length,
    exports: exportsList,
    imports: importsList,
  });

  // Group functions by category
  const categories = {};
  for (const fn of exportsList) {
    const spec = FUNCTION_SPECS[fn] || { category: 'Other', desc: 'Exported WebAssembly runtime function' };
    (categories[spec.category] ??= []).push({ name: fn, ...spec });
  }

  // Generate per-firmware documentation
  let doc = `# Firmware Interface Specification: ${fw.name}\n\n`;
  doc += `> **Repository**: [${fw.repo}](${fw.url})  \n`;
  doc += `> **Author**: ${fw.author}  \n`;
  doc += `> **License**: ${fw.license}  \n`;
  doc += `> **Interface Family**: \`${fw.style}\`  \n`;
  doc += `> **Source Shim**: \`${fw.sourceShim}\`  \n`;
  doc += `> **Build Instructions**: \`${fw.buildScript}\`  \n`;
  doc += `> **Binary Artifact**: \`dist/${fw.id}.wasm\` (${(size / 1024).toFixed(1)} KB, SHA-256: \`${sha256.slice(0, 16)}...\`)  \n\n`;

  doc += `## Overview\n\n${fw.description}\n\n`;

  doc += `## Architectural Summary\n\n`;
  doc += `| Attribute | Details |\n`;
  doc += `| :--- | :--- |\n`;
  doc += `| **Interface Family** | \`${fw.style}\` |\n`;
  doc += `| **Linear Memory** | WebAssembly Linear Memory (32-bit pointers) |\n`;
  doc += `| **Clock Model** | AudioWorklet frame pull; host calls render per audio block (128 frames / 2.9 ms) |\n`;
  doc += `| **Sample Rate** | 44,100 Hz stereo interleaved or split float32 arrays |\n`;
  doc += `| **Display Resolution** | 240 x 240 pixels (RGB565 in device byte order) |\n`;
  doc += `| **Exported Functions** | ${exportsList.length} exported WebAssembly functions |\n`;
  doc += `| **Imported Symbols** | ${importsList.length ? importsList.map((i) => `\`${i}\``).join(', ') : 'None (self-contained)'} |\n\n`;

  doc += `## Exported Interface Functions\n\n`;

  if (exportsList.length === 0) {
    if (fw.id === 'Felucca') {
      doc += `*Note: The upstream Hugelton Felucca repository targets the hardware JieLi SoC platform and does not publish a standalone web wasm build. In this suite, Felucca is emulated via \`fma-player\` or compiled using the universal \`felucca_web.c\` core with \`-DFELUCCA_FMINI_ONLY=0\`.*\n\n`;
    } else {
      doc += `*Build pending. Run the build script to generate \`${fw.id}.wasm\`.*\n\n`;
    }
  } else {
    for (const [cat, fns] of Object.entries(categories)) {
      doc += `### ${cat}\n\n`;
      doc += `| Function | Signature / Return | Description |\n`;
      doc += `| :--- | :--- | :--- |\n`;
      for (const fn of fns) {
        const sig = fn.params ? `\`(${fn.params})\`` : (fn.returns ? `\`-> ${fn.returns}\`` : '`void`');
        doc += `| \`${fn.name}\` | ${sig} | ${fn.desc} |\n`;
      }
      doc += `\n`;
    }
  }

  if (importsList.length > 0) {
    doc += `## Imported Host Dependencies\n\n`;
    doc += `This WebAssembly module requires the host environment (browser AudioWorklet / JS engine) to provide the following imports:\n\n`;
    doc += `| Import Name | Role |\n`;
    doc += `| :--- | :--- |\n`;
    for (const imp of importsList) {
      let role = 'Host environment function';
      if (imp.startsWith('wasi_')) role = 'WASI system call (clock/io)';
      else if (imp.startsWith('env.web_yield')) role = 'Asyncify coroutine yield hook (AudioWorklet)';
      else if (imp.startsWith('env.web_ticks')) role = 'Asyncify timer tick counter';
      doc += `| \`${imp}\` | ${role} |\n`;
    }
    doc += `\n`;
  }

  doc += `## Integration with FM-1 Adapter Player\n\n`;
  doc += `To play this native build in the web client, \`ui/web/native-worklet.js\` interfaces with these exports:\n`;
  doc += `1. **Audio Loop**: Invokes audio render function every 128 frames, passing output to Web Audio graph.\n`;
  doc += `2. **UI Updates**: Polls framebuffer and screen draw revisions every 16–33 ms to update HTML5 canvas.\n`;
  doc += `3. **Controls Dispatch**: Dispatches button masks, rotary encoder steps, and MIDI messages from user gestures.\n`;
  doc += `4. **State Persistence**: Serializes flash NOR or object storage buffers into IndexedDB when writing settles.\n\n`;

  const docFile = join(docsDir, `${fw.id}.md`);
  writeFileSync(docFile, doc, 'utf8');

  docSummaries.push({
    id: fw.id,
    name: fw.name,
    repo: fw.repo,
    style: fw.style,
    size: size ? `${(size / 1024).toFixed(1)} KB` : 'N/A',
    exportsCount: exportsList.length,
    docPath: `docs/${fw.id}.md`,
  });

  console.log(`  [OK] ${fw.name.padEnd(16)} -> ${fw.style.padEnd(12)} (${size ? (size / 1024).toFixed(1) + ' KB' : 'N/A'}, ${exportsList.length} exports)`);
}

// Generate master INTERFACES.md
let master = `# FM-1 Firmware Interface Catalog & Specification\n\n`;
master += `This document provides the complete interface documentation for all 21 community firmwares built for the M-VAVE FM-1 pocket synthesizer, detailing their WebAssembly export and import contracts, control schemas, and audio/video interfaces.\n\n`;

master += `## Firmware Summary Matrix (21 Firmwares)\n\n`;
master += `| Firmware | Repository | Style Family | Wasm Size | Exports | Detailed Spec |\n`;
master += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
for (const s of docSummaries) {
  master += `| **${s.name}** | [${s.repo}](https://github.com/${s.repo}) | \`${s.style}\` | ${s.size} | ${s.exportsCount} | [${s.name} Interface](${s.docPath}) |\n`;
}
master += `\n---\n\n`;

master += `## Interface Families Overview\n\n`;

master += `### 1. The \`felucca\` Family\n`;
master += `* **Firmwares**: FMini-1, Skiff, Felucca, CoralFlower\n`;
master += `* **Frame Buffer**: 240x240 RGB565 via \`web_screen()\` or \`web_fb()\`, revision checked by \`web_screen_draws()\` or \`web_lcd_writes()\`. Byte order matches device SPI panel.\n`;
master += `* **Controls**: Buttons and keys via bitmasks (\`web_buttons\`, \`web_keys\`, \`web_keys_tap\`). Encoders by functional role (\`web_enc\`). Master pot 0..1023 (\`web_master\`, \`web_master_get\`).\n`;
master += `* **LEDs**: Multi-state masks (\`web_lit_*\`, \`web_dim_*\`, \`web_breath_*\`, \`web_anim_levels\`, \`web_play_green\`).\n`;
master += `* **Storage**: 1 MiB raw NOR flash image (\`web_nor\`, \`web_nor_size\`, \`web_flash\`, \`web_flash_stage\`, \`web_nor_erase\`, \`web_flash_writes_count\`).\n\n`;

master += `### 2. The \`x0x\` Family\n`;
master += `* **Firmwares**: X0X, AMB-1, Niagara Drift, MONK-1, Loom, Aisling, Nachtfahrt, FiMba-1, SATIE-1\n`;
master += `* **Frame Buffer**: 240x240 RGB565 via \`web_fb()\`, tracked by \`web_blits()\`. Byte order matches device SPI panel.\n`;
master += `* **Controls**: Buttons/keys bitmasks; MONK-1 features per-key strike velocity via \`web_key(id, vel, at)\`. Master pot scaled 0..4096.\n`;
master += `* **Storage**: Named object slots (\`web_store\`, \`web_store_len\`, \`web_store_set_len\`, \`web_nobj\`, \`web_store_max\`).\n`;
master += `* **Speech / Accessibility**: Built-in speech announcer buffers (\`web_said_buf\`, \`web_said_len\`, \`web_said_clear\`, \`web_sysex\`).\n`;
master += `* **Sample Breaks (X0X)**: 22050 Hz 16-bit PCM IMA-ADPCM upload engine (\`web_slot_pcm\`, \`web_slot_zone\`).\n\n`;

master += `### 3. The \`dream\` Family (Braids / Plaits Port)\n`;
master += `* **Firmwares**: Mutable Dreams\n`;
master += `* **Sound Engines**: Over 50 synthesis models ported from Mutable Instruments Eurorack modules.\n`;
master += `* **Controls**: Macro-oscillator navigation via \`dream_page\`, \`dream_track\`, \`dream_value\`, \`dream_knob\`, and \`dream_raw_knob\`.\n`;
master += `* **Patch Architecture**: Dedicated dream patch system with \`dream_patch_data\`, \`dream_patch_size\`, \`dream_patch_buffer\`, and \`dream_bank_browser\`.\n\n`;

master += `### 4. The \`frasil\` Family (Drone / River)\n`;
master += `* **Firmwares**: FRASIL\n`;
master += `* **Engine Scope**: Ambient frozen drone textures, shimmer reverb, and GLINT FM bells.\n`;
master += `* **River Integration**: Web scene shard loading and streaming via \`web_scene_buf\`, \`web_scene_size\`, \`web_lead_buf\`, \`web_scene_play\`, and \`web_scene_take\`.\n`;
master += `* **Drone Controls**: Latched voices and hold mode with \`web_latch\`, \`web_clear\`, \`web_hold\`, and drone sequencer \`web_dseq_buf\`.\n\n`;

master += `### 5. The \`zen\` Family (Microtonal / Traditional Instruments)\n`;
master += `* **Firmwares**: ZEN-1\n`;
master += `* **Models**: Koto, Shakuhachi, Erhu traditional acoustic modeling with ornament articulation (\`web_ornament\`).\n`;
master += `* **Microtonal Tuning**: Cents-accurate key offsets and pitch bending (\`web_key_cents\`, \`web_bend\`, \`web_bend_cents\`).\n`;
master += `* **Preset Architecture**: Factory and user patch banks with bilingual metadata (\`web_patch_get\`, \`web_patch_ja\`, \`web_custom\`).\n\n`;

master += `### 6. The \`sim\` Family\n`;
master += `* **Firmwares**: OberVave, S1Vave\n`;
master += `* **Execution**: Compiled with Zig freestanding C toolchain + Binaryen Asyncify.\n`;
master += `* **Functions**: Fully namespaced \`sim_*\` prefix (\`sim_init\`, \`sim_render\`, \`sim_fb\`, \`sim_fb_hash\`, \`sim_button\`, \`sim_key\`, \`sim_enc\`, \`sim_master\`, \`sim_midi\`).\n`;
master += `* **Storage**: Direct state snapshot blob (\`sim_blob\`, \`sim_blob_size\`, \`sim_store_hash\`).\n\n`;

master += `### 7. The \`asyncify\` Family\n`;
master += `* **Firmwares**: GR!MM, Arctic Scream\n`;
master += `* **Execution**: Emscripten + Binaryen Asyncify coroutine loop (\`env.web_yield\`, \`env.web_ticks\`).\n`;
master += `* **Audio Scheduling**: \`web_run(ticks)\` steps coroutine; \`web_take(frames)\` pulls synthesized audio.\n`;
master += `* **Diagnostics & Metadata**: \`web_meta\`, \`web_knob_text\`, \`web_env_text\`, \`web_lfo_text\`, \`web_panic\`.\n\n`;

master += `### 8. The \`melodee\` Family\n`;
master += `* **Firmwares**: Melodee\n`;
master += `* **Frame Buffer**: \`web_fb()\`, revision tracked by \`web_fb_gen()\`. Visual custom UI rendering.\n`;
master += `* **Controls**: \`web_buttons\`, \`web_keys\`, \`web_encoder\`, \`web_master\`, \`web_midi_in\`.\n`;
master += `* **LEDs**: Distinct \`web_led_buttons\` and \`web_led_keys\` masks.\n\n`;

writeFileSync(join(root, 'INTERFACES.md'), master, 'utf8');

// Write manifest.json
const manifestPath = join(dist, 'manifest.json');
writeFileSync(manifestPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  count: manifestBuilds.length,
  builds: manifestBuilds,
}, null, 2), 'utf8');

console.log(`\nGenerated ${manifestBuilds.length} firmware specifications in firmwares/docs/`);
console.log(`Generated master catalog in firmwares/INTERFACES.md`);
console.log(`Generated manifest in firmwares/dist/manifest.json`);
