import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../src/composer/examples";
import { tuneTimeline } from "../src/composer/exports";
import { writeMidi } from "../src/composer/midi";
import { readMidiFile } from "../src/composer/midifile";
import {
  chooseGrid,
  estimateKey,
  keyLabel,
  snap,
  spellerFor,
} from "../src/composer/midifile/convert";
import { EVENT_LIMIT, MidiFileError, parseSmf } from "../src/composer/midifile/smf";

/* A small SMF writer for fixtures. */
type Event = [tick: number, bytes: number[]];
const vlq = (value: number) => {
  const out = [value & 0x7f];
  let rest = value >> 7;
  while (rest) {
    out.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return out;
};
const utf = (text: string) => [...new TextEncoder().encode(text)];
const meta = (type: number, data: number[]) => [0xff, type, ...vlq(data.length), ...data];
const name = (text: string) => meta(0x03, utf(text));
const lyric = (text: string) => meta(0x05, utf(text));
const tempo = (bpm: number) => {
  const us = Math.round(60_000_000 / bpm);
  return meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]);
};
const meter = (num: number, den: number) => meta(0x58, [num, Math.log2(den), 24, 8]);
const key = (fifths: number, minor = false) => meta(0x59, [fifths & 255, minor ? 1 : 0]);
/** Notes as [start, length, pitch] in quarters. */
const notes = (channel: number, list: [number, number, number][], division = 480, velocity = 80) =>
  list.flatMap(([start, length, pitch]): Event[] => [
    [Math.round(start * division), [0x90 | channel, pitch, velocity]],
    [Math.round((start + length) * division), [0x80 | channel, pitch, 0]],
  ]);
/** A track: events in time order (offs before ons at a tick), with running status if asked. */
function track(events: Event[], running = false): number[] {
  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        a.event[0] - b.event[0] ||
        Number((a.event[1][0] as number) >= 0x90 && (a.event[1][0] as number) < 0xa0) -
          Number((b.event[1][0] as number) >= 0x90 && (b.event[1][0] as number) < 0xa0) ||
        a.index - b.index,
    )
    .map((each) => each.event);
  const body: number[] = [];
  let tick = 0;
  let status = 0;
  for (const [at, bytes] of sorted) {
    body.push(...vlq(at - tick));
    tick = at;
    let message = bytes;
    const first = bytes[0] as number;
    if (running && first < 0xf0 && first === status) message = bytes.slice(1);
    if (first < 0xf0) status = first;
    body.push(...message);
  }
  body.push(0, 0xff, 0x2f, 0);
  return [...utf("MTrk"), ...u32(body.length), ...body];
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function smf(format: number, tracks: number[][], division = 480): Uint8Array {
  return new Uint8Array([
    ...utf("MThd"),
    ...u32(6),
    0,
    format,
    0,
    tracks.length,
    (division >> 8) & 255,
    division & 255,
    ...tracks.flat(),
  ]);
}
const musicOf = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/^[A-Za-z]:|^%%/.test(line))
    .join("\n");

const notesOf = (text: string) => {
  const timeline = tuneTimeline(abcjs as never, text, true);
  if (!timeline) throw new Error("no timeline");
  return timeline.notes
    .map((note) =>
      [Math.round(note.time * 96), note.pitch, Math.round(note.duration * 96)].join(":"),
    )
    .sort();
};

describe("MIDI import: round trip", () => {
  for (const example of EXAMPLES)
    it(`${example.title} comes back with the same notes and lengths`, async () => {
      const timeline = tuneTimeline(abcjs as never, example.text, true);
      if (!timeline) throw new Error("no timeline");
      const bytes = writeMidi(timeline, { title: example.title });
      const result = await readMidiFile(bytes, example.file.replace(/abc$/, "mid"));
      expect(notesOf(result.text)).toEqual(notesOf(example.text));
    });
});

