import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkBars } from "../src/composer/barcheck";
import { copyText } from "../src/composer/barwise";
import type { Change } from "../src/composer/commands";
import { checkLyrics } from "../src/composer/lyriccheck";
import { planPaste, sourceAt } from "../src/composer/paste";
import { selectedNotes } from "../src/composer/selected";
import { indexFile } from "../src/composer/tunes";
import { tuneItems } from "../src/composer/walk";

/*
 * Pasting over a note (round 7, finding 1): one to three bars copied from each voice, pasted over
 * every note of a trio, a piano piece and a song. Afterwards (or refused, saying why) every voice
 * has as many bars as the others, every bar its length, and no verse off its notes that wasn't.
 */

const read = (name: string) =>
  readFileSync(new URL(`./fixtures/composer/${name}.abc`, import.meta.url), "utf8");
const apply = (text: string, changes: Change[]) =>
  [...changes]
    .sort((a, b) => b.from - a.from || b.to - a.to)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );
const issues = (text: string) => {
  const file = indexFile(text);
  return file.tunes.flatMap((tune) => checkBars(text, tune, file)).map((issue) => issue.message);
};
const lyricIssues = (text: string) => {
  const file = indexFile(text);
  return file.tunes.flatMap((tune) => checkLyrics(text, tune)).length;
};

/** Each voice's bars, as ranges of their notes, and each note's span. */
function barsOf(text: string) {
  const file = indexFile(text);
  const byVoice = new Map<string, { from: number; to: number }[][]>();
  for (const item of tuneItems(text, file.tunes[0] as never, file)) {
    const bars = byVoice.get(item.voice) ?? [[]];
    if (item.type === "bar") bars.push([]);
    else {
      const span = selectedNotes(text, [{ from: item.from, to: item.from + 1 }], file)[0]?.span;
      (bars[bars.length - 1] as { from: number; to: number }[]).push(span ?? item);
    }
    byVoice.set(item.voice, bars);
  }
  return [...byVoice.entries()].map(([voice, bars]) => ({
    voice,
    bars: bars.filter((bar) => bar.length),
  }));
}

/** A voice's events with their times (in whole notes) and text. */
function timesOf(text: string, voice: string) {
  const file = indexFile(text);
  let clock = 0;
  const out: { from: number; start: number; end: number; text: string }[] = [];
  for (const item of tuneItems(text, file.tunes[0] as never, file)) {
    if (item.type !== "event" || item.voice !== voice) continue;
    const end = clock + item.duration.num / item.duration.den;
    out.push({ from: item.from, start: clock, end, text: text.slice(item.from, item.to) });
    clock = end;
  }
  return out;
}
/** How long a copy lasts in a tune's meter and unit. */
function lengthOf(clip: string, text: string): number {
  const head = text.slice(0, text.indexOf("\nK:") + 1).replace(/^(V:|%%score).*\n/gm, "");
  const mini = `${head}K:C\n${clip}\n`;
  const file = indexFile(mini);
  return tuneItems(mini, file.tunes[0] as never, file)
    .filter((item) => item.type === "event")
    .reduce(
      (sum, item) => sum + (item.type === "event" ? item.duration.num / item.duration.den : 0),
      0,
    );
}

