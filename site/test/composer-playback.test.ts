import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { humanDate } from "../src/composer/dates";
import { KEYS, METERS, decorationOptions, inOrder } from "../src/composer/editor";
import { INSTRUMENTS, findLoop, nearestSample, velocityGain } from "../src/composer/instruments";
import { applyPassDynamics, passDynamics, passMarks } from "../src/composer/passes";
import { normalise } from "../src/composer/player";
import {
  type Placed,
  type ScoreNote,
  type ScorePoint,
  authorBarsPerLine,
  breaksKey,
  caretNotesAt,
  chooseBreaks,
  chosenBreaks,
  dragRegion,
  drawnRegion,
  indexScore,
  noteUnder,
  padLyrics,
  reachAt,
  regionOfRanges,
  regionRanges,
  spanLoneNotes,
  spanRegion,
} from "../src/composer/score";
import { PIECE_GAP, piecesOf, selectionTimeline } from "../src/composer/selection-play";
import { encodeText, readBytes, readText, writeText } from "../src/composer/source";
import {
  beatsBetween,
  buildTimeline,
  firstPlayOf,
  regionTimeline,
  regionWritten,
  soundingAt,
} from "../src/composer/timeline";
import { indexFile } from "../src/composer/tunes";
import { tuneItems } from "../src/composer/walk";

/* biome-ignore lint/suspicious/noExplicitAny: abcjs objects. */
type Any = any;

function prepare(text: string) {
  const file = indexFile(text);
  const tune = file.tunes[0] as NonNullable<(typeof file.tunes)[0]>;
  const visual = (abcjs as Any).parseOnly(text)[0];
  const index = indexScore(visual, tune, (char) => char, text);
  const byStart = new Map<number, ScoreNote>(index.notes.map((note) => [note.start, note]));
  const lookup = (start: number) => {
    let at = start;
    while (/\s/.test(text[at] ?? "")) at += 1;
    return byStart.get(at);
  };
  const audio = visual.setUpAudio({});
  const timeline = buildTimeline(
    audio,
    {
      bpm: audio.tempo,
      beat: visual.getBeatLength(),
      bar: visual.getBarLength(),
      pickup: visual.getPickupLength(),
      voices: index.voices.map((voice) => voice.name),
    },
    (char) => char,
    lookup,
  );
  return { index, timeline };
}

const repeated = "X:1\nT:Repeat\nM:2/4\nL:1/8\nQ:1/4=120\nK:C\n|: C2 D2 | E2 F2 :| G4 |]\n";
const twoVoices = "X:1\nT:Two\nM:2/4\nL:1/4\nK:C\nV:1\nC D | E F |\nV:2\nC, D, | E, F, |\n";

describe("source files", () => {
  it("saves an unchanged file byte for byte, and keeps BOM and line ends when changed", () => {
    const original = "\uFEFFX:1\r\nT:Café\r\nK:C\r\nCDE|\r\n";
    const file = readText(original);
    expect(file.normalized).toBe("X:1\nT:Café\nK:C\nCDE|\n");
    expect(writeText(file, file.normalized)).toBe(original);
    expect(writeText(file, `${file.normalized}F|\n`)).toBe(
      "\uFEFFX:1\r\nT:Café\r\nK:C\r\nCDE|\r\nF|\r\n",
    );
  });
  it("reads Latin-1 files and writes them back as Latin-1", () => {
    const bytes = new Uint8Array([0x54, 0x3a, 0x43, 0x61, 0x66, 0xe9, 0x0a]);
    const file = readBytes(bytes);
    expect(file.encoding).toBe("windows-1252");
    expect(file.normalized).toBe("T:Café\n");
    expect([...encodeText(file, file.normalized).bytes]).toEqual([...bytes]);
    const upgraded = encodeText(file, "T:Café ♪\n");
    expect(upgraded.upgraded).toBe(true);
    expect(new TextDecoder().decode(upgraded.bytes)).toBe("T:Café ♪\n");
  });
});

