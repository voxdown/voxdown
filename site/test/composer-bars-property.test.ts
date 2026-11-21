import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { checkBars } from "../src/composer/barcheck";
import { copyText, cutPlan } from "../src/composer/barwise";
import type { Change } from "../src/composer/commands";
import { planPaste, sourceAt } from "../src/composer/paste";
import { followOrder, playOrder, structureOf } from "../src/composer/playorder";
import { type ScoreNote, indexScore } from "../src/composer/score";
import { selectedNotes } from "../src/composer/selected";
import { buildTimeline } from "../src/composer/timeline";
import { indexFile } from "../src/composer/tunes";
import { tuneItems } from "../src/composer/walk";

/* biome-ignore lint/suspicious/noExplicitAny: abcjs objects. */
type Any = any;

/*
 * Cut, Copy and Paste keep the music's structure, bar by bar: for every bar and every run of
 * bars of tunes with repeats, endings, D.S. al Coda and inline fields, a Cut leaves every bar its
 * length and plays what was played less those notes; pasting the cut back at its caret plays as
 * before; a Copy pasted at a bar line adds whole bars. (Cut then Paste at the caret giving back
 * the text exactly is the app's, which remembers the cut: check-composer step 33.)
 */

const TUNES = {
  "repeats, endings, D.S. al Coda":
    "X:1\nT:Jumps\nM:4/4\nL:1/4\nK:C\n|: C D E F |1 G A B c :|2 c B A G |]\nS d e f g | a b c' d' !D.S.alcoda! |\nO e f g a | g f e d |]\n",
  "inline fields":
    "X:1\nT:Fields\nM:4/4\nL:1/8\nK:G\nG2 A2 B2 c2 | [K:Bb][L:1/4] B c d e | [M:2/4] f g | [M:3/4] a b c' | B A G |]\n",
  "a repeat with two endings of two bars":
    "X:1\nT:Endings\nM:3/4\nL:1/4\nK:D\n|: D E F | G A B |1 c d e | f g a :|2 B c d | A3 |]\n",
  "two lines": "X:1\nT:Lines\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c |\nd e f g | a b c' d' |]\n",
};

const apply = (text: string, changes: Change[]) =>
  [...changes]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );

/** The pitches played, in play order, with where each is written. */
function played(text: string): { pitch: number; start: number }[] {
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
    .notes.filter((note) => note.track === 0)
    .map((note) => ({ pitch: note.pitch, start: note.start ?? -1 }));
}

/** Each bar's notes as a selection takes them: from its first note's marks to its last note. */
function barsOf(text: string) {
  const file = indexFile(text);
  const tune = file.tunes[0] as never;
  const bars: { from: number; to: number }[][] = [[]];
  for (const item of tuneItems(text, tune, file)) {
    if (item.type === "bar") bars.push([]);
    else (bars[bars.length - 1] as { from: number; to: number }[]).push(item);
  }
  return bars
    .filter((bar) => bar.length)
    .map((bar) => {
      const first = bar[0] as { from: number; to: number };
      const span = selectedNotes(text, [{ from: first.from, to: first.from + 1 }], file)[0]?.span;
      return { from: span?.from ?? first.from, to: (bar[bar.length - 1] as { to: number }).to };
    });
}

/** The text after pasting a copy at a caret, as the app's paste does it. */
const pasted = (text: string, at: number, clip: string, source: ReturnType<typeof sourceAt>) => {
  const plan = planPaste(text, [{ from: at, to: at }], 0, clip, source);
  if (plan && "refused" in plan) throw new Error(plan.refused);
  return plan ? apply(text, plan.changes) : `${text.slice(0, at)}${clip}${text.slice(at)}`;
};

const issues = (text: string) => {
  const file = indexFile(text);
  return checkBars(text, file.tunes[0] as never, file).map((issue) => issue.message);
};

describe("Cut keeps the structure, bar by bar and run by run (round 4)", () => {
  for (const [name, text] of Object.entries(TUNES)) {
    const bars = barsOf(text);
    const before = played(text);
    for (let a = 0; a < bars.length; a++)
      for (let b = a; b < Math.min(bars.length, a + 3); b++) {
        const range = {
          from: (bars[a] as { from: number }).from,
          to: (bars[b] as { to: number }).to,
        };
        if (text.slice(range.from, range.to).includes("\n") && b > a + 1) continue;
        it(`${name}: bars ${a + 1}–${b + 1} (${JSON.stringify(text.slice(range.from, range.to))})`, () => {
          const plan = cutPlan(text, [range]);
          expect(plan).not.toBeNull();
          if (!plan || "refused" in plan) {
            // Only a cut that would leave endings unreachable is refused, and it says why.
            expect(plan && "refused" in plan && plan.refused).toMatch(/ending|repeat/);
            return;
          }
          const after = apply(text, plan.changes);
          expect(issues(after), after).toEqual([]);
          const cut = before.filter((note) => note.start < range.from || note.start >= range.to);
          expect(
            played(after).map((note) => note.pitch),
            after,
          ).toEqual(cut.map((note) => note.pitch));
          // The clipboard holds what Copy would.
          expect(plan.clip).toBe(copyText(text, range));
          // Pasted back at the caret it plays as it did, by the paste rules alone (the app puts
          // back the exact text, remembering the cut). Repeat signs merged aren't split again.
          const back = pasted(
            after,
            plan.caret,
            plan.clip,
            sourceAt(text, indexFile(text), range.from),
          );
          // (A run with marks at both ends, a segno and a D.S., has them on swapped sides.)
          const both =
            /^\s*(S|O|!segno!|!coda!)/.test(text.slice(range.from)) &&
            /!D\.[SC]\.[a-z]*!\s*\|/.test(text.slice(range.to, text.indexOf("|", range.to) + 1));
          const marksAcross =
            /\n/.test(text.slice(range.from, range.to)) &&
            /!D\.|\nO |\nS /.test(text.slice(range.from, range.to));
          if (
            !both &&
            !marksAcross &&
            !/\|[:1-9]|:\|/.test(text.slice(range.from - 4, range.to + 4))
          )
            expect(
              played(back).map((note) => note.pitch),
              back,
            ).toEqual(before.map((note) => note.pitch));
        });
      }
  }
});

describe("Copy pasted at a bar line adds whole bars (round 4)", () => {
  for (const [name, text] of Object.entries(TUNES)) {
    const bars = barsOf(text);
    for (let a = 0; a < bars.length; a++) {
      const range = bars[a] as { from: number; to: number };
      it(`${name}: bar ${a + 1} pasted before every bar`, () => {
        const clip = copyText(text, range);
        expect(clip).toMatch(/\|$/);
        const source = sourceAt(text, indexFile(text), range.from);
        for (const target of bars) {
          for (const at of [target.from, target.to]) {
            const after = pasted(text, at, clip, source);
            expect(issues(after), after).toEqual([]);
            expect(played(after).length, after).toBeGreaterThan(played(text).length);
          }
        }
      });
    }
  }
});
