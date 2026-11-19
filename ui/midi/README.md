# ui/midi: MIDI controllers

Plays the panel from any hardware controller, by **learning** it: nothing here knows a make or model. It
does not import anything from the page and the page does not import anything from it except `index.js`:
the two meet in `ui/midi-controller.js` (the button and the list of controls) and a few lines in `app.js`.

| File | What |
|---|---|
| `manager.js` | Finds MIDI ports (Web MIDI, or any `MIDIAccess`-shaped object), connects each controller to the **profile** that matches it, follows plug and unplug, listens to inputs as they come and go. The profile contract is described at its top. |
| `mapping.js` | Device-neutral rules (JSON) that turn incoming MIDI into events: keys, encoders, analog controls, raw MIDI, and **actions** (what the page itself does). |
| `learn.js` | "Learn": turns what a control sent, while the user worked it, into a rule (a button as a note / controller / system message; a knob, and how it counts). |
| `profiles/learned.js` | The profile the page uses: every input is it, and what it does is whatever rules say. |
| `profiles/generic.js` | A controller described by data alone (ports to match + rules), for someone who writes the rules by hand. |
| `user-profiles.js` | Stores such descriptions (localStorage by default; any storage will do). |

## In the page

The **midi** button in the bar turns MIDI on by itself when the page opens (the browser may ask once) and
shows whether an input is there: dim without MIDI, solid when a controller is connected. Click it for the
list of controls, in this order:

1. navigation left, 2. navigation right: the chosen screen moves to the previous / next screen that has a firmware
3. to 10. the panel's 8 knobs (master, select, presets, algorithm, knob 1 to 4)
11. play: the chosen screen's play / stop
12. **Firm**: opens the firmware list; with the list open, loads the highlighted firmware (or unloads it, if it is on a
    screen) and closes the list. If no screen is free the list stays open and the status line says so.
13. list knob: moves the highlight up and down the list (clockwise = down; stops at the ends; does nothing while the
    list is closed). The highlight starts on the chosen screen's firmware, else the first row.

`learn` beside a control, then work it on the controller (a button: press it; a knob: turn it clockwise). A control
is learned the moment it is heard; a knob keeps sharpening how it counts while it goes on turning (so turn it a good
way, once). `learn all` goes through them one after another. What each sent is kept in the browser
(`luka.midi.learned`); `reset` forgets them. The list also shows the last message any controller sent.

A knob that is a **position** (a pot, or a knob with stops) sets the master to where it stands and turns the
others by how far it moved; an **endless** one (relative) turns them by its clicks. Which it is, is worked out
from what it sent (`modeOf` in `learn.js`): a few small steps look like an endless
one, a wide sweep like a position. A control does one thing: learning it again elsewhere lets go of its old job.

**Notes go to the firmware as MIDI** (2026-11-19), with no learning: the chosen screen's firmware gets each note on
its MIDI IN, as a controller plugged into the FM-1 itself would give it: its own pitch, in any octave, on the
controller's channel, with its velocity. The panel's key of that pitch (MIDI 53 F3 to 79 G5) lights while held. A
note-off goes to the firmware its note-on went to, even if another screen is chosen meanwhile. A note you have
learned for a button (navigation, play, Firm) does that instead; a stopped firmware takes nothing.

A firmware whose MIDI IN plays no notes, or that has none (measured when builds are imported:
`tools/self-start.mjs` `playsMidiNotes`, the manifest's `midi_notes`), gets the notes as its keys
(`native-worklet.js` `NoteKeys`): the whole keyboard moved by octaves onto the 27 keys, so a tune keeps its shape;
the move changes only when a note does not fit and none is held.

(Before: every note was folded onto the keys on its own, so on a 25-key controller C3 sounded above F3, and C3
and C4 were the same key.)

Only notes, controller changes and the like are used: the page asks the browser for plain MIDI, not
system-exclusive.

## Adding another kind of controller

A controller that needs more than rules (a handshake, a screen, lights) is a new file in `profiles/`
exporting a profile object (see `manager.js`); register it and nothing else changes.

## Tests

`node --test tests/midi/midi.test.mjs` runs against a fake MIDI backend; nothing has run against hardware yet.
