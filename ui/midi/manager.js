// Finds MIDI controllers and connects each to the profile that knows it. Knows nothing of the
// page: it hands out what the controllers do (`onInput`) and takes feedback for them (`notify`),
// and the page joins the two to its own controls. Nothing here is specific to one controller: a
// controller is a PROFILE, registered with `register`.
//
// A profile is a plain object:
//   {
//     id: "learned",                         stable, unique
//     name: "MIDI controller",               for people
//     match: { input: /keystation/i,         which ports are this controller's: a RegExp, or a
//              output: /keystation/i,        function (name) -> bool. `output` may be left out.
//              also: /keystation/i },        other inputs whose messages the session should get
//                                            too, as they come and go; optional
//     sysex: true,                           needs system-exclusive (the browser asks the user)
//     connect(io) -> session,                called once the ports are found; may be async
//   }
//   io:      { send(bytes), emit(event), status(type, extra?), input: portName, output: portName|null }
//            (status: a word for the page, e.g. "ready")
//   session: { onMessage?(bytes, portName), notify?(message), close?() }
//     onMessage  every MIDI message the device sends (an array of bytes)
//     notify     feedback from the page for the device (each profile says which it understands)
//     close      the device is going away: let go of whatever was taken
//
// `requestAccess` (default: the browser's Web MIDI) can be given for tests or another backend.

const asTest = (m) => (typeof m === "function" ? m : m instanceof RegExp ? (name) => m.test(name) : () => false);

export class MidiManager {
  #profiles = new Map();
  #connections = new Map(); // profile id -> { session, inputId, outputId, attached: Set of input ids, closed }
  #access = null;
  #request;
  #onInput;
  #onStatus;
  #onTraffic;

  /// `onInput(event, profileId)`: what the controllers do (see mapping.js for the events).
  /// `onStatus({ type, ... })`: connected, disconnected, ready, warning, error, unavailable.
  /// `onTraffic({ profile, port, bytes })`: every message a controller sends, as it is (to look
  /// at, or to learn from).
  constructor({ requestAccess, onInput = () => {}, onStatus = () => {}, onTraffic = () => {} } = {}) {
    this.#request = requestAccess ?? ((opts) => globalThis.navigator?.requestMIDIAccess?.(opts));
    this.#onInput = onInput;
    this.#onStatus = onStatus;
    this.#onTraffic = onTraffic;
  }