for (const name of ["trio", "piano", "song"]) {
  const text = read(name);
  const file = indexFile(text);
  const voices = barsOf(text);
  describe(`pasting 1–3 bars over every note: ${name}`, () => {
    expect(issues(text)).toEqual([]);
    for (const { voice, bars } of voices)
      for (const size of [1, 2, 3]) {
        // The copy: the voice's bars from its 2nd (as a musician copies a phrase).
        const from = (bars[1]?.[0] ?? bars[0]?.[0]) as { from: number };
        const to = (bars[size]?.at(-1) ?? bars.at(-1)?.at(-1)) as { to: number };
        const clip = copyText(text, { from: from.from, to: to.to }, file);
        const source = sourceAt(text, file, from.from);
        it(`V:${voice}, ${size} bar${size > 1 ? "s" : ""} (${JSON.stringify(clip)})`, () => {
          let pasted = 0;
          const others = voices.filter((each) => each.voice !== voice);
          const music = (doc: string, list: typeof voices) =>
            barsOf(doc)
              .filter((each) => list.some((other) => other.voice === each.voice))
              .map((each) =>
                each.bars.map((bar) => bar.map((n) => doc.slice(n.from, n.to)).join(" ")),
              );
          // Each note, and each two notes side by side in a bar (a mid-bar selection).
          for (const bar of bars)
            for (const [index, note] of bar.entries())
              for (const range of [
                note,
                ...(bar[index + 1]
                  ? [{ from: note.from, to: (bar[index + 1] as { to: number }).to }]
                  : []),
              ]) {
                const plan = planPaste(text, [range], 0, clip, source, file);
                if (!plan) continue;
                const at = `${name} V:${voice}, over ${JSON.stringify(text.slice(range.from, range.to))} at ${range.from}`;
                if ("refused" in plan) {
                  expect(plan.refused, at).toMatch(
                    /repeat|ending|end of the voice|tuplet|two lines/,
                  );
                  continue;
                }
                const after = apply(text, plan.changes);
                expect(issues(after), `${at}\n${plan.message}\n${after}`).toEqual([]);
                expect(lyricIssues(after), `${at}: verses\n${after}`).toBeLessThanOrEqual(
                  lyricIssues(text),
                );
                // Over notes, the other voices are as they were; the notice says when it ran on.
                if (!plan.message.includes("rests in"))
                  expect(music(after, others), `${at}: other voices\n${after}`).toEqual(
                    music(text, others),
                  );
                if (/from its first note/.test(plan.message) && others.length)
                  expect(plan.message).toMatch(/the other voices are as they were/);
                // Overwritten, every note after the copy's end (and the selection's) is as it
                // was, at the same time (round 8, item 4).
                if (/from its first note/.test(plan.message)) {
                  const before = timesOf(text, voice);
                  const afterTimes = timesOf(after, voice);
                  const start = before.find((each) => each.from >= range.from)?.start ?? 0;
                  const selEnd = Math.max(
                    ...before.filter((each) => each.from < range.to).map((each) => each.end),
                  );
                  const end = Math.max(start + lengthOf(clip, text), selEnd);
                  const later = (list: typeof before) =>
                    list
                      .filter((each) => each.start >= end - 1e-9)
                      .map((each) => `${each.start.toFixed(4)} ${each.text}`);
                  // (Less a note the copy only partly covered, now a rest and the rest of it.)
                  const tail = later(before).filter((line) => later(afterTimes).includes(line));
                  expect(
                    later(before).length - tail.length,
                    `${at}: a later note changed\n${after}`,
                  ).toBe(0);
                }
                pasted += 1;
              }
          expect(pasted).toBeGreaterThan(0);
        });
      }
  });
}

describe("ragged copies of voices, ending at different points (round 8, item 3)", () => {
  const clips = [
    "V:1\nc2 d2 e2 f2 | g4\nV:2\nC4 E4 | G,4 C4 |\n",
    "V:1\nc2 d2 e2 f2 | g4 a4 |\nV:2\nC4 E4 | G,4\n",
    "V:1\nc2 d2 e2 f2 | g4\n",
  ];
  for (const name of ["ragged", "trio"]) {
    const text = read(name);
    const file = indexFile(text);
    for (const clip of clips)
      it(`${name}: ${JSON.stringify(clip)} over every note`, () => {
        let pasted = 0;
        for (const { bars } of barsOf(text))
          for (const bar of bars)
            for (const note of bar) {
              const plan = planPaste(text, [note], 0, clip, null, file);
              if (!plan) continue;
              const at = `${name}, over ${JSON.stringify(text.slice(note.from, note.to))} at ${note.from}`;
              if ("refused" in plan) {
                expect(plan.refused, at).toMatch(/sounding across|repeat|end of the voice|tuplet/);
                continue;
              }
              const after = apply(text, plan.changes);
              expect(issues(after), `${at}\n${plan.message}\n${after}`).toEqual([]);
              pasted += 1;
            }
        expect(pasted).toBeGreaterThan(0);
      });
  }
});