describe("the playback timeline", () => {
  it("expands repeats, marks the repeat pass and keeps the written place of each note", () => {
    const { timeline } = prepare(repeated);
    const melody = timeline.notes.filter((note) => note.track === 0);
    expect(melody.map((note) => note.pitch)).toEqual([60, 62, 64, 65, 60, 62, 64, 65, 67]);
    expect(melody.map((note) => note.written)).toEqual([0, 0.25, 0.5, 0.75, 0, 0.25, 0.5, 0.75, 1]);
    expect(timeline.passes.length).toBe(2);
    expect(timeline.passes[1]?.repeat).toBe(true);
    expect(timeline.bars).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(firstPlayOf(timeline, 1)).toBe(2);
  });
  it("plays a region over a repeat once, as written", () => {
    const { timeline } = prepare(repeated);
    const region = regionTimeline(timeline, { from: 0.5, to: 1.5, voices: [0] }, true);
    expect(region.notes.map((note) => [note.time, note.pitch])).toEqual([
      [0, 64],
      [0.25, 65],
      [0.5, 67],
    ]);
    expect(region.length).toBe(1);
  });
  it("lights the notes sounding at a time", () => {
    const { timeline } = prepare(repeated);
    expect(soundingAt(timeline, 0.3).notes.map((note) => note.pitch)).toEqual([62]);
  });
  it("counts beats and downbeats, including a count-in", () => {
    const { timeline } = prepare(repeated);
    const beats = beatsBetween(timeline, -0.5, 0.5);
    expect(beats.map((beat) => [beat.time, beat.down])).toEqual([
      [-0.5, true],
      [-0.25, false],
      [0, true],
      [0.25, false],
    ]);
  });
});

describe("score regions", () => {
  it("turns a region into one text range per voice, bar lines included", () => {
    const { index } = prepare(twoVoices);
    const ranges = regionRanges(index, { from: 0, to: 0.5, voices: [0, 1] }, twoVoices);
    expect(ranges.map((range) => twoVoices.slice(range.from, range.to))).toEqual([
      "C D |",
      "C, D, |",
    ]);
  });
  it("splits a voice whose music continues in a later V: block, never taking other voices' text", () => {
    const text =
      "X:1\nM:4/4\nL:1/4\nK:C\nV:1\nV:2\nV:1\nC D E F |\nV:2\nC,4 |\nV:1\nG A B c |\nV:2\nG,4 |\n";
    const { index } = prepare(text);
    const ranges = regionRanges(index, { from: 0.5, to: 1.5, voices: [0, 1] }, text);
    expect(ranges.map((range) => text.slice(range.from, range.to))).toEqual([
      "E F |",
      "G A",
      "G,4 |",
    ]);
  });
  it("splits a voice's range at every line that isn't its music, and at comments", () => {
    const whole = (text: string) => {
      const { index } = prepare(text);
      const region = spanRegion(index, 0, 100, [0]);
      return regionRanges(index, region, text).map((range) => text.slice(range.from, range.to));
    };
    // Lyrics and a comment between two lines of music (Codex's case).
    expect(
      whole(
        "X:1\nM:4/4\nL:1/4\nK:C\nC D E F |\nw: one two three four\n% important comment\nG A B c |\nw: five six se-ven eight\n",
      ),
    ).toEqual(["C D E F |", "G A B c |"]);
    // Parts, a key change, a title, meter and unit fields, a directive (Claude's cases).
    expect(
      whole(
        "X:1\nT:Reel with parts\nM:4/4\nL:1/8\nK:D\nP:A\n|:dfaf gfed|cdeg fedc:|\nP:B\n|:d2fd ad fd|e2ge be ge:|\nK:G\nT:Second strain\nM:3/4\nL:1/4\n%%vskip 10\nG A B |\n",
      ),
    ).toEqual(["dfaf gfed|cdeg fedc:|", "d2fd ad fd|e2ge be ge:|", "G A B |"]);
    // A comment at the end of a line of music. (A blank line ends the tune, so none falls inside.)
    expect(whole("X:1\nL:1/4\nK:C\nC D | % the end\nE F |\n")).toEqual(["C D |", "E F |"]);
    // Music lines one after another stay one range; a % inside an annotation is not a comment.
    expect(whole('X:1\nL:1/4\nK:C\nC "^50%"D |\nE F |\n')).toEqual(['C "^50%"D |\nE F |']);
  });
  it("snaps a text selection to whole notes and back", () => {
    const { index } = prepare(twoVoices);
    const start = twoVoices.indexOf("D |");
    const region = regionOfRanges(index, [{ from: start, to: start + 1 }]);
    expect(region).toEqual({
      from: 0.25,
      to: 0.5,
      voices: [0],
      reach: 0.25,
      bounds: { 0: { from: 0.25, reach: 0.25 } },
    });
  });
});

