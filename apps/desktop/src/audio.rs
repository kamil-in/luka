//! The sound card. The session hands audio over in pieces at about the pace it is played;
//! the card takes it when it wants, at its own rate. Between them: a small buffer, and a
//! resampler that leans a little (half a percent at most) to keep the buffer near its
//! target, so neither clock has to agree with the other.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

/// Frames kept ahead of the card: what covers the session's ticks arriving unevenly.
const TARGET: usize = 44_100 * 40 / 1000;
/// More than this and the oldest goes (the session ran ahead: a stall on the card's side).
const MOST: usize = 44_100 * 200 / 1000;

#[derive(Default)]
struct Ring {
    /// interleaved L R at `rate`
    samples: VecDeque<i16>,
    rate: u32,
    /// filling up again after running dry
    playing: bool,
    /// how far between the first frame and the second the next output frame is
    pos: f64,
    /// how full the buffer is on average (frames, over about a second): what the lean
    /// follows, not the level of the moment, which jumps with every piece that arrives
    level: f64,
    stats: Stats,
}

/// `FMA_AUDIO_LOG=1`: once a second on stderr, how the buffer fared.
#[derive(Default)]
struct Stats {
    on: bool,
    since: Option<std::time::Instant>,
    last_push: Option<std::time::Instant>,
    pushes: u32,
    pushed: usize,
    longest_gap_ms: f64,
    biggest_push: usize,
    dry: u32,
    dropped: usize,
    low: usize,
    high: usize,
    out_frames: usize,
    silent_frames: usize,
}

impl Stats {
    fn report(&mut self, have: usize) {
        let now = std::time::Instant::now();
        let since = *self.since.get_or_insert(now);
        if !self.on || now.duration_since(since).as_secs_f64() < 1.0 {
            return;
        }
        eprintln!(
            "audio: {} pushes ({} frames, biggest {}, longest gap {:.1} ms) | buffer {}..{} now {} | out {} frames, {} silent | ran dry {}x, dropped {}",
            self.pushes, self.pushed, self.biggest_push, self.longest_gap_ms, self.low, self.high, have, self.out_frames, self.silent_frames, self.dry, self.dropped
        );
        *self = Stats { on: true, since: Some(now), last_push: self.last_push, low: have, high: have, ..Stats::default() };
    }
}

#[derive(Clone)]
pub struct Output {
    ring: Arc<Mutex<Ring>>,
}

impl Output {
    /// Open the default output. Without one the app still runs, silent.
    pub fn start() -> Output {
        let stats = Stats { on: std::env::var_os("FMA_AUDIO_LOG").is_some(), ..Stats::default() };
        let ring = Arc::new(Mutex::new(Ring { rate: 44_100, stats, ..Ring::default() }));
        let for_card = ring.clone();
        // (a stream belongs to the thread that made it, and lives as long as that does)
        std::thread::Builder::new()
            .name("fma-audio".into())
            .spawn(move || match open(for_card) {
                Ok(stream) => {
                    let _keep = stream;
                    loop {
                        std::thread::park();
                    }
                }
                Err(e) => eprintln!("no sound: {e}"),
            })
            .expect("a thread for the sound card");
        Output { ring }
    }

    pub fn push(&self, samples: &[i16], rate: u32) {
        let mut ring = self.ring.lock().unwrap();
        ring.rate = rate;
        ring.samples.extend(samples);
        let now = std::time::Instant::now();
        if let Some(last) = ring.stats.last_push.replace(now) {
            ring.stats.longest_gap_ms = ring.stats.longest_gap_ms.max(now.duration_since(last).as_secs_f64() * 1000.0);
        }
        ring.stats.pushes += 1;
        ring.stats.pushed += samples.len() / 2;
        ring.stats.biggest_push = ring.stats.biggest_push.max(samples.len() / 2);
        let over = (ring.samples.len() / 2).saturating_sub(MOST);
        if over > 0 {
            ring.samples.drain(..(over + MOST - TARGET) * 2);
            ring.stats.dropped += over + MOST - TARGET;
        }
        ring.stats.high = ring.stats.high.max(ring.samples.len() / 2);
    }

    pub fn clear(&self) {
        let mut ring = self.ring.lock().unwrap();
        ring.samples.clear();
        ring.playing = false;
    }
}

