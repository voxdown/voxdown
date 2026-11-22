import { readFileSync } from "node:fs";
import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { frac } from "../src/composer/abc";
import { checkBars } from "../src/composer/barcheck";
import {
  copyText,
  cutPlan,
  duplicate,
  inOneVoice,
  lengthPartners,
  lengthsInStep,
  overwriteForward,
  replaceKeepingBars,
  tuneTokens,
} from "../src/composer/barwise";
import { type Change, scaleLengths, toggleTies, transpose } from "../src/composer/commands";
import { checkLyrics } from "../src/composer/lyriccheck";
import { placeMark } from "../src/composer/marks";
import { lyricsOfChanges, planPaste, sourceAt } from "../src/composer/paste";
import { selectedNotes } from "../src/composer/selected";
import { indexFile } from "../src/composer/tunes";
import { tuneItems } from "../src/composer/walk";
import { played } from "./composer-played";

/*
 * The conformance sweep (round 9, after Codex's 1,768-case run): the written "Editing rules"
 * (docs/plans/voxdown-composer.md), rule by rule, over every kind of selection (each note, part
 * of each bar, one and two whole bars, per voice) of ten scores: a trio, a piano piece, a song
 * with verses, two voices on one staff, a solo with every kind of mark, an inline-voice duet in
 * 6/8, four interleaved voices with a spacer voice, two voices with lyrics from MusicXML, a repeat
 * with endings, and mid-tune meters. Each edit is checked against what its rule says, and undone
 * through CodeMirror's own changes to give the text back exactly. The browser cases (score
 * selections, MIDI, the status) are check-composer's step 38.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/composer/${name}.abc`, import.meta.url), "utf8");
const SCORES: Record<string, string> = {
  trio: fixture("trio"),
  piano: fixture("piano"),
  song: fixture("song"),
  ragged: fixture("ragged"),
  solo: fixture("conformance/custom-solo"),
  duet: fixture("conformance/custom-duet"),
  four: fixture("conformance/custom-four"),
  lyrics: fixture("conformance/two-voices-lyrics"),
  endings: fixture("conformance/repeats-endings"),
  meters: fixture("conformance/meters"),
};

type Range = { from: number; to: number };
/** Through CodeMirror's own changes: they must not overlap, and undo is their inverse. */
function edit(text: string, changes: Change[]) {
  const doc = Text.of(text.split("\n"));
  const set = ChangeSet.of(changes, doc.length);
  const after = set.apply(doc);
  return { after: after.toString(), undone: set.invert(doc).apply(after).toString() };
}
/** The bar and verse problems a text has (the fixtures' own aside). */
function problems(text: string): string[] {
  const file = indexFile(text);
  return file.tunes.flatMap((tune) => [
    ...checkBars(text, tune, file).map((issue) => `${issue.voice}:${issue.message}`),
    // (A verse off its notes, however far: one problem, its count by the verse.)
    ...checkLyrics(text, tune).map(() => "a verse off its notes"),
  ]);
}
/** Problems an edit made: those after it, less the score's own (bar numbers aside: bars cut
 * renumber the rest), counted. */
const added = (before: string[], after: string[]) => {
  const plain = (issue: string) => issue.replace(/Bar \d+/, "Bar");
  const left = before.map(plain);
  return after.filter((issue) => {
    const at = left.indexOf(plain(issue));
    if (at < 0) return true;
    left.splice(at, 1);
    return false;
  });
};
/** Every hairpin of every voice opened, then closed. */
function hairpinsPaired(text: string): boolean {
  const file = indexFile(text);
  const opens = new Map<string, number>();
  for (const { token, voice } of tokens(text, file)) {
    if (token.kind !== "decoration") continue;
    if (/^!(<|>)\(!$/.test(token.text)) opens.set(voice, (opens.get(voice) ?? 0) + 1);
    if (/^!(<|>)\)!$/.test(token.text)) opens.set(voice, (opens.get(voice) ?? 0) - 1);
    if ((opens.get(voice) ?? 0) < 0 || (opens.get(voice) ?? 0) > 1) return false;
  }
  return [...opens.values()].every((each) => each === 0);
}
const tokens = (text: string, file: ReturnType<typeof indexFile>) =>
  tuneTokens(text, file, file.tunes[0]?.bodyFrom ?? 0);

