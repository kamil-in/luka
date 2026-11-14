//! One running firmware, turned into what a client sees and hears. No thread, clock or file
//! of its own: whoever owns it calls [`Player::tick`] with the time that has passed, and
//! keeps what [`Player::save_due`] hands back.

use crate::{Event, Frame, Transport};
use fma_player::{Emulator, Info, Input, LoadError, Options};
use std::time::Duration;

/// A screen is sent no more often than this (about 60 a second).
const FRAME_EVERY: Duration = Duration::from_millis(16);
const LEDS_EVERY: Duration = Duration::from_millis(33);
/// A tick stands for no more time than this: after a stall (the host was busy, the window
/// was asleep) the machine carries on from now, it does not race to catch up.
const LONGEST_TICK: Duration = Duration::from_millis(100);
/// Audio the firmware has made beyond what was pulled: above this, the surplus is sent too.
const MOST_PENDING: usize = 1024;
/// A save is taken once the firmware's storage has been left alone this long.
const SAVE_AFTER: Duration = Duration::from_secs(1);

pub struct Player {
    emu: Box<dyn Emulator>,
    /// frames owed to the audio, the fraction carried from tick to tick
    owed: f64,
    audio: Vec<i16>,
    since_frame: Duration,
    sent_revision: Option<u32>,
    since_leds: Duration,
    sent_leds: Vec<f32>,
    /// the storage revision last seen, how long it has stayed, and the one last saved
    storage: u32,
    storage_quiet: Duration,
    saved: u32,
    told_stopped: bool,
    save_restored: bool,
}

impl Player {
    /// Start a package. `save`: what [`save_due`](Player::save_due) handed back for this same
    /// package before; one that does not fit is left out (see [`save_restored`](Player::save_restored)).
    pub fn start(package: &[u8], options: &Options, save: Option<&[u8]>) -> Result<Self, LoadError> {
        let mut emu = fma_player::load(package, options)?;
        let restored = save.is_some_and(|s| emu.restore(s).is_ok());
        let mut player = Self::with_emulator(emu);
        player.save_restored = restored;
        Ok(player)
    }

    /// Around an emulator already made.
    pub fn with_emulator(emu: Box<dyn Emulator>) -> Self {
        let storage = emu.storage_revision();
        Player {
            emu, owed: 0.0, audio: Vec::new(), since_frame: FRAME_EVERY, sent_revision: None, since_leds: LEDS_EVERY,
            sent_leds: Vec::new(), storage, storage_quiet: Duration::ZERO, saved: storage, told_stopped: false, save_restored: false,
        }
    }

    pub fn info(&self) -> &Info {
        self.emu.info()
    }

    pub fn save_restored(&self) -> bool {
        self.save_restored
    }

    /// The firmware stopped by itself ([`Event::Stopped`] has said why).
    pub fn is_stopped(&self) -> bool {
        self.emu.stopped().is_some()
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.emu.elapsed_ms()
    }

    pub fn input(&mut self, input: &Input) {
        self.emu.input(input);
    }

    /// `dt` has passed since the last tick: run the machine that long, and send what came of
    /// it. Call it often and evenly (every few milliseconds): the audio comes in pieces of `dt`.
    pub fn tick(&mut self, dt: Duration, out: &dyn Transport) {
        let dt = dt.min(LONGEST_TICK);
        if !self.is_stopped() {
            let rate = self.emu.info().sample_rate;
            self.owed += dt.as_secs_f64() * rate as f64;
            let due = self.owed as usize;
            self.owed -= due as f64;
            self.audio.clear();
            // (a pull that comes back short is not owed again: the client plays silence there)
            let ran = self.emu.render(due, &mut self.audio);
            let pending = self.emu.pending_frames();
            if pending > MOST_PENDING {
                let _ = self.emu.render(pending - MOST_PENDING / 2, &mut self.audio);
            }
            if !self.audio.is_empty() {
                out.audio(&self.audio, rate);
            }
            if ran.is_err() || self.is_stopped() {
                self.tell_stopped(out);
            }
        }

        self.since_frame += dt;
        let screen = self.emu.screen();
        if self.since_frame >= FRAME_EVERY && self.sent_revision != Some(screen.revision) {
            out.frame(Frame { revision: screen.revision, width: screen.width, height: screen.height, rgba: &screen.rgba() });
            self.sent_revision = Some(screen.revision);
            self.since_frame = Duration::ZERO;
        }

        self.since_leds += dt;
        if self.since_leds >= LEDS_EVERY {
            self.since_leds = Duration::ZERO;
            let levels = self.emu.leds();
            let same = levels.len() == self.sent_leds.len() && levels.iter().zip(&self.sent_leds).all(|(a, b)| (a - b).abs() < 0.02);
            if !same {
                self.sent_leds = levels.clone();
                out.event(Event::Leds { levels });
            }
        }

        let storage = self.emu.storage_revision();
        if storage != self.storage {
            self.storage = storage;
            self.storage_quiet = Duration::ZERO;
        } else {
            self.storage_quiet += dt;
        }
    }