describe("reading the pointer in the score", () => {
  // Two voices; voice 1 ends bar 1 with a half note while voice 2 still moves in quarters.
  const text = "X:1\nM:4/4\nL:1/4\nK:C\nV:1\nC D E2 | F G A B |\nV:2\nC, D, E, F, | G,4 |\n";
  const { index } = prepare(text);
  // A drawn layout: heads 400 px per whole note from x 100; the bar line at 510, bar 2 from 520.
  const xOf = (time: number) => 100 + time * 400 + (time >= 1 ? 20 : 0);
  const placed: Placed[] = index.notes.map((note) => ({
    note,
    line: 0,
    staff: note.voice,
    x: xOf(note.time),
  }));
  const voice = (n: number) => placed.filter((each) => each.note.voice === n);
  const point = (staff: number, x: number): ScorePoint => ({
    note: noteUnder(voice(staff), 0, x) as ScoreNote,
    line: 0,
    staff,
    x,
    reach: reachAt(placed, 0, x),
  });
  const slices = (anchor: ScorePoint, pointer: ScorePoint, voices = [0, 1]) =>
    regionRanges(index, dragRegion(index, anchor, pointer, voices), text).map((range) =>
      text.slice(range.from, range.to),
    );

  it("reaches a note only once the pointer gets to its head", () => {
    expect(reachAt(placed, 0, xOf(0.5) + 10)).toBe(0.5);
    expect(reachAt(placed, 0, xOf(0.75) - 1)).toBe(0.5);
    expect(reachAt(placed, 0, xOf(0.75))).toBe(0.75);
  });
  it("stays in the bar until the pointer passes the bar line and reaches the next note", () => {
    expect(reachAt(placed, 0, 505)).toBe(0.75);
    expect(reachAt(placed, 0, 515)).toBe(0.75);
    expect(reachAt(placed, 0, 520)).toBe(1);
  });
  it("belongs to a system's first note left of it, and takes earlier systems whole", () => {
    expect(reachAt(placed, 0, 40)).toBe(0);
    const second: Placed[] = [
      ...placed,
      {
        note: { ...(index.byVoice[0]?.[4] as ScoreNote), time: 2, line: 1 },
        line: 1,
        staff: 0,
        x: 120,
      },
    ];
    expect(reachAt(second, 1, 60)).toBe(2);
  });
  it("picks the note of a voice whose head the pointer has passed, never the next bar's", () => {
    expect(noteUnder(voice(0), 0, 480)?.time).toBe(0.5);
    expect(noteUnder(voice(0), 0, 515)?.time).toBe(0.5);
    expect(noteUnder(voice(0), 0, 40)?.time).toBe(0);
  });
  it("reads just past a bar line as the start of that bar, both ways", () => {
    const bars = [510];
    expect(noteUnder(voice(0), 0, 512, bars)?.time).toBe(1);
    expect(noteUnder(voice(1), 0, 518, bars)?.time).toBe(1);
    // The gap before the bar line stays with the bar's last note.
    expect(noteUnder(voice(0), 0, 505, bars)?.time).toBe(0.5);
    const at = (staff: number, x: number): ScorePoint => ({
      note: noteUnder(voice(staff), 0, x, bars) as ScoreNote,
      line: 0,
      staff,
      x,
      reach: reachAt(placed, 0, x),
    });
    // Starting 2–10 px after the bar line takes nothing from the bar before.
    for (const offset of [2, 6, 9]) {
      expect(slices(at(0, 510 + offset), at(0, xOf(1.25) + 5), [0])).toEqual(["F G"]);
      expect(slices(at(0, xOf(1.25) + 5), at(0, 510 + offset), [0])).toEqual(["F G"]);
      expect(slices(at(0, 510 + offset), at(1, xOf(1.25) + 5))).toEqual(["F G", "G,4 |"]);
    }
    // Ending 2–10 px either side of the bar line keeps bar 1 whole and takes nothing of bar 2.
    // (Bar 2's first head is 10 px past the bar line in this layout, so 8 is the last gap.)
    for (const offset of [-10, -2, 2, 8]) {
      expect(slices(at(0, xOf(0)), at(0, 510 + offset))).toEqual(["C D E2 |", "C, D, E, F, |"]);
    }
  });
  it("reads a rest alone in its bar and drawn mid-bar (a whole-bar rest) from the bar's start", () => {
    const moved = placed.map((each) =>
      each.note.voice === 1 && each.note.time === 1
        ? { ...each, x: 700, note: { ...each.note, rest: true } }
        : each,
    );
    const spanned = spanLoneNotes(moved, new Map([[0, [510, 900]]]));
    const rest = spanned.find((each) => each.note.voice === 1 && each.note.time === 1);
    expect(rest?.x).toBe(522);
    // Bar 1's notes keep their heads.
    expect(spanned.filter((each) => each.note.time < 1).map((each) => each.x)).toEqual(
      moved.filter((each) => each.note.time < 1).map((each) => each.x),
    );
  });
  it("reads a note alone in its bar at its head, as the other voices' notes then", () => {
    // The reviewer's case: a whole note C6 alone in its bar was taken 12 px after the bar line,
    // before the pointer reached its head, while the other voice's note at that time was not.
    const spanned = spanLoneNotes(placed, new Map([[0, [510, 900]]]));
    const lone = spanned.find((each) => each.note.voice === 1 && each.note.time === 1);
    const other = spanned.find((each) => each.note.voice === 0 && each.note.time === 1);
    expect(lone?.x).toBe(xOf(1));
    expect(lone?.x).toBe(other?.x);
  });
  it("does not let a long note pull the other voice ahead of the pointer", () => {
    const anchor = point(1, xOf(0));
    expect(slices(anchor, point(0, xOf(0.5) + 10))).toEqual(["C D E2 |", "C, D, E,"]);
    expect(slices(anchor, point(0, xOf(0.75) + 2))).toEqual(["C D E2 |", "C, D, E, F, |"]);
  });
  it("takes nothing from the next bar in the gap before or after the bar line", () => {
    const anchor = point(0, xOf(0));
    expect(slices(anchor, point(0, 505), [0])).toEqual(["C D E2 |"]);
    expect(slices(anchor, point(1, 515))).toEqual(["C D E2 |", "C, D, E, F, |"]);
    expect(slices(anchor, point(1, 521))).toEqual(["C D E2 | F", "C, D, E, F, | G,4 |"]);
  });
  it("drags backwards from where the pointer went down", () => {
    expect(slices(point(0, xOf(0.75) + 5), point(0, xOf(0.25) + 5))).toEqual([
      "D E2 |",
      "D, E, F, |",
    ]);
  });
  it("extends by reach, as Shift click and Alt Shift → do", () => {
    const region = spanRegion(index, 0, 0.25, [0, 1]);
    expect(region.to).toBe(0.5);
    expect(
      regionRanges(index, region, text).map((range) => text.slice(range.from, range.to)),
    ).toEqual(["C D", "C, D,"]);
  });
});

