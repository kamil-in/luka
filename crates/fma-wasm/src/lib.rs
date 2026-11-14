//! The player for a browser. The page's audio worklet (`ui/web/player-worklet.js`) is what
//! the native `Session` is on a desktop, with the sound card as its clock: for every block
//! of audio the browser asks for it calls [`fma_tick`] with the time that block stands for,
//! plays the audio that comes out, and passes the events and screen frames on to the page.
//! This module is the same [`Player`] the desktop runs, with a [`Transport`] that collects
//! one tick's output for the worklet to read.
//!
//! Plain `extern "C"` exports and pointers into linear memory: no bindings generator. All
//! pointers handed out stay valid until the next call into the module.
//!
//! Built with the function table exported and growable (`tools/build-web.ps1`): the
//! emulator's JIT has the host compile hot code and install it there (`ui/web/player-worklet.js`).

use fma_display::{Event, Frame, Player, Transport};
use fma_player::{Input, Options};
use std::cell::RefCell;
use std::time::Duration;

/// One tick's output.
#[derive(Default)]
struct Collected {
    events: RefCell<Vec<Event>>,
    frame: RefCell<Vec<u8>>,
    audio: RefCell<Vec<i16>>,
}

impl Transport for Collected {
    fn event(&self, event: Event) {
        self.events.borrow_mut().push(event);
    }
    fn frame(&self, frame: Frame<'_>) {
        let mut mine = self.frame.borrow_mut();
        mine.clear();
        mine.extend_from_slice(frame.rgba);
    }
    fn audio(&self, samples: &[i16], _sample_rate: u32) {
        self.audio.borrow_mut().extend_from_slice(samples);
    }
}

#[derive(Default)]
struct State {
    player: Option<Player>,
    out: Collected,
    /// JSON for the worker: what `fma_start` or `fma_tick` has to say
    text: Vec<u8>,
    save: Vec<u8>,
}

static mut STATE: Option<State> = None;

#[allow(static_mut_refs)]
fn state() -> &'static mut State {
    // SAFETY: a wasm32 instance is single-threaded, and every export runs to completion.
    unsafe { STATE.get_or_insert_with(State::default) }
}

/// `len` bytes for the worker to fill, consumed by the call they are passed to.
#[no_mangle]
pub extern "C" fn fma_alloc(len: u32) -> *mut u8 {
    let mut v = vec![0u8; len as usize];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// SAFETY: `ptr` and `len` are an `fma_alloc` allocation, passed once.
unsafe fn take(ptr: *mut u8, len: u32) -> Vec<u8> {
    if len == 0 { Vec::new() } else { Vec::from_raw_parts(ptr, len as usize, len as usize) }
}

/// Start the package at `pkg` (and its save at `save`, when `save_len` is not 0), stopping
/// what ran. Returns 1 and leaves `{"info": .., "save_restored": ..}` in the text, or 0 and
/// the reason there, as a JSON string.
#[no_mangle]
pub extern "C" fn fma_start(pkg: *mut u8, pkg_len: u32, save: *mut u8, save_len: u32, clock_mhz: u32, jit: u32) -> u32 {
    let (pkg, save) = unsafe { (take(pkg, pkg_len), take(save, save_len)) };
    let s = state();
    s.player = None;
    let options = Options { clock_mhz, jit: jit != 0 };
    match Player::start(&pkg, &options, (!save.is_empty()).then_some(save.as_slice())) {
        Ok(player) => {
            s.text = serde_json::to_vec(&serde_json::json!({ "info": player.info(), "save_restored": player.save_restored() })).unwrap_or_default();
            s.player = Some(player);
            1
        }
        Err(e) => {
            s.text = serde_json::to_vec(&e.to_string()).unwrap_or_default();
            0
        }
    }
}

/// Something done to the device: an `Input` of the protocol, as JSON.
#[no_mangle]
pub extern "C" fn fma_input(json: *mut u8, len: u32) {
    let json = unsafe { take(json, len) };
    if let (Some(player), Ok(input)) = (state().player.as_mut(), serde_json::from_slice::<Input>(&json)) {
        player.input(&input);
    }
}

/// `dt_ms` have passed. Afterwards: the events in the text (a JSON array), a frame when the
/// screen changed, the audio made.
#[no_mangle]
pub extern "C" fn fma_tick(dt_ms: f64) {
    let s = state();
    s.out.events.borrow_mut().clear();
    s.out.frame.borrow_mut().clear();
    s.out.audio.borrow_mut().clear();
    // The tick runs in the audio thread, and compiling hot code there must not hold up a
    // block of audio for long: a few compiles a tick, the rest stay interpreted until the next.
    #[cfg(target_arch = "wasm32")]
    fm1_core::jit_wasm::COMPILE_BUDGET.store(16, std::sync::atomic::Ordering::Relaxed);
    if let Some(player) = s.player.as_mut() {
        player.tick(Duration::from_secs_f64(dt_ms.clamp(0.0, 1000.0) / 1000.0), &s.out);
    }
    s.text = serde_json::to_vec(&*s.out.events.borrow()).unwrap_or_default();
}

/// What the firmware stored, when there is something to keep (`now` = 1: without waiting
/// for it to settle, on the way out). Returns its length (0: nothing), the bytes at `fma_save_ptr`.
#[no_mangle]
pub extern "C" fn fma_save(now: u32) -> u32 {
    let s = state();
    let save = s.player.as_mut().and_then(|p| if now != 0 { p.save_now() } else { p.save_due() });
    s.save = save.unwrap_or_default();
    s.save.len() as u32
}

/// Emulated milliseconds since the start (0: nothing runs).
#[no_mangle]
pub extern "C" fn fma_elapsed_ms() -> f64 {
    state().player.as_ref().map_or(0.0, |p| p.elapsed_ms() as f64)
}

#[no_mangle]
pub extern "C" fn fma_stop() {
    state().player = None;
}

#[no_mangle]
pub extern "C" fn fma_text_ptr() -> *const u8 { state().text.as_ptr() }
#[no_mangle]
pub extern "C" fn fma_text_len() -> u32 { state().text.len() as u32 }
#[no_mangle]
pub extern "C" fn fma_save_ptr() -> *const u8 { state().save.as_ptr() }
/// RGBA bytes (0: the screen did not change this tick).
#[no_mangle]
pub extern "C" fn fma_frame_ptr() -> *const u8 { state().out.frame.borrow().as_ptr() }
#[no_mangle]
pub extern "C" fn fma_frame_len() -> u32 { state().out.frame.borrow().len() as u32 }
/// Interleaved L R, signed 16 bit, at 44100 Hz; the length in samples.
#[no_mangle]
pub extern "C" fn fma_audio_ptr() -> *const i16 { state().out.audio.borrow().as_ptr() }
#[no_mangle]
pub extern "C" fn fma_audio_len() -> u32 { state().out.audio.borrow().len() as u32 }
