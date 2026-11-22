/**
 * What to play, when: abcjs's note events (repeats expanded, dynamics and articulation applied)
 * turned into one sorted list in whole notes, with the written place of each note so playback can
 * light it in the score and the text, loop a region of the written music, and draw the bars.
 */

/* biome-ignore lint/suspicious/noExplicitAny: abcjs's audio description is loosely typed. */
type Any = any;

export type Articulation = "normal" | "staccato" | "legato";
export type PlayNote = {
  /** Performance time, in whole notes from the start. */
  time: number;
  duration: number;
  pitch: number;
  velocity: number;
  track: number;
  /** Document offsets of the note in the text, when it has one. */
  start?: number | undefined;
  end?: number | undefined;
  articulation: Articulation;
  /** Written time (repeats not expanded), for regions. */
  written: number;
};
export type Track = { name: string; voice?: number; chords?: boolean };
export type Pass = { from: number; to: number; repeat: boolean };
export type Timeline = {
  notes: PlayNote[];
  /** Total length, in whole notes. */
  length: number;
  /** The tune's own tempo: beats a minute, and the beat in whole notes. */
  bpm: number;
  beat: number;
  bar: number;
  pickup: number;
  tracks: Track[];
  /** Performance times where bars start. */
  bars: number[];
  passes: Pass[];
  /** Stretches played after a D.C. or D.S. jump, in performance time. */
  returns?: { from: number; to: number; label: "D.C." | "D.S." | "Coda" }[];
  /** Written time of the region start, when this is a region's timeline. */
  offset: number;
  /** A selection played as written, though the play order would repeat or skip some of it. */
  asWritten?: boolean;
  /**
   * A selection in pieces, played back to back: where each piece starts in this timeline (`at`)
   * and in the written music (`from`).
   */
  pieces?: { at: number; from: number; to: number }[];
};

/** Finds the drawn note for a document offset from abcjs (which may start at a space). */
export type NoteLookup = (
  start: number,
) => { time: number; voice: number; start: number; end: number } | undefined;

/** Builds a tune's timeline from abcjs's `setUpAudio()` description. */
export function buildTimeline(
  audio: Any,
  meta: { bpm: number; beat: number; bar: number; pickup: number; voices: string[] },
  toDocument: (char: number) => number,
  lookup: NoteLookup,
): Timeline {
  const notes: PlayNote[] = [];
  const tracks: Track[] = [];
  const rawTracks: Any[][] = audio?.tracks ?? [];
  rawTracks.forEach((events, index) => {
    const isVoice =
      index < meta.voices.length && events.some((event) => typeof event.startChar === "number");
    tracks.push(
      isVoice
        ? { name: meta.voices[index] ?? `Voice ${index + 1}`, voice: index }
        : { name: "Chords", chords: true },
    );
    for (const event of events) {
      if (event.cmd !== "note" || !Number.isFinite(event.pitch) || event.duration <= 0) continue;
      const hasChar = typeof event.startChar === "number";
      notes.push({
        time: event.start,
        duration: event.duration,
        pitch: event.pitch,
        velocity: Math.max(1, Math.min(127, event.volume ?? 80)),
        track: index,
        start: hasChar ? toDocument(event.startChar) : undefined,
        end: hasChar ? toDocument(event.endChar) : undefined,
        articulation:
          event.endType === "staccato"
            ? "staccato"
            : event.endType === "tenuto"
              ? "legato"
              : "normal",
        written: 0,
      });
    }
  });
  notes.sort((a, b) => a.time - b.time || a.track - b.track || a.pitch - b.pitch);
  // Written time: each note with a place in the text knows it; others (grace notes, ornaments,
  // accompaniment) follow the latest such note.
  type Anchor = { time: number; written: number };
  const anchors: Anchor[] = [];
  for (const note of notes) {
    if (note.start === undefined) continue;
    const found = lookup(note.start);
    if (!found) continue;
    note.written = found.time;
    note.start = found.start;
    note.end = found.end;
    if (!anchors.length || (anchors[anchors.length - 1] as Anchor).time !== note.time)
      anchors.push({ time: note.time, written: found.time });
  }
  let anchorIndex = 0;
  for (const note of notes) {
    if (note.start !== undefined && lookup(note.start)) continue;
    while (
      anchorIndex + 1 < anchors.length &&
      (anchors[anchorIndex + 1] as Anchor).time <= note.time + 1e-9
    )
      anchorIndex += 1;
    const anchor = anchors[anchorIndex];
    note.written =
      anchor && anchor.time <= note.time + 1e-9
        ? anchor.written + (note.time - anchor.time)
        : note.time;
  }
  const length = Math.max(
    audio?.totalDuration ?? 0,
    ...notes.map((note) => note.time + note.duration),
    0,
  );
  const bars: number[] = [];
  if (meta.bar > 0) {
    let at = meta.pickup > 1e-6 && meta.pickup < meta.bar - 1e-6 ? meta.pickup : meta.bar;
    bars.push(0);
    while (at < length - 1e-6 && bars.length < 5000) {
      bars.push(at);
      at += meta.bar;
    }
  }
  // Passes: where playback jumps back in the written music (a repeat), a new pass begins.
  const passes: Pass[] = [];
  let passStart = 0;
  let previous: Anchor | undefined;
  let repeat = false;
  for (const anchor of anchors) {
    if (previous && anchor.written < previous.written - 1e-6) {
      passes.push({ from: passStart, to: anchor.time, repeat });
      passStart = anchor.time;
      repeat = !repeat;
    }
    previous = anchor;
  }
  passes.push({ from: passStart, to: length, repeat });
  return {
    notes,
    length,
    bpm: meta.bpm,
    beat: meta.beat,
    bar: meta.bar,
    pickup: meta.pickup,
    tracks,
    bars,
    passes,
    offset: 0,
  };
}

