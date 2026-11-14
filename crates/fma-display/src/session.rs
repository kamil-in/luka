//! The native runner: two threads behind one `send`.
//!
//! * the library thread runs the commands that may wait on the network, one at a time;
//! * the player thread runs the firmware against the wall clock, and is never held up by
//!   the other (a download does not make the sound stutter).
//!
//! Saves are files beside the library, `ROOT/saves/<the package's SHA-256>.sav`: a save
//! belongs to the exact package it came from, so a new version starts without one.

use crate::library::{name, not_here};
use crate::{Command, Event, LibraryService, Player, Transport};
use fma_fetch::{Error, Firmware, Library, Source};
use fma_player::Options;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// How often the firmware is run on while one plays.
const TICK: Duration = Duration::from_millis(4);

type Out = Arc<dyn Transport + Send + Sync>;

/// A running session. Dropping it stops the firmware (saving what it stored) and waits for
/// a command in flight.
pub struct Session {
    library: Option<Sender<Command>>,
    player: Option<Sender<Command>>,
    threads: Vec<JoinHandle<()>>,
}

impl Session {
    /// `root`: where the library and the saves are kept (created when missing).
    pub fn spawn(root: impl Into<PathBuf>, source: Box<dyn Source + Send>, transport: Out) -> Result<Session, Error> {
        let root: PathBuf = root.into();
        let service = LibraryService::new(Library::open(&root)?, source);
        let player_library = Library::open(&root)?;
        std::fs::create_dir_all(root.join("saves"))?;

        let (library_tx, library_rx) = mpsc::channel::<Command>();
        let (player_tx, player_rx) = mpsc::channel::<Command>();
        let out = transport.clone();
        let library = std::thread::Builder::new().name("fma-library".into()).spawn(move || {
            for command in library_rx {
                service.handle(&command, out.as_ref());
            }
        })?;
        let player = std::thread::Builder::new().name("fma-player".into()).spawn(move || {
            Playing { library: player_library, out: transport, now: None }.run(player_rx);
        })?;
        Ok(Session { library: Some(library_tx), player: Some(player_tx), threads: vec![library, player] })
    }

    /// Returns at once: the answer comes through the transport.
    pub fn send(&self, command: Command) {
        let to = if command.is_library() { &self.library } else { &self.player };
        // (a send fails only once the thread is gone, and that only in drop)
        let _ = to.as_ref().map(|tx| tx.send(command));
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        (self.library, self.player) = (None, None);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

/// The player thread's state.
struct Playing {
    library: Library,
    out: Out,
    now: Option<(Player, Firmware)>,
}

impl Playing {
    fn run(mut self, commands: mpsc::Receiver<Command>) {
        let mut last = Instant::now();
        loop {
            // (with nothing playing there is nothing to do until a command comes. While one
            // plays the pace is `sleep`'s, below: a wait on the channel is only as fine as the
            // system's timer, 16 ms on Windows, and the audio would come in lumps that long)
            let first = match &self.now {
                Some(_) => commands.try_recv().map_err(|e| match e {
                    mpsc::TryRecvError::Empty => RecvTimeoutError::Timeout,
                    mpsc::TryRecvError::Disconnected => RecvTimeoutError::Disconnected,
                }),
                None => commands.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match first {
                Ok(command) => {
                    let idle = self.now.is_none();
                    self.handle(command);
                    while let Ok(command) = commands.try_recv() {
                        self.handle(command);
                    }
                    if idle {
                        last = Instant::now(); // the wait for the command is not the firmware's time
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            let now = Instant::now();
            if let Some((player, firmware)) = &mut self.now {
                player.tick(now - last, self.out.as_ref());
                if let Some(save) = player.save_due() {
                    write_save(&self.library, &self.out, firmware, &save);
                }
            }
            last = now;
            if self.now.is_some() {
                std::thread::sleep(TICK.saturating_sub(now.elapsed()));
            }
        }
        self.stop(false);
    }

    fn handle(&mut self, command: Command) {
        match command {
            Command::Start { id, options } => {
                if let Err(message) = self.start(&id, &options.unwrap_or_default()) {
                    self.out.event(Event::Error { command: "start".into(), message });
                }
            }
            Command::StartBuild { .. } => self.out.event(Event::Error {
                command: "start_build".into(),
                message: "browser builds play in the web client only: here, add the firmware by its link".into(),
            }),
            Command::Stop => self.stop(true),
            Command::Input { input } => {
                if let Some((player, _)) = &mut self.now {
                    player.input(&input);
                }
            }
            other => debug_assert!(false, "{} is a library command", name(&other)),
        }
    }

    fn start(&mut self, id: &str, options: &Options) -> Result<(), String> {
        let firmware = self.library.get(id).map_err(|e| e.to_string())?.ok_or_else(|| not_here(id).to_string())?;
        let package = self.library.read_package(&firmware).map_err(|e| e.to_string())?;
        // (the one playing keeps playing if the new one cannot start, but its save is taken
        // first: it may be the very file read next)
        if let Some((player, playing)) = &mut self.now {
            if let Some(save) = player.save_now() {
                write_save(&self.library, &self.out, playing, &save);
            }
        }
        let save = std::fs::read(save_path(&self.library, &firmware)).ok();
        let player = Player::start(&package, options, save.as_deref()).map_err(|e| e.to_string())?;
        self.stop(true);
        self.out.event(Event::Started { firmware: firmware.clone(), info: player.info().clone(), save_restored: player.save_restored() });
        self.now = Some((player, firmware));
        Ok(())
    }

    /// `tell`: say so (not when the session itself is going away).
    fn stop(&mut self, tell: bool) {
        let Some((mut player, firmware)) = self.now.take() else { return };
        if let Some(save) = player.save_now() {
            write_save(&self.library, &self.out, &firmware, &save);
        }
        // (a firmware that stopped by itself has said so already)
        if tell && !player.is_stopped() {
            self.out.event(Event::Stopped { reason: None, at_ms: player.elapsed_ms() });
        }
    }
}

fn save_path(library: &Library, firmware: &Firmware) -> PathBuf {
    library.root().join("saves").join(format!("{}.sav", firmware.sha256))
}

fn write_save(library: &Library, out: &Out, firmware: &Firmware, save: &[u8]) {
    if let Err(e) = write_whole(&save_path(library, firmware), save) {
        out.event(Event::Error { command: "save".into(), message: format!("{}'s storage could not be saved: {e}", firmware.repo) });
    }
}

/// All of the file or none of it.
fn write_whole(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("part");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}
