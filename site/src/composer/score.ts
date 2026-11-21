import { lineKind } from "./abc";
import { maxOf, minOf } from "./extent";
import { DYNAMIC_WORD, passDynamics } from "./passes";
import type { FileIndex, TuneInfo } from "./tunes";

/* biome-ignore lint/suspicious/noExplicitAny: abcjs's tune objects are loosely typed. */
type Any = any;
type Abcjs = typeof import("abcjs");

let abcjsModule: Promise<Abcjs> | null = null;
/** abcjs once loaded, for work that cannot wait (the browser's own Print). */
export let loadedAbcjs: Abcjs | null = null;
/** The play order (D.C., D.S., Fine, Coda), loaded with abcjs: playback needs both. */
export let loadedPlayOrder: typeof import("./playorder") | null = null;
/** The key and clef repair for abcjs's reflow (./reflow), loaded with abcjs. */
let loadedReflow: typeof import("./reflow") | null = null;
/** abcjs is ~500 KB; it loads after the first paint, once there is a tune to draw. */
export function loadAbcjs(): Promise<Abcjs> {
  abcjsModule ??= Promise.all([import("abcjs"), import("./playorder"), import("./reflow")]).then(
    ([module, order, reflow]) => {
      loadedPlayOrder = order;
      loadedReflow = reflow;
      loadedAbcjs = ((module as Any).default ?? module) as Abcjs;
      return loadedAbcjs;
    },
  );
  return abcjsModule;
}

