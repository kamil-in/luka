//! The FM-1's controls by their ids, for [`Input`](crate::Input): what a front panel needs
//! to know to be drawn and wired. (The SMK-37 runs too, but its panel is not described yet.)

/// Buttons: (label on the device, key id).
pub const BUTTONS: [(&str, u8); 14] = [
    ("OCT-", 0), ("OCT+", 1),
    ("FX", 2), ("SCL", 3), ("ENV", 4), ("LFO", 5), ("EDIT", 6), ("GLO", 7),
    ("HOME", 8), ("SAVE", 9), ("ARP", 10), ("SEQ", 11), ("PLAY", 12), ("REC", 13),
];

/// Encoders: (label on the device, encoder id).
pub const ENCODERS: [(&str, u8); 7] =
    [("SELECT", 0), ("ALGORITHM", 1), ("KNOB1", 2), ("KNOB2", 3), ("KNOB3", 4), ("KNOB4", 5), ("PRESETS", 6)];

/// The MASTER volume pot's analog channel.
pub const MASTER_POT: u8 = 4;

/// The 27 note keys' ids, lowest (F3) to highest (G5).
pub const NOTE_KEYS: std::ops::RangeInclusive<u8> = 14..=40;

/// The MIDI note of the lowest note key (F3), at the device's middle octave.
pub const LOWEST_NOTE: u8 = 53;

/// The note key for a MIDI note, if the keyboard has it (at its middle octave).
pub fn key_of_note(note: u8) -> Option<u8> {
    let id = note.checked_sub(LOWEST_NOTE)?.checked_add(*NOTE_KEYS.start())?;
    NOTE_KEYS.contains(&id).then_some(id)
}

/// Whether a note key is a black key.
pub fn is_black(key_id: u8) -> bool {
    matches!((key_id + LOWEST_NOTE - NOTE_KEYS.start()) % 12, 1 | 3 | 6 | 8 | 10)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyboard() {
        assert_eq!(key_of_note(53), Some(14)); // F3
        assert_eq!(key_of_note(60), Some(21)); // C4
        assert_eq!(key_of_note(79), Some(40)); // G5
        assert_eq!(key_of_note(52), None);
        assert_eq!(key_of_note(80), None);
        assert_eq!(NOTE_KEYS.filter(|&k| is_black(k)).count(), 11);
        assert!(is_black(15) && !is_black(14) && !is_black(21)); // F#3, F3, C4
    }
}
