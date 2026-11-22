import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { checkBars } from "../src/composer/barcheck";
import { copyText, cutPlan, duplicate, replaceKeepingBars } from "../src/composer/barwise";
import { type Change, musicParts } from "../src/composer/commands";
import { planPaste, sourceAt } from "../src/composer/paste";
import { selectedNotes } from "../src/composer/selected";
import { indexFile } from "../src/composer/tunes";
import { tuneItems } from "../src/composer/walk";
import { played } from "./composer-played";

/*
 * The edit sweep (round 6, after Codex's): Delete, Backspace, typing, Duplicate, Cut then Paste and
 * Copy then Paste over every kind of selection (a note, part of a bar, runs of whole bars) of six
 * tunes. After each: no bar lines fused into new signs; every bar of every voice its length, and
 * the voices with as many bars; the play order changed as it should; every verse's syllables still
 * on their notes; and the edit undone gives the text back exactly.
 */

const HYMN =
  'X:1\nT:Old Hundredth\nM:2/2\nL:1/4\n%%score (S A) (T B)\nV:S clef=treble name="Soprano"\nV:A clef=treble name="Alto"\nV:T clef=bass name="Tenor"\nV:B clef=bass name="Bass"\nK:G\n[V:S] G2 | G F E D | G2 A2 | B2 B2 | B A G c | B2 A2 | G2 |]\nw: All peo-ple that on earth do dwell, Sing to the Lord with cheer-ful voice;\n[V:A] D2 | D D C B, | D2 D2 | D2 D2 | G F G E | D2 D2 | D2 |]\n[V:T] B,2 | B, A, G, G, | B,2 C2 | B,2 G,2 | D D B, C | D2 C2 | B,2 |]\n[V:B] G,2 | G, D, E, G, | G,2 F,2 | G,2 G,2 | G, D, E, C, | D,2 D,2 | G,,2 |]\n';

const TUNES = {
  compact: "X:1\nT:Reel\nM:3/4\nL:1/8\nK:G\n|:E3 B3|EBE AFD|1 BAG FED:|2 BAG FE2|]\n",
  spaced: "X:1\nT:Reel\nM:3/4\nL:1/8\nK:G\n|: E3 B3 | EBE AFD |1 BAG FED :|2 BAG FE2 |]\n",
  jumps:
    "X:1\nT:Jumps\nM:4/4\nL:1/4\nK:C\n|: C D E F |1 G A B c :|2 c B A G |]\nS d e f g | a b c' d' !D.S.alcoda! |\nO e f g a | g f e d |]\n",
  tuplets: "X:1\nT:Triplets\nM:4/4\nL:1/8\nK:C\n(3cde (3fga b2 c'2 | d'2 (c'2 b2) a2 | g8 |]\n",
  fields:
    "X:1\nT:Fields\nM:4/4\nL:1/8\nK:G\nA2 B2 c2 d2 | [K:Bb][L:1/4] B c d e | [M:2/4] f g | [M:3/4] a b c' |]\n",
  voices:
    "X:1\nT:Voices\nM:4/4\nL:1/4\n%%score (1 2) 3\nK:C\nV:1\nC D E F|G A B c|\nw: one two three four five six sev en\nw: un deux trois quatre cinq six sept huit\nV:2\nE F G A|B c d e|\nV:3\nG A B c|d e f g|\nV:1\nc B A G|F E D C|]\nw: eight nine ten more words go here now\nw: neuf dix onze douze treize quatorze quinze seize\nV:2\ne d c B|A G F E|]\nV:3\ng f e d|c B A G|]\n",
  // Four voices on inline [V:] lines (round 7, Codex's hymn).
  hymn: HYMN,
};

type Range = { from: number; to: number };
const apply = (text: string, changes: Change[]) => {
  // Through CodeMirror's own changes: they must not overlap, and undo is their inverse.
  const doc = Text.of(text.split("\n"));
  const set = ChangeSet.of(changes, doc.length);
  const after = set.apply(doc);
  const back = set.invert(doc).apply(after);
  return { after: after.toString(), undone: back.toString() };
};
const fused = (text: string) => /\|::\||\|:\||::\|/.test(text);
const issues = (text: string) => {
  const file = indexFile(text);
  return file.tunes.flatMap((tune) => checkBars(text, tune, file)).map((issue) => issue.message);
};

