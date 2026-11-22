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
                pasted += 1;
              }
          expect(pasted).toBeGreaterThan(0);
        });
      }
  });
}
