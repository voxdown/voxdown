import { readFileSync } from "node:fs";
import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { frac, meterLength } from "../src/composer/abc";
import {
  copyText,
  cutPlan,
  duplicate,
  inOneVoice,
  lengthPartners,
  lengthsInStep,
  repitch,
  replaceKeepingBars,
  tuneTokens,
} from "../src/composer/barwise";
import {
  type Change,
  markSelection,
  musicParts,
  scaleLengths,
  transpose,
} from "../src/composer/commands";
import { placeMark } from "../src/composer/marks";
import { planPaste, sourceAt } from "../src/composer/paste";
import { selectedNotes } from "../src/composer/selected";
import { indexFile } from "../src/composer/tunes";
import { tuneItems } from "../src/composer/walk";

/*
 * The seeded fuzz check (round 10, after Codex's 216 random 20-step runs): random selections and
 * edits, one after another, through the same plans the app uses (Delete, Backspace and Cut as
 * one plan over the selection's music, voice by voice; Copy; Paste over a selection and at a
 * caret; Duplicate; typing; transpose; ½× and 2×; marks and decorations), on six scores. After
 * each step:
 * - its changes are CodeMirror's own (none overlapping) and their inverse gives the text back;
 * - an edit that keeps time (all but typing, Duplicate and a paste that goes in) leaves no bar
 *   short or over-full, and no voice out of step, that wasn't;
 * - hairpins stay paired; no slur is left on a rest.
 * At the end every step undone, in turn, gives the score back exactly. The seeds are fixed, so a
 * failure says its seed, step and operation, and replays.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/composer/${name}.abc`, import.meta.url), "utf8");
const SCORES: Record<string, string> = {
  song: fixture("song"),
  trio: fixture("trio"),
  four: fixture("conformance/custom-four"),
  mixed: fixture("conformance/mixed"),
  meter: fixture("conformance/fuzz-meter"),
  moonlight: fixture("conformance/moonlight"),
};
const SEQUENCES = 40;
const STEPS = 15;
/** The long score (eight pages, four voices) runs fewer, so the check stays in seconds. */
const FEWER: Record<string, number> = { moonlight: 12 };

function rng(seed: number) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

type Range = { from: number; to: number };
/** Each voice's bars, by number: how long each is and the meter's length there. */
function barLengths(text: string) {
  const file = indexFile(text);
  const tune = file.tunes[0];
  const out: {
    voice: string;
    index: number;
    have: number;
    want: number;
    at: number;
    end: number;
  }[] = [];
  if (!tune) return out;
  const open = new Map<
    string,
    { index: number; have: number; want: number; any: boolean; at: number; end: number }
  >();
  for (const item of tuneItems(text, tune, file)) {
    const bar = open.get(item.voice) ?? {
      index: 0,
      have: 0,
      want: 0,
      any: false,
      at: 0,
      end: 0,
    };
    open.set(item.voice, bar);
    if (item.type === "bar") {
      if (bar.any) {
        out.push({ voice: item.voice, ...bar });
        open.set(item.voice, {
          index: bar.index + 1,
          have: 0,
          want: 0,
          any: false,
          at: 0,
          end: 0,
        });
      }
      continue;
    }
    if (!bar.any) {
      const length = meterLength(item.meter);
      bar.want = length ? length.num / length.den : 0;
      bar.at = item.from;
    }
    bar.any = true;
    bar.end = item.to;
    bar.have += item.duration.num / item.duration.den;
  }
  for (const [voice, bar] of open) if (bar.any) out.push({ voice, ...bar });
  return out;
}
/**
 * Bars an edit left wrong that weren't (as Codex's fuzzer judged them): a bar of the wrong
 * length (a short first bar, a pickup, aside) whose bar of the same number before was right, or
 * less wrong; and voices whose lengths were equal, no longer so.
 */
