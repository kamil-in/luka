//! Playing firmware: a package's bytes become a running machine with a screen, sound and
//! controls.
//!
//! ```no_run
//! use fma_player::{Input, Options};
//! # let package: Vec<u8> = Vec::new();
//! let mut emu = fma_player::load(&package, &Options::default())?;
//! emu.input(&Input::Key { id: 21, down: true, velocity: Some(100) });
//! let mut audio = Vec::new();
//! emu.render(512, &mut audio)?;          // 512 stereo frames, when the firmware has them
//! let screen = emu.screen();             // 240x240 RGB565, and a revision to see changes by
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! Everything a client needs is in the [`Emulator`] trait and the plain types beside it: no
//! type of the emulator behind it shows. [`Fm1Emu`] is the one implementation (the MIT
//! fm1-emu crates); another emulator is another implementation, and [`load`] the one place
//! that chooses.
//!
//! This crate does not fetch, pace, or play: it is handed bytes, runs when asked, and hands
//! back samples and pixels. The caller owns the clock (see [`Emulator::render`]).
//!
//! An `Emulator` is not `Send`: make it on the thread that runs it.

mod fm1emu;
pub mod panel;

pub use fm1emu::Fm1Emu;

use serde::{Deserialize, Serialize};

/// The device a package is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Board {
    Fm1,
    Smk37,
}

/// What was loaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Info {
    /// The package's own identity (`FM-1_918`).
    pub identity: String,
    pub board: Board,
    /// Of [`Emulator::render`]'s audio, in Hz. Stereo, interleaved, signed 16 bit.
    pub sample_rate: u32,
    pub screen_width: u32,
    pub screen_height: u32,
}

/// How to run a package.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Options {
    /// The emulated chip's clock. Lower is less work for the host, and less time for the
    /// firmware: one that needs its full clock will stutter.
    pub clock_mhz: u32,
    /// Compile hot code (several times faster where the host supports it).
    pub jit: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options { clock_mhz: 240, jit: true }
    }
}

/// Something done to the device. Ids are the device's own (for the FM-1: [`panel`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Input {
    /// A button or a note key, pressed or released. `velocity` (1..=127): how hard a note
    /// key is struck (`None`: as the last one).
    Key { id: u8, down: bool, velocity: Option<u8> },
    /// An encoder turned by `clicks` detents (+: clockwise).
    Encoder { id: u8, clicks: i32 },
    /// An analog control set (0..=1023): a pot, a fader, a wheel.
    Analog { channel: u8, value: u16 },
    /// Bytes into the MIDI IN jack.
    Midi { bytes: Vec<u8> },
}

/// The screen as it is now.
#[derive(Debug, Clone, Copy)]
pub struct Screen<'a> {
    /// Changes whenever a pixel may have: draw again when it differs from the last one seen.
    pub revision: u32,
    pub width: u32,
    pub height: u32,
    /// RGB565, row by row from the top left.
    pub pixels: &'a [u16],
}

impl Screen<'_> {
    /// The pixels as RGBA bytes (what a canvas or an image encoder takes).
    pub fn rgba(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.pixels.len() * 4);
        for &p in self.pixels {
            let (r, g, b) = ((p >> 11) & 31, (p >> 5) & 63, p & 31);
            out.extend_from_slice(&[(r << 3 | r >> 2) as u8, (g << 2 | g >> 4) as u8, (b << 3 | b >> 2) as u8, 255]);
        }
        out
    }
}

/// The package could not be started.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("this is not a firmware package the emulator can start: {0}")]
pub struct LoadError(pub String);

/// The firmware stopped: it did something the emulator cannot follow (or its own fault). The
/// machine stays as it was at that moment (its screen can still be shown) and runs no further.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("the firmware stopped after {at_ms} ms: {reason}")]
pub struct Stopped {
    /// Emulated milliseconds since the start.
    pub at_ms: u64,
    pub reason: String,
}

/// What the firmware has written to its own storage (presets, settings, recordings) since it
/// was loaded. Belongs to the exact package it came from.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SaveError {
    #[error("a save can only be restored before the firmware has run")]
    AlreadyRunning,
    #[error("this is not a save of this emulator")]
    Malformed,
}

/// A running firmware.
pub trait Emulator {
    fn info(&self) -> &Info;

    /// Takes effect as the machine runs on.
    fn input(&mut self, input: &Input);

    /// The pull a sound card makes: run the machine until it has `frames` stereo frames, and
    /// append them to `out` (interleaved L R). Returns the frames appended: fewer than asked
    /// when the firmware has not made them in the time those frames stand for (it is still
    /// starting, or the host is too slow); the caller plays silence for the rest. Calling
    /// this at the pace audio is played is what keeps the machine in real time.
    fn render(&mut self, frames: usize, out: &mut Vec<i16>) -> Result<usize, Stopped>;

    /// Frames the firmware has made that `render` has not handed out yet. A firmware's
    /// audio clock is its own, a hair off the nominal rate: a caller that sees this grow
    /// pulls the surplus too, or the sound falls behind the controls.
    fn pending_frames(&self) -> usize;

    /// Run `ms` of emulated time whatever audio that makes (it waits for `render`). For
    /// running without a sound card: tests, screenshots.
    fn run(&mut self, ms: u64) -> Result<(), Stopped>;

    fn screen(&self) -> Screen<'_>;

    /// How lit each LED was since the last call (0..=1 of the time; the order is the board's).
    fn leds(&mut self) -> Vec<f32>;

    /// Emulated milliseconds since the start.
    fn elapsed_ms(&self) -> u64;

    /// `Some` once the firmware has stopped.
    fn stopped(&self) -> Option<&Stopped>;

    /// Changes whenever the firmware writes to its storage: save again when it differs.
    fn storage_revision(&self) -> u32;

    /// The firmware is in the middle of a write: a save taken now may be half of one.
    fn storage_busy(&self) -> bool;

    /// What the firmware has stored since it was loaded (empty: nothing).
    fn save(&self) -> Vec<u8>;

    /// Put a [`save`](Emulator::save) of the same package back. Before the first `render` or
    /// `run` only; a refused save changes nothing.
    fn restore(&mut self, save: &[u8]) -> Result<(), SaveError>;
}

/// Start a package (a `.fwsc`, whole, as downloaded).
pub fn load(package: &[u8], options: &Options) -> Result<Box<dyn Emulator>, LoadError> {
    Ok(Box::new(Fm1Emu::new(package, options)?))
}
