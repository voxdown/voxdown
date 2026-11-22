import {
  INSTRUMENTS,
  type InstrumentId,
  findLoop,
  nearestSample,
  sampleUrl,
  velocityGain,
} from "./instruments";
import { type PlayNote, type Timeline, beatsBetween } from "./timeline";

export type PlayerStatus = "stopped" | "loading" | "playing" | "paused";
export type PlayOptions = {
  from?: number | undefined;
  region?: Timeline | undefined;
  loop?: boolean | undefined;
};

const LOOKAHEAD = 0.14;
const START_DELAY = 0.025;
const CACHE = "voxdown-composer-sounds-v1";

type Sample = { buffer: AudioBuffer; loop?: { start: number; end: number } | null };
type Graph = {
  context: BaseAudioContext;
  master: GainNode;
  play: GainNode;
  send: GainNode;
  wet: GainNode;
  click: GainNode;
  tracks: GainNode[];
};

/** A small hall: decaying stereo noise, darker as it fades, after a short pre-delay. */
function impulse(context: BaseAudioContext, seconds = 2.1): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = context.createBuffer(2, length, rate);
  const predelay = Math.floor(rate * 0.012);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    let seed = channel === 0 ? 17 : 91;
    for (let index = predelay; index < length; index++) {
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647) * 2 - 1;
      const t = (index - predelay) / rate;
      // Air absorbs the highs: blend toward a low-passed copy as time goes on.
      const darkness = Math.min(0.92, t * 0.9);
      smooth = smooth * darkness + noise * (1 - darkness);
      const early = t < 0.08 && index % Math.floor(rate * 0.013) < 3 ? 0.5 : 0;
      data[index] = (smooth + early * noise) * Math.exp(-t * 3.3) * 0.5;
    }
  }
  return buffer;
}

function createGraph(
  context: BaseAudioContext,
  trackCount: number,
  settings: { volume: number; reverb: number },
): Graph {
  const master = context.createGain();
  master.gain.value = settings.volume;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 8;
  limiter.ratio.value = 4;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.2;
  master.connect(limiter).connect(context.destination);
  const play = context.createGain();
  const dry = context.createGain();
  dry.gain.value = 1;
  const send = context.createGain();
  send.gain.value = 1;
  const convolver = context.createConvolver();
  convolver.buffer = impulse(context);
  const wet = context.createGain();
  wet.gain.value = settings.reverb * 0.55;
  play.connect(dry).connect(master);
  play.connect(send).connect(convolver).connect(wet).connect(master);
  const click = context.createGain();
  click.gain.value = 0.5;
  click.connect(master);
  const tracks: GainNode[] = [];
  for (let index = 0; index < trackCount; index++) {
    const gain = context.createGain();
    gain.connect(play);
    tracks.push(gain);
  }
  return { context, master, play, send, wet, click, tracks };
}

export class Player {
  status: PlayerStatus = "stopped";
  instrument: InstrumentId = "piano";
  volume = 0.8;
  reverb = 0.35;
  humanise = false;
  metronome = false;
  countIn = false;
  tempoFactor = 1;
  metrics = { startLatency: 0, coldLoad: 0, scheduled: 0, lastPress: 0 };
  onChange: () => void = () => {};
  onLoading: (message: string) => void = () => {};

  private audio: AudioContext | null = null;
  private graph: Graph | null = null;
  private samples = new Map<InstrumentId, Map<number, Sample>>();
  private main: Timeline | null = null;
  private current: Timeline | null = null;
  private loop = false;
  private anchorTime = 0;
  private anchorPosition = 0;
  private pausedAt = 0;
  private startPosition = 0;
  private notesUntil = 0;
  private beatsUntil = 0;
  private noteIndex = 0;
  private clock: Worker | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private muted = new Set<number>();
  private pending: PlayOptions | null = null;

  constructor(private readonly base: string) {}