describe("a drag reads what is drawn, voice by voice", () => {
  // abcjs draws V:1's Z4 one bar wide, so V:1's "c d e f" (bar 5) sits over V:2's bar 2.
  const text =
    "X:1\nM:4/4\nL:1/4\n%%score 1 2\nK:C\nV:1\nZ4|c d e f|g4|]\nV:2\nC D E F|G A B c|c B A G|F E D C|E4|D4|]\n";
  const { index } = prepare(text);
  // Drawn bar by bar: bar n's beats at x = 100 + (n - 1) * 200 + beat * 40, V:1 bar by bar too.
  const drawnBar = (note: ScoreNote) => {
    if (note.voice === 1) return note.measure;
    // V:1: Z4 is drawn as bar 1, then its bars follow on: written bar 5 is drawn as bar 2.
    return note.measure >= 4 ? note.measure - 3 : 0;
  };
  const placed: Placed[] = index.notes.map((note) => ({
    note,
    line: 0,
    staff: note.voice,
    x: 100 + drawnBar(note) * 200 + (note.time - Math.floor(note.time + 1e-9)) * 160,
  }));
  const at = (voice: number, time: number): ScorePoint => {
    const each = placed.find(
      (one) => one.note.voice === voice && Math.abs(one.note.time - time) < 1e-6,
    ) as Placed;
    return { note: each.note, line: 0, staff: voice, x: each.x + 2, reach: time };
  };
  it("counts a multi-bar rest as the bars it stands for", () => {
    const c = index.notes.find((note) => note.voice === 0 && note.time === 4) as ScoreNote;
    expect(c.measure).toBe(4);
    expect(index.measures).toBe(6);
  });
  it("takes in each voice only what the pointer went over", () => {
    // From V:2's G (bar 2) up to V:1's c drawn above it: V:2's G, and V:1's c.
    const region = drawnRegion(index, placed, at(1, 1), at(0, 4), [0, 1]);
    expect(
      regionRanges(index, region, text).map((range) => text.slice(range.from, range.to)),
    ).toEqual(["c", "G"]);
    // Along V:2's bar 2: V:1's c d e f drawn over it, and V:2's G A B c.
    const along = drawnRegion(index, placed, at(1, 1), at(1, 1.75), [0, 1]);
    expect(
      regionRanges(index, along, text).map((range) => text.slice(range.from, range.to)),
    ).toEqual(["c d e f|", "G A B c|"]);
  });
  it("drags back from the anchor to the pointer's note", () => {
    const back = drawnRegion(index, placed, at(1, 1.75), at(1, 1), [1]);
    expect(
      regionRanges(index, back, text).map((range) => text.slice(range.from, range.to)),
    ).toEqual(["G A B c|"]);
  });
});

