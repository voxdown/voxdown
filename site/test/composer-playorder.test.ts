import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { writeMidi } from "../src/composer/midi";
import { bar, followOrder, playOrder, structureOf } from "../src/composer/playorder";
import { type ScoreNote, indexScore } from "../src/composer/score";
import { buildTimeline } from "../src/composer/timeline";
import { indexFile } from "../src/composer/tunes";
import { readMidi } from "./midi-read";

/* biome-ignore lint/suspicious/noExplicitAny: abcjs objects. */
type Any = any;

const NAMES: Record<number, string> = {};
"CDEFGABcdefgab".split("").forEach((name, at) => {
  NAMES[[60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83][at] as number] = name;
});

/** A tune's timeline as Composer builds it: abcjs's, then laid out in the play order. */
function played(body: string, followJumps = true) {
  const text = `X:1\nT:t\nM:1/4\nL:1/4\nK:C\n${body}\n`;
  const file = indexFile(text);
  const visual = (abcjs as Any).parseOnly(text)[0];
  const index = indexScore(visual, file.tunes[0] as never, (char) => char, text);
  const byStart = new Map<number, ScoreNote>(index.notes.map((note) => [note.start, note]));
  const lookup = (start: number) => {
    let at = start;
    while (/\s/.test(text[at] ?? "")) at += 1;
    return byStart.get(at);
  };
  const audio = visual.setUpAudio({});
  const abcjsTimeline = buildTimeline(
    audio,
    { bpm: 120, beat: 0.25, bar: 0.25, pickup: 0, voices: index.voices.map((voice) => voice.name) },
    (char) => char,
    lookup,
  );
  const structure = structureOf(visual);
  const timeline = followOrder(abcjsTimeline, structure, playOrder(structure, followJumps));
  const letters = (notes: { pitch: number; track: number }[]) =>
    notes
      .filter((note) => note.track === 0)
      .map((note) => NAMES[note.pitch] ?? "?")
      .join("");
  return { abcjs: letters(abcjsTimeline.notes), ours: letters(timeline.notes), timeline };
}

