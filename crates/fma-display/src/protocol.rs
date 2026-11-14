//! The messages between a client and a session. As JSON each is an object with a `type`:
//!
//! ```json
//! {"type": "add", "link": "https://github.com/owner/repo"}
//! {"type": "start", "id": "owner/repo@v1.0#thing.fwsc"}
//! {"type": "input", "input": {"type": "key", "id": 21, "down": true, "velocity": 100}}
//! ```
//!
//! The web client (`ui/web/transport-web.js`) plays several firmwares at once, each in a
//! slot: there `start`, `start_build`, `stop` and `input` may carry a `slot` (0..=3; none: 0),
//! `started`, `stopped`, `leds` and errors carry it back, and there is a `mute` command
//! (`{"type": "mute", "slot": 1, "muted": true}`, answered by a `muted` event). A session
//! here plays one firmware: it has no `slot` (one sent to it is ignored) and no `mute`.

pub use fma_fetch::{Asset, Firmware, Release};
pub use fma_player::{Board, Info, Input, Options};

use serde::{Deserialize, Serialize};

/// What a client asks for. Every command is answered by one or more [`Event`]s, or by
/// [`Event::Error`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    /// -> [`Event::Library`]
    ListLibrary,
    /// The whole of "paste a link". -> [`Event::Added`] and [`Event::Library`]; or
    /// [`Event::Choose`] when the release has several packages (answer with `Install`).
    Add { link: String },
    /// Look at a link without adding anything. -> [`Event::Choose`]
    Resolve { link: String },
    /// Add one package (by its name) of a release an `Event::Choose` showed.
    /// -> [`Event::Added`] and [`Event::Library`]
    Install { release: Release, asset: String },
    /// -> [`Event::Update`]
    CheckUpdate { id: String },
    /// -> [`Event::Removed`] and [`Event::Library`]
    Remove { id: String },
    /// Play a firmware of the library (stopping the one playing). -> [`Event::Started`], then
    /// frames and audio until [`Event::Stopped`].
    Start { id: String, #[serde(default)] options: Option<Options> },
    /// -> [`Event::Stopped`]
    Stop,
    /// Something done to the device playing (ignored when none is).
    Input { input: Input },
    /// The firmwares' own browser builds this client can offer. -> [`Event::Builds`] (empty
    /// where there are none: only the web client has them)
    ListBuilds,
    /// Play one of them. -> as `Start`
    StartBuild { id: String },
}

impl Command {
    /// A command for the library (it may take a while: the network), not for the player.
    pub fn is_library(&self) -> bool {
        !matches!(self, Command::Start { .. } | Command::StartBuild { .. } | Command::Stop | Command::Input { .. })
    }
}

/// A firmware's own browser build: its source compiled by its author to run in a page
/// directly, in place of the package the emulator runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Build {
    pub id: String,
    /// The firmware's name.
    pub name: String,
    /// `owner/repo` it is from, and the commit of the file.
    pub repo: String,
    pub commit: String,
    pub size: u64,
    /// This client knows how to drive it (`false`: it is only listed).
    pub playable: bool,
    /// It makes sound by itself from power on (a generative firmware): a client playing
    /// several at once starts it muted.
    #[serde(default)]
    pub autostarts: bool,
}

/// What a client is told.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Everything in the library, oldest first.
    Library { firmwares: Vec<Firmware> },
    /// A release and its packages, for the user to choose one of.
    Choose { release: Release },
    Added { firmware: Firmware },
    /// `release`: the newer one, or `None` when the firmware is the latest.
    Update { id: String, release: Option<Release> },
    Removed { id: String },
    /// A firmware is running. `save_restored`: it carries on from what it stored last time.
    Started { firmware: Firmware, info: Info, save_restored: bool },
    /// How lit each LED is now (0..=1), in the board's order. Sent when it changes.
    Leds { levels: Vec<f32> },
    /// The firmware runs no more. `reason`: why it stopped by itself (the emulator could not
    /// follow it); `None` when it was asked to.
    Stopped { reason: Option<String>, at_ms: u64 },
    /// A command failed. `command`: its `type`; `message`: for the user.
    Error { command: String, message: String },
    /// The firmwares' own browser builds on offer.
    Builds { builds: Vec<Build> },
    /// Something the user should know that is not a failure (the web client: the firmware
    /// was given a slower clock, this machine not keeping up with the faster one).
    Notice { message: String },
}