    fn tell_stopped(&mut self, out: &dyn Transport) {
        if let Some(stopped) = self.emu.stopped().filter(|_| !self.told_stopped) {
            out.event(Event::Stopped { reason: Some(stopped.reason.clone()), at_ms: stopped.at_ms });
            self.told_stopped = true;
        }
    }

    /// The firmware's storage to keep, when it has changed and settled since the last one
    /// handed back. Ask after each tick; give it to [`start`](Player::start) next time.
    pub fn save_due(&mut self) -> Option<Vec<u8>> {
        (self.storage_quiet >= SAVE_AFTER).then(|| self.save_now()).flatten()
    }

    /// As `save_due` without the wait: for when the firmware is about to be dropped. `None`
    /// when nothing changed, or in the middle of a write (a half save is worse than the last).
    pub fn save_now(&mut self) -> Option<Vec<u8>> {
        if self.storage == self.saved || self.emu.storage_busy() {
            return None;
        }
        self.saved = self.storage;
        Some(self.emu.save())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fma_player::{Board, SaveError, Screen, Stopped};
    use std::cell::RefCell;

    /// A machine that makes a little more audio than its nominal rate, and nothing else.
    struct Fake {
        info: Info,
        pixels: Vec<u16>,
        revision: u32,
        queue: usize,
        made: f64,
        ms: u64,
        fail_at_ms: Option<u64>,
        stopped: Option<Stopped>,
        storage: u32,
        busy: bool,
        leds: Vec<f32>,
    }

    fn fake() -> Fake {
        Fake {
            info: Info { identity: "FAKE_1".into(), board: Board::Fm1, sample_rate: 44_100, screen_width: 2, screen_height: 1 },
            pixels: vec![0xf800, 0x001f], revision: 1, queue: 0, made: 0.0, ms: 0, fail_at_ms: None, stopped: None,
            storage: 0, busy: false, leds: vec![0.0; 3],
        }
    }

    impl Emulator for Fake {
        fn info(&self) -> &Info { &self.info }
        fn input(&mut self, input: &Input) {
            match input {
                Input::Key { id, down, .. } => { self.leds[*id as usize] = *down as u8 as f32; self.revision += 1 }
                Input::Encoder { .. } => self.storage += 1,
                _ => {}
            }
        }
        fn render(&mut self, frames: usize, out: &mut Vec<i16>) -> Result<usize, Stopped> {
            if let Some(s) = &self.stopped { return Err(s.clone()) }
            // (a millisecond at a time, 44.118 frames each: 0.04 % fast, as the FM-1's I2S)
            let until = self.ms + (frames as u64 * 1500 / 44_100).max(20);
            while self.queue < frames && self.ms < until {
                self.ms += 1;
                self.made += 44.118;
                self.queue += self.made as usize;
                self.made -= (self.made as usize) as f64;
                if self.fail_at_ms.is_some_and(|at| self.ms >= at) {
                    let s = Stopped { at_ms: self.ms, reason: "an instruction the emulator does not know".into() };
                    self.stopped = Some(s.clone());
                    return Err(s);
                }
            }
            let n = self.queue.min(frames);
            self.queue -= n;
            out.extend(std::iter::repeat_n(7, n * 2));
            Ok(n)
        }
        fn pending_frames(&self) -> usize { self.queue }
        fn run(&mut self, _ms: u64) -> Result<(), Stopped> { Ok(()) }
        fn screen(&self) -> Screen<'_> { Screen { revision: self.revision, width: 2, height: 1, pixels: &self.pixels } }
        fn leds(&mut self) -> Vec<f32> { self.leds.clone() }
        fn elapsed_ms(&self) -> u64 { self.ms }
        fn stopped(&self) -> Option<&Stopped> { self.stopped.as_ref() }
        fn storage_revision(&self) -> u32 { self.storage }
        fn storage_busy(&self) -> bool { self.busy }
        fn save(&self) -> Vec<u8> { vec![self.storage as u8] }
        fn restore(&mut self, _save: &[u8]) -> Result<(), SaveError> { Ok(()) }
    }

    #[derive(Default)]
    struct Seen {
        events: RefCell<Vec<Event>>,
        frames: RefCell<Vec<(u32, Vec<u8>)>>,
        samples: RefCell<usize>,
    }

    impl Transport for Seen {
        fn event(&self, event: Event) { self.events.borrow_mut().push(event) }
        fn frame(&self, f: Frame<'_>) { self.frames.borrow_mut().push((f.revision, f.rgba.to_vec())) }
        fn audio(&self, samples: &[i16], rate: u32) {
            assert_eq!(rate, 44_100);
            *self.samples.borrow_mut() += samples.len();
        }
    }

    const MS5: Duration = Duration::from_millis(5);

    #[test]
    fn audio_keeps_real_time_and_does_not_pile_up() {
        let (mut p, seen) = (Player::with_emulator(Box::new(fake())), Seen::default());
        for _ in 0..200 * 60 {
            p.tick(MS5, &seen); // a minute
        }
        let frames = *seen.samples.borrow() / 2;
        // everything the firmware made (44118 a second), but for the little kept pending
        assert!((44_118 * 60 - 2 * MOST_PENDING..=44_118 * 60 + 500).contains(&frames), "{frames}");
        assert!(p.emu.pending_frames() <= MOST_PENDING + 256);
        assert!((59_900..=60_100).contains(&p.elapsed_ms()), "{} ms emulated in a minute", p.elapsed_ms());
    }

    #[test]
    fn a_stall_is_not_caught_up() {
        let (mut p, seen) = (Player::with_emulator(Box::new(fake())), Seen::default());
        p.tick(Duration::from_secs(30), &seen);
        assert!(*seen.samples.borrow() / 2 <= 44_100 / 10 + MOST_PENDING);
    }

    #[test]
    fn the_screen_is_sent_when_it_changes() {
        let (mut p, seen) = (Player::with_emulator(Box::new(fake())), Seen::default());
        p.tick(MS5, &seen);
        assert_eq!(*seen.frames.borrow(), vec![(1, vec![255, 0, 0, 255, 0, 0, 255, 255])], "the first tick shows the screen");
        for _ in 0..20 {
            p.tick(MS5, &seen);
        }
        assert_eq!(seen.frames.borrow().len(), 1, "an unchanged screen is not sent again");
        // changed on every tick for a second: sent at the frame pace, not the tick's
        for _ in 0..200 {
            p.input(&Input::Key { id: 0, down: true, velocity: None });
            p.tick(MS5, &seen);
        }
        let sent = seen.frames.borrow().len() - 1;
        assert!((45..=63).contains(&sent), "{sent} frames in a second");
    }

    #[test]
    fn leds_are_told_when_they_change() {
        let (mut p, seen) = (Player::with_emulator(Box::new(fake())), Seen::default());
        for _ in 0..20 {
            p.tick(MS5, &seen);
        }
        p.input(&Input::Key { id: 2, down: true, velocity: Some(90) });
        for _ in 0..20 {
            p.tick(MS5, &seen);
        }
        let leds: Vec<Event> = seen.events.borrow().iter().filter(|e| matches!(e, Event::Leds { .. })).cloned().collect();
        assert_eq!(leds, vec![Event::Leds { levels: vec![0.0; 3] }, Event::Leds { levels: vec![0.0, 0.0, 1.0] }]);
    }

    #[test]
    fn a_firmware_that_stops_says_so_once_and_keeps_its_screen() {
        let mut emu = fake();
        emu.fail_at_ms = Some(50);
        let (mut p, seen) = (Player::with_emulator(Box::new(emu)), Seen::default());
        for _ in 0..100 {
            p.tick(MS5, &seen);
        }
        assert!(p.is_stopped());
        let stops: Vec<Event> = seen.events.borrow().iter().filter(|e| matches!(e, Event::Stopped { .. })).cloned().collect();
        assert_eq!(stops, vec![Event::Stopped { reason: Some("an instruction the emulator does not know".into()), at_ms: 50 }]);
        assert_eq!(seen.frames.borrow().len(), 1);
        assert!(*seen.samples.borrow() / 2 < 44_100 / 10, "no audio after the stop");
    }

    #[test]
    fn storage_is_saved_once_it_settles() {
        let (mut p, seen) = (Player::with_emulator(Box::new(fake())), Seen::default());
        let ticks = |p: &mut Player, n: u32| (0..n).filter_map(|_| { p.tick(MS5, &seen); p.save_due() }).collect::<Vec<_>>();
        assert!(ticks(&mut p, 400).is_empty(), "nothing stored, nothing to save");

        // written to for half a second: no save while it goes on, one a second after
        let mut during = Vec::new();
        for _ in 0..100 {
            p.input(&Input::Encoder { id: 0, clicks: 1 });
            during.extend(ticks(&mut p, 1));
        }
        assert!(during.is_empty());
        assert_eq!(ticks(&mut p, 400), vec![vec![100]]);
        assert!(p.save_now().is_none(), "saved already");

        p.input(&Input::Encoder { id: 0, clicks: 1 });
        p.tick(MS5, &seen);
        assert_eq!(p.save_now(), Some(vec![101]), "on the way out there is no waiting");
    }
}
