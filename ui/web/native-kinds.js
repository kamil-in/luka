// Which kind of build a firmware's own browser build is, from the functions it exports.
// One answer for everyone: tools/import-builds.mjs (at import time, in Node) and
// native-worklet.js (when a build starts, in the audio thread). No DOM, no Node: only names.
//
//   identify(exports, imports) -> { family, style, note }
//
//   family  what the build is, whether or not this client can play it:
//             felucca     Felucca's browser build and its forks' (web_screen, masks, a flash image)
//             x0x         X0X's and the builds made after it (web_fb + web_blits, named objects)
//             melodee     Melodee's (web_fb + web_fb_gen, web_encoder, no storage)
//             sim         OberVave's and S1Vave's (sim_*, the state as blobs)
//             asyncify    a coroutine the host drives (web_run / web_take; GR!MM, Arctic Scream)
//             coralflower CoralFlower's own (web_step, web_flash, web_keymap)
//             demake      demake's (w_*: a 4-bit screen and palette, a 64 KiB store)
//             viscera     viscera's tape looper (control() takes the whole panel, projects in slots)
//             mpyre       M-PYRE's (emu_*: a UI step the host calls, songs as projects, a sound pack)
//             wsim        bk40-home's web simulators (wsim_*: main() under Asyncify; M-Vsynth2, M-vance)
//             preview     a sound engine for an editor, no screen or panel (SLOOP)
//             unknown
//   style   the adapter of native-worklet.js that plays it, or null (listed only)
//   note    why it cannot be played yet, when style is null

export function identify(exports, imports = []) {
  const names = exports instanceof Set ? exports : new Set(exports);
  const has = (...n) => n.every((x) => names.has(x));
  const any = (p) => [...names].some((n) => n.startsWith(p));

  if (has("sim_init", "sim_render", "sim_out_l", "sim_out_r", "sim_fb", "sim_button", "sim_key", "sim_enc"))
    return { family: "sim", style: "sim", note: null };
  if (has("web_run", "web_take", "web_avail"))
    return { family: "asyncify", style: "asyncify", note: null };
  if (has("web_step", "web_flash", "web_keymap"))
    return { family: "coralflower", style: "coralflower", note: null };
  if (has("emu_init", "emu_render", "emu_block_frames", "emu_ui", "emu_screen", "emu_keys", "emu_button", "emu_knob"))
    return { family: "mpyre", style: "mpyre", note: null };
  if (has("w_init", "w_render", "w_audio", "w_frame", "w_palette", "w_leds", "w_key", "w_button", "w_encoder"))
    return { family: "demake", style: "demake", note: null };
  if (has("init", "control", "paint", "screen", "leds", "render", "output_buffer", "project", "device"))
    return { family: "viscera", style: "viscera", note: null };
  if (has("wsim_pull", "wsim_fb", "wsim_keys", "wsim_btn", "wsim_enc", "main", "asyncify_start_unwind"))
    return { family: "wsim", style: "wsim", note: null };
  if (any("preview_") && !has("web_fb"))
    return { family: "preview", style: null, note: "a sound engine without screen or panel: nothing to play with" };

  const core = has("web_boot", "web_render", "web_out_l", "web_out_r");
  if (core && has("web_screen", "web_buttons", "web_keys", "web_enc")) return { family: "felucca", style: "felucca", note: null };
  if (core && has("web_fb", "web_fb_gen", "web_buttons", "web_keys", "web_encoder")) return { family: "melodee", style: "melodee", note: null };
  if (core && has("web_fb", "web_blits", "web_buttons", "web_enc") && (names.has("web_keys") || names.has("web_key")))
    return { family: "x0x", style: "x0x", note: null };
  return { family: "unknown", style: null, note: "no interface this client knows" };
}
