/**
 * Dynamics per pass through a repeat, written the way players write them, as plain ABC 2.1
 * annotations: "^2nd time p", "^1st time f, 2nd time p", "^f, 2nd time p", "_on repeat pp".
 * Playback applies them on that pass; the score draws their dynamic letters like !p!.
 */
import type { PlayNote, Timeline } from "./timeline";
import type { FileIndex, TuneInfo } from "./tunes";
import { walkTune } from "./walk";

export const DYNAMICS = [
  "pppp",
  "ppp",
  "pp",
  "p",
  "mp",
  "mf",
  "f",
  "ff",
  "fff",
  "ffff",
  "sfz",
] as const;
export type Dynamic = (typeof DYNAMICS)[number];

/** Loudness of each dynamic, relative to forte = 0.87. */
const LEVEL: Record<Dynamic, number> = {
  pppp: 0.2,
  ppp: 0.3,
  pp: 0.4,
  p: 0.5,
  mp: 0.62,
  mf: 0.75,
  f: 0.87,
  ff: 1,
  fff: 1.1,
  ffff: 1.18,
  sfz: 0.95,
};

export const DYNAMIC_WORD = /(^|[\s,;(])(pppp|ppp|pp|p|mp|mf|f|ff|fff|ffff|sfz)(?=$|[\s,;.)])/g;

const ORDINALS: [RegExp, number][] = [
  [/\b(1st|first)\b/i, 1],
  [/\b(2nd|second)\b|\bon repeat\b|\brepeat\b/i, 2],
  [/\b(3rd|third)\b/i, 3],
  [/\b(4th|fourth)\b/i, 4],
];

/**
 * The passes an annotation sets a dynamic for, or null when it is not about dynamics per pass.
 * A part without a pass ("f" in "f, 2nd time p") is the first time.
 */
export function passDynamics(annotation: string): Map<number, Dynamic> | null {
  const text = annotation.replace(/^[\^_<>@]/, "").trim();
  if (!/\b(time|x|repeat)\b|\b\d(st|nd|rd|th)\b/i.test(text)) return null;
  const found = new Map<number, Dynamic>();
  for (const part of text.split(/[,;]/)) {
    const dynamic = /(?:^|\s)(pppp|ppp|pp|p|mp|mf|f|ff|fff|ffff|sfz)(?=$|[\s.)])/.exec(
      part.trim(),
    )?.[1] as Dynamic | undefined;
    if (!dynamic) continue;
    const pass = ORDINALS.find(([pattern]) => pattern.test(part))?.[1] ?? 1;
    found.set(pass, dynamic);
  }
  return found.size ? found : null;
}

/** "on the 2nd time through, p (soft)"; for the status line. */
export function describePassDynamics(rules: Map<number, Dynamic>): string {
  const names: Record<string, string> = {
    pppp: "as soft as possible",
    ppp: "very very soft",
    pp: "very soft",
    p: "soft",
    mp: "moderately soft",
    mf: "moderately loud",
    f: "loud",
    ff: "very loud",
    fff: "very very loud",
    ffff: "as loud as possible",
    sfz: "a sudden accent",
  };
  const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
  return [...rules]
    .sort((a, b) => a[0] - b[0])
    .map(([pass, dynamic]) => `${ordinal(pass)} time ${dynamic} (${names[dynamic]})`)
    .join(", ");
}

export type PassRule = { start: number; rules: Map<number, Dynamic> };
export type WrittenDynamic = { start: number; dynamic: Dynamic };

/**
 * Applies per-pass dynamics to a timeline. A rule starts at its note on the passes it names and
 * lasts, through that pass, until the next written dynamic or the music jumps back (a new pass).
 * Velocities are scaled from the dynamic written in force there (mf when none).
 */
export function applyPassDynamics(
  timeline: Timeline,
  rules: PassRule[],
  written: WrittenDynamic[],
): Timeline {
  if (!rules.length) return timeline;
  const ruleAt = new Map(rules.map((rule) => [rule.start, rule.rules]));
  const writtenAt = new Map(written.map((mark) => [mark.start, mark.dynamic]));
  // Which time through each written place is: count occurrences in performance order.
  const seen = new Map<string, number>();
  const passes = timeline.notes.map((note) => {
    const key = `${note.track}:${Math.round(note.written * 1e5)}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count;
  });
  const notes = timeline.notes.map((note) => ({ ...note }));
  const byTrack = new Map<number, number[]>();
  notes.forEach((note, index) => {
    const list = byTrack.get(note.track) ?? [];
    list.push(index);
    byTrack.set(note.track, list);
  });
  for (const list of byTrack.values()) {
    const trackNotes = list.map((index) => notes[index] as PlayNote);
    let override: { dynamic: Dynamic; pass: number } | null = null;
    let lastWritten = Number.NEGATIVE_INFINITY;
    for (const index of list) {
      const note = notes[index] as PlayNote;
      const pass = passes[index] ?? 1;
      if (note.written < lastWritten - 1e-6) override = null;
      lastWritten = note.written;
      if (note.start !== undefined && writtenAt.has(note.start)) override = null;
      const rule = note.start !== undefined ? ruleAt.get(note.start) : undefined;
      if (rule?.has(pass)) override = { dynamic: rule.get(pass) as Dynamic, pass };
      if (!override || override.pass !== pass) continue;
      const base = writtenBefore(note, written, trackNotes);
      note.velocity = Math.max(
        1,
        Math.min(127, Math.round(note.velocity * (LEVEL[override.dynamic] / LEVEL[base]))),
      );
    }
  }
  return { ...timeline, notes };
}

/** The written dynamic in force at a note: the latest written mark at or before it (mf if none). */
function writtenBefore(note: PlayNote, written: WrittenDynamic[], list: PlayNote[]): Dynamic {
  let best: Dynamic = "mf";
  let bestWritten = Number.NEGATIVE_INFINITY;
  for (const mark of written) {
    const marked = list.find((each) => each.start === mark.start);
    if (marked && marked.written <= note.written + 1e-9 && marked.written >= bestWritten) {
      best = mark.dynamic;
      bestWritten = marked.written;
    }
  }
  return best;
}

/** Per-pass annotations and written dynamics, keyed by where their note's element starts. */
export function passMarks(
  text: string,
  tune: TuneInfo,
  file: FileIndex | null,
): { rules: PassRule[]; written: WrittenDynamic[] } {
  const rules: PassRule[] = [];
  const written: WrittenDynamic[] = [];
  let prefixStart: number | null = null;
  let pendingRule: Map<number, Dynamic> | null = null;
  let pendingWritten: Dynamic | null = null;
  walkTune(text, tune, file, (token) => {
    if (token.kind === "space") return;
    if (
      token.kind === "annotation" ||
      token.kind === "chord-symbol" ||
      token.kind === "decoration"
    ) {
      prefixStart ??= token.from;
      if (token.kind === "annotation")
        pendingRule = passDynamics(token.text.slice(1, -1)) ?? pendingRule;
      if (token.kind === "decoration") {
        const name = token.text.slice(1, -1);
        if ((DYNAMICS as readonly string[]).includes(name)) pendingWritten = name as Dynamic;
      }
      return;
    }
    if (token.kind === "note" || token.kind === "rest" || token.kind === "chord-open") {
      const start = prefixStart ?? token.from;
      if (pendingRule) rules.push({ start, rules: pendingRule });
      if (pendingWritten) written.push({ start, dynamic: pendingWritten });
    }
    if (token.kind === "note" && token.inChord) return;
    prefixStart = null;
    pendingRule = null;
    pendingWritten = null;
  });
  return { rules, written };
}
