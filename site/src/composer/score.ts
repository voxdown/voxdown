import type { FileIndex, TuneInfo } from "./tunes";

/* biome-ignore lint/suspicious/noExplicitAny: abcjs's tune objects are loosely typed. */
type Any = any;
type Abcjs = typeof import("abcjs");

let abcjsModule: Promise<Abcjs> | null = null;
/** abcjs is ~500 KB; it loads after the first paint, once there is a tune to draw. */
export function loadAbcjs(): Promise<Abcjs> {
  abcjsModule ??= import("abcjs").then((module) => ((module as Any).default ?? module) as Abcjs);
  return abcjsModule;
}

/** One note, chord or rest as drawn, with its place in the text and in written time. */
export type ScoreNote = {
  /** Offsets in the whole document. */
  start: number;
  end: number;
  voice: number;
  line: number;
  staff: number;
  /** Written time from the tune's start, in whole notes, per voice (repeats not expanded). */
  time: number;
  duration: number;
  measure: number;
  rest: boolean;
  elements: Element[];
};
export type ScoreVoice = { key: string; name: string; staff: number };
export type ScoreIndex = {
  tune: TuneInfo;
  notes: ScoreNote[];
  byVoice: ScoreNote[][];
  voices: ScoreVoice[];
  /** Bar lines per voice: written time and document offset of each. */
  bars: { time: number; start: number; end: number; voice: number }[];
  measures: number;
  /** Maps an abcjs character offset to a document offset. */
  toDocument: (char: number) => number;
  /** The abcjs tune, for timing and audio. */
  visual: Any;
  warnings: { from: number; to: number; message: string }[];
  /** The text abcjs drew, for playback. */
  source: string;
};

export type RenderInput = { text: string; file: FileIndex; tune: TuneInfo; width: number };

/** Builds the text abcjs reads for one tune, with the file header in front. */
export function tuneSource(input: Pick<RenderInput, "text" | "file" | "tune">) {
  const header = input.file.header
    ? input.text.slice(input.file.header.from, input.file.header.to)
    : "";
  const body = input.text.slice(input.tune.from, input.tune.to);
  const prefix = header ? `${header.replace(/\n*$/, "")}\n` : "";
  const headerFrom = input.file.header?.from ?? 0;
  const toDocument = (char: number) =>
    char < prefix.length ? headerFrom + char : input.tune.from + char - prefix.length;
  return { source: prefix + body, toDocument, prefixLength: prefix.length };
}

function measuresPerLine(width: number): number {
  return Math.max(1, Math.min(8, Math.round(width / 210)));
}

/** Renders one tune into `stage` (hidden), then indexes what was drawn. */
export async function renderTune(
  stage: HTMLElement,
  input: RenderInput,
  wide: boolean,
): Promise<ScoreIndex> {
  const abcjs = await loadAbcjs();
  const { source, toDocument } = tuneSource(input);
  const staffwidth = Math.max(240, Math.floor(input.width) - 30);
  stage.style.width = `${Math.floor(input.width)}px`;
  const font = '"Literata Variable", Georgia, serif';
  const tunes = abcjs.renderAbc(stage, source, {
    add_classes: true,
    staffwidth,
    paddingtop: 6,
    paddingbottom: 10,
    paddingleft: 6,
    paddingright: 12,
    selectTypes: false,
    wrap: {
      minSpacing: 1.6,
      maxSpacing: wide ? 2.4 : 2.7,
      preferredMeasuresPerLine: measuresPerLine(staffwidth),
    },
    format: {
      titlefont: `${font} 19`,
      subtitlefont: `${font} 14`,
      composerfont: `${font} italic 12`,
      gchordfont: '"Recursive Variable", sans-serif 12',
      annotationfont: '"Recursive Variable", sans-serif 11',
      vocalfont: `${font} 13`,
      partsfont: '"Recursive Variable", sans-serif bold 12',
      tempofont: '"Recursive Variable", sans-serif 11',
      wordsfont: `${font} 13`,
    },
  } as Any) as Any[];
  const visual = tunes[0];
  return indexScore(visual, input.tune, toDocument, source);
}

