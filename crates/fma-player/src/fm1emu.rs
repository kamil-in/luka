//! The fm1-emu crates as an [`Emulator`]. The boot follows fm1-emu's own native player
//! (its crates/fm1-live, `Machine::new`), the audio pull its browser build (crates/fm1-web,
//! `fm1_render`).

use crate::{Board, Emulator, Info, Input, LoadError, Options, SaveError, Screen, Stopped};
use fm1_core::{Bus, Cpu};
use fm1_soc::{machine, Action, Soc};

const RAM_SIZE: usize = 1 << 20;
/// What the firmwares' I2S is played at (it runs a hair faster: 24 MHz / 544).
const SAMPLE_RATE: u32 = 44_100;
const LCD: u32 = 240;
/// cpu0's instructions between two looks at the clock and the audio.
const CHUNK: u32 = 20_000;
const SECTOR: usize = 4096;
/// A save's record: a sector's offset in flash (u32, little endian), then the sector.
const RECORD: usize = 4 + SECTOR;

pub struct Fm1Emu {
    cpu: Cpu,
    /// the second core, once the firmware releases it
    cpu1: Option<Cpu>,
    soc: Soc,
    pending_tick: bool,
    jit: bool,
    /// interleaved L R, made and not yet handed out
    audio: Vec<i16>,
    /// the flash as loaded: a save is what differs from it
    flash0: Vec<u8>,
    started: bool,
    stopped: Option<Stopped>,
    info: Info,
}

impl Fm1Emu {
    pub fn new(package: &[u8], options: &Options) -> Result<Self, LoadError> {
        let st = fm1_soc::stock_from_package(package, None).map_err(LoadError)?;
        let mut soc = Soc::new(RAM_SIZE, st.xip.clone());
        soc.periph.hz = options.clock_mhz.max(1) as u64 * 1_000_000;
        soc.periph.skip_idle = true;
        let mut cpu = Cpu::new(st.entry);
        cpu.jit_on = options.jit;
        cpu.user = true; // the chip's loader hands cpu0 over in user mode
        let params = fm1_soc::RAM_BASE + 0x7fc00;
        soc.write32(params, params + 0x40);
        cpu.regs[0] = fm1_soc::stock_boot(&mut soc, &st.flash, params, st.board);
        soc.sfc_boot(st.key, st.app_end);
        let flash0 = soc.flash.mem.clone();
        let info = Info {
            identity: st.identity,
            board: match st.board {
                fm1_soc::Board::Fm1 => Board::Fm1,
                fm1_soc::Board::Smk37 => Board::Smk37,
            },
            sample_rate: SAMPLE_RATE,
            screen_width: LCD,
            screen_height: LCD,
        };
        Ok(Fm1Emu { cpu, cpu1: None, soc, pending_tick: false, jit: options.jit, audio: Vec::new(), flash0, started: false, stopped: None, info })
    }

    /// One chunk of the machine, its audio into the queue.
    fn chunk(&mut self) -> Result<(), Stopped> {
        if let Some(stopped) = &self.stopped {
            return Err(stopped.clone());
        }
        self.started = true;
        let Fm1Emu { cpu, cpu1, soc, pending_tick, jit, .. } = self;
        let ran = machine::run_dual(cpu1, soc, CHUNK, RAM_SIZE, *jit, |soc, k| machine::run_blocks(cpu, soc, k, pending_tick));
        self.audio.append(&mut self.soc.periph.audio);
        ran.map_err(|reason| {
            let stopped = Stopped { at_ms: self.soc.periph.ms(), reason };
            self.stopped = Some(stopped.clone());
            stopped
        })
    }

    fn cycles_of_ms(&self, ms: u64) -> u64 {
        self.soc.periph.hz * ms / 1000
    }
}

impl Emulator for Fm1Emu {
    fn info(&self) -> &Info {
        &self.info
    }

