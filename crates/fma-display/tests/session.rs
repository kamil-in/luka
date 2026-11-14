//! A whole session as a client sees it: commands in, events, frames and audio out. The
//! source is a stand-in (no network); the firmware is real when there is a package
//! (`FMA_TEST_FWSC=path`, or the one in `.cache/firmware/`), and those tests are skipped,
//! saying so, without one. They run in real time: build optimized.
//!
//!   cargo test --release -p fma-display -- --nocapture

use fma_display::protocol::{Asset, Input, Release};
use fma_display::{Command, Event, Frame, Session, Transport};
use fma_fetch::{Error, Source};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Default)]
struct Client {
    events: Mutex<Vec<Event>>,
    frames: Mutex<Vec<u32>>,
    audio: Mutex<Vec<i16>>,
}

impl Transport for Client {
    fn event(&self, event: Event) {
        self.events.lock().unwrap().push(event);
    }
    fn frame(&self, frame: Frame<'_>) {
        assert_eq!(frame.rgba.len() as u32, frame.width * frame.height * 4);
        self.frames.lock().unwrap().push(frame.revision);
    }
    fn audio(&self, samples: &[i16], _rate: u32) {
        self.audio.lock().unwrap().extend_from_slice(samples);
    }
}

impl Client {
    /// The first event `pick` takes, within `secs`.
    fn wait<T>(&self, secs: u64, what: &str, pick: impl Fn(&Event) -> Option<T>) -> T {
        let until = Instant::now() + Duration::from_secs(secs);
        loop {
            if let Some(found) = self.events.lock().unwrap().iter().find_map(&pick) {
                return found;
            }
            assert!(Instant::now() < until, "no {what} within {secs} s; events: {:?}", self.events.lock().unwrap());
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    fn take_audio(&self) -> Vec<i16> {
        std::mem::take(&mut self.audio.lock().unwrap())
    }
}

/// One release, its packages' bytes at hand.
struct Shelf {
    names: Vec<&'static str>,
    body: Vec<u8>,
}

impl Source for Shelf {
    fn resolve(&self, link: &str) -> Result<Release, Error> {
        if !link.contains("owner/synth") {
            return Err(Error::NotFound(link.to_owned()));
        }
        let assets = self.names.iter().map(|n| Asset { name: (*n).into(), size: 0, url: format!("https://github.com/owner/synth/releases/download/v1/{n}") }).collect();
        Ok(Release {
            owner: "owner".into(), repo: "synth".into(), description: None, license: Some("MIT".into()), tag: "v1".into(), title: None,
            published_at: None, prerelease: false, page_url: "https://github.com/owner/synth/releases/tag/v1".into(), assets,
        })
    }
    fn download(&self, _asset: &Asset) -> Result<Vec<u8>, Error> {
        Ok(self.body.clone())
    }
}

fn root(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("fma-display-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    root
}

fn package() -> Option<Vec<u8>> {
    let path = std::env::var("FMA_TEST_FWSC")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../../.cache/firmware/felucca-1.8.2.fwsc").to_owned());
    let bytes = std::fs::read(&path).ok();
    if bytes.is_none() {
        eprintln!("no package at {path}: skipped");
    }
    bytes
}

#[test]
fn commands_are_json() {
    let c: Command = serde_json::from_str(r#"{"type":"input","input":{"type":"key","id":21,"down":true,"velocity":100}}"#).unwrap();
    assert_eq!(c, Command::Input { input: Input::Key { id: 21, down: true, velocity: Some(100) } });
    let c: Command = serde_json::from_str(r#"{"type":"start","id":"o/r@v1#a.fwsc"}"#).unwrap();
    assert_eq!(c, Command::Start { id: "o/r@v1#a.fwsc".into(), options: None });
    assert_eq!(serde_json::to_string(&Command::Stop).unwrap(), r#"{"type":"stop"}"#);
    assert_eq!(
        serde_json::to_string(&Event::Stopped { reason: None, at_ms: 12 }).unwrap(),
        r#"{"type":"stopped","reason":null,"at_ms":12}"#
    );
    assert_eq!(serde_json::to_string(&Event::Leds { levels: vec![0.5] }).unwrap(), r#"{"type":"leds","levels":[0.5]}"#);
}

#[test]
fn the_library_through_a_session() {
    let (root, client) = (root("library"), Arc::new(Client::default()));
    let session = Session::spawn(&root, Box::new(Shelf { names: vec!["fm1.fwsc", "smk37.fwsc"], body: b"PKG".to_vec() }), client.clone()).unwrap();

    session.send(Command::ListLibrary);
    assert!(client.wait(5, "library", |e| match e { Event::Library { firmwares } => Some(firmwares.is_empty()), _ => None }));

    // two packages: a choice, then the one chosen
    session.send(Command::Add { link: "github.com/owner/synth".into() });
    let release = client.wait(5, "choose", |e| match e { Event::Choose { release } => Some(release.clone()), _ => None });
    assert_eq!(release.assets.len(), 2);
    session.send(Command::Install { release, asset: "smk37.fwsc".into() });
    let fw = client.wait(5, "added", |e| match e { Event::Added { firmware } => Some(firmware.clone()), _ => None });
    assert_eq!(fw.id, "owner/synth@v1#smk37.fwsc");

    session.send(Command::CheckUpdate { id: fw.id.clone() });
    assert!(client.wait(5, "update", |e| match e { Event::Update { release, .. } => Some(release.is_none()), _ => None }));

    // what goes wrong is said, and by which command
    session.send(Command::Add { link: "github.com/nobody/nothing".into() });
    session.send(Command::Start { id: "not/there@v0#x.fwsc".into(), options: None });
    session.send(Command::Start { id: fw.id.clone(), options: None }); // "PKG" is no firmware
    for (command, part) in [("add", "not found"), ("start", "not in the library"), ("start", "not a firmware package")] {
        client.wait(5, part, |e| match e {
            Event::Error { command: c, message } if c == command && message.contains(part) => Some(()),
            _ => None,
        });
    }

    session.send(Command::Remove { id: fw.id.clone() });
    client.wait(5, "removed", |e| matches!(e, Event::Removed { .. }).then_some(()));
    drop(session);
    let last = client.events.lock().unwrap().iter().rev().find_map(|e| match e { Event::Library { firmwares } => Some(firmwares.len()), _ => None });
    assert_eq!(last, Some(0));
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_firmware_plays_through_a_session() {
    let Some(body) = package() else { return };
    let (root, client) = (root("play"), Arc::new(Client::default()));
    let session = Session::spawn(&root, Box::new(Shelf { names: vec!["synth.fwsc"], body }), client.clone()).unwrap();

    session.send(Command::Add { link: "https://github.com/owner/synth".into() });
    let fw = client.wait(10, "added", |e| match e { Event::Added { firmware } => Some(firmware.clone()), _ => None });
    session.send(Command::Start { id: fw.id.clone(), options: None });
    let info = client.wait(10, "started", |e| match e { Event::Started { info, save_restored: false, .. } => Some(info.clone()), _ => None });
    println!("{info:?}");

    // three seconds of start: a screen, LEDs, and audio at the pace of the clock
    let began = Instant::now();
    std::thread::sleep(Duration::from_secs(3));
    let (frames, start_audio) = (client.frames.lock().unwrap().len(), client.take_audio());
    let rate = start_audio.len() as f64 / 2.0 / began.elapsed().as_secs_f64();
    println!("{frames} screen frames, audio at {rate:.0} frames a second");
    assert!(frames >= 2, "the screen was sent");
    client.wait(1, "leds", |e| matches!(e, Event::Leds { .. }).then_some(()));
    assert!((30_000.0..=46_000.0).contains(&rate), "audio keeps real time ({rate:.0} frames a second)");

    // a second of nothing, then middle C held for a second
    std::thread::sleep(Duration::from_secs(1));
    let quiet = peak(&client.take_audio());
    let before = client.frames.lock().unwrap().len();
    session.send(Command::Input { input: Input::Key { id: 21, down: true, velocity: Some(110) } });
    session.send(Command::Input { input: Input::Encoder { id: 2, clicks: 3 } });
    std::thread::sleep(Duration::from_secs(1));
    session.send(Command::Input { input: Input::Key { id: 21, down: false, velocity: None } });
    let note = client.take_audio();
    println!("silence peak {quiet}, note peak {}, {} frames in the second", peak(&note), note.len() / 2);
    assert!(peak(&note) > 1000 && peak(&note) > quiet.saturating_mul(4), "the key sounds");
    assert!(note.len() / 2 > 40_000, "no gaps while it plays");
    assert!(client.frames.lock().unwrap().len() > before, "the knob redrew the screen");

    session.send(Command::Stop);
    client.wait(5, "stopped", |e| matches!(e, Event::Stopped { reason: None, .. }).then_some(()));
    std::thread::sleep(Duration::from_millis(100));
    client.take_audio();
    std::thread::sleep(Duration::from_millis(200));
    assert!(client.take_audio().is_empty(), "nothing plays after the stop");
    assert!(!client.events.lock().unwrap().iter().any(|e| matches!(e, Event::Error { .. })));
    drop(session);
    std::fs::remove_dir_all(&root).unwrap();
}

fn peak(samples: &[i16]) -> u16 {
    samples.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0)
}