function newlyWrong(before: string, after: string, set: ChangeSet): string[] {
  const was = barLengths(before);
  const now = barLengths(after);
  // Each bar after the edit matched with the bar before it whose first note it is (whole bars
  // cut renumber the rest), else the bar of the same number.
  // (A cut's edit is one change from its first difference to its last, verses included: a bar
  // is matched by what is written in it, before the bar of the same number.)
  const textOf = (source: string, bar: { at: number; end: number }) =>
    source.slice(bar.at, bar.end);
  const unused = [...was];
  void set;
  const out: string[] = [];
  for (const bar of now) {
    const off = Math.abs(bar.have - bar.want);
    if (!bar.want || off < 1e-6 || (bar.index === 0 && bar.have < bar.want)) continue;
    const same = unused.findIndex(
      (each) => each.voice === bar.voice && textOf(before, each) === textOf(after, bar),
    );
    const prior =
      same >= 0
        ? (unused.splice(same, 1)[0] as (typeof was)[number])
        : was.find((each) => each.voice === bar.voice && each.index === bar.index);
    if (
      prior &&
      (Math.abs(prior.have - bar.have) < 1e-6 || Math.abs(prior.have - prior.want) >= off - 1e-6)
    )
      continue;
    out.push(`V:${bar.voice} bar ${bar.index + 1}: ${bar.have} of ${bar.want}`);
  }
  const totals = (list: typeof was) => {
    const byVoice = new Map<string, number>();
    for (const bar of list) byVoice.set(bar.voice, (byVoice.get(bar.voice) ?? 0) + bar.have);
    return [...byVoice.values()].map((each) => each.toFixed(6));
  };
  const tb = totals(was);
  const ta = totals(now);
  if (tb.length > 1 && new Set(tb).size === 1 && new Set(ta).size > 1)
    out.push(`voices out of step: ${ta.join(", ")}`);
  return out;
}
function hairpinsPaired(text: string): boolean {
  const file = indexFile(text);
  const opens = new Map<string, number>();
  for (const { token, voice } of tuneTokens(text, file, file.tunes[0]?.bodyFrom ?? 0)) {
    if (token.kind !== "decoration") continue;
    if (/^!(<|>)\(!$/.test(token.text)) opens.set(voice, (opens.get(voice) ?? 0) + 1);
    if (/^!(<|>)\)!$/.test(token.text)) opens.set(voice, (opens.get(voice) ?? 0) - 1);
    if ((opens.get(voice) ?? 0) < 0 || (opens.get(voice) ?? 0) > 1) return false;
  }
  return [...opens.values()].every((each) => each === 0);
}

type Step = { kind: string; ranges: Range[]; changes: Change[]; keepsTime: boolean };