describe("the score's index", () => {
  it("takes no overlay closing bar line for a note", () => {
    const text = "X:1\nM:4/4\nL:1/4\nK:C\nc d e f & A B c d|g a b c' & e f g a|c'4|]\n";
    const { index } = prepare(text);
    for (const note of index.notes) expect(text.slice(note.start, note.end)).toMatch(/[A-Ga-gz]/);
    expect(index.notes.some((note) => text.slice(note.start, note.end).includes("|"))).toBe(false);
  });
});

describe("playing a selection", () => {
  const text =
    "X:1\nM:4/4\nL:1/4\n%%score (1 2)\nK:C\nV:1\nc d e f|g a b c'|c' b a g|f e d c|]\nV:2\nC D E F|G A B c|c B A G|F E D C|]\n";
  const { index, timeline } = prepare(text);
  const notesAt = (voice: number, times: number[]) =>
    index.notes.filter(
      (note) => note.voice === voice && times.some((time) => Math.abs(note.time - time) < 1e-6),
    );
  const play = (notes: ScoreNote[]) =>
    selectionTimeline(
      timeline,
      piecesOf(notes),
      new Set(notes.map((note) => note.start)),
      [...new Set(notes.map((note) => note.voice))],
      false,
    );
  it("plays exactly two notes three bars apart, back to back", () => {
    const line = play([...notesAt(0, [0.25]), ...notesAt(0, [3])]);
    expect(line.notes.map((note) => [note.time, note.pitch])).toEqual([
      [0, 74],
      [0.25 + PIECE_GAP, 77],
    ]);
    expect(regionWritten(line, 0.1)).toBeCloseTo(0.35);
    expect(regionWritten(line, 0.25 + PIECE_GAP + 0.1)).toBeCloseTo(3.1);
  });
  it("plays V:1's bar 1 then V:2's bar 3: eight notes, not twenty-four", () => {
    const line = play([...notesAt(0, [0, 0.25, 0.5, 0.75]), ...notesAt(1, [2, 2.25, 2.5, 2.75])]);
    expect(line.notes.length).toBe(8);
    expect(line.notes.map((note) => note.pitch)).toEqual([72, 74, 76, 77, 72, 71, 69, 67]);
    expect(line.length).toBeCloseTo(2 + PIECE_GAP);
  });
  it("plays a selection in one place as it was", () => {
    const line = play(notesAt(0, [1, 1.25, 1.5]));
    expect(line.notes.map((note) => note.time)).toEqual([0, 0.25, 0.5]);
    expect(line.pieces).toEqual([{ at: 0, from: 1, to: 1.75 }]);
  });
});

describe("files and dates", () => {
  it("says when a draft was kept in words", () => {
    const now = new Date(2026, 10, 20, 19, 30).getTime();
    expect(humanDate(new Date(2026, 10, 20, 19, 5).getTime(), now)).toMatch(/^Today, 7:05/);
    expect(humanDate(new Date(2026, 10, 19, 9, 12).getTime(), now)).toMatch(/^Yesterday, 9:12/);
    expect(humanDate(new Date(2026, 10, 16, 9, 12).getTime(), now)).toMatch(/^Monday, /);
    expect(humanDate(new Date(2026, 1, 3).getTime(), now)).toMatch(/3/);
  });
  it("brings an exported recording up to −1 dBFS", () => {
    const data = [new Float32Array([0.1, -0.17, 0.05]), new Float32Array([0.02, 0.08, -0.1])];
    normalise({ numberOfChannels: 2, getChannelData: (channel) => data[channel] as Float32Array });
    expect(Math.max(...data.flatMap((channel) => [...channel].map(Math.abs)))).toBeCloseTo(
      10 ** (-1 / 20),
      5,
    );
  });
});