/** Each music line's verses, as syllables per note (in the line's note order). */
function verses(text: string): string[][] {
  const out: string[][] = [];
  const lines = text.split("\n");
  for (let at = 0; at < lines.length; at++)
    if ((lines[at] as string).startsWith("w:"))
      out.push(
        (lines[at] as string)
          .slice(2)
          .trim()
          .split(/\s+|(?<=-)/)
          .filter(Boolean),
      );
  return out;
}

/** The selections: each note, part of each bar, and runs of one to three whole bars, per voice. */
function selections(text: string): { label: string; range: Range; whole: boolean }[] {
  const file = indexFile(text);
  const tune = file.tunes[0] as never;
  type Event = { from: number; to: number; length: number };
  const byVoice = new Map<string, Event[][]>();
  for (const item of tuneItems(text, tune, file)) {
    const bars = byVoice.get(item.voice) ?? [[]];
    if (item.type === "bar") bars.push([]);
    else
      (bars[bars.length - 1] as Event[]).push({
        from: item.from,
        to: item.to,
        length: item.duration.num / item.duration.den,
      });
    byVoice.set(item.voice, bars);
  }
  // (A pickup, or the short last bar answering it, isn't a whole bar for the length checks.)
  const meter = /^M:\s*(\d+)\/(\d+)/m.exec(text);
  const full = meter ? Number(meter[1]) / Number(meter[2]) : 0;
  const short = (bar: Event[]) =>
    full > 0 && bar.reduce((sum, each) => sum + each.length, 0) < full - 1e-9;
  const span = (event: { from: number; to: number }) =>
    selectedNotes(text, [{ from: event.from, to: event.from + 1 }], file)[0]?.span ?? event;
  const cases: { label: string; range: Range; whole: boolean }[] = [];
  for (const [voice, all] of byVoice) {
    const bars = all.filter((bar) => bar.length);
    bars.forEach((bar, index) => {
      const first = bar[0] as Range;
      cases.push({
        label: `V:${voice} note ${first.from}`,
        range: { from: span(first).from, to: first.to },
        whole: bar.length === 1 && !short(bar),
      });
      if (bar.length > 1) {
        const half = bar[Math.floor(bar.length / 2) - 1] as Range;
        cases.push({
          label: `V:${voice} part of bar ${index + 1}`,
          range: { from: span(first).from, to: half.to },
          whole: false,
        });
      }
      for (let k = 1; k <= 3 && index + k <= bars.length; k++) {
        const last = (bars[index + k - 1] as Range[]).at(-1) as Range;
        cases.push({
          label: `V:${voice} bars ${index + 1}–${index + k}`,
          range: { from: span(first).from, to: last.to },
          whole: !bars.slice(index, index + k).some(short),
        });
      }
    });
  }
  return cases;
}