export function indexScore(
  visual: Any,
  tune: TuneInfo,
  toDocument: (char: number) => number,
  source: string,
): ScoreIndex {
  const notes: ScoreNote[] = [];
  const voiceKeys = new Map<string, number>();
  const voices: ScoreVoice[] = [];
  const clocks: {
    time: number;
    measure: number;
    sinceBar: number;
    triplet: number;
    tripletLeft: boolean;
  }[] = [];
  const bars: ScoreIndex["bars"] = [];
  const lines: Any[] = visual?.lines ?? [];
  lines.forEach((line: Any, lineIndex: number) => {
    if (!line.staff) return;
    line.staff.forEach((staff: Any, staffIndex: number) => {
      staff.voices.forEach((elements: Any[], voiceIndex: number) => {
        const key = `${staffIndex}.${voiceIndex}`;
        let voice = voiceKeys.get(key);
        if (voice === undefined) {
          voice = voices.length;
          voiceKeys.set(key, voice);
          const title = Array.isArray(staff.title) ? staff.title[voiceIndex] : undefined;
          const fromTune = tune.voices[voice];
          voices.push({
            key,
            name:
              (typeof title === "string" && title) ||
              fromTune?.name ||
              (fromTune ? `Voice ${fromTune.id}` : `Voice ${voice + 1}`),
            staff: staffIndex,
          });
          clocks.push({ time: 0, measure: 0, sinceBar: 0, triplet: 1, tripletLeft: false });
        }
        const clock = clocks[voice] as (typeof clocks)[number];
        for (const element of elements) {
          if (element.el_type === "note") {
            if (element.startTriplet) {
              clock.triplet = element.tripletMultiplier ?? 1;
              clock.tripletLeft = true;
            }
            const spacer = element.rest?.type === "spacer";
            const duration = spacer
              ? 0
              : (element.duration ?? 0) * (clock.tripletLeft ? clock.triplet : 1);
            const elementsDrawn: Element[] = (element.abselem?.elemset ?? []).filter(
              (item: unknown) => item instanceof Element,
            );
            let startChar = element.startChar;
            while (startChar < element.endChar && /\s/.test(source[startChar] ?? ""))
              startChar += 1;
            let endChar = element.endChar;
            // abcjs counts the space after a note in; the note itself ends before it.
            while (endChar > element.startChar && /\s/.test(source[endChar - 1] ?? ""))
              endChar -= 1;
            if (typeof element.startChar === "number" && !spacer)
              notes.push({
                start: toDocument(startChar),
                end: toDocument(endChar),
                voice,
                line: lineIndex,
                staff: staffIndex,
                time: clock.time,
                duration,
                measure: clock.measure,
                rest: Boolean(element.rest),
                elements: elementsDrawn,
              });
            clock.time += duration;
            clock.sinceBar += duration;
            if (element.endTriplet) {
              clock.tripletLeft = false;
              clock.triplet = 1;
            }
          } else if (element.el_type === "bar") {
            if (typeof element.startChar === "number") {
              let barStart = element.startChar;
              let barEnd = element.endChar;
              while (barStart < barEnd && /\s/.test(source[barStart] ?? "")) barStart += 1;
              while (barEnd > barStart && /\s/.test(source[barEnd - 1] ?? "")) barEnd -= 1;
              bars.push({
                time: clock.time,
                start: toDocument(barStart),
                end: toDocument(barEnd),
                voice,
              });
            }
            if (clock.sinceBar > 0) clock.measure += 1;
            clock.sinceBar = 0;
          }
        }
      });
    });
  });
  notes.sort((a, b) => a.start - b.start);
  const byVoice = voices.map((_, voice) =>
    notes.filter((note) => note.voice === voice).sort((a, b) => a.time - b.time),
  );
  const measures = Math.max(
    0,
    ...clocks.map((clock) => clock.measure + (clock.sinceBar > 0 ? 1 : 0)),
  );
  const warnings = parseWarnings(visual?.warnings ?? [], source, toDocument);
  return { tune, notes, byVoice, voices, bars, measures, toDocument, visual, warnings, source };
}

/** abcjs warnings read "Music Line:7:35: Unknown character ignored: …"; place them in the text. */
export function parseWarnings(
  list: string[],
  source: string,
  toDocument: (char: number) => number,
) {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++)
    if (source[index] === "\n") lineStarts.push(index + 1);
  const out: { from: number; to: number; message: string }[] = [];
  for (const raw of list) {
    const text = raw.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
    const match = /Line:\s*(\d+):(\d+):\s*([^:]+)/.exec(text);
    if (!match) {
      out.push({ from: toDocument(0), to: toDocument(0), message: text });
      continue;
    }
    const line = Number(match[1]) - 1;
    const column = Number(match[2]);
    const start = (lineStarts[line] ?? 0) + Math.max(0, column);
    const from = Math.min(start, source.length);
    out.push({
      from: toDocument(from),
      to: toDocument(Math.min(from + 1, source.length)),
      message: (match[3] as string).trim(),
    });
  }
  return out;
}

/** Notes covering a document position (the caret), preferring the one that starts there. */
export function notesAt(index: ScoreIndex, position: number): ScoreNote[] {
  const inside = index.notes.filter((note) => note.start <= position && position < note.end);
  if (inside.length) return inside;
  return index.notes.filter((note) => note.end === position);
}