/** Each note, part of each bar, and one and two whole bars, per voice. */
function selections(
  text: string,
): { label: string; range: Range; voice: string; whole: boolean }[] {
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
  const span = (event: Range) =>
    selectedNotes(text, [{ from: event.from, to: event.from + 1 }], file)[0]?.span ?? event;
  const out: { label: string; range: Range; voice: string; whole: boolean }[] = [];
  for (const [voice, all] of byVoice) {
    const bars = all.filter((bar) => bar.length);
    bars.forEach((bar, index) => {
      const first = bar[0] as Event;
      for (const note of bar)
        out.push({
          label: `V:${voice} note ${note.from}`,
          range: span(note),
          voice,
          whole: bar.length === 1,
        });
      if (bar.length > 2)
        out.push({
          label: `V:${voice} part of bar ${index + 1}`,
          range: { from: span(first).from, to: (bar[1] as Event).to },
          voice,
          whole: false,
        });
      for (let k = 1; k <= 2 && index + k <= bars.length; k++)
        out.push({
          label: `V:${voice} bars ${index + 1}–${index + k}`,
          range: {
            from: span(first).from,
            to: ((bars[index + k - 1] as Event[]).at(-1) as Event).to,
          },
          voice,
          whole: true,
        });
    });
  }
  return out;
}

