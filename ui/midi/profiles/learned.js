// A controller that is not known beforehand: any MIDI input is it, and what it does is whatever
// rules say (mapping.js), which the page fills in by LEARNING (learn.js). Nothing in here is
// specific to one make of controller.
//
// `rules` is a list, or a function that gives it (asked at every message, so it can change while
// the controller is connected).

import { createMapper } from "../mapping.js";

export function learnedProfile({ rules = [], id = "learned", name = "MIDI controller" } = {}) {
  return {
    id,
    name,
    match: { input: () => true, also: () => true }, // every input there is, as they come and go
    sysex: false,                                   // notes, controllers: no need to ask for more
    connect(io) {
      const map = createMapper(rules);
      return { onMessage: (bytes) => { for (const event of map(bytes)) io.emit(event); } };
    },
  };
}
