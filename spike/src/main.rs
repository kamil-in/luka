//! Spike: boot a firmware package headless through the fm1-emu crates, run it for a few
//! emulated seconds, and write what it drew (BMP) and what it played (WAV).
//!
//!   fma-spike FIRMWARE.fwsc [SECONDS] [OUT_DIR]
//!
//! The boot sequence follows fm1-emu's own native player (crates/fm1-live, `Machine::new`).

use fm1_core::{Bus, Cpu};
use fm1_soc::{machine, Soc};
use std::time::Instant;

const RAM_SIZE: usize = 1 << 20;
const MHZ: u64 = 240; // fm1-live's default clock
const AUDIO_HZ: u32 = 44_100;
const LCD: usize = 240;

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let path = args.first().ok_or("usage: fma-spike FIRMWARE.fwsc [SECONDS] [OUT_DIR]")?;
    let seconds: u64 = args.get(1).map_or(Ok(5), |s| s.parse()).map_err(|_| "SECONDS: not a number")?;
    let out = args.get(2).cloned().unwrap_or_else(|| ".".into());

    let pkg = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    let st = fm1_soc::stock_from_package(&pkg, None).map_err(|e| format!("{path}: {e}"))?;
    println!("package : {path} ({} bytes)", pkg.len());
    println!("identity: {:?}  board: {:?}  entry: {:#010x}", st.identity, st.board, st.entry);

    let mut soc = Soc::new(RAM_SIZE, st.xip.clone());
    soc.periph.hz = MHZ * 1_000_000;
    soc.periph.skip_idle = true;
    let mut cpu = Cpu::new(st.entry);
    cpu.jit_on = std::env::var_os("FMA_NO_JIT").is_none();
    cpu.user = true;
    let params = fm1_soc::RAM_BASE + 0x7fc00;
    soc.write32(params, params + 0x40);
    cpu.regs[0] = fm1_soc::stock_boot(&mut soc, &st.flash, params, st.board);
    soc.sfc_boot(st.key, st.app_end);

    let mut cpu1: Option<Cpu> = None;
    let mut pending_tick = false;
    let mut audio: Vec<i16> = Vec::new();
    let target = soc.periph.hz * seconds;
    let jit = cpu.jit_on;
    let wall = Instant::now();
    let mut fault = None;
    while soc.periph.cycles < target {
        let r = machine::run_dual(&mut cpu1, &mut soc, 20_000, RAM_SIZE, jit, |soc, k| {
            machine::run_blocks(&mut cpu, soc, k, &mut pending_tick)
        });
        audio.append(&mut soc.periph.audio);
        if let Err(e) = r {
            fault = Some(e);
            break;
        }
    }
    let wall = wall.elapsed().as_secs_f64();
    let emulated = soc.periph.cycles as f64 / soc.periph.hz as f64;

    let frames = audio.len() / 2;
    let peak = audio.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0);
    let lit = soc.lcd.fb.iter().filter(|&&p| p != 0).count();
    println!("ran     : {emulated:.2} s emulated in {wall:.2} s ({:.1}x real time), jit {}", emulated / wall, if jit { "on" } else { "off" });
    println!("cores   : cpu1 {}", if cpu1.is_some() { "running" } else { "not released" });
    println!("lcd     : revision {}, {lit} of {} pixels non-black", soc.lcd.revision, LCD * LCD);
    println!("audio   : {frames} frames ({:.2} s at {AUDIO_HZ} Hz), peak {peak}", frames as f64 / AUDIO_HZ as f64);

    std::fs::create_dir_all(&out).map_err(|e| format!("{out}: {e}"))?;
    let (bmp, wav) = (format!("{out}/screen.bmp"), format!("{out}/audio.wav"));
    std::fs::write(&bmp, bmp_bytes(&soc.lcd.fb)).map_err(|e| format!("{bmp}: {e}"))?;
    std::fs::write(&wav, wav_bytes(&audio)).map_err(|e| format!("{wav}: {e}"))?;
    println!("wrote   : {bmp}, {wav}");

    match fault {
        Some(e) => Err(format!("the firmware stopped after {emulated:.2} s: {e}")),
        None => Ok(()),
    }
}

/// RGB565 framebuffer -> 24-bit BMP (rows bottom-up, BGR).
fn bmp_bytes(fb: &[u16]) -> Vec<u8> {
    let data = LCD * LCD * 3;
    let mut b = Vec::with_capacity(54 + data);
    b.extend_from_slice(b"BM");
    b.extend_from_slice(&((54 + data) as u32).to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&54u32.to_le_bytes());
    b.extend_from_slice(&40u32.to_le_bytes());
    b.extend_from_slice(&(LCD as i32).to_le_bytes());
    b.extend_from_slice(&(LCD as i32).to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&24u16.to_le_bytes());
    b.extend_from_slice(&[0; 24]);
    for y in (0..LCD).rev() {
        for x in 0..LCD {
            let p = fb[y * LCD + x];
            let (r, g, bl) = ((p >> 11) & 31, (p >> 5) & 63, p & 31);
            b.extend_from_slice(&[(bl << 3 | bl >> 2) as u8, (g << 2 | g >> 4) as u8, (r << 3 | r >> 2) as u8]);
        }
    }
    b
}

/// Interleaved stereo i16 -> WAV.
fn wav_bytes(samples: &[i16]) -> Vec<u8> {
    let data = samples.len() * 2;
    let mut b = Vec::with_capacity(44 + data);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&((36 + data) as u32).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&AUDIO_HZ.to_le_bytes());
    b.extend_from_slice(&(AUDIO_HZ * 4).to_le_bytes());
    b.extend_from_slice(&4u16.to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&(data as u32).to_le_bytes());
    for s in samples {
        b.extend_from_slice(&s.to_le_bytes());
    }
    b
}