  /// Offers a controller. Replaces one with the same id.
  register(profile) {
    if (!profile?.id || typeof profile.connect !== "function") throw new Error("a profile needs an id and connect()");
    this.#close(profile.id);
    this.#profiles.set(profile.id, profile);
    if (this.#access) this.#scan();
  }

  unregister(id) {
    this.#close(id);
    this.#profiles.delete(id);
  }

  profiles() { return [...this.#profiles.values()].map((p) => ({ id: p.id, name: p.name ?? p.id, connected: this.#connections.has(p.id) })); }

  /// Asks the browser for MIDI and connects what it finds, now and as devices come and go.
  /// Resolves false where there is no MIDI or the user said no.
  async start() {
    if (this.#access) return true;
    const sysex = [...this.#profiles.values()].some((p) => p.sysex);
    let access = null;
    try { access = await this.#request({ sysex }); } catch { /* refused: tried again without sysex */ }
    if (!access && sysex) {
      try { access = await this.#request({ sysex: false }); } catch { /* none, then */ }
      if (access) this.#onStatus({ type: "warning", message: "System-exclusive was refused: controllers that need it cannot be connected." });
    }
    if (!access) { this.#onStatus({ type: "unavailable", message: "MIDI is not available here (or was refused)." }); return false; }
    this.#access = access;
    access.onstatechange = () => this.#scan();
    this.#scan();
    return true;
  }

  /// Every port there is, as { id, name, state }.
  ports() {
    const list = (map) => (map ? [...map.values()].map((p) => ({ id: p.id, name: p.name ?? "", state: p.state ?? "connected" })) : []);
    return { inputs: list(this.#access?.inputs), outputs: list(this.#access?.outputs) };
  }

  /// Connects a profile to chosen ports instead of what it would match itself.
  async connect(profileId, { inputId, outputId = null } = {}) {
    const profile = this.#profiles.get(profileId);
    if (!profile) throw new Error(`no profile "${profileId}"`);
    const input = this.#access?.inputs.get(inputId);
    if (!input) throw new Error("that input is not there");
    await this.#open(profile, input, outputId ? this.#access.outputs.get(outputId) : null);
  }

  disconnect(profileId) { this.#close(profileId); }

  /// Feedback for the devices (to every profile, or just one).
  notify(message, profileId = null) {
    for (const [id, c] of this.#connections) if (!profileId || id === profileId) {
      try { c.session?.notify?.(message); } catch (e) { this.#onStatus({ type: "error", profile: id, message: String(e?.message ?? e) }); }
    }
  }

  /// Lets go of everything (the page is closing, or the user turned MIDI off).
  stop() {
    for (const id of [...this.#connections.keys()]) this.#close(id);
    if (this.#access) this.#access.onstatechange = null;
    this.#access = null;
  }

  // ------------------------------------------------------------------ inside

  #live(map) { return [...(map?.values() ?? [])].filter((p) => p.state !== "disconnected"); }

  #scan() {
    const inputs = this.#live(this.#access?.inputs), outputs = this.#live(this.#access?.outputs);
    // a controller that has gone
    for (const [id, c] of [...this.#connections]) {
      if (!inputs.some((p) => p.id === c.inputId)) { this.#close(id); this.#onStatus({ type: "disconnected", profile: id }); }
    }
    // a controller that has come
    for (const profile of this.#profiles.values()) {
      if (this.#connections.has(profile.id)) continue;
      const wantIn = asTest(profile.match?.input), wantOut = profile.match?.output ? asTest(profile.match.output) : null;
      const input = inputs.find((p) => wantIn(p.name ?? ""));
      if (!input) continue;
      const output = wantOut ? outputs.find((p) => wantOut(p.name ?? "")) : null;
      if (wantOut && !output) continue;
      this.#open(profile, input, output).catch(() => {});
    }
    // the other ports of a connected profile, as they come and go
    for (const [id, c] of this.#connections) if (c.session) this.#attach(id, c, inputs);
  }

  /// Listens to every input the profile wants (its main one and its `also`), and to no other.
  #attach(profileId, c, inputs = this.#live(this.#access?.inputs)) {
    const profile = this.#profiles.get(profileId);
    const wantAlso = profile?.match?.also ? asTest(profile.match.also) : null;
    const wanted = inputs.filter((p) => p.id === c.inputId || (wantAlso && wantAlso(p.name ?? "")));
    for (const id of [...c.attached]) {
      if (!wanted.some((p) => p.id === id)) { c.attached.delete(id); const gone = this.#access?.inputs?.get(id); if (gone) gone.onmidimessage = null; }
    }
    for (const port of wanted) {
      if (c.attached.has(port.id)) continue;
      c.attached.add(port.id);
      port.onmidimessage = (event) => {
        try {
          const bytes = Array.from(event.data);
          this.#onTraffic({ profile: profileId, port: port.name ?? "", bytes });
          c.session.onMessage?.(bytes, port.name ?? "");
        } catch (e) { this.#onStatus({ type: "error", profile: profileId, message: String(e?.message ?? e) }); }
      };
    }
  }

  async #open(profile, input, output) {
    this.#close(profile.id);
    const slot = { session: null, inputId: input.id, outputId: output?.id ?? null, attached: new Set(), closed: false };
    this.#connections.set(profile.id, slot); // (taken now, so a second scan does not start another)
    const io = {
      input: input.name ?? "", output: output?.name ?? null,
      send: (bytes) => { if (!slot.closed && output) { try { output.send(Uint8Array.from(bytes)); } catch { /* the port went away: the scan will say so */ } } },
      emit: (event) => { if (!slot.closed) this.#onInput(event, profile.id); },
      status: (type, extra = {}) => { if (!slot.closed) this.#onStatus({ ...extra, type, profile: profile.id }); },
    };
    try {
      const session = await profile.connect(io);
      if (slot.closed) { try { session?.close?.(); } catch { /* gone anyway */ } return; }
      slot.session = session ?? {};
      this.#attach(profile.id, slot);
      this.#onStatus({ type: "connected", profile: profile.id, name: profile.name ?? profile.id, input: io.input, output: io.output });
    } catch (e) {
      this.#connections.delete(profile.id);
      slot.closed = true;
      this.#onStatus({ type: "error", profile: profile.id, message: String(e?.message ?? e) });
      throw e;
    }
  }

  #close(id) {
    const c = this.#connections.get(id);
    if (!c) return;
    this.#connections.delete(id);
    for (const portId of c.attached) { const port = this.#access?.inputs?.get(portId); if (port) port.onmidimessage = null; }
    try { c.session?.close?.(); } catch { /* the device may be gone already */ } // (it may still send: a goodbye)
    c.closed = true;
  }
}
