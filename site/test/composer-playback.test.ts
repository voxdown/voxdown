import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { humanDate } from "../src/composer/dates";
import { KEYS, METERS, decorationOptions, inOrder } from "../src/composer/editor";
import { INSTRUMENTS, findLoop, nearestSample, velocityGain } from "../src/composer/instruments";
import { normalise } from "../src/composer/player";
import {
  type Placed,
  type ScoreNote,
  type ScorePoint,
  authorBarsPerLine,
  breaksKey,
  chooseBreaks,
  chosenBreaks,
  dragRegion,
  indexScore,
  noteUnder,
  padLyrics,
  reachAt,
  regionOfRanges,
  regionRanges,
  spanRegion,
} from "../src/composer/score";
import { encodeText, readBytes, readText, writeText } from "../src/composer/source";
import {
  beatsBetween,
  buildTimeline,
  firstPlayOf,
  regionTimeline,
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
  it("snaps a text selection to whole notes and back", () => {
    const { index } = prepare(twoVoices);
    const start = twoVoices.indexOf("D |");
    const region = regionOfRanges(index, [{ from: start, to: start + 1 }]);
    expect(region).toEqual({ from: 0.25, to: 0.5, voices: [0], reach: 0.25 });
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