/** One random operation on a text: its changes (empty when refused or nothing to do). */
function operation(text: string, random: () => number, clip: { text: string }): Step {
  const file = indexFile(text);
  const notes = selectedNotes(
    text,
    [{ from: file.tunes[0]?.bodyFrom ?? 0, to: text.length }],
    file,
  ).filter((each) => each.whole);
  const kinds = [
    "delete",
    "cut",
    "copy",
    "paste",
    "pastecaret",
    "duplicate",
    "typing",
    "transpose",
    "half",
    "double",
    "decoration",
    "mark",
  ];
  const kind = kinds[Math.floor(random() * kinds.length)] as string;
  const none: Step = { kind, ranges: [], changes: [], keepsTime: true };
  if (!notes.length) return none;
  const first = notes[Math.floor(random() * notes.length)] as (typeof notes)[number];
  // A run of one to five notes in the same voice, or (one time in five) a note in another too.
  const same = notes.filter((each) => each.event.voice === first.event.voice);
  const k = same.indexOf(first);
  const last = same[Math.min(same.length - 1, k + Math.floor(random() * 5))] ?? first;
  const ranges: Range[] = [{ from: first.span.from, to: last.span.to }];
  if (random() < 0.2) {
    const other = notes.find((each) => each.event.voice !== first.event.voice);
    if (other) ranges.push({ from: other.span.from, to: other.span.to });
  }
  const step = (changes: Change[], keepsTime = true): Step => ({
    kind,
    ranges,
    changes,
    keepsTime,
  });
  switch (kind) {
    case "delete":
    case "cut": {
      const parts = musicParts(text, ranges, file);
      const plan = cutPlan(text, parts, file);
      if (!plan || "refused" in plan) return step([]);
      if (kind === "cut") clip.text = plan.clip;
      return step(plan.changes);
    }
    case "copy":
      clip.text = copyText(text, ranges[0] as Range, file);
      return step([]);
    case "paste": {
      if (!clip.text.trim()) return step([]);
      const plan = planPaste(
        text,
        ranges,
        0,
        clip.text,
        sourceAt(text, file, (ranges[0] as Range).from),
        file,
      );
      if (!plan || "refused" in plan) return step([]);
      return step(plan.changes);
    }
    case "pastecaret": {
      const at = first.span.from;
      const plan = planPaste(
        text,
        [{ from: at, to: at }],
        0,
        random() < 0.5 ? "A2 B2 |" : "(3cde f2",
        null,
        file,
      );
      if (!plan || "refused" in plan)
        return { kind, ranges: [{ from: at, to: at }], changes: [], keepsTime: false };
      return { kind, ranges: [{ from: at, to: at }], changes: plan.changes, keepsTime: false };
    }
    case "duplicate": {
      const plan = duplicate(text, ranges, file);
      return step("refused" in plan ? [] : plan.changes, false);
    }
    case "typing": {
      if (!inOneVoice(text, ranges, file)) return step([], false);
      const typed = random() < 0.5 ? "A" : "B2 c2";
      const pitched = repitch(text, ranges, typed, file);
      if (pitched) return step(pitched.changes, false);
      const changes = replaceKeepingBars(text, ranges, typed, file);
      return step(changes && !("refused" in changes) ? changes : [], false);
    }
    case "transpose":
      return step(transpose(text, ranges, random() < 0.5 ? 1 : -1, file));
    case "half":
    case "double": {
      const factor = kind === "half" ? 0.5 : 2;
      const changes = scaleLengths(
        text,
        lengthPartners(text, ranges, file),
        frac(factor * 2, 2),
        file,
      );
      if (!changes.length) return step([]);
      const plan = lengthsInStep(text, file, changes, factor, kind);
      return step(plan && !("refused" in plan) ? plan.changes : plan ? [] : changes, Boolean(plan));
    }
    case "decoration": {
      const mark = ["accent", "fermata", "mf", "crescendo"][Math.floor(random() * 4)] as string;
      const plan = placeMark(text, ranges, mark, file);
      return step("refused" in plan ? [] : plan.changes);
    }
    case "mark": {
      const result = markSelection(text, ranges, random() < 0.5 ? "." : "~", file);
      return step(result ? result.changes : []);
    }
  }
  return none;
}

describe(`the seeded fuzz check: up to ${SEQUENCES} sequences of ${STEPS} steps on each of ${Object.keys(SCORES).length} scores`, () => {
  for (const [name, score] of Object.entries(SCORES))
    it(name, () => {
      for (let sequence = 0; sequence < (FEWER[name] ?? SEQUENCES); sequence++) {
        const seed = 0x9e3779b9 ^ (sequence * 7919 + name.length * 104729);
        const random = rng(seed);
        const clip = { text: "" };
        let text = score;
        const undo: { set: ChangeSet; before: string }[] = [];
        for (let at = 0; at < STEPS; at++) {
          const step = operation(text, random, clip);
          if (!step.changes.length) continue;
          const where = `${name}, seed ${seed}, step ${at}: ${step.kind} ${JSON.stringify(step.ranges.map((range) => text.slice(range.from, range.to)))}`;
          const doc = Text.of(text.split("\n"));
          let set: ChangeSet;
          try {
            set = ChangeSet.of(step.changes, doc.length);
          } catch (error) {
            throw new Error(`${where}: changes overlap or run out of the text (${error})`);
          }
          const after = set.apply(doc).toString();
          expect(
            set
              .invert(doc)
              .apply(Text.of(after.split("\n")))
              .toString(),
            `${where}: undo`,
          ).toBe(text);
          if (step.keepsTime)
            expect(newlyWrong(text, after, set), `${where}\n${after}`).toEqual([]);
          if (hairpinsPaired(text))
            expect(hairpinsPaired(after), `${where}: hairpins\n${after}`).toBe(true);
          expect(after, `${where}: a slur on a rest alone`).not.toMatch(/\([zx]\d*\)/);
          undo.push({ set, before: text });
          text = after;
        }
        // Every step undone, in turn: the score as it was.
        for (const { set, before } of [...undo].reverse())
          text = set
            .invert(Text.of(before.split("\n")))
            .apply(Text.of(text.split("\n")))
            .toString();
        expect(text, `${name}, seed ${seed}: all undone`).toBe(score);
      }
    });
});