    fn input(&mut self, input: &Input) {
        let periph = &mut self.soc.periph;
        match input {
            Input::Key { id, down, velocity } => {
                if let Some(vel) = velocity.filter(|_| *down) {
                    let vel = vel.clamp(1, 127);
                    // (the two boards read velocity differently: the FM-1 as force, the
                    // SMK-37 as the time between a key's two contacts, 4 ms hard .. 100 ms soft)
                    match self.info.board {
                        Board::Fm1 => periph.apply(&Action::KeyVel { vel }),
                        Board::Smk37 => periph.apply(&Action::Vel { us: 100_000 - (vel as u32 - 1) * 96_000 / 126 }),
                    }
                }
                periph.apply(&Action::Key { id: *id, down: *down });
            }
            Input::Encoder { id, clicks } => periph.apply(&Action::Enc { enc: *id, clicks: *clicks }),
            Input::Analog { channel, value } => periph.apply(&Action::Adc { ch: *channel, value: (*value).min(1023) }),
            Input::Midi { bytes } => {
                for &b in bytes {
                    periph.apply(&Action::Midi { b });
                }
            }
        }
    }

    fn render(&mut self, frames: usize, out: &mut Vec<i16>) -> Result<usize, Stopped> {
        // the time these frames stand for and half as much again, and never less than 20 ms
        // (a start that makes no audio yet still gets on)
        let ms = (frames as u64 * 1500 / SAMPLE_RATE as u64).max(20);
        let until = self.soc.periph.cycles + self.cycles_of_ms(ms);
        let mut result = Ok(());
        while self.audio.len() / 2 < frames && self.soc.periph.cycles < until {
            result = self.chunk();
            if result.is_err() {
                break;
            }
        }
        // (what was made before a stop is still played)
        let n = (self.audio.len() / 2).min(frames);
        out.extend(self.audio.drain(..n * 2));
        if n == 0 { result.map(|()| 0) } else { Ok(n) }
    }

    fn pending_frames(&self) -> usize {
        self.audio.len() / 2
    }

    fn run(&mut self, ms: u64) -> Result<(), Stopped> {
        let until = self.soc.periph.cycles + self.cycles_of_ms(ms);
        while self.soc.periph.cycles < until {
            self.chunk()?;
        }
        Ok(())
    }

    fn screen(&self) -> Screen<'_> {
        Screen { revision: self.soc.lcd.revision, width: LCD, height: LCD, pixels: &self.soc.lcd.fb }
    }

    fn leds(&mut self) -> Vec<f32> {
        match self.info.board {
            Board::Fm1 => self.soc.periph.led_take().to_vec(),
            Board::Smk37 => self.soc.periph.smk.led_take().to_vec(),
        }
    }

    fn elapsed_ms(&self) -> u64 {
        self.soc.periph.ms()
    }

    fn stopped(&self) -> Option<&Stopped> {
        self.stopped.as_ref()
    }

    fn storage_revision(&self) -> u32 {
        self.soc.flash.revision
    }

    fn storage_busy(&self) -> bool {
        self.soc.flash.busy()
    }

    fn save(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let sectors = self.soc.flash.mem.chunks_exact(SECTOR).zip(self.flash0.chunks_exact(SECTOR));
        for (i, (now, then)) in sectors.enumerate() {
            if now != then {
                out.extend_from_slice(&((i * SECTOR) as u32).to_le_bytes());
                out.extend_from_slice(now);
            }
        }
        out
    }

    fn restore(&mut self, save: &[u8]) -> Result<(), SaveError> {
        if self.started {
            return Err(SaveError::AlreadyRunning);
        }
        let size = self.soc.flash.mem.len();
        if save.len() % RECORD != 0 {
            return Err(SaveError::Malformed);
        }
        // all of it or none: every record is checked before the first is applied
        let mut image = self.soc.flash.mem.clone();
        let mut seen = vec![false; size / SECTOR];
        for record in save.chunks_exact(RECORD) {
            let at = u32::from_le_bytes(record[..4].try_into().expect("4 bytes")) as usize;
            if at % SECTOR != 0 || at + SECTOR > size || std::mem::replace(&mut seen[at / SECTOR], true) {
                return Err(SaveError::Malformed);
            }
            image[at..at + SECTOR].copy_from_slice(&record[4..]);
        }
        // (through to the memory-mapped view too, as the firmware's own writes go)
        self.soc.restore_flash(&image);
        Ok(())
    }
}
