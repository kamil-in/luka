//! The one thing a UI talks to. A client (a Tauri window now, a web page later) sends
//! [`Command`]s and is handed [`Event`]s, screen [`Frame`]s and audio through a
//! [`Transport`] it implements. It never touches the fetching or the emulator.
//!
//! ```no_run
//! use fma_display::{Command, Event, Frame, Session, Transport};
//! use std::sync::Arc;
//!
//! struct Window;
//! impl Transport for Window {
//!     fn event(&self, event: Event) { /* to the UI, as JSON */ }
//!     fn frame(&self, frame: Frame<'_>) { /* to a canvas */ }
//!     fn audio(&self, samples: &[i16], sample_rate: u32) { /* to the sound card */ }
//! }
//!
//! let session = Session::spawn("app/data/dir", Box::new(fma_fetch::GithubSource::new()), Arc::new(Window))?;
//! session.send(Command::Add { link: "https://github.com/owner/repo".into() });
//! // ... Event::Added { firmware } arrives ...
//! # let id = String::new();
//! session.send(Command::Start { id, options: None });
//! # Ok::<(), fma_fetch::Error>(())
//! ```
//!
//! The parts, from the outside in:
//! * [`protocol`]: the messages. Plain data, serializable: the same JSON over any transport.
//! * [`Transport`]: where the output goes. One implementation per kind of client.
//! * [`Session`]: the native runner: threads, the wall clock, the save files.
//! * [`Player`] and [`LibraryService`]: what the session runs, without threads, clocks or
//!   files of their own, so a client that has none of those (a browser) can drive them itself.

mod library;
mod player;
pub mod protocol;
#[cfg(not(target_arch = "wasm32"))]
mod session;

pub use library::LibraryService;
pub use player::Player;
pub use protocol::{Command, Event};
#[cfg(not(target_arch = "wasm32"))]
pub use session::Session;

/// One picture of the screen.
#[derive(Debug, Clone, Copy)]
pub struct Frame<'a> {
    /// The screen's revision this is a picture of.
    pub revision: u32,
    pub width: u32,
    pub height: u32,
    /// `width * height * 4` bytes, RGBA, row by row from the top left.
    pub rgba: &'a [u8],
}

/// Where a session's output goes. Called from the session's threads: return quickly (queue,
/// do not block), and expect `frame` and `audio` many times a second.
pub trait Transport {
    /// Something happened: small, and the same JSON for every client.
    fn event(&self, event: Event);
    /// The screen changed (at most about 60 times a second).
    fn frame(&self, frame: Frame<'_>);
    /// The next audio, in order: stereo, interleaved L R. It comes at the pace it is to be
    /// played, give or take the firmware's own clock: the player of it keeps a small buffer,
    /// plays silence when that runs dry and drops the oldest when it overflows.
    fn audio(&self, samples: &[i16], sample_rate: u32);
}