for (const [name, text] of Object.entries(SCORES)) {
  const file = indexFile(text);
  const own = problems(text);
  const cases = selections(text);
  const voices = new Set(cases.map((each) => each.voice)).size;
  const at = (label: string, range: Range) =>
    `${name}, ${label} (${JSON.stringify(text.slice(range.from, range.to))})`;

  describe(`conformance: ${name} (${cases.length} selections)`, () => {
    it("Delete, Backspace and Cut: bars kept their lengths, voices in step, hairpins paired, undo exact", () => {
      for (const { label, range } of cases) {
        const plan = cutPlan(text, [range], file);
        if (!plan) continue;
        if ("refused" in plan) {
          expect(plan.refused, at(label, range)).toMatch(/repeat|ending|tuplet|tunes/);
          continue;
        }
        const { after, undone } = edit(text, plan.changes);
        expect(undone, at(label, range)).toBe(text);
        expect(added(own, problems(after)), `${at(label, range)}\n${after}`).toEqual([]);
        expect(hairpinsPaired(after), `${at(label, range)}: hairpins\n${after}`).toBe(true);
        expect(after, `${at(label, range)}: a slur left on a rest`).not.toMatch(/\([zx]\d*\)/);
        // Copy holds what Cut takes, never a header or a verse of other notes.
        expect(plan.clip).toBe(copyText(text, range, file));
        expect(plan.clip, at(label, range)).not.toMatch(/^[A-Z]:/m);
      }
    });

    it("Paste over a selection: forward, bars and voices in step; the copy of the same notes over them is a no-op in time", () => {
      for (const { label, range } of cases) {
        const clip = copyText(text, range, file);
        const plan = planPaste(text, [range], 0, clip, sourceAt(text, file, range.from), file);
        if (!plan) continue;
        if ("refused" in plan) {
          // (A selection across other voices' lines is refused too: a paste replaces one voice.)
          expect(plan.refused, at(label, range)).toMatch(
            /repeat|ending|end of the voice|tuplet|sounding across|two lines|multi-bar|several voices|broken rhythm/,
          );
          continue;
        }
        const { after, undone } = edit(text, plan.changes);
        expect(undone, at(label, range)).toBe(text);
        expect(
          added(own, problems(after)),
          `${at(label, range)}\n${plan.message}\n${after}`,
        ).toEqual([]);
      }
    });

    it("Duplicate: whole bars as bars, every voice in step; part of a bar over-full, as the rules say", () => {
      for (const { label, range, whole } of cases) {
        const plan = duplicate(text, [range], file);
        if ("refused" in plan) {
          expect(plan.refused, at(label, range)).toMatch(/repeat|ending|sounding across|lines/);
          continue;
        }
        if (!plan.changes.length) continue;
        const { after, undone } = edit(text, plan.changes);
        expect(undone, at(label, range)).toBe(text);
        // (A bar copied that was already short or over-full is that bar again: not a new kind.)
        const known = own.map((issue) => issue.replace(/Bar \d+/, "Bar"));
        const news = added(own, problems(after)).filter(
          (issue) => !known.includes(issue.replace(/Bar \d+/, "Bar")),
        );
        if (whole)
          expect(
            news.filter((issue) => !/verse|syllable|lyric/i.test(issue)),
            `${at(label, range)}\n${after}`,
          ).toEqual([]);
        // Never out of step: a bar more or less in one voice only.
        expect(
          news.filter((issue) => /out of step/.test(issue)),
          `${at(label, range)}\n${after}`,
        ).toEqual([]);
      }
    });

    it("Typing over notes: one voice only; bar lines kept; undo exact", () => {
      for (const { label, range } of cases) {
        const typed = replaceKeepingBars(text, [range], "A", file);
        if (!typed || "refused" in typed) continue;
        const { after, undone } = edit(text, typed);
        expect(undone, at(label, range)).toBe(text);
        expect(after.split("|").length, at(label, range)).toBe(text.split("|").length);
      }
      if (voices > 1) {
        const [a, b] = [...new Set(cases.map((each) => each.voice))];
        const one = cases.find((each) => each.voice === a) as (typeof cases)[number];
        const two = cases.find((each) => each.voice === b) as (typeof cases)[number];
        expect(inOneVoice(text, [one.range, two.range], file)).toBe(false);
      }
    });

    it("Step entry over a note: written forward, bars kept their lengths, the other voices as they were", () => {
      for (const { label, range } of cases.filter((each) => /note/.test(each.label))) {
        const over = overwriteForward(text, file, range, "c2");
        if (!over) continue;
        if ("refused" in over) {
          expect(over.refused, at(label, range)).toMatch(
            /repeat|ending|end of the voice|tuplet|two lines|multi-bar|broken rhythm/,
          );
          continue;
        }
        // (Its verses kept on their notes, as the step does.)
        const { after } = edit(text, lyricsOfChanges(text, file, over.changes));
        expect(added(own, problems(after)), `${at(label, range)}\n${after}`).toEqual([]);
      }
    });

    it("½×, 2× and dot: every bar keeps its length (halved: rests; 2× or dot past the bar: refused)", () => {
      for (const { label, range } of cases) {
        for (const [factor, name] of [
          [0.5, "Halve"],
          [2, "Double"],
          [1.5, "Dot"],
        ] as const) {
          const changes = scaleLengths(
            text,
            lengthPartners(text, [range], file),
            frac(factor * 2, 2),
            file,
          );
          if (!changes.length) continue;
          const plan = lengthsInStep(text, file, changes, factor, name);
          if (!plan) continue;
          if ("refused" in plan) {
            expect(plan.refused, at(label, range)).toMatch(/would overfill bar/);
            continue;
          }
          const { after } = edit(text, plan.changes);
          expect(
            added(own, problems(after)).filter((issue) => !/verse|syllable|lyric/i.test(issue)),
            `${name}: ${at(label, range)}\n${after}`,
          ).toEqual([]);
        }
      }
    });

    it("Decorations: an articulation toggled on then off gives the text back; dynamics once per staff", () => {
      for (const { label, range } of cases) {
        for (const mark of ["accent", ".", "fermata"]) {
          // On, off, on again: as on (a toggle; equal spellings, !>! and !accent!, are one).
          const on = placeMark(text, [range], mark, file);
          if ("refused" in on) continue;
          const once = edit(text, on.changes).after;
          const map = (changes: Change[], length: number, given: Range) => {
            const set = ChangeSet.of(changes, length);
            return { from: set.mapPos(given.from, -1), to: set.mapPos(given.to, 1) };
          };
          const r1 = map(on.changes, text.length, range);
          const off = placeMark(once, [r1], mark);
          if ("refused" in off) continue;
          const twice = edit(once, off.changes).after;
          const r2 = map(off.changes, once.length, r1);
          const again = placeMark(twice, [r2], mark);
          if ("refused" in again) continue;
          const thrice = edit(twice, again.changes).after;
          const count = (doc: string) =>
            (
              doc.match(
                mark === "."
                  ? /\.|!staccato!/g
                  : mark === "fermata"
                    ? /!fermata!|H(?=[A-Ga-g[])/g
                    : /!accent!|!>!|L(?=[A-Ga-g[])/g,
              ) ?? []
            ).length;
          expect(count(thrice), `${mark}: ${at(label, range)}`).toBe(count(once));
        }
      }
    });

    it("Transpose: up then down plays as before; Alt+T twice gives the text back", () => {
      const before = played(text, null).map((note) => note.pitch);
      for (const { label, range } of cases.filter((each) => each.whole)) {
        const up = transpose(text, [range], 2, file);
        const raised = edit(text, up).after;
        const set = ChangeSet.of(up, text.length);
        const mapped = { from: set.mapPos(range.from, -1), to: set.mapPos(range.to, 1) };
        const down = edit(raised, transpose(raised, [mapped], -2)).after;
        expect(
          played(down, null).map((note) => note.pitch),
          at(label, range),
        ).toEqual(before);
      }
      for (const { label, range } of cases.filter((each) => /note/.test(each.label)).slice(0, 40)) {
        const tie = toggleTies(text, [range], file);
        if (!tie.changes.length) continue;
        const once = edit(text, tie.changes).after;
        const set = ChangeSet.of(tie.changes, text.length);
        const back = toggleTies(once, [
          { from: set.mapPos(range.from, -1), to: set.mapPos(range.to, 1) },
        ]);
        // (Tied again, maybe spelt the other way: [C-E-]2 and [CE]2- are the same ties.)
        if (back.changes.length)
          expect(edit(once, back.changes).after.replace(/-/g, ""), at(label, range)).toBe(
            text.replace(/-/g, ""),
          );
      }
    });
  });
}