describe("the play order", () => {
  it("plays repeats and endings as abcjs does", () => {
    for (const body of [
      "C|D|E|F|]",
      "C|D:|E|F:|G|]",
      "C|:D|E:|F|G:|A|]",
      "|:C|1D:|2E|]",
      "|:C|1D:|2E:|3F|]",
      "|:C|1,3D:|2E:|]",
      "C|:D::E:|F|]",
      "C|D|E:|F|]",
      "|:C|1D|E:|2F|G|]",
      "|:CD|E2:|\n|:FG|[1A2:|[2B2|]",
    ]) {
      const { abcjs: theirs, ours } = played(body);
      expect(ours, body).toBe(theirs);
    }
  });
  it("follows D.C. al Fine, D.S. al Coda and D.C. al Coda", () => {
    const cases: [string, string, string][] = [
      ["D.C. al Fine", "C|D|!fine!E|F|!D.C.alfine!G|]", "CDEFGCDE"],
      ["D.C. al Fine, the Fine as a word", 'C|D|"^Fine"E|F|"^D.C. al Fine"G|]', "CDEFGCDE"],
      ["plain D.C. with a Fine stops there", "C|!fine!D|E|!D.C.!F|]", "CDEFCD"],
      ["plain D.C. without one plays to the end", "C|D|!D.C.!E|]", "CDECDE"],
      ["D.S. al Fine", "C|!segno!D|!fine!E|F|!D.S.alfine!G|]", "CDEFGDE"],
      [
        "D.S. al Coda, To Coda as a word",
        'C|!segno!D|"^To Coda"E|F|!D.S.alcoda!G|!coda!A|B|]',
        "CDEFGDEAB",
      ],
      ["D.S. al Coda, two coda signs", "C|!segno!D|!coda!E|F|!D.S.alcoda!G|!coda!A|]", "CDEFGDEA"],
      ["D.C. al Coda, !dacoda!", "C|!dacoda!D|E|!D.C.alcoda!F|!coda!G|]", "CDEFCDG"],
      ["D.S. as a word, Dal Segno", 'C|!segno!D|E|"^Dal Segno"F|]', "CDEFDEF"],
    ];
    for (const [name, body, order] of cases) expect(played(body).ours, name).toBe(order);
  });
  it("does not repeat again on the return, and takes the last ending", () => {
    // |: C D :| then D.C. al Fine: the repeat is played once on the way back.
    expect(played("|:C|D:|!fine!E|!D.C.alfine!F|]").ours).toBe("CDCDEFCDE");
    // First and second endings: the return skips the first.
    expect(played("|:C|1D:|2E|F|!D.C.!G|]").ours).toBe("CDCEFGCEFG");
    // D.S. al Coda over a repeat with endings, the coda after.
    expect(played('C|!segno!|:D|1E:|2F|"^To Coda"G|!D.S.alcoda!A|!coda!B|]').ours).toBe(
      "CDEDFGADFGB",
    );
    // A D.C. in a bar that ends a repeat goes back after the repeat.
    expect(played("|:C|!D.C.!D:|]").ours).toBe("CDCDCD");
  });
  it("plays as written when jumps are not followed", () => {
    expect(played("C|!segno!D|!fine!E|!D.S.alfine!F|]", false).ours).toBe("CDEF");
  });
  it("marks the return for the clock, and keeps the bars and their times", () => {
    const { timeline } = played('C|!segno!D|"^To Coda"E|!D.S.alcoda!F|!coda!G|]');
    expect(timeline.notes.map((note) => note.time)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
    expect(timeline.bars).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
    expect(timeline.returns).toEqual([
      { from: 1, to: 1.5, label: "D.S." },
      { from: 1.5, to: 1.75, label: "Coda" },
    ]);
    expect(timeline.length).toBe(1.75);
  });
  it("reads the structure: bars, endings, segno and coda", () => {
    const visual = (abcjs as Any).parseOnly(
      "X:1\nM:2/4\nL:1/4\nK:C\n|:C D|1 E F:|2 G A||!segno!B c|!D.S.alfine!!fine!d2|]\n",
    )[0];
    const structure = structureOf(visual);
    expect(
      structure.bars.map((each) => [each.from, each.to, each.ending, each.lastEnding]),
    ).toEqual([
      [0, 0.5, null, 0],
      [0.5, 1, [1], 2],
      [1, 1.5, [2], 2],
      [1.5, 2, null, 0],
      [2, 2.5, null, 0],
    ]);
    expect(structure.segno).toBe(1.5);
    expect(structure.bars[4]?.jump).toEqual({ kind: "D.S.", until: "fine" });
    // The pure order, from bars alone.
    expect(
      playOrder({
        bars: [
          bar(0, 1),
          bar(1, 2, { fine: true }),
          bar(2, 3, { jump: { kind: "D.C.", until: "fine" } }),
        ],
        segno: null,
        coda: null,
      }),
    ).toEqual([
      { from: 0, to: 3, returning: null },
      { from: 0, to: 2, returning: "D.C." },
    ]);
  });
  it("writes MIDI in the order played: a type-1 file, a track per voice", () => {
    const { timeline } = played('C|!segno!D|"^To Coda"E|!D.S.alcoda!F|!coda!G|]');
    const midi = readMidi(writeMidi(timeline, { title: "Jumps", tempoFactor: 1 }));
    expect(midi.format).toBe(1);
    expect(midi.division).toBe(480);
    // 120 quarter notes a minute: half a second a quarter.
    expect(midi.tempo).toBe(500_000);
    expect(midi.tracks.map((track) => track.name)).toEqual(["Jumps", "Voice 1"]);
    const notes = (midi.tracks[1] as (typeof midi.tracks)[number]).notes;
    expect(notes.map((note) => NAMES[note.pitch]).join("")).toBe("CDEFDEG");
    expect(notes.map((note) => note.tick)).toEqual([0, 480, 960, 1440, 1920, 2400, 2880]);
    expect(notes.every((note) => note.length === 456)).toBe(true);
  });
});