export function notesInRanges(
  index: ScoreIndex,
  ranges: { from: number; to: number }[],
): ScoreNote[] {
  return index.notes.filter((note) =>
    ranges.some((range) => range.to > range.from && note.start < range.to && note.end > range.from),
  );
}

/* Regions: a span of written time in some voices. */
export type Region = { from: number; to: number; voices: number[] };

/** The text ranges a region covers: one per voice, from its first note to its last. */
export function regionRanges(
  index: ScoreIndex,
  region: Region,
  text: string,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const eps = 1e-6;
  for (const voice of region.voices) {
    const notes = (index.byVoice[voice] ?? []).filter(
      (note) => note.time >= region.from - eps && note.time < region.to - eps,
    );
    if (!notes.length) continue;
    const from = Math.min(...notes.map((note) => note.start));
    let to = Math.max(...notes.map((note) => note.end));
    while (to > from && /[ \t]/.test(text[to - 1] as string)) to -= 1;
    // A region that ends with its bar takes the bar line, so copying or deleting keeps bars whole.
    const bar = index.bars.find(
      (each) =>
        each.voice === voice &&
        Math.abs(each.time - region.to) < eps &&
        each.start >= to &&
        /^[ \t]*$/.test(text.slice(to, each.start)),
    );
    if (bar) to = bar.end;
    ranges.push({ from, to });
  }
  return ranges.sort((a, b) => a.from - b.from);
}

/** The region a set of text ranges selects, in written time. */
export function regionOfRanges(
  index: ScoreIndex,
  ranges: { from: number; to: number }[],
): Region | null {
  const notes = notesInRanges(index, ranges);
  if (!notes.length) return null;
  const from = Math.min(...notes.map((note) => note.time));
  const to = Math.max(...notes.map((note) => note.time + note.duration));
  const voices = [...new Set(notes.map((note) => note.voice))].sort((a, b) => a - b);
  return { from, to, voices };
}

/** Snaps a written time to note boundaries in a voice: never half a note. */
export function noteAtTime(index: ScoreIndex, voice: number, time: number): ScoreNote | undefined {
  const notes = index.byVoice[voice] ?? [];
  let found = notes[0];
  for (const note of notes) {
    if (note.time <= time + 1e-6) found = note;
    else break;
  }
  return found;
}

/* Geometry, measured lazily in the score's own coordinates. */
export type NoteBox = { note: ScoreNote; left: number; right: number; top: number; bottom: number };
export type StaffBox = {
  line: number;
  staff: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export function measure(
  index: ScoreIndex,
  container: HTMLElement,
): { notes: NoteBox[]; staves: StaffBox[] } {
  const origin = container.getBoundingClientRect();
  const notes: NoteBox[] = [];
  for (const note of index.notes) {
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const element of note.elements) {
      const rect = element.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      left = Math.min(left, rect.left - origin.left);
      right = Math.max(right, rect.right - origin.left);
      top = Math.min(top, rect.top - origin.top);
      bottom = Math.max(bottom, rect.bottom - origin.top);
    }
    if (Number.isFinite(left)) notes.push({ note, left, right, top, bottom });
  }
  const staves: StaffBox[] = [];
  const lines = container.querySelectorAll<SVGGraphicsElement>(".abcjs-staff");
  const byKey = new Map<string, StaffBox>();
  for (const element of lines) {
    const line = Number(/abcjs-l(\d+)/.exec(element.getAttribute("class") ?? "")?.[1] ?? -1);
    const rect = element.getBoundingClientRect();
    if (line < 0 || !rect.width) continue;
    // Staff lines of one system are separate paths; staves are told apart by their gaps.
    const keyPrefix = `${line}`;
    const box = {
      top: rect.top - origin.top,
      bottom: rect.bottom - origin.top,
      left: rect.left - origin.left,
      right: rect.right - origin.left,
    };
    let placed = false;
    for (const [key, existing] of byKey) {
      if (!key.startsWith(`${keyPrefix}:`)) continue;
      if (box.top <= existing.bottom + 14 && box.bottom >= existing.top - 14) {
        existing.top = Math.min(existing.top, box.top);
        existing.bottom = Math.max(existing.bottom, box.bottom);
        existing.left = Math.min(existing.left, box.left);
        existing.right = Math.max(existing.right, box.right);
        placed = true;
        break;
      }
    }
    if (!placed) byKey.set(`${keyPrefix}:${byKey.size}`, { line, staff: 0, ...box });
  }
  const grouped = new Map<number, StaffBox[]>();
  for (const box of byKey.values()) {
    const list = grouped.get(box.line) ?? [];
    list.push(box);
    grouped.set(box.line, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.top - b.top);
    list.forEach((box, staff) => {
      box.staff = staff;
      staves.push(box);
    });
  }
  return { notes, staves };
}