/** The score's fonts, the same on screen and on paper. */
export function scoreFormat(compact = false): Any {
  const font = '"Literata Variable", Georgia, serif';
  return {
    titlefont: `${font} ${compact ? 16 : 19}`,
    subtitlefont: `${font} ${compact ? 12 : 14}`,
    composerfont: `${font} italic ${compact ? 11 : 12}`,
    // A narrow score is drawn at COMPACT_SCALE; its words are set larger so they read the same.
    gchordfont: `"Recursive Variable", sans-serif ${compact ? 13 : 12}`,
    annotationfont: `"Recursive Variable", sans-serif ${compact ? 12 : 11}`,
    vocalfont: `${font} ${compact ? 15.5 : 13}`,
    partsfont: '"Recursive Variable", sans-serif bold 12',
    tempofont: '"Recursive Variable", sans-serif 11',
    wordsfont: `${font} 13`,
  };
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

export type RenderInput = {
  text: string;
  file: FileIndex;
  tune: TuneInfo;
  width: number;
  /** A phone: smaller titles and closer spacing. */
  compact?: boolean | undefined;
  /** The reader's zoom, 0.5–2: the score is laid out at width ÷ zoom and drawn that much larger. */
  zoom?: number | undefined;
};

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

/** Renders one tune into `stage` (hidden), then indexes what was drawn. */
/** Line breaks abcjs chose (last measure of each line, per section), for redrawing in one pass. */
export type Breaks = {
  key: string;
  lineBreaks: number[][];
  /** What the breaks were chosen from, for checks. */
  measured?:
    | { sections: { left: number; measureWidths: number[] }[]; staffwidth: number }
    | undefined;
};

/** What decides line breaks: the width and the number of bars, not the notes inside them. */
export function breaksKey(source: string, width: number): string {
  return `${Math.floor(width)}:${(source.match(/\|/g) ?? []).length}`;
}

/** abcjs's own choice, read back from its explanation of the wrapping it did. */
export function chosenBreaks(explanation: Any): number[][] | null {
  if (!Array.isArray(explanation)) return null;
  const sections: number[][] = [];
  for (const section of explanation) {
    const chosen = (section?.attempts ?? [])
      .filter((attempt: Any) => !attempt.failed && Array.isArray(attempt.lineBreaks))
      .at(-1);
    if (!chosen) return null;
    sections.push(chosen.lineBreaks);
  }
  return sections;
}

/** Lyric syllables carry a no-break space each side, so words never touch, and a narrow one
 * before a hyphen, so it stands between syllables. abcjs then reserves the room itself. */
export function padLyrics(tune: Any): void {
  for (const line of tune?.lines ?? [])
    for (const staff of line.staff ?? [])
      for (const voice of staff.voices ?? [])
        for (const element of voice)
          for (const lyric of element.lyric ?? []) {
            if (!lyric.syllable || lyric.padded) continue;
            lyric.padded = true;
            lyric.syllable = `\u00a0${lyric.syllable}${lyric.divider === "-" ? "\u202f" : ""}`;
            lyric.divider = lyric.divider === " " ? "\u00a0" : `${lyric.divider}\u00a0`;
          }
}

/**
 * A subtitle (a second T:) is drawn with the title, yet abcjs still leaves a system's gap for
 * its line before the first staff: 60 px more than a tune without one. Take that gap back.
 */
export function closeSubtitleGap(tune: Any): void {
  const lines: Any[] = tune?.lines ?? [];
  const first = lines.findIndex((line) => line.staff);
  if (first <= 0 || !lines.slice(0, first).every((line) => line.subtitle) || lines[first].closed)
    return;
  const staffsep = tune.formatting?.staffsep;
  const separation = typeof staffsep === "number" ? (staffsep * 4) / 3 : 61.33;
  lines[first].closed = true;
  lines[first].vskip = (lines[first].vskip ?? 0) - separation;
}

/** Everything Composer adjusts in a parsed tune before abcjs draws it. */
export function prepareTune(tune: Any): void {
  loadedReflow?.keepSignatures(tune);
  padLyrics(tune);
  closeSubtitleGap(tune);
}

/**
 * On a narrow score, tighter spacing around the title and between systems, set on the tune's own
 * formatting (as %%titlespace, %%staffsep would), so no offsets in the source move.
 */
export function prepareCompactTune(tune: Any): void {
  if (tune) {
    // Voice names once, on the first system; later systems keep their width for the music.
    let seen = false;
    for (const line of tune.lines ?? []) {
      if (!line.staff) continue;
      if (seen) for (const staff of line.staff) if (staff.title) staff.title = undefined;
      seen = true;
    }
    tune.formatting ??= {};
    Object.assign(tune.formatting, {
      topspace: 0,
      titlespace: 0,
      subtitlespace: 1,
      composerspace: 2,
      musicspace: 0,
      staffsep: 34,
    });
  }
  prepareTune(tune);
}

/** How much a narrow score is drawn smaller, so two bars still fit a line. */
export const COMPACT_SCALE = 0.86;

/**
 * Line breaks that follow phrases: the number of bars the author wrote per line when that is
 * consistent and fits, else 4 bars, else 2 (or 8 when 4 leave lines sparse), else 1; a pickup
 * rides with the first line, and a short last line joins the one above when it fits.
 */
export function chooseBreaks(
  sections: { left: number; measureWidths: number[] }[],
  staffwidth: number,
  spacing: { min: number; max: number },
  options: {
    authorBars?: number | null;
    pickup?: boolean;
    filled?: boolean[][];
    /** A phone reads two bars a line at most. */
    maxBars?: number;
  } = {},
): number[][] {
  return sections.map((section, sectionIndex) => {
    const filled = options.filled?.[sectionIndex];
    const widths = section.measureWidths;
    const usable = staffwidth - section.left;
    const most = usable / spacing.min;
    const least = usable / spacing.max;
    // abcjs counts an empty "measure" before a leading |: — it rides with the bar after it.
    const real = widths
      .map((width, index) => ({ width, index }))
      .filter(({ width, index }) => (filled ? filled[index] !== false : width > 0.5));
    if (real.length < 2) return [];
    const pickup = Boolean(options.pickup) && sectionIndex === 0;
    const lines = (perLine: number): { width: number; index: number }[][] => {
      const out: { width: number; index: number }[][] = [];
      let at = 0;
      while (at < real.length) {
        const take = perLine + (pickup && at === 0 ? 1 : 0);
        out.push(real.slice(at, at + take));
        at += take;
      }
      return out;
    };
    const total = (line: { width: number }[]) => line.reduce((sum, bar) => sum + bar.width, 0);
    const greedy = (atMost: number): { width: number; index: number }[][] => {
      const out: { width: number; index: number }[][] = [];
      let at = 0;
      while (at < real.length) {
        let take = Math.min(atMost + (pickup && at === 0 ? 1 : 0), real.length - at);
        while (take > 1 && total(real.slice(at, at + take)) > most + 0.5) take -= 1;
        out.push(real.slice(at, at + take));
        at += take;
      }
      return out;
    };
    const fits = (perLine: number) => lines(perLine).every((line) => total(line) <= most + 0.5);
    const sparse = (perLine: number) =>
      lines(perLine)
        .slice(0, -1)
        .some((line) => total(line) < least);
    // The author's own bars per line first; else 4 (8 when 4 leave lines sparse), 2, 1.
    const candidates: number[] = [];
    if (options.authorBars && options.authorBars > 0) candidates.push(options.authorBars);
    if (fits(4) && sparse(4) && fits(8)) candidates.push(8);
    candidates.push(4, 2, 1);
    const chosen = candidates.filter((count) => count <= (options.maxBars ?? 8)).find(fits) ?? 1;
    // When two bars do not fit on every line, still pair them wherever they do.
    const result = chosen === 1 ? greedy(2) : lines(chosen);
    // A short last line (under half the width) joins the line above when they fit together.
    if (result.length > 1) {
      const last = result[result.length - 1] as { width: number; index: number }[];
      const previous = result[result.length - 2] as { width: number; index: number }[];
      const remainder = last.length < chosen;
      if (remainder && total(last) < most * 0.5 && total(previous) + total(last) <= most + 0.5)
        result.splice(result.length - 2, 2, [...previous, ...last]);
    }
    return result.slice(0, -1).map((line) => (line[line.length - 1] as { index: number }).index);
  });
}

/**
 * Which of abcjs's measures hold music, per section (a leading |: makes an empty one), and
 * whether the first is a pickup: shorter than the bar.
 */
export function measuresOf(parsed: Any): { filled: boolean[][]; pickup: boolean } {
  const filled: boolean[][] = [];
  let section: boolean[] | null = null;
  let first: number | null = null;
  const bar = parsed?.getBarLength?.() ?? 1;
  for (const line of parsed?.lines ?? []) {
    if (!line.staff) {
      section = null;
      continue;
    }
    if (!section) {
      section = [];
      filled.push(section);
    }
    let notes = 0;
    let length = 0;
    for (const element of line.staff[0]?.voices?.[0] ?? []) {
      if (element.el_type === "note") {
        notes += 1;
        length += element.duration ?? 0;
      } else if (element.el_type === "bar") {
        section.push(notes > 0);
        if (notes > 0 && first === null) first = length;
        notes = 0;
        length = 0;
      }
    }
    if (notes > 0) {
      section.push(true);
      if (first === null) first = length;
    }
  }
  return { filled, pickup: first !== null && first > 1e-6 && first < bar - 1e-6 };
}

/** Bars per source line in the first voice, when the author wrote a consistent number. */
export function authorBarsPerLine(
  text: string,
  items: { type: string; voice: string; from: number; to: number }[],
): number | null {
  const voice = items.find((item) => item.type === "event")?.voice;
  if (voice === undefined) return null;
  const counts = new Map<number, number>();
  let events = 0;
  let first = true;
  for (const item of items) {
    if (item.voice !== voice) continue;
    if (item.type === "event") {
      events += 1;
      continue;
    }
    if (!events) continue;
    events = 0;
    const line = text.slice(0, item.from).split("\n").length;
    // The pickup does not count as one of the line's bars.
    if (first) {
      first = false;
      continue;
    }
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const values = [...counts.values()];
  if (values.length < 2) return values[0] && values[0] >= 2 ? values[0] : null;
  const body = values.slice(1, -1);
  const typical = values[1] as number;
  if (
    body.every((count) => count === typical) &&
    (values[0] as number) >= typical - 1 &&
    (values[values.length - 1] as number) <= typical
  )
    return typical;
  return null;
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function renderTune(
  stage: HTMLElement,
  input: RenderInput,
  wide: boolean,
  cached: Breaks | null = null,
  authorBars: () => number | null = () => null,
): Promise<ScoreIndex & { breaks: Breaks | null }> {
  const abcjs = await loadAbcjs();
  const { source, toDocument } = tuneSource(input);
  // Narrow screens accept closer spacing and a slightly smaller drawing, so a phone still shows
  // two bars a line.
  const compact = input.compact ?? Math.floor(input.width) - 30 < 400;
  const zoom = input.zoom ?? 1;
  const scale = (compact ? COMPACT_SCALE : 1) * zoom;
  const staffwidth = Math.max(240, Math.floor(input.width) - 30);
  // abcjs lays out at width ÷ scale, then draws it smaller; bars are measured in those units.
  const layoutWidth = Math.floor(staffwidth / scale);
  stage.style.width = `${Math.floor(input.width)}px`;
  const spacing = { min: compact ? 1.1 : 1.35, max: wide ? 2.4 : 2.7 };
  const params: Any = {
    add_classes: true,
    staffwidth,
    paddingtop: compact ? 2 : 6,
    paddingbottom: 10,
    paddingleft: 6,
    paddingright: 12,
    selectTypes: false,
    // A phone keeps the title block small, so the first staff is not pushed off the screen.
    format: scoreFormat(compact),
    afterParsing: compact ? prepareCompactTune : prepareTune,
    ...(scale !== 1 ? { scale } : {}),
  };
  // While the bars and the width stay the same, the last line breaks still fit: one pass.
  const key = `${breaksKey(source, staffwidth)}:${wide ? "w" : "n"}:${zoom}`;
  let lineBreaks = cached && cached.key === key ? cached.lineBreaks : null;
  let measured = cached && cached.key === key ? cached.measured : undefined;
  if (!lineBreaks) {
    // Otherwise measure the bars and choose phrase-aware breaks, then draw in the next task.
    performance.mark("composer:measure");
    const parsed = (abcjs as Any).parseOnly(source, params)[0];
    padLyrics(parsed);
    const controller = new (abcjs as Any).test.EngraverController(stage, params);
    const sections = parsed ? controller.getMeasureWidths(parsed) : [];
    const { filled, pickup } = measuresOf(parsed);
    lineBreaks = chooseBreaks(sections, layoutWidth, spacing, {
      ...(compact ? { maxBars: 2 } : {}),
      authorBars: authorBars(),
      pickup,
      filled,
    });
    // abcjs wants a list of breaks for each section of music it reflows (a %%vskip, a %%text or a
    // new part's title starts one) and throws without it: the score then never redraws.
    const reflowed = (parsed?.deline?.({ lineBreaks: false }) ?? []).filter(
      (line: Any) => line.staff,
    ).length;
    while (lineBreaks.length < reflowed) lineBreaks.push([]);
    measured = {
      sections: sections.map((section: Any) => ({
        left: section.left,
        measureWidths: section.measureWidths,
      })),
      staffwidth: layoutWidth,
    };
    stage.replaceChildren();
    performance.measure("composer:measure", "composer:measure");
    await nextTask();
  }
  performance.mark("composer:engrave");
  const tunes = abcjs.renderAbc(stage, source, { ...params, lineBreaks } as Any) as Any[];
  const visual = tunes[0];
  drawPassDynamics(stage);
  performance.measure("composer:engrave", "composer:engrave");
  performance.mark("composer:index");
  const index = indexScore(visual, input.tune, toDocument, source);
  performance.measure("composer:index", "composer:index");
  return { ...index, breaks: { key, lineBreaks, measured } };
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
    /** Bars a multi-bar rest (Z4) in this bar stands for. */
    rests: number;
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
          clocks.push({
            time: 0,
            measure: 0,
            sinceBar: 0,
            triplet: 1,
            tripletLeft: false,
            rests: 1,
          });
        }
        const clock = clocks[voice] as (typeof clocks)[number];
        for (const element of elements) {
          if (element.el_type === "note") {
            if (element.startTriplet) {
              clock.triplet = element.tripletMultiplier ?? 1;
              clock.tripletLeft = true;
            }
            const spacer = element.rest?.type === "spacer";
            if (element.rest?.type === "multimeasure")
              clock.rests = Math.max(1, Number(element.rest.text) || 1);
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
            // An overlay's (&) closing bar line comes through as a note with nothing drawn: an
            // entry with no drawing and no note or rest letter in its text is no note.
            const phantom =
              !elementsDrawn.length && !/[A-Ga-gzxZX]/.test(source.slice(startChar, endChar));
            if (typeof element.startChar === "number" && !spacer && !phantom)
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
            // A bar holding a multi-bar rest (Z4) counts as the bars it stands for.
            if (clock.sinceBar > 0) clock.measure += clock.rests;
            clock.sinceBar = 0;
            clock.rests = 1;
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
    ...clocks.map((clock) => clock.measure + (clock.sinceBar > 0 ? clock.rests : 0)),
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
    // "Line:5:9: Unknown decoration: foo:  !foo!A B|" — the message, without the quoted line.
    const match = /Line:\s*(\d+):(\d+):\s*(.*?)(?::\s{2}.*)?$/.exec(text);
    if (!match) {
      out.push({ from: toDocument(0), to: toDocument(0), message: text });
      continue;
    }
    const line = Number(match[1]) - 1;
    // abcjs counts columns from 1.
    const column = Number(match[2]) - 1;
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

/**
 * The notes the caret is on, by the explanation's rule: between two notes ("d/|e"), the one to
 * its left. The status line, the score's highlight and Say note all name the same note.
 */
export function caretNotesAt(index: ScoreIndex, position: number): ScoreNote[] {
  const left = index.notes.filter((note) => note.end === position && note.start < position);
  if (left.length) return left;
  return index.notes.filter((note) => note.start <= position && position < note.end);
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
/**
 * A region of written time in some voices. `reach` is the latest note start it takes: a note is
 * in the region when it starts at or after `from` and no later than `reach`. `to` is where the
 * last note taken ends (for playback). Without `reach`, notes starting before `to` are taken.
 */
export type Region = {
  from: number;
  to: number;
  voices: number[];
  reach?: number | undefined;
  /**
   * Each voice's own span, when the voices don't share one: a drag takes what is drawn under it,
   * and voices drawn out of line with each other (a multi-bar rest drawn one bar wide) span
   * different written times.
   */
  bounds?: Record<number, { from: number; reach: number }> | undefined;
  /** A selection's own notes (their text starts) and the stretches of time they cover: what
   * Play and Loop play, piece after piece. */
  starts?: Set<number> | undefined;
  pieces?: { from: number; to: number }[] | undefined;
};

const EPS = 1e-6;

function takes(region: Region, note: ScoreNote): boolean {
  if (region.bounds) {
    const own = region.bounds[note.voice];
    return (
      Boolean(own) && note.time >= (own?.from ?? 0) - EPS && note.time <= (own?.reach ?? 0) + EPS
    );
  }
  if (note.time < region.from - EPS) return false;
  return region.reach !== undefined ? note.time <= region.reach + EPS : note.time < region.to - EPS;
}

/** The notes a region takes, voice by voice. */
export function regionNotes(index: ScoreIndex, region: Region): ScoreNote[] {
  return region.voices.flatMap((voice) =>
    (index.byVoice[voice] ?? []).filter((note) => takes(region, note)),
  );
}

/** A region from a start, a reach and voices, with `to` where its last note ends. */
export function spanRegion(
  index: ScoreIndex,
  from: number,
  reach: number,
  voices: number[],
): Region {
  const region: Region = { from, to: from, voices, reach };
  const notes = regionNotes(index, region);
  region.to = maxOf(
    notes.map((note) => note.time + note.duration),
    from,
  );
  return region;
}

/** A voice change in the text: a `V:` line or an inline `[V:…]`. */
const VOICE_SWITCH = /(?:^|\n)[ \t]*V:|\[V:/;

/**
 * Whether the text between two notes of a voice holds something that isn't that voice's music, so
 * a range must stop before it: a voice change, a comment, or a whole line that isn't music (a
 * field such as P:, K: or T:, a w: line, a %% directive or a blank line).
 */
export function breaksRun(gap: string): boolean {
  if (VOICE_SWITCH.test(gap)) return true;
  if (gap.replace(/"[^"\n]*"/g, "").includes("%")) return true;
  const lines = gap.split("\n");
  for (const line of lines.slice(1, -1)) if (lineKind(line, true) !== "music") return true;
  return false;
}

/**
 * The text ranges a region covers: per voice, from its first note to its last, split wherever the
 * voice's text is interrupted by another voice's (its music continuing in a later `V:` block) or by
 * a line that isn't music (lyrics, fields, comments, directives, blank lines), so a range never
 * takes another voice's text or anything but music.
 */
export function regionRanges(
  index: ScoreIndex,
  region: Region,
  text: string,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const inText = [...index.notes].sort((a, b) => a.start - b.start);
  for (const voice of region.voices) {
    const runs: ScoreNote[][] = [];
    let run: ScoreNote[] = [];
    let interrupted = false;
    for (const note of inText) {
      if (note.voice !== voice) {
        if (run.length) interrupted = true;
        continue;
      }
      if (!takes(region, note)) continue;
      const last = run.at(-1);
      if (last && (interrupted || breaksRun(text.slice(last.end, note.start)))) {
        runs.push(run);
        run = [];
      }
      interrupted = false;
      run.push(note);
    }
    if (run.length) runs.push(run);
    for (const notes of runs) {
      const from = minOf(notes.map((note) => note.start));
      let to = maxOf(notes.map((note) => note.end));
      const lastEnd = maxOf(notes.map((note) => note.time + note.duration));
      while (to > from && /[ \t]/.test(text[to - 1] as string)) to -= 1;
      // When this run's last note ends its bar, the bar line comes too, so bars stay whole.
      const bar = index.bars.find(
        (each) =>
          each.voice === voice &&
          Math.abs(each.time - lastEnd) < EPS &&
          each.start >= to &&
          /^[ \t]*$/.test(text.slice(to, each.start)),
      );
      if (bar) to = bar.end;
      ranges.push({ from, to });
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}

/** The region a set of text ranges selects, in written time. */
export function regionOfRanges(
  index: ScoreIndex,
  ranges: { from: number; to: number }[],
): Region | null {
  return regionOfNotes(index, notesInRanges(index, ranges));
}

/** The region a set of score notes spans, voice by voice. */
export function regionOfNotes(index: ScoreIndex, notes: ScoreNote[]): Region | null {
  if (!notes.length) return null;
  const from = minOf(notes.map((note) => note.time));
  const to = maxOf(notes.map((note) => note.time + note.duration));
  const reach = maxOf(notes.map((note) => note.time));
  const voices = [...new Set(notes.map((note) => note.voice))].sort((a, b) => a - b);
  // Each voice's own span: a selection taken from the drawing may span different times per voice.
  const bounds: Record<number, { from: number; reach: number }> = {};
  for (const note of notes) {
    const own = bounds[note.voice];
    if (!own) bounds[note.voice] = { from: note.time, reach: note.time };
    else {
      own.from = Math.min(own.from, note.time);
      own.reach = Math.max(own.reach, note.time);
    }
  }
  return { from, to, voices, reach, bounds };
}

/* The pointer in the score, in musical terms. */

/** A drawn note's place: its system (abcjs line) and the x of its head (not its chord symbol). */
export type Placed = { note: ScoreNote; line: number; staff: number; x: number };

function before(a: { line: number; x: number }, line: number, x: number): boolean {
  return a.line < line || (a.line === line && a.x <= x);
}

/**
 * How far the pointer has reached, as a written time: the latest start among notes (in any
 * voice) whose head is at or left of the pointer on its system, or on an earlier system. Left
 * of a system's first note, the pointer belongs to that first note. A note is never reached
 * before the pointer gets to it, so a bar line the pointer has not crossed is never crossed.
 */
export function reachAt(placed: Placed[], line: number, x: number): number {
  let reach = Number.NEGATIVE_INFINITY;
  let first: Placed | undefined;
  for (const each of placed) {
    if (each.line === line && (!first || each.x < first.x)) first = each;
    if (before(each, line, x)) reach = Math.max(reach, each.note.time);
  }
  if (first && x < first.x) reach = Math.max(reach, first.note.time);
  return Number.isFinite(reach) ? reach : 0;
}

/**
 * The note of one voice under the pointer: the last whose head is at or left of it. Past a bar
 * line but before that bar's first note, the pointer is at the bar's start: its first note, never
 * the last note of the bar before. `bars` are the bar lines' x on that system.
 */
export function noteUnder(
  placed: Placed[],
  line: number,
  x: number,
  bars: number[] = [],
): ScoreNote | undefined {
  const onLine = placed.filter((each) => each.line === line).sort((a, b) => a.x - b.x);
  let found = onLine[0];
  for (const each of onLine) if (each.x <= x) found = each;
  if (found && found.x <= x) {
    const crossed = bars.filter((bar) => bar > found.x && bar <= x);
    const barline = crossed.length ? Math.max(...crossed) : null;
    if (barline !== null) {
      const next = onLine.find((each) => each.x > barline);
      if (next) return next.note;
    }
  }
  return found?.note;
}

/**
 * Where the pointer reads each note: its head, except a note alone in its bar (a whole-bar rest,
 * drawn mid-bar) is read from just after the bar line, so it spans its bar.
 */
export function spanLoneNotes(placed: Placed[], barsByLine: Map<number, number[]>): Placed[] {
  const groups = new Map<string, Placed[]>();
  const segment = (each: Placed) => {
    const bars = barsByLine.get(each.line) ?? [];
    const left = bars.filter((bar) => bar < each.x);
    return left.length ? Math.max(...left) : Number.NEGATIVE_INFINITY;
  };
  for (const each of placed) {
    const key = `${each.line}:${each.staff}:${each.note.voice}:${segment(each)}`;
    const list = groups.get(key) ?? [];
    list.push(each);
    groups.set(key, list);
  }
  return placed.map((each) => {
    const start = segment(each);
    const alone =
      (groups.get(`${each.line}:${each.staff}:${each.note.voice}:${start}`) ?? []).length === 1;
    return alone && Number.isFinite(start) ? { ...each, x: Math.min(each.x, start + 12) } : each;
  });
}

/** A point in a drag: the note under the pointer in its voice, and how far the pointer reached. */
export type ScorePoint = { note: ScoreNote; line: number; staff: number; x: number; reach: number };

/**
 * The region a drag covers, read from what is drawn: in each voice, the notes whose heads lie
 * between where the drag started (the anchor note's head) and where the pointer is (heads at or
 * left of it), in reading order: system, then x. Left of a system's first head, the pointer is on
 * that head. Dragging back, the pointer's note starts it and the anchor ends it. Voices drawn out
 * of line with each other (a multi-bar rest is drawn one bar wide) each take what was dragged over.
 */
export function drawnRegion(
  index: ScoreIndex,
  placed: Placed[],
  anchor: ScorePoint,
  pointer: ScorePoint,
  voices: number[],
): Region {
  const headOf = (note: ScoreNote, fallback: number) =>
    placed.find((each) => each.note === note)?.x ?? fallback;
  const firstHead = (line: number) =>
    minOf(placed.filter((each) => each.line === line).map((each) => each.x));
  const anchorHead = headOf(anchor.note, anchor.x);
  const pointerX = Math.max(pointer.x, firstHead(pointer.line));
  const forward =
    pointer.line > anchor.line || (pointer.line === anchor.line && pointerX >= anchorHead);
  // Heads of notes sounding together can sit a few pixels apart (a second, a clash of voices).
  const slack = 6;
  const [low, high] = forward
    ? [
        { line: anchor.line, x: anchorHead - slack },
        { line: pointer.line, x: pointerX },
      ]
    : [
        { line: pointer.line, x: headOf(pointer.note, pointer.x) - slack },
        { line: anchor.line, x: Math.max(anchor.x, anchorHead) },
      ];
  const after = (each: Placed, point: { line: number; x: number }) =>
    each.line > point.line || (each.line === point.line && each.x >= point.x);
  const bounds: Record<number, { from: number; reach: number }> = {};
  for (const each of placed) {
    if (
      !voices.includes(each.note.voice) ||
      !after(each, low) ||
      after(each, { ...high, x: high.x + 1e-6 })
    )
      continue;
    const own = bounds[each.note.voice];
    if (!own) bounds[each.note.voice] = { from: each.note.time, reach: each.note.time };
    else {
      own.from = Math.min(own.from, each.note.time);
      own.reach = Math.max(own.reach, each.note.time);
    }
  }
  // The anchor's own note is always taken.
  const mine = bounds[anchor.note.voice];
  if (!mine) bounds[anchor.note.voice] = { from: anchor.note.time, reach: anchor.note.time };
  else {
    mine.from = Math.min(mine.from, anchor.note.time);
    mine.reach = Math.max(mine.reach, anchor.note.time);
  }
  const taken = Object.keys(bounds).map(Number);
  const region: Region = {
    from: minOf(taken.map((voice) => (bounds[voice] as { from: number }).from)),
    to: 0,
    voices: voices.filter((voice) => taken.includes(voice)),
    reach: maxOf(taken.map((voice) => (bounds[voice] as { reach: number }).reach)),
    bounds,
  };
  region.to = maxOf(
    regionNotes(index, region).map((note) => note.time + note.duration),
    region.from,
  );
  return region;
}

/** The region between where a drag started and where the pointer is now. */
export function dragRegion(
  index: ScoreIndex,
  anchor: ScorePoint,
  pointer: ScorePoint,
  voices: number[],
): Region {
  const forward =
    pointer.line > anchor.line || (pointer.line === anchor.line && pointer.x >= anchor.x);
  const [start, end] = forward ? [anchor, pointer] : [pointer, anchor];
  // The start snaps back to the start of the note it is in; the end takes what it reached.
  const from = Math.min(start.note.time, end.note.time);
  return spanRegion(index, from, Math.max(end.reach, start.note.time), voices);
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
export type NoteBox = {
  note: ScoreNote;
  /** The note's own drawing (heads, stem, flags, accidentals, dots), without its words. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Left of the note head and its accidentals, without a chord symbol or text above it. */
  head: number;
  /** Its chord symbols, annotations and other words, each where it is drawn. */
  words: { left: number; right: number; top: number; bottom: number }[];
};
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
  const isWords = (part: Element) =>
    part.tagName.toLowerCase() === "text" ||
    /^(chord|annotation)/.test(part.getAttribute("data-name") ?? "");
  for (const note of index.notes) {
    // The note's own drawing and its words apart: abcjs groups a note's chord symbol and text
    // with it, and they can be far wider than the note (a long annotation reaches across the bar).
    const body = {
      left: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    };
    const all = { ...body };
    const words: NoteBox["words"] = [];
    const grow = (into: typeof body, rect: DOMRect) => {
      into.left = Math.min(into.left, rect.left - origin.left);
      into.right = Math.max(into.right, rect.right - origin.left);
      into.top = Math.min(into.top, rect.top - origin.top);
      into.bottom = Math.max(into.bottom, rect.bottom - origin.top);
    };
    for (const element of note.elements) {
      const rect = element.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      grow(all, rect);
      const parts = [...element.children];
      if (!parts.length) {
        if (isWords(element))
          words.push({
            left: rect.left - origin.left,
            right: rect.right - origin.left,
            top: rect.top - origin.top,
            bottom: rect.bottom - origin.top,
          });
        else grow(body, rect);
        continue;
      }
      for (const part of parts) {
        const box = part.getBoundingClientRect();
        if (!box.width && !box.height) continue;
        if (isWords(part))
          words.push({
            left: box.left - origin.left,
            right: box.right - origin.left,
            top: box.top - origin.top,
            bottom: box.bottom - origin.top,
          });
        else grow(body, box);
      }
    }
    // A note drawn as words alone (rare) keeps its whole box.
    const own = Number.isFinite(body.left) ? body : all;
    if (Number.isFinite(own.left)) notes.push({ note, ...own, head: own.left, words });
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

/**
 * Beams, ties and slurs belong to several notes, and abcjs draws them apart from those notes. Each
 * is matched by line, voice and position to the notes it spans, so it can share their colour.
 */
export type Attachment = { element: Element; notes: ScoreNote[] };
export function attachments(index: ScoreIndex, container: HTMLElement): Attachment[] {
  const voiceOf = (element: Element | undefined) =>
    Number(/abcjs-v(\d+)/.exec(element?.getAttribute("class") ?? "")?.[1] ?? -1);
  const lineOf = (element: Element) =>
    Number(/abcjs-l(\d+)/.exec(element.getAttribute("class") ?? "")?.[1] ?? -1);
  const heads = index.notes
    .filter((note) => !note.rest && note.elements[0])
    .map((note) => {
      const box = (note.elements[0] as Element).getBoundingClientRect();
      return { note, voice: voiceOf(note.elements[0]), center: box.left + box.width / 2 };
    });
  const found: Attachment[] = [];
  for (const element of container.querySelectorAll(
    ".abcjs-beam-elem, [data-name='tie'], [data-name='slur']",
  )) {
    const box = element.getBoundingClientRect();
    if (!box.width) continue;
    const line = lineOf(element);
    const voice = voiceOf(element);
    const notes = heads
      .filter(
        (head) =>
          head.note.line === line &&
          (voice < 0 || head.voice === voice) &&
          head.center >= box.left - 8 &&
          head.center <= box.right + 8,
      )
      .map((head) => head.note);
    if (notes.length) found.push({ element, notes });
  }
  return found;
}

/** In annotations like "2nd time p", the dynamic letters are drawn as dynamics: bold italic. */
export function drawPassDynamics(root: Element): number {
  let drawn = 0;
  for (const text of root.querySelectorAll("text.abcjs-annotation")) {
    if (!passDynamics(text.textContent ?? "")) continue;
    const walker = text.ownerDocument.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const value = node.data;
      const parts: Node[] = [];
      let last = 0;
      for (const match of value.matchAll(DYNAMIC_WORD)) {
        const lead = match[1] ?? "";
        const start = (match.index ?? 0) + lead.length;
        parts.push(text.ownerDocument.createTextNode(value.slice(last, start)));
        const span = text.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "tspan");
        span.setAttribute("class", "abc-dyn");
        span.textContent = match[2] ?? "";
        parts.push(span);
        drawn += 1;
        last = start + (match[2] ?? "").length;
      }
      if (!parts.length) continue;
      parts.push(text.ownerDocument.createTextNode(value.slice(last)));
      node.replaceWith(...parts);
    }
  }
  return drawn;
}

/** The first bar's length when it is shorter than a full bar (a pickup), else 0. */
export function firstBarPickup(index: ScoreIndex, bar: number): number {
  const first = (index.byVoice[0] ?? [])
    .filter((note) => note.measure === 0)
    .reduce((sum, note) => sum + note.duration, 0);
  return first > 1e-6 && first < bar - 1e-6 ? first : 0;
}
