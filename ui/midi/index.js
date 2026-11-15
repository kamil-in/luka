// MIDI controllers: the one door into ui/midi/. Independent of the page and of any one controller.
//
//   import { MidiManager, learnedProfile } from "./midi/index.js";
//   const midi = new MidiManager({
//     onInput: (event) => ...,                 // what a controller did: see mapping.js
//     onStatus: (s) => console.log(s),
//   });
//   midi.register(learnedProfile({ rules: () => theRulesLearnedSoFar }));
//   await midi.start();                      // from a click: browsers want a gesture for MIDI
//
// Adding a controller of another make = a new profile (see manager.js for its shape), or just data
// (see profiles/generic.js); nothing else changes.

export { MidiManager } from "./manager.js";
export { createMapper } from "./mapping.js";
export { learnedProfile } from "./profiles/learned.js";
export { genericProfile, validate as validateController } from "./profiles/generic.js";
export { userProfiles } from "./user-profiles.js";
export { ruleFromKnob, ruleFromButton, describe as describeMessage, isNoise } from "./learn.js";