  /** Starts loading the chosen instrument (after a user gesture shows intent to listen). */
  warm(): Promise<void> {
    return this.load(this.instrument, this.needed(this.instrument, this.hint));
  }
  /** Pitches of the tune on screen: their samples load first. */
  hint: number[] = [];

  ready(id: InstrumentId = this.instrument): boolean {
    return (this.samples.get(id)?.size ?? 0) === INSTRUMENTS[id].notes.length;
  }

  private sampleTasks = new Map<string, Promise<void>>();
  private decoder: OfflineAudioContext | null = null;
  private soundCache: Promise<Cache | null> | null = null;

  private loadSample(id: InstrumentId, midi: number): Promise<void> {
    const key = `${id}:${midi}`;
    const existing = this.sampleTasks.get(key);
    if (existing) return existing;
    this.decoder ??= new OfflineAudioContext(1, 1, 44100);
    this.soundCache ??= ("caches" in globalThis ? caches.open(CACHE) : Promise.resolve(null)).catch(
      () => null,
    );
    const decoder = this.decoder;
    const task = (async () => {
      const cache = await this.soundCache;
      const url = sampleUrl(id, midi, this.base);
      let response = cache ? await cache.match(url).catch(() => undefined) : undefined;
      if (!response) {
        response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`Sample ${midi} could not be loaded.`);
        if (cache) await cache.put(url, response.clone()).catch(() => undefined);
      }
      const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
      let map = this.samples.get(id);
      if (!map) {
        map = new Map();
        this.samples.set(id, map);
      }
      map.set(midi, { buffer });
      this.report(id);
    })();
    this.sampleTasks.set(key, task);
    task.catch(() => this.sampleTasks.delete(key));
    return task;
  }

  private report(id: InstrumentId) {
    const def = INSTRUMENTS[id];
    const done = this.samples.get(id)?.size ?? 0;
    this.onLoading(
      done < def.notes.length && (this.status === "loading" || id === this.instrument)
        ? `Loading ${def.label.toLowerCase()}… ${Math.round((done / def.notes.length) * 100)}%`
        : "",
    );
  }

  /** The samples a set of pitches needs. */
  private needed(id: InstrumentId, pitches: Iterable<number>): number[] {
    return [...new Set([...pitches].map((pitch) => nearestSample(INSTRUMENTS[id], pitch)))];
  }

  /**
   * Loads an instrument; the samples `first` needs are asked for first, so playback can start as
   * soon as they arrive while the rest follow.
   */
  load(id: InstrumentId, first: number[] = []): Promise<void> {
    if (this.ready(id)) return Promise.resolve();
    const def = INSTRUMENTS[id];
    this.report(id);
    // The rest wait for the first, so they do not share the connection with them.
    const task = Promise.all(first.map((midi) => this.loadSample(id, midi)))
      .then(() => Promise.all(def.notes.map((midi) => this.loadSample(id, midi))))
      .then(() => undefined);
    task.then(
      () => this.onLoading(""),
      () =>
        this.onLoading(
          `The ${def.label.toLowerCase()} could not load. Check your connection and try again.`,
        ),
    );
    return task;
  }

  /** Waits only for the samples these pitches need. */
  async ensure(pitches: Iterable<number>, id: InstrumentId = this.instrument): Promise<void> {
    const needed = this.needed(id, pitches);
    const all = this.load(id, needed);
    all.catch(() => {});
    await Promise.all(needed.map((midi) => this.loadSample(id, midi)));
  }

  private has(pitches: Iterable<number>, id: InstrumentId = this.instrument): boolean {
    const map = this.samples.get(id);
    return this.needed(id, pitches).every((midi) => map?.has(midi));
  }

  async setInstrument(id: InstrumentId) {
    this.instrument = id;
    await this.load(id);
  }

  private ensureContext(): AudioContext {
    if (!this.audio) {
      this.audio = new AudioContext({ latencyHint: "interactive" });
      this.graph = createGraph(this.audio, 0, this);
    }
    if (this.audio.state === "suspended") void this.audio.resume();
    return this.audio;
  }

  private trackGain(index: number): GainNode {
    const graph = this.graph as Graph;
    while (graph.tracks.length <= index) {
      const gain = graph.context.createGain();
      gain.gain.value = this.muted.has(graph.tracks.length) ? 0 : 1;
      gain.connect(graph.play);
      graph.tracks.push(gain);
    }
    return graph.tracks[index] as GainNode;
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.graph && this.audio)
      this.graph.master.gain.setTargetAtTime(volume, this.audio.currentTime, 0.03);
  }
  setReverb(amount: number) {
    this.reverb = amount;
    if (this.graph && this.audio)
      this.graph.wet.gain.setTargetAtTime(amount * 0.55, this.audio.currentTime, 0.05);
  }
  /** Which tracks are silent (mute and solo are worked out by the caller). */
  setMuted(muted: Set<number>) {
    this.muted = new Set(muted);
    if (!this.graph || !this.audio) return;
    const now = this.audio.currentTime;
    this.graph.tracks.forEach((gain, index) =>
      gain.gain.setTargetAtTime(this.muted.has(index) ? 0 : 1, now, 0.02),
    );
  }

  /** The timeline of the tune; replacing it while playing keeps the place. */
  setTimeline(timeline: Timeline | null) {
    const followingMain = !this.current || this.current === this.main;
    this.main = timeline;
    if (!followingMain) return;
    this.current = timeline;
    if (this.status === "playing" && timeline) {
      this.noteIndex = this.firstIndexAt(this.notesUntil);
      if (this.position() > timeline.length) this.stop();
    }
  }
  /** Replaces a playing region's notes (after an edit), keeping its place. */
  setRegion(timeline: Timeline) {
    if (!this.loopingRegion) return;
    this.current = timeline;
    this.noteIndex = this.firstIndexAt(this.notesUntil);
  }
  get loopingRegion(): boolean {
    return Boolean(this.current && this.current !== this.main);
  }
  get timeline(): Timeline | null {
    return this.current ?? this.main;
  }

  private rate(): number {
    const timeline = this.current ?? this.main;
    if (!timeline) return 1;
    return (timeline.bpm * this.tempoFactor * timeline.beat) / 60;
  }

  private countFrom = 0;
  /** During a count-in: which beat is sounding (0-based) of how many; otherwise null. */
  counting(): { beat: number; beats: number } | null {
    const timeline = this.current;
    if (this.status !== "playing" || !timeline) return null;
    const position = this.position();
    if (position >= this.startPosition || this.countFrom >= this.startPosition) return null;
    const beat = timeline.beat > 0 ? timeline.beat : 0.25;
    const beats = Math.max(1, Math.round((this.startPosition - this.countFrom) / beat));
    return {
      beat: Math.max(0, Math.min(beats - 1, Math.floor((position - this.countFrom) / beat + 1e-6))),
      beats,
    };
  }

  /** The place being heard now, in whole notes of the current timeline. */
  position(): number {
    if (this.status !== "playing" || !this.audio) return this.pausedAt;
    const latency = (this.audio as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return this.anchorPosition + (this.audio.currentTime - latency - this.anchorTime) * this.rate();
  }

  setTempoFactor(factor: number) {
    if (this.status === "playing" && this.audio) {
      const now = this.audio.currentTime;
      this.anchorPosition += (now - this.anchorTime) * this.rate();
      this.anchorTime = now;
    }
    this.tempoFactor = factor;
  }

  async play(options: PlayOptions = {}) {
    this.metrics.lastPress = performance.now();
    const context = this.ensureContext();
    const timeline = options.region ?? this.main;
    if (!timeline) return;
    const pitches = timeline.notes.map((note) => note.pitch);
    if (!this.has(pitches)) {
      this.pending = options;
      this.status = "loading";
      this.onChange();
      const started = performance.now();
      try {
        await this.ensure(pitches);
        if (!this.metrics.coldLoad) this.metrics.coldLoad = performance.now() - started;
      } catch {
        this.status = "stopped";
        this.onChange();
        return;
      }
      if (this.pending !== options || this.status !== "loading") return;
      this.pending = null;
    }
    this.silenceNow();
    const graph = this.graph as Graph;
    graph.play.gain.cancelScheduledValues(context.currentTime);
    graph.play.gain.setValueAtTime(1, context.currentTime);
    this.current = timeline;
    this.loop = Boolean(options.loop);
    const from = Math.max(
      0,
      Math.min(
        options.from ?? (this.status === "paused" && !options.region ? this.pausedAt : 0),
        timeline.length,
      ),
    );
    this.startPosition = from >= timeline.length - 1e-6 ? 0 : from;
    const lead = this.countIn ? timeline.bar || timeline.beat * 4 : 0;
    this.countFrom = this.startPosition - lead;
    this.anchorPosition = this.startPosition - lead;
    this.anchorTime = context.currentTime + START_DELAY;
    this.notesUntil = this.startPosition;
    this.beatsUntil = this.anchorPosition;
    this.noteIndex = this.firstIndexAt(this.startPosition);
    this.status = "playing";
    this.metrics.scheduled = 0;
    this.startClock();
    this.tick();
    const latency = (context as AudioContext & { baseLatency?: number }).baseLatency ?? 0;
    this.metrics.startLatency =
      performance.now() - this.metrics.lastPress + (START_DELAY + latency) * 1000;
    this.onChange();
  }

  pause() {
    if (this.status === "loading") {
      this.pending = null;
      this.status = "stopped";
      this.onChange();
      return;
    }
    if (this.status !== "playing") return;
    this.pausedAt = Math.max(this.startPosition, this.position());
    this.fadeOut();
    this.status = "paused";
    this.stopClock();
    this.onChange();
  }

  stop() {
    this.pending = null;
    if (this.status === "playing") this.fadeOut();
    this.status = "stopped";
    this.pausedAt = 0;
    this.current = this.main;
    this.stopClock();
    this.onChange();
  }

  /** Moves the place; keeps playing from there if playing. */
  seek(position: number) {
    const timeline = this.current ?? this.main;
    if (!timeline) return;
    const target = Math.max(0, Math.min(position, timeline.length));
    if (this.status === "playing")
      void this.play({
        from: target,
        region: this.loopingRegion ? (this.current as Timeline) : undefined,
        loop: this.loop,
      });
    else {
      this.pausedAt = target;
      this.status = target > 0 ? "paused" : "stopped";
      this.onChange();
    }
  }

  /** Sounds a note or chord briefly, for hearing as you write. */
  audition(pitches: number[], velocity = 62, seconds = 0.42) {
    if (!pitches.length || this.status === "playing") return;
    if (!this.has(pitches)) {
      void this.ensure(pitches).catch(() => {});
      return;
    }
    const context = this.ensureContext();
    const graph = this.graph as Graph;
    const when = context.currentTime + 0.01;
    for (const pitch of pitches)
      this.voice(graph, graph.master, pitch, velocity, when, seconds, "normal", true);
  }

  private startClock() {
    if (!this.clock) {
      try {
        this.clock = new Worker(new URL("./clock-worker.ts", import.meta.url), { type: "module" });
        this.clock.onmessage = () => this.tick();
      } catch {
        this.clock = null;
      }
    }
    if (this.clock) this.clock.postMessage({ run: true, interval: 25 });
    else this.fallbackTimer ??= setInterval(() => this.tick(), 25);
  }
  private fallbackTimer: ReturnType<typeof setInterval> | undefined;
  private stopClock() {
    this.clock?.postMessage({ run: false });
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.fallbackTimer = undefined;
  }

  private firstIndexAt(position: number): number {
    const notes = (this.current ?? this.main)?.notes ?? [];
    let low = 0;
    let high = notes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((notes[middle] as PlayNote).time < position - 1e-9) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private tick() {
    if (this.status !== "playing" || !this.audio || !this.graph) return;
    const timeline = this.current;
    if (!timeline) return;
    const context = this.audio;
    const rate = this.rate();
    let guard = 0;
    while (guard++ < 8) {
      const horizon =
        this.anchorPosition + (context.currentTime + LOOKAHEAD - this.anchorTime) * rate;
      const end = Math.min(horizon, timeline.length);
      this.scheduleNotes(timeline, end, rate);
      this.scheduleBeats(timeline, end, rate);
      if (horizon < timeline.length) break;
      if (this.loop && timeline.length > 1e-3) {
        // Wrap: the loop start follows the loop end without a gap.
        this.anchorTime += (timeline.length - this.anchorPosition) / rate;
        this.anchorPosition = 0;
        this.notesUntil = 0;
        this.beatsUntil = 0;
        this.noteIndex = 0;
        continue;
      }
      if (this.position() >= timeline.length) {
        this.status = "stopped";
        this.pausedAt = 0;
        this.current = this.main;
        this.stopClock();
        this.onChange();
      }
      break;
    }
  }

  private when(position: number, rate: number): number {
    return this.anchorTime + (position - this.anchorPosition) / rate;
  }

  private scheduleNotes(timeline: Timeline, until: number, rate: number) {
    const graph = this.graph as Graph;
    const notes = timeline.notes;
    while (this.noteIndex < notes.length) {
      const note = notes[this.noteIndex] as PlayNote;
      if (note.time >= until - 1e-9) break;
      this.noteIndex += 1;
      if (note.time < this.notesUntil - 1e-9) continue;
      let when = this.when(note.time, rate);
      let velocity = note.velocity;
      if (this.humanise) {
        when += (Math.random() - 0.5) * 0.016;
        velocity *= 1 + (Math.random() - 0.5) * 0.12;
      }
      const seconds = note.duration / rate;
      this.voice(
        graph,
        this.trackGain(note.track),
        note.pitch,
        velocity,
        Math.max(when, graph.context.currentTime),
        seconds,
        note.articulation,
        false,
      );
      this.metrics.scheduled += 1;
    }
    this.notesUntil = Math.max(this.notesUntil, until);
  }

  private scheduleBeats(timeline: Timeline, until: number, rate: number) {
    const countingIn = this.beatsUntil < this.startPosition;
    if (!this.metronome && !countingIn) {
      this.beatsUntil = until;
      return;
    }
    const to = this.metronome ? until : Math.min(until, this.startPosition);
    for (const beat of beatsBetween(timeline, this.beatsUntil, to))
      this.click(this.when(beat.time, rate), beat.down);
    this.beatsUntil = Math.max(this.beatsUntil, until);
  }

  private click(when: number, down: boolean) {
    const graph = this.graph as Graph;
    const context = graph.context;
    if (when < context.currentTime) return;
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.value = down ? 1760 : 1320;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(down ? 0.55 : 0.32, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0008, when + 0.06);
    oscillator.connect(gain).connect(graph.click);
    oscillator.start(when);
    oscillator.stop(when + 0.08);
    this.track(oscillator);
  }

  private track(source: AudioScheduledSourceNode) {
    this.sources.add(source);
    source.addEventListener("ended", () => this.sources.delete(source), { once: true });
  }

  /** One note: the nearest sample, shifted, shaped by velocity, articulation and release. */
  private voice(
    graph: Graph,
    output: AudioNode,
    pitch: number,
    velocity: number,
    when: number,
    seconds: number,
    articulation: PlayNote["articulation"],
    audition: boolean,
  ) {
    const def = INSTRUMENTS[this.instrument];
    const loaded = this.samples.get(this.instrument);
    let sampleMidi = nearestSample(def, pitch);
    // While the rest of an instrument is still arriving, borrow the nearest sample already here.
    if (!loaded?.has(sampleMidi) && loaded?.size)
      sampleMidi = [...loaded.keys()].reduce((best, midi) =>
        Math.abs(midi - pitch) < Math.abs(best - pitch) ? midi : best,
      );
    const sample = loaded?.get(sampleMidi);
    if (!sample) return;
    const context = graph.context;
    const source = context.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = 2 ** ((pitch - sampleMidi) / 12);
    const sounding =
      articulation === "staccato"
        ? seconds * 0.45
        : articulation === "legato"
          ? seconds * 1.04
          : seconds * (def.sustained ? 0.9 : 0.96);
    const length = Math.max(0.05, sounding);
    if (def.sustained) {
      if (sample.loop === undefined)
        sample.loop = findLoop(sample.buffer.getChannelData(0), sample.buffer.sampleRate);
      const available = sample.buffer.duration / source.playbackRate.value;
      if (sample.loop && length + def.release > available * 0.85) {
        source.loop = true;
        source.loopStart = sample.loop.start;
        source.loopEnd = sample.loop.end;
      }
    }
    const peak = velocityGain(velocity) * def.level * (audition ? 0.6 : 1);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(peak, when + Math.max(0.003, def.attack));
    const off = when + length;
    // Lower notes ring a little longer when released, as real strings do.
    const release = def.release * (pitch < 48 ? 1.5 : pitch > 84 ? 0.7 : 1);
    envelope.gain.setTargetAtTime(0, off, release / 3);
    let input: AudioNode = envelope;
    if (def.brightness) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = Math.min(
        18000,
        1400 + (velocity / 127) ** 1.4 * 11000 + Math.max(0, pitch - 60) * 90,
      );
      filter.Q.value = 0.4;
      filter.connect(envelope);
      input = filter;
    }
    source.connect(input);
    envelope.connect(output);
    source.start(when);
    source.stop(off + release * 2.2);
    this.track(source);
  }

  /** A quick fade, then silence: stopping never clicks. */
  private fadeOut() {
    if (!this.audio || !this.graph) return;
    const now = this.audio.currentTime;
    const gain = this.graph.play.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + 0.04);
    const sources = [...this.sources];
    this.sources.clear();
    for (const source of sources) {
      try {
        source.stop(now + 0.05);
      } catch {
        /* Already stopped. */
      }
    }
  }
  private silenceNow() {
    if (!this.audio) return;
    const now = this.audio.currentTime;
    for (const source of this.sources) {
      try {
        source.stop(now + 0.03);
      } catch {
        /* Already stopped. */
      }
    }
    this.sources.clear();
  }

  /** Renders a timeline to audio offline, with the same sound as playback. */
  async render(timeline: Timeline): Promise<AudioBuffer> {
    await this.load(this.instrument);
    const rate = (timeline.bpm * this.tempoFactor * timeline.beat) / 60;
    const seconds = timeline.length / rate + 2.5;
    const context = new OfflineAudioContext(2, Math.ceil(seconds * 44100), 44100);
    const graph = createGraph(context, timeline.tracks.length, this);
    graph.tracks.forEach((gain, index) => {
      gain.gain.value = this.muted.has(index) ? 0 : 1;
    });
    for (const note of timeline.notes)
      this.voice(
        graph,
        graph.tracks[note.track] ?? graph.play,
        note.pitch,
        note.velocity,
        0.05 + note.time / rate,
        note.duration / rate,
        note.articulation,
        false,
      );
    return context.startRendering();
  }
}

/** Scales audio so its loudest sample sits at `ceiling` (−1 dBFS by default); returns the gain. */
export function normalise(
  buffer: { numberOfChannels: number; getChannelData(channel: number): Float32Array },
  ceiling = 10 ** (-1 / 20),
): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      const value = Math.abs(data[index] as number);
      if (value > peak) peak = value;
    }
  }
  if (peak <= 1e-6) return 1;
  const gain = ceiling / peak;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) data[index] = (data[index] as number) * gain;
  }
  return gain;
}

/** A 16-bit PCM WAV file. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const bytes = 44 + length * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++)
      view.setUint8(offset + index, text.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let index = 0; index < length; index++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, (data[channel] as Float32Array)[index] as number));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}