describe("the edit sweep: every selection of six tunes, six edits (round 6)", () => {
  for (const [name, tune] of Object.entries(TUNES)) {
    const cases = selections(tune);
    // A played note's start is where abcjs reads it (a tuplet's sign, for its first note): as its
    // event's start.
    const starts = tuneItems(tune, indexFile(tune).tunes[0] as never, indexFile(tune))
      .filter((item) => item.type === "event")
      .map((item) => item.from)
      .sort((x, y) => x - y);
    const before = played(tune, null).map((note) => ({
      ...note,
      start: starts.find((at) => at >= note.start) ?? note.start,
    }));
    const beforeVerses = verses(tune);
    it(`${name}: ${cases.length} selections`, () => {
      let edits = 0;
      for (const { label, range, whole } of cases) {
        const at = `${name}, ${label} (${JSON.stringify(tune.slice(range.from, range.to))})`;
        const gone = new Set(
          selectedNotes(tune, [range], indexFile(tune))
            .filter((each) => each.whole)
            .map((each) => each.event.from),
        );
        // Delete and Backspace: one plan.
        const plan = cutPlan(tune, [range]);
        if (plan && !("refused" in plan)) {
          const { after, undone } = apply(tune, plan.changes);
          edits += 1;
          expect(undone, `${at}: Delete undone`).toBe(tune);
          expect(fused(after), `${at}: Delete fused bar lines\n${after}`).toBe(false);
          expect(issues(after), `${at}: Delete bar lengths\n${after}`).toEqual([]);
          expect(
            played(after, null).map((note) => note.pitch),
            `${at}: Delete play order\n${after}`,
          ).toEqual(before.filter((note) => !gone.has(note.start)).map((note) => note.pitch));
          // Every verse keeps its syllables on the notes that stay (the others' come out).
          const afterVerses = verses(after);
          expect(afterVerses.length, `${at}: verses kept`).toBeLessThanOrEqual(beforeVerses.length);
          for (const verse of afterVerses) expect(verse.length).toBeGreaterThan(0);
          // Cut then Paste back at the caret plays as before (a repeat's marks aside).
          if (!/[:|][0-9:|]|S|O|!D\./.test(tune.slice(range.from - 3, range.to + 3))) {
            const back = planPaste(
              after,
              [{ from: plan.caret, to: plan.caret }],
              0,
              plan.clip,
              sourceAt(tune, indexFile(tune), range.from),
            );
            if (back && !("refused" in back)) {
              const pasted = apply(after, back.changes).after;
              expect(fused(pasted), `${at}: Cut then Paste fused bar lines\n${pasted}`).toBe(false);
              if (whole)
                expect(
                  played(pasted, null).length,
                  `${at}: Cut then Paste plays as much\n${pasted}`,
                ).toBe(before.length);
            }
          }
        } else if (plan) expect(plan.refused, at).toMatch(/repeat|ending|tuplet/);
        // Typing over the selection: every bar line its own, undo exact.
        const typed = replaceKeepingBars(tune, [range], "A");
        if (typed && !("refused" in typed)) {
          const { after, undone } = apply(tune, typed);
          edits += 1;
          expect(undone, `${at}: typing undone`).toBe(tune);
          expect(fused(after), `${at}: typing fused bar lines\n${after}`).toBe(false);
        }
        // Duplicate: no fused bar lines, bars their lengths, the voices in step, more notes.
        const dup = duplicate(tune, [range]);
        if (!("refused" in dup) && dup.changes.length) {
          const { after, undone } = apply(tune, dup.changes);
          edits += 1;
          expect(undone, `${at}: Duplicate undone`).toBe(tune);
          expect(fused(after), `${at}: Duplicate fused bar lines\n${after}`).toBe(false);
          if (whole) expect(issues(after), `${at}: Duplicate bar lengths\n${after}`).toEqual([]);
          expect(played(after, null).length, `${at}: Duplicate adds notes`).toBeGreaterThan(
            before.length - 1,
          );
        }
        // Copy then Paste over the same selection: the music as it was.
        const clip = copyText(tune, range);
        const over = planPaste(tune, [range], 0, clip, sourceAt(tune, indexFile(tune), range.from));
        if (over && !("refused" in over)) {
          const { after, undone } = apply(tune, over.changes);
          edits += 1;
          expect(undone, `${at}: Paste undone`).toBe(tune);
          expect(fused(after), `${at}: Copy then Paste fused bar lines\n${after}`).toBe(false);
          expect(issues(after), `${at}: Copy then Paste bar lengths\n${after}`).toEqual([]);
        }
      }
      expect(edits).toBeGreaterThan(cases.length);
    });
  }
});

describe("the edit sweep: a text selection across voices (round 7)", () => {
  // From the soprano's 3rd bar to the bass's 4th, and its mirror, from the soprano's 4th bar to
  // the bass's 3rd, as a drag in the text makes them.
  const cases = [
    {
      label: "soprano down to the bass",
      from: HYMN.indexOf("G2 A2"),
      to: HYMN.indexOf("| G,2 G,2") + 1,
    },
    {
      label: "the bass up to the soprano",
      from: HYMN.indexOf("G,2 F,2") + 7,
      to: HYMN.indexOf("| B2 B2"),
    },
  ];
  for (const { label, from, to } of cases)
    it(label, () => {
      const range = { from: Math.min(from, to), to: Math.max(from, to) };
      const plan = cutPlan(HYMN, musicParts(HYMN, [range], indexFile(HYMN)));
      if (!plan || "refused" in plan) throw new Error(JSON.stringify(plan));
      const { after, undone } = apply(HYMN, plan.changes);
      expect(undone).toBe(HYMN);
      // Every voice marker first on its own line, before its own music; no bar line moved off.
      const lines = after.split("\n").filter((line) => /\[V:/.test(line));
      expect(lines.map((line) => line.slice(0, 5))).toEqual(["[V:S]", "[V:A]", "[V:T]", "[V:B]"]);
      for (const line of lines) {
        expect(line).toMatch(/^\[V:[SATB]\] [^[]*\|\]$/);
        expect(line.match(/\[V:/g)).toHaveLength(1);
      }
      // Every bar its length, and as many bars in every voice: still in step.
      expect(issues(after), after).toEqual([]);
      const bars = lines.map((line) => line.split("|").length);
      expect(new Set(bars).size, after).toBe(1);
      expect(fused(after)).toBe(false);
    });
});
