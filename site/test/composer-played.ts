import abcjs from "abcjs";
import type { Change } from "../src/composer/commands";
import { followOrder, playOrder, structureOf } from "../src/composer/playorder";
import { type ScoreNote, indexScore } from "../src/composer/score";
import { buildTimeline } from "../src/composer/timeline";
import { indexFile } from "../src/composer/tunes";

/* biome-ignore lint/suspicious/noExplicitAny: abcjs objects. */
type Any = any;

/** Checks' helpers: a text with changes made, and what a tune plays, in play order. */
export const apply = (text: string, changes: Change[]) =>
  [...changes]
    // From the end; at one place, a replacement before an insertion (which goes in front of it).
    .sort((a, b) => b.from - a.from || b.to - a.to)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );

/** The pitches played (every voice), in play order, with where each is written. */
export function played(text: string, track: number | null = 0): { pitch: number; start: number }[] {
  const file = indexFile(text);
  const visual = (abcjs as Any).parseOnly(text)[0];
  const index = indexScore(visual, file.tunes[0] as never, (char) => char, text);
  const byStart = new Map<number, ScoreNote>(index.notes.map((note) => [note.start, note]));
  const lookup = (start: number) => {
    let at = start;
    while (/\s/.test(text[at] ?? "")) at += 1;
    return byStart.get(at);
  };
  const timeline = buildTimeline(
    visual.setUpAudio({}),
    { bpm: 120, beat: 0.25, bar: 1, pickup: 0, voices: index.voices.map((voice) => voice.name) },
    (char) => char,
    lookup,
  );
  const structure = structureOf(visual);
  return followOrder(timeline, structure, playOrder(structure))
    .notes.filter((note) => track === null || note.track === track)
    .map((note) => ({ pitch: note.pitch, start: note.start ?? -1 }));
}
