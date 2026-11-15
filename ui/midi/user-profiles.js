// The controllers a user has added, kept as data (generic.js describes the shape). The storage is
// given, so any place will do: the browser's localStorage by default, a file for the desktop app, a
// map in a test.

import { genericProfile, validate } from "./profiles/generic.js";

const KEY = "luka.midi.controllers";

const browserStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function userProfiles(storage = browserStorage()) {
  const read = () => { try { return JSON.parse(storage?.getItem(KEY) ?? "[]").filter((s) => s && typeof s === "object"); } catch { return []; } };
  const write = (list) => { try { storage?.setItem(KEY, JSON.stringify(list)); } catch { /* not kept, then */ } };
  return {
    /// The descriptions, as stored.
    list: read,
    /// Adds (or replaces, by id) one. Throws with what is wrong if it will not do.
    save(spec) {
      const problems = validate(spec);
      if (problems.length) throw new Error(problems.join("; "));
      write([...read().filter((s) => s.id !== spec.id), spec]);
    },
    remove(id) { write(read().filter((s) => s.id !== id)); },
    /// Ready for `manager.register` (a stored description that no longer holds is left out).
    profiles() {
      const out = [];
      for (const spec of read()) { try { out.push(genericProfile(spec)); } catch { /* skipped */ } }
      return out;
    },
  };
}