describe("MIDI import: handmade files", () => {
  it("reads format 0 with several channels, running status and programs naming the parts", async () => {
    const file = smf(0, [
      track(
        [
          [0, name("Little piece")],
          [0, tempo(100)],
          [0, meter(4, 4)],
          [0, key(0)],
          [0, [0xc0, 40]],
          [0, [0xc1, 32]],
          [0, [0xb0, 7, 100]],
          ...notes(0, [
            [0, 1, 72],
            [1, 1, 74],
            [2, 1, 76],
            [3, 1, 77],
          ]),
          ...notes(1, [
            [0, 2, 48],
            [2, 2, 43],
          ]),
          [960, [0xe0, 0, 0x40]],
        ],
        true,
      ),
    ]);
    const result = await readMidiFile(file, "little.mid");
    expect(result.report.title).toBe("Little piece");
    expect(result.report.parts).toBe(2);
    expect(result.text).toContain('name="Violin"');
    expect(result.text).toContain('name="Acoustic Bass"');
    expect(result.text).toContain("clef=bass");
    expect(musicOf(result.text)).toMatch(/c d e f \|/);
    expect(musicOf(result.text)).toMatch(/C,2 G,,2 \|/);
    expect(result.report.notes[0]).toMatch(/format 0 .*2 channels became a part/);
    const left = result.report.dropped.map((item) => item.label).join("; ");
    expect(left).toContain("pitch bends");
    expect(left).toContain("controller changes");
    expect(left).toContain("program changes");
  });

  it("reads format 1 with a conductor track, tempo changes, key and meter", async () => {
    const file = smf(1, [
      track([
        [0, name("Waltz")],
        [0, meter(3, 4)],
        [0, key(2)],
        [0, tempo(120)],
        [480 * 6, tempo(90)],
      ]),
      track([
        [0, name("Melody")],
        ...notes(0, [
          [0, 1, 74],
          [1, 1, 78],
          [2, 1, 81],
          [3, 3, 79],
          [6, 1, 78],
          [7, 1, 76],
          [8, 1, 73],
          [9, 3, 74],
        ]),
      ]),
    ]);
    const result = await readMidiFile(file, "waltz.mid");
    expect(result.report.title).toBe("Waltz");
    expect(result.text).toContain("M:3/4");
    expect(result.text).toContain("K:D");
    expect(result.text).toContain("Q:1/4=120");
    expect(result.text).toContain("[Q:1/4=90]");
    expect(result.text).toContain('name="Melody"');
    expect(musicOf(result.text)).toMatch(/d f a \| g3 \| \[Q:1\/4=90\] f e c \| d3 \|/);
    expect(result.report.notes.join(" ")).not.toMatch(/estimated|no time signature/);
  });

  it("finds triplets and writes them as tuplets", async () => {
    const third = 1 / 3;
    const file = smf(0, [
      track([
        [0, meter(4, 4)],
        [0, key(0)],
        ...notes(0, [
          [0, third, 60],
          [third, third, 62],
          [2 * third, third, 64],
          [1, 1, 65],
          [2, 0.5, 67],
          [2.5, 0.5, 69],
          [3, 1, 71],
        ]),
      ]),
    ]);
    const result = await readMidiFile(file, "triplets.mid");
    expect(result.grid).toMatch(/triplets in 1 beat/);
    expect(musicOf(result.text)).toMatch(/\(3:2:3?C ?D ?E|\(3 ?C ?D ?E/);
    expect(musicOf(result.text)).toMatch(/F2 GA B2 \|/);
    // At another grid, straight sixteenths: no tuplets.
    const straight = await readMidiFile(file, "triplets.mid", { grid: "16", drums: "omit" });
    expect(straight.text).not.toContain("(3");
  });

  it("quantises swing-ish eighths to straight ones, not triplets or dotted pairs", async () => {
    const list: [number, number, number][] = [];
    const jitter = [0.01, -0.02, 0.015, -0.01, 0.02, 0, -0.015, 0.01];
    for (let beat = 0; beat < 8; beat++) {
      const j = jitter[beat] as number;
      list.push([beat + j, 0.55, [60, 62, 64, 65][beat % 4] as number]);
      list.push([beat + 0.6 + j, 0.35, 67]);
    }
    const file = smf(0, [track([[0, meter(4, 4)], [0, key(0)], ...notes(0, list)])]);
    const result = await readMidiFile(file, "swing.mid");
    expect(result.grid).toMatch(/^eighths/);
    const music = musicOf(result.text);
    expect(music).not.toMatch(/\(3|>|</);
    expect(music).toMatch(/CG DG EG FG \| CG DG EG FG \|/);
  });

  it("leaves drums out unless asked, then writes a percussion staff", async () => {
    const file = smf(1, [
      track([
        [0, meter(4, 4)],
        [0, key(0)],
      ]),
      track([
        [0, name("Tune")],
        ...notes(0, [
          [0, 2, 67],
          [2, 2, 72],
        ]),
      ]),
      track([
        [0, name("Kit")],
        ...notes(9, [
          [0, 1, 36],
          [1, 1, 38],
          [2, 1, 36],
          [3, 1, 38],
        ]),
      ]),
    ]);
    const omitted = await readMidiFile(file, "drums.mid");
    expect(omitted.report.parts).toBe(1);
    expect(omitted.hasDrums).toBe(true);
    expect(omitted.report.notes.join(" ")).toMatch(/Drums \(channel 10, 4 notes\) were left out/);
    const kept = await readMidiFile(file, "drums.mid", { grid: "auto", drums: "staff" });
    expect(kept.report.parts).toBe(2);
    expect(kept.text).toContain("clef=perc");
    expect(kept.text).toContain('name="Kit"');
  });

  it("puts lyrics under the notes they start with", async () => {
    const file = smf(0, [
      track([
        [0, meter(3, 4)],
        [0, key(-1)],
        [0, lyric("Hel-")],
        [480, lyric("lo")],
        [960, lyric("world")],
        [1440, lyric("a-")],
        [1920, lyric("gain")],
        ...notes(0, [
          [0, 1, 65],
          [1, 1, 69],
          [2, 1, 72],
          [3, 1, 70],
          [4, 2, 65],
        ]),
      ]),
    ]);
    const result = await readMidiFile(file, "song.mid");
    expect(result.text).toContain("K:F");
    expect(result.text).toMatch(/^w: ?Hel-lo world \| a-gain/m);
    expect(result.report.notes.join(" ")).toMatch(/5 lyric syllables from the file are under/);
  });

  it("estimates the key and meter when the file gives none, and says so", async () => {
    // A minor, harmonic: the leading note spelled G♯.
    const file = smf(0, [
      track(
        notes(0, [
          [0, 1, 57],
          [1, 1, 59],
          [2, 1, 60],
          [3, 1, 62],
          [4, 1, 64],
          [5, 1, 65],
          [6, 1, 68],
          [7, 1, 69],
          [8, 2, 64],
          [10, 2, 57],
        ]),
      ),
    ]);
    const result = await readMidiFile(file, "minor.mid");
    expect(result.text).toContain("K:Am");
    expect(result.text).toContain("^G");
    const said = result.report.notes.join(" ");
    expect(said).toContain("estimated as A minor");
    expect(said).toContain("no time signature: written in 4/4");
    expect(said).toContain("no tempo");
  });

  it("ties across beats and bar lines, and beams by the beat", async () => {
    const file = smf(0, [
      track([
        [0, meter(4, 4)],
        [0, key(0)],
        ...notes(0, [
          [0, 0.5, 60],
          [0.5, 1, 62],
          [1.5, 0.5, 64],
          [2, 3, 65],
          [5, 3, 67],
          [8, 0.25, 72],
          [8.25, 0.25, 71],
          [8.5, 0.5, 69],
          [9, 0.5, 67],
          [9.5, 0.5, 65],
          [10, 2, 64],
        ]),
      ]),
    ]);
    const result = await readMidiFile(file, "ties.mid");
    expect(musicOf(result.text)).toMatch(/^C2D2- D2E2 F8- \| F4 G12 \| cBA2 G2F2 E8 \|/m);
  });

  it("splits overlapping lines in a track into voices", async () => {
    const file = smf(0, [
      track([
        [0, meter(4, 4)],
        [0, key(0)],
        // A held C under a moving line; then a chord.
        ...notes(0, [
          [0, 4, 60],
          [0, 1, 72],
          [1, 1, 74],
          [2, 1, 76],
          [3, 1, 77],
          [4, 4, 64],
          [4, 4, 67],
          [4, 4, 72],
        ]),
      ]),
    ]);
    const result = await readMidiFile(file, "lines.mid");
    expect(result.voices).toBe(2);
    expect(result.text).toMatch(/c d e f \| \[EGc\]4 \|/);
    expect(result.text).toMatch(/C4 \| x4 \|/);
    expect(result.text).toContain("%%score (1 2)");
  });
});

describe("MIDI import: damaged and hostile files", () => {
  const ok = smf(0, [track(notes(0, [[0, 1, 60]]))]);
  it("refuses what isn't a MIDI file", () => {
    expect(() => parseSmf(new TextEncoder().encode("X:1\nK:C\nCDE\n"))).toThrow(MidiFileError);
    expect(() => parseSmf(new TextEncoder().encode("X:1\nK:C\nCDE\n"))).toThrow(/not a MIDI file/);
  });
  it("refuses a file cut short", () => {
    expect(() => parseSmf(ok.subarray(0, ok.length - 6))).toThrow(/cut short/);
  });
  it("refuses data with no status, and bad data bytes", () => {
    const broken = smf(0, [[...utf("MTrk"), ...u32(4), 0, 0x40, 0x40, 0]]);
    expect(() => parseSmf(broken)).toThrow(/no status/);
  });
  it("refuses SMPTE timing, files over 16 MB and too many events", () => {
    const smpte = ok.slice();
    smpte[12] = 0xe7;
    smpte[13] = 40;
    expect(() => parseSmf(smpte)).toThrow(/SMPTE/);
    expect(() => parseSmf(new Uint8Array(16 * 1024 * 1024 + 1))).toThrow(/16 MB/);
    const many: number[] = [];
    for (let i = 0; i <= EVENT_LIMIT; i++) many.push(0, 0xb0, 1, 0);
    const flood = smf(0, [[...utf("MTrk"), ...u32(many.length), ...many]]);
    expect(() => parseSmf(flood)).toThrow(/events, too many/);
  });
  it("skips SysEx and unknown chunks, and closes notes left open", () => {
    const file = smf(0, [
      [...utf("XFIH"), ...u32(3), 1, 2, 3],
      track([
        [0, [0xf0, 3, 0x43, 0x10, 0xf7]],
        [0, [0x90, 60, 90]],
        [480, [0x90, 62, 90]],
        [960, [0x80, 62, 0]],
      ]),
    ]);
    // The header counts one track; the unknown chunk is skipped, so count two.
    file[11] = 2;
    const read = parseSmf(file);
    expect(read.counts.sysex).toBe(1);
    expect(read.counts.unclosed).toBe(1);
    expect(read.tracks[0]?.notes.map((note) => [note.pitch, note.tick, note.end])).toEqual([
      [60, 0, 960],
      [62, 480, 960],
    ]);
  });
  it("says plainly when a file has no notes", async () => {
    const empty = smf(0, [track([[0, tempo(120)]])]);
    await expect(readMidiFile(empty, "empty.mid")).rejects.toThrow(/no notes/);
  });
});

describe("MIDI import: the grid, key and spelling", () => {
  it("chooses the coarsest straight grid that holds the notes, and triplets by the beat", () => {
    expect(chooseGrid([0, 12, 24, 36], "auto", false).step).toBe(12);
    expect(chooseGrid([0, 6, 12, 18, 24], "auto", false).step).toBe(6);
    expect(chooseGrid([0, 3, 6, 9, 12], "auto", false).step).toBe(3);
    const mixed = chooseGrid([0, 8, 16, 24, 36, 48, 54, 60], "auto", false);
    expect(mixed.step).toBe(6);
    expect([...mixed.beats]).toEqual([0]);
    expect(snap(7.4, mixed)).toBe(8);
    expect(snap(31, mixed)).toBe(30);
    // Compound time stays straight unless triplets are asked for.
    expect(chooseGrid([0, 8, 16, 24], "auto", true).beats.size).toBe(0);
    expect(chooseGrid([0, 12], "triplets", true).all).toBe(true);
  });
  it("estimates keys from how long each note sounds", () => {
    const scale = (pcs: number[]) => {
      const weights = new Array(12).fill(0) as number[];
      for (const pc of pcs) weights[pc] = (weights[pc] as number) + 1;
      return weights;
    };
    expect(estimateKey(scale([0, 2, 4, 5, 7, 9, 11, 0, 4, 7, 0]), 0)).toEqual({
      fifths: 0,
      minor: false,
    });
    expect(estimateKey(scale([9, 11, 0, 2, 4, 5, 8, 9, 9, 4, 0]), 9)).toEqual({
      fifths: 0,
      minor: true,
    });
    expect(keyLabel(-3, true)).toBe("C minor");
    expect(keyLabel(6, false)).toBe("F♯ major");
  });
  it("spells for the key, with a minor key's leading note raised", () => {
    const c = spellerFor(0, false);
    expect(
      [63, 66, 70, 61, 68].map((p) => {
        const s = c(p);
        return `${s.step}${s.alter}`;
      }),
    ).toEqual(["E-1", "F1", "B-1", "C1", "G1"]);
    const dMinor = spellerFor(-1, true);
    expect(dMinor(61)).toEqual({ step: "C", alter: 1, octave: 4 });
    expect(dMinor(70)).toEqual({ step: "B", alter: -1, octave: 4 });
    const bFlat = spellerFor(-2, false);
    expect(bFlat(63)).toEqual({ step: "E", alter: -1, octave: 4 });
    expect(bFlat(64)).toEqual({ step: "E", alter: 0, octave: 4 });
    const e = spellerFor(4, false);
    expect(e(70)).toEqual({ step: "A", alter: 1, octave: 4 });
    expect(e(60)).toEqual({ step: "C", alter: 0, octave: 4 });
  });
});