/**
 * A region's own timeline: the written music between `from` and `to`, once, in the chosen
 * voices (and the chord accompaniment when every voice is chosen). Repeats inside play as written.
 */
export function regionTimeline(
  timeline: Timeline,
  region: { from: number; to: number; voices: number[]; reach?: number | undefined },
  allVoices: boolean,
): Timeline {
  const eps = 1e-6;
  const seen = new Set<string>();
  const notes: PlayNote[] = [];
  for (const note of timeline.notes) {
    if (note.written < region.from - eps || note.written >= region.to - eps) continue;
    // A written note is in when the region reached its start; ornaments and chords follow time.
    if (region.reach !== undefined && note.start !== undefined && note.written > region.reach + eps)
      continue;
    const track = timeline.tracks[note.track];
    const wanted = track?.chords
      ? allVoices
      : track?.voice !== undefined && region.voices.includes(track.voice);
    if (!wanted) continue;
    const key = `${note.track}:${note.pitch}:${Math.round(note.written * 1e5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({
      ...note,
      time: note.written - region.from,
      duration: Math.min(note.duration, region.to - note.written),
    });
  }
  notes.sort((a, b) => a.time - b.time || a.track - b.track);
  const length = Math.max(region.to - region.from, eps);
  const bars: number[] = [0];
  return {
    ...timeline,
    notes,
    length,
    bars,
    passes: [{ from: 0, to: length, repeat: false }],
    returns: [],
    offset: region.from,
  };
}

/** The written place a region's timeline is at, a time into it (across its pieces). */
export function regionWritten(line: Timeline, position: number): number {
  if (!line.pieces?.length) return line.offset + position;
  let piece = line.pieces[0] as { at: number; from: number; to: number };
  for (const each of line.pieces) if (each.at <= position + 1e-9) piece = each;
  return Math.min(piece.to, piece.from + Math.max(0, position - piece.at));
}

/** The performance time where a written place is first played. */
export function firstPlayOf(timeline: Timeline, written: number): number {
  const eps = 1e-6;
  let best: number | undefined;
  for (const note of timeline.notes) {
    if (note.written >= written - eps && note.written < written + eps) {
      best = best === undefined ? note.time : Math.min(best, note.time);
    }
  }
  if (best !== undefined) return best;
  const later = timeline.notes.find((note) => note.written > written);
  return later ? later.time : 0;
}

/** Notes sounding at a performance time (for lighting them). */
export function soundingAt(
  timeline: Timeline,
  time: number,
  from = 0,
): { notes: PlayNote[]; index: number } {
  const notes: PlayNote[] = [];
  let index = from;
  const list = timeline.notes;
  if (index > 0 && (list[index]?.time ?? 0) > time) index = 0;
  while (index < list.length && (list[index] as PlayNote).time + 4 < time) index += 1;
  for (let at = index; at < list.length; at++) {
    const note = list[at] as PlayNote;
    if (note.time > time + 1e-9) break;
    if (note.start !== undefined && time < note.time + note.duration) notes.push(note);
  }
  return { notes, index };
}

/** Beat times (count-in included when `from` is negative), with downbeats marked. */
export function beatsBetween(
  timeline: Timeline,
  from: number,
  to: number,
): { time: number; down: boolean }[] {
  const beats: { time: number; down: boolean }[] = [];
  const beat = timeline.beat > 0 ? timeline.beat : 0.25;
  const bar = timeline.bar > 0 ? timeline.bar : beat * 4;
  const origin = timeline.pickup > 1e-6 && timeline.pickup < bar - 1e-6 ? timeline.pickup : 0;
  const first = Math.ceil((from - origin) / beat - 1e-9);
  for (let k = first; origin + k * beat < to - 1e-9; k++) {
    const time = origin + k * beat;
    const inBar = (((time - origin) % bar) + bar) % bar;
    beats.push({ time, down: inBar < 1e-6 || Math.abs(inBar - bar) < 1e-6 });
  }
  return beats;
}

export function barAt(timeline: Timeline, time: number): number {
  let index = 0;
  for (let at = 0; at < timeline.bars.length; at++)
    if ((timeline.bars[at] as number) <= time + 1e-9) index = at;
  return index;
}
