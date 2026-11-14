//! A real firmware through the player. Needs a package: `FMA_TEST_FWSC=path`, or the one the
//! spike left in `.cache/firmware/`; skipped (and says so) without one. Run it optimized, the
//! machine is slow otherwise:
//!
//!   cargo test --release -p fma-player -- --nocapture

use fma_player::{panel, Input, Options, SaveError};

fn package() -> Option<Vec<u8>> {
    let path = std::env::var("FMA_TEST_FWSC")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../../.cache/firmware/felucca-1.8.2.fwsc").to_owned());
    let bytes = std::fs::read(&path).ok();
    if bytes.is_none() {
        eprintln!("no package at {path}: skipped");
    }
    bytes
}

fn peak(samples: &[i16]) -> u16 {
    samples.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0)
}

#[test]
fn not_a_package() {
    assert!(fma_player::load(b"", &Options::default()).is_err());
    assert!(fma_player::load(&[0x5a; 4096], &Options::default()).is_err());
}

#[test]
fn boots_draws_and_sounds_a_note() {
    let Some(pkg) = package() else { return };
    let mut emu = fma_player::load(&pkg, &Options::default()).unwrap();
    println!("{:?}", emu.info());
    assert_eq!((emu.info().screen_width, emu.info().screen_height), (240, 240));

    emu.run(3000).unwrap();
    assert!(emu.elapsed_ms() >= 3000);
    let screen = emu.screen();
    assert_eq!(screen.pixels.len(), 240 * 240);
    assert!(screen.pixels.iter().any(|&p| p != screen.pixels[0]), "the screen shows something");
    assert_eq!(screen.rgba().len(), 240 * 240 * 4);

    // what the start left in the queue, then a second of silence: nothing is held
    let mut audio = Vec::new();
    while emu.render(4096, &mut audio).unwrap() == 4096 && audio.len() < 2 * 44_100 * 4 {}
    audio.clear();
    for _ in 0..86 {
        emu.render(512, &mut audio).unwrap();
    }
    let quiet = peak(&audio);

    // middle C, held for a second
    let key = panel::key_of_note(60).unwrap();
    emu.input(&Input::Key { id: key, down: true, velocity: Some(110) });
    audio.clear();
    let mut got = 0;
    for _ in 0..86 {
        got += emu.render(512, &mut audio).unwrap();
    }
    let loud = peak(&audio);
    println!("silence peak {quiet}, note peak {loud}, {got} of {} frames delivered", 86 * 512);
    assert!(got >= 86 * 512 * 9 / 10, "the firmware keeps up with the audio pull");
    assert!(loud > 1000 && loud > quiet.saturating_mul(4), "a held key sounds");

    emu.input(&Input::Key { id: key, down: false, velocity: None });
    emu.run(200).unwrap();
    assert!(emu.stopped().is_none());
    assert!(emu.leds().iter().all(|l| (0.0..=1.0).contains(l)));
}

#[test]
fn turning_a_knob_redraws_the_screen() {
    let Some(pkg) = package() else { return };
    let mut emu = fma_player::load(&pkg, &Options::default()).unwrap();
    emu.run(3000).unwrap();
    let (before, pixels) = (emu.screen().revision, emu.screen().pixels.to_vec());
    let knob1 = panel::ENCODERS.iter().find(|e| e.0 == "KNOB1").unwrap().1;
    emu.input(&Input::Encoder { id: knob1, clicks: 5 });
    emu.run(500).unwrap();
    assert_ne!(emu.screen().revision, before);
    assert_ne!(emu.screen().pixels, pixels.as_slice());
}

#[test]
fn saves_restore_into_a_fresh_machine() {
    let Some(pkg) = package() else { return };
    let fresh = || fma_player::load(&pkg, &Options::default()).unwrap();

    let mut a = fresh();
    assert!(a.save().is_empty(), "nothing stored before the firmware runs");

    // a save as the firmware would leave one: one sector, written over
    let mut save = 0x000f_0000u32.to_le_bytes().to_vec();
    save.extend((0..4096).map(|i| i as u8));
    assert_eq!(a.restore(&save), Ok(()));
    assert_eq!(a.save(), save, "what was restored is what is saved");

    // refused whole, and nothing changed
    let mut b = fresh();
    for bad in [&save[..100], &[save.as_slice(), save.as_slice()].concat(), &[&1u32.to_le_bytes()[..], &[0; 4096]].concat(),
        &[&0x0010_0000u32.to_le_bytes()[..], &[0; 4096]].concat()] {
        assert_eq!(b.restore(bad), Err(SaveError::Malformed));
        assert!(b.save().is_empty());
    }
    b.run(10).unwrap();
    assert_eq!(b.restore(&save), Err(SaveError::AlreadyRunning));

    // the machine with a restored save still starts
    a.run(2000).unwrap();
    assert!(a.stopped().is_none());
}
