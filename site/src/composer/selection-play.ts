/**
 * Playing a selection: exactly its notes, piece after piece. Loaded with abcjs (as the play order
 * is), since there is nothing to play before a score is drawn.
 */
import type { PlayNote, Timeline } from "./timeline";

/** The gap between the pieces of a selection played back to back, in whole notes. */
export const PIECE_GAP = 1 / 16;

/**
 * Exactly the selected notes, to play: the notes whose text starts are `starts`, in the stretches
 * of written time they cover (`pieces`), with what sounds with them and has no text of its own
 * (chord symbols' accompaniment, ornaments). A selection in several places plays its pieces back
 * to back, a sixteenth apart, never the music between them.
 */
export function selectionTimeline(
  timeline: Timeline,
  pieces: { from: number; to: number }[],
  starts: Set<number>,
  voices: number[],
  allVoices: boolean,
): Timeline {
  const eps = 1e-6;
  const inPieces = (note: PlayNote) =>
    pieces.some((piece) => note.written >= piece.from - eps && note.written < piece.to - eps);
  const chosen = (note: PlayNote) => {
    if (!inPieces(note)) return false;
    const track = timeline.tracks[note.track];
    if (note.start !== undefined) return starts.has(note.start);
    return track?.chords ? allVoices : track?.voice !== undefined && voices.includes(track.voice);
  };
  // The play order's jumps back (a repeat, a D.C. or D.S.): where the music goes on from.
  const texted = [...timeline.notes]
    .filter((note) => note.start !== undefined)
    .sort((a, b) => a.time - b.time);
  const landings: PlayNote[] = [];
  for (let at = 1; at < texted.length; at++) {
    const note = texted[at] as PlayNote;
    const before = texted[at - 1] as PlayNote;
    if (note.written < before.written - eps && note.time > before.time + eps) landings.push(note);
  }
  // A selection that covers where a repeat starts plays as the music does, repeats and all.
  if (landings.some((note) => chosen(note))) return played(timeline, chosen);
  const result = written(timeline, pieces, chosen);
  // Otherwise as written: said, when the play order would differ (a note it plays twice or not
  // at all, or a jump back between the selection's first and last notes).
  const picked = texted.filter((note) => chosen(note));
  const times = new Map<number, number>();
  for (const note of picked)
    times.set(note.start as number, (times.get(note.start as number) ?? 0) + 1);
  const firstTime = picked[0]?.time ?? 0;
  const lastTime = picked.at(-1)?.time ?? 0;
  const differs =
    [...starts].some(
      (start) => (times.get(start) ?? 0) !== 1 && result.notes.some((note) => note.start === start),
    ) || landings.some((note) => note.time > firstTime + eps && note.time <= lastTime + eps);
  return differs ? { ...result, asWritten: true } : result;
}

/**
 * The selected notes in the order they are played, a sixteenth apart where music between them is
 * left out; its pieces in written time, a new one at each jump back (so the ruler and the place
 * marker follow).
 */
function played(timeline: Timeline, chosen: (note: PlayNote) => boolean): Timeline {
  const eps = 1e-6;
  const picked = timeline.notes.filter(chosen).sort((a, b) => a.time - b.time || a.track - b.track);
  const notes: PlayNote[] = [];
  const placed: { at: number; from: number; to: number }[] = [];
  let shift = picked[0]?.time ?? 0;
  let lastEnd = shift;
  let lastWritten = Number.NEGATIVE_INFINITY;
  for (const note of picked) {
    const gap = note.time > lastEnd + eps;
    if (gap) shift += note.time - lastEnd - PIECE_GAP;
    const time = note.time - shift;
    const piece = placed[placed.length - 1];
    if (!piece || gap || note.written < lastWritten - eps)
      placed.push({ at: time, from: note.written, to: note.written + note.duration });
    else piece.to = Math.max(piece.to, note.written + note.duration);
    notes.push({ ...note, time });
    lastEnd = Math.max(lastEnd, note.time + note.duration);
    lastWritten = note.written;
  }
  const length = Math.max(lastEnd - shift, eps);
  return {
    ...timeline,
    notes,
    length,
    bars: [0],
    passes: [{ from: 0, to: length, repeat: false }],
    returns: [],
    offset: placed[0]?.from ?? 0,
    pieces: placed,
  };
}

/** The selected notes in written order, each once, piece after piece. */
function written(
  timeline: Timeline,
  pieces: { from: number; to: number }[],
  chosen: (note: PlayNote) => boolean,
): Timeline {
  const eps = 1e-6;
  const seen = new Set<string>();
  const notes: PlayNote[] = [];
  const placed: { at: number; from: number; to: number }[] = [];
  let at = 0;
  for (const piece of [...pieces].sort((a, b) => a.from - b.from)) {
    for (const note of timeline.notes) {
      if (note.written < piece.from - eps || note.written >= piece.to - eps) continue;
      if (!chosen(note)) continue;
      const key = `${note.track}:${note.pitch}:${Math.round(note.written * 1e5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push({
        ...note,
        time: at + note.written - piece.from,
        duration: Math.min(note.duration, piece.to - note.written),
      });
    }
    placed.push({ at, from: piece.from, to: piece.to });
    at += piece.to - piece.from + PIECE_GAP;
  }
  notes.sort((a, b) => a.time - b.time || a.track - b.track);
  const length = Math.max(at - (placed.length ? PIECE_GAP : 0), eps);
  return {
    ...timeline,
    notes,
    length,
    bars: [0],
    passes: [{ from: 0, to: length, repeat: false }],
    returns: [],
    offset: placed[0]?.from ?? 0,
    pieces: placed,
  };
}

/** The stretches of written time some notes cover, joined where they touch or overlap. */
export function piecesOf(
  notes: { time: number; duration: number }[],
): { from: number; to: number }[] {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const pieces: { from: number; to: number }[] = [];
  for (const note of sorted) {
    const last = pieces[pieces.length - 1];
    const end = note.time + Math.max(note.duration, 1e-6);
    if (last && note.time <= last.to + 1e-6) last.to = Math.max(last.to, end);
    else pieces.push({ from: note.time, to: end });
  }
  return pieces;
}