describe("redrawing in one pass", () => {
  it("reads abcjs's chosen line breaks and keys them on width and bar count", () => {
    expect(
      chosenBreaks([
        {
          attempts: [
            { type: "Fixed", failed: true, lineBreaks: [1] },
            { type: "Free", lineBreaks: [3, 7] },
            { type: "Optimize", failed: false, lineBreaks: [3, 8] },
          ],
        },
      ]),
    ).toEqual([[3, 8]]);
    expect(
      chosenBreaks([{ attempts: [{ type: "Fixed", failed: false, lineBreaks: [3] }] }]),
    ).toEqual([[3]]);
    expect(chosenBreaks("narrower than the margin")).toBeNull();
    expect(breaksKey("A B | c d | e f |", 600.4)).toBe("600:3");
    expect(breaksKey("A B c | c d | e f |", 600)).toBe(breaksKey("A B | c d | e f |", 600));
  });
});

describe("phrase-aware line breaks", () => {
  const even = (count: number, width = 80) => Array.from({ length: count }, () => width);
  it("prefers four bars a line, two when four do not fit", () => {
    expect(
      chooseBreaks([{ left: 0, measureWidths: even(16) }], 600, { min: 1.35, max: 2.7 }),
    ).toEqual([[3, 7, 11]]);
    expect(
      chooseBreaks([{ left: 0, measureWidths: even(8, 130) }], 600, { min: 1.35, max: 2.7 }),
    ).toEqual([[1, 3, 5]]);
  });
  it("follows the author's bars per line when they fit, and lets a pickup ride with the first line", () => {
    expect(
      chooseBreaks(
        [{ left: 0, measureWidths: [30, ...even(16, 40)] }],
        900,
        { min: 1.35, max: 2.7 },
        { authorBars: 8, pickup: true },
      ),
    ).toEqual([[8]]);
  });
  it("joins a stranded short last line to the one above", () => {
    expect(
      chooseBreaks(
        [{ left: 0, measureWidths: even(10, 60) }],
        900,
        { min: 1.35, max: 2.7 },
        { authorBars: 4 },
      ),
    ).toEqual([[3]]);
  });
  it("skips abcjs's empty measure before a leading repeat", () => {
    expect(
      chooseBreaks(
        [{ left: 0, measureWidths: [20, ...even(8)] }],
        600,
        { min: 1.35, max: 2.7 },
        { filled: [[false, ...even(8).map(() => true)]] },
      ),
    ).toEqual([[4]]);
  });
  it("reads the author's bars per source line", () => {
    const text =
      "X:1\nM:4/4\nL:1/4\nK:C\nD | C D E F | G A B c | c B A G | F E D C |\nC D E F | G A B c | c B A G | F E D C |\n";
    const file = indexFile(text);
    expect(authorBarsPerLine(text, tuneItems(text, file.tunes[0] as never, file))).toBe(4);
  });
  it("pads lyric syllables so words never touch", () => {
    const tune = {
      lines: [
        {
          staff: [
            {
              voices: [
                [
                  { lyric: [{ syllable: "sec", divider: "-" }] },
                  { lyric: [{ syllable: "onds", divider: " " }] },
                ],
              ],
            },
          ],
        },
      ],
    };
    padLyrics(tune);
    padLyrics(tune);
    const [first, second] = tune.lines[0]?.staff[0]?.voices[0] ?? [];
    expect(first?.lyric[0]).toMatchObject({ syllable: "\u00a0sec\u202f", divider: "-\u00a0" });
    expect(second?.lyric[0]).toMatchObject({ syllable: "\u00a0onds", divider: "\u00a0" });
  });
});