fn open(ring: Arc<Mutex<Ring>>) -> Result<cpal::Stream, String> {
    let device = cpal::default_host().default_output_device().ok_or("there is no output device")?;
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    let format = config.sample_format();
    let config: cpal::StreamConfig = config.into();
    let stream = match format {
        SampleFormat::I16 => build::<i16>(&device, &config, ring),
        SampleFormat::U16 => build::<u16>(&device, &config, ring),
        _ => build::<f32>(&device, &config, ring),
    }?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

fn build<T: SizedSample + FromSample<f32>>(device: &cpal::Device, config: &cpal::StreamConfig, ring: Arc<Mutex<Ring>>) -> Result<cpal::Stream, String> {
    let (channels, card_rate) = (config.channels as usize, config.sample_rate.0 as f64);
    device
        .build_output_stream(
            config,
            move |out: &mut [T], _: &cpal::OutputCallbackInfo| {
                let mut ring = ring.lock().unwrap();
                let have = ring.samples.len() / 2;
                ring.stats.report(have);
                for frame in out.chunks_mut(channels) {
                    let (l, r) = ring.next(card_rate);
                    match frame {
                        [mono] => *mono = T::from_sample((l + r) / 2.0),
                        [left, right, rest @ ..] => {
                            *left = T::from_sample(l);
                            *right = T::from_sample(r);
                            rest.fill(T::from_sample(0.0));
                        }
                        [] => {}
                    }
                }
            },
            |e| eprintln!("sound: {e}"),
            None,
        )
        .map_err(|e| e.to_string())
}

impl Ring {
    /// The next output frame at the card's rate (silence while there is nothing to play).
    fn next(&mut self, card_rate: f64) -> (f32, f32) {
        let have = self.samples.len() / 2;
        self.stats.out_frames += 1;
        self.stats.low = self.stats.low.min(have);
        if !self.playing && have >= TARGET {
            (self.playing, self.pos, self.level) = (true, 0.0, TARGET as f64);
        }
        if !self.playing || have < 2 {
            self.stats.dry += self.playing as u32;
            self.stats.silent_frames += 1;
            self.playing = false;
            return (0.0, 0.0);
        }
        let s = |i: usize| self.samples[i] as f32 / 32768.0;
        let t = self.pos as f32;
        let frame = (s(0) + (s(2) - s(0)) * t, s(1) + (s(3) - s(1)) * t);
        // a fuller buffer is played a little faster, an emptier one a little slower
        self.level += (have as f64 - self.level) / card_rate;
        let lean = ((self.level - TARGET as f64) / TARGET as f64).clamp(-1.0, 1.0) * 0.005;
        self.pos += self.rate as f64 / card_rate * (1.0 + lean);
        while self.pos >= 1.0 && self.samples.len() >= 4 {
            self.samples.drain(..2);
            self.pos -= 1.0;
        }
        frame
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring(frames: usize) -> Ring {
        Ring { samples: (0..frames).flat_map(|i| [i as i16, -(i as i16)]).collect(), rate: 44_100, ..Ring::default() }
    }

    #[test]
    fn silent_until_there_is_enough_then_plays_in_order() {
        let mut r = ring(TARGET - 1);
        assert_eq!(r.next(44_100.0), (0.0, 0.0));
        r.samples.extend([0, 0, 0, 0]);
        let first: Vec<f32> = (0..100).map(|_| r.next(44_100.0).0 * 32768.0).collect();
        assert!(first.windows(2).all(|w| w[1] > w[0]), "rising, as the samples are");
        assert!((first[99] - 99.0).abs() < 2.0, "one frame out for one frame in: {}", first[99]);
    }

    #[test]
    fn a_faster_card_takes_frames_more_slowly() {
        let mut r = ring(TARGET + 2000);
        for _ in 0..960 {
            r.next(96_000.0);
        }
        let used = TARGET + 2000 - r.samples.len() / 2;
        assert!((436..=446).contains(&used), "{used} frames for 10 ms at 96 kHz");
    }

    #[test]
    fn runs_dry_into_silence_and_starts_again() {
        let mut r = ring(TARGET);
        for _ in 0..TARGET + 10 {
            r.next(44_100.0);
        }
        assert_eq!(r.next(44_100.0), (0.0, 0.0));
        assert!(!r.playing);
        r.samples.extend(std::iter::repeat_n(1000, TARGET * 2));
        assert!(r.next(44_100.0).0 != 0.0 || r.next(44_100.0).0 != 0.0);
    }
}