describe("dynamics per pass", () => {
  it("reads the ways players write them", () => {
    expect([...(passDynamics("^2nd time p") ?? [])]).toEqual([[2, "p"]]);
    expect([...(passDynamics("^1st time f, 2nd time p") ?? [])]).toEqual([
      [1, "f"],
      [2, "p"],
    ]);
    expect([...(passDynamics("^f, 2nd time p") ?? [])]).toEqual([
      [1, "f"],
      [2, "p"],
    ]);
    expect([...(passDynamics("_on repeat pp") ?? [])]).toEqual([[2, "pp"]]);
    expect([...(passDynamics("^2nd x mf") ?? [])]).toEqual([[2, "mf"]]);
    expect(passDynamics("^rit.")).toBeNull();
    expect(passDynamics("^p")).toBeNull();
  });
  it("plays the second time softer from the marked note", () => {
    const text = 'X:1\nM:2/4\nL:1/4\nQ:1/4=120\nK:C\n|: !f!C D | "^2nd time p"E F :| G2 |]\n';
    const { timeline } = prepare(text);
    const file = indexFile(text);
    const marks = passMarks(text, file.tunes[0] as never, file);
    expect(marks.rules).toHaveLength(1);
    const after = applyPassDynamics(timeline, marks.rules, marks.written);
    const e = after.notes.filter((note) => note.track === 0 && note.pitch === 64);
    const before = timeline.notes.filter((note) => note.track === 0 && note.pitch === 64);
    expect(e[0]?.velocity).toBe(before[0]?.velocity);
    expect(e[1]?.velocity).toBeLessThan((before[1]?.velocity ?? 0) * 0.7);
    // The pass ends at the repeat: G after it is untouched.
    const g = after.notes.find((note) => note.track === 0 && note.pitch === 67);
    expect(g?.velocity).toBe(
      timeline.notes.find((note) => note.track === 0 && note.pitch === 67)?.velocity,
    );
  });
});

describe("completion order", () => {
  it("offers the most used meters and keys first", () => {
    expect(METERS.slice(0, 9).map(([label]) => label)).toEqual([
      "4/4",
      "3/4",
      "6/8",
      "2/4",
      "2/2",
      "C",
      "C|",
      "9/8",
      "12/8",
    ]);
    expect(KEYS.slice(0, 9).map(([label]) => label)).toEqual([
      "C",
      "G",
      "D",
      "F",
      "A",
      "Bb",
      "Am",
      "Em",
      "Dm",
    ]);
    const boosts = inOrder([{ label: "b" }, { label: "a" }]).map((option) => option.boost ?? 0);
    expect(boosts[0]).toBeGreaterThan(boosts[1] as number);
    expect(
      decorationOptions()
        .slice(0, 3)
        .map((option) => option.label),
    ).toEqual(["p", "mf", "f"]);
  });
});

describe("instruments", () => {
  it("picks the nearest sample and a gentle velocity curve", () => {
    expect(nearestSample(INSTRUMENTS.piano, 61)).toBe(60);
    expect(nearestSample(INSTRUMENTS.flute, 30)).toBe(60);
    expect(velocityGain(127)).toBeCloseTo(1);
    expect(velocityGain(40)).toBeLessThan(velocityGain(100) / 2);
  });
  it("finds a seamless loop in a steady tone", () => {
    const rate = 8000;
    const data = new Float32Array(rate * 2);
    for (let index = 0; index < data.length; index++)
      data[index] = Math.sin((2 * Math.PI * 200 * index) / rate) * 0.5;
    const loop = findLoop(data, rate);
    expect(loop).not.toBeNull();
    const period = rate / 200;
    const length = ((loop?.end ?? 0) - (loop?.start ?? 0)) * rate;
    expect(Math.abs(length / period - Math.round(length / period))).toBeLessThan(0.05);
  });
});

describe("the caret's note", () => {
  it("is the note to its left, as the explanation says, for the highlight too", async () => {
    const { explainAt } = await import("../src/composer/explain");
    const text = "X:1\nT:Caret\nM:4/4\nL:1/8\nK:D\nc2 d/e/ f4|\n";
    const { index } = prepare(text);
    const at = text.indexOf("d/") + 2;
    const [note] = caretNotesAt(index, at);
    expect(text.slice(note?.start, note?.end)).toBe("d/");
    expect(explainAt(text, indexFile(text), at)?.token).toBe("d/");
    // Inside a note, or before the first: that note.
    expect(
      text.slice(caretNotesAt(index, at + 1)[0]?.start, caretNotesAt(index, at + 1)[0]?.end),
    ).toBe("e/");
    const first = text.indexOf("c2");
    expect(caretNotesAt(index, first)[0]?.start).toBe(first);
  });
});
