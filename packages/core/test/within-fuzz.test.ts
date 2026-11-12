/**
 * Who and How on words selected, over stories and selections made at random (a fixed seed): the
 * words heard and the book never change, the story keeps its shape, the words selected are said
 * as asked (by the voice asked for, each in the way it was said; or in the way asked for), and
 * words well away from the selection are said as before.
 */
import { describe, expect, it } from "vitest";
import { heardPlaces } from "../src/edit";
import { applyChanges, bookText, parse, setDirectionWithin, setSpeakerWithin } from "../src/index";

/** A small fast random number generator, the same numbers for the same seed. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const front = "---\ncast:\n  Ann:\n  Bob:\n---\n";

function story(next: () => number): string {
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)] as T;
  const word = () => pick(["ab", "cd", "ef", "gh", "ij", "kl", "mn", "op"]);
  const words = (n: number) => Array.from({ length: n }, word).join(" ");
  const piece = () =>
    pick([
      () => words(1 + Math.floor(next() * 3)),
      () => `@${pick(["Ann", "Bob"])} ${words(2)}`,
      () => `@${pick(["Ann", "Bob"])} (${pick(["softly", "sadly"])}) ${words(2)}`,
      () => `@(${pick(["softly", "loudly"])}) ${words(2)}`,
      () => `@/ ${words(2)}`,
      () => `“${words(2)},” ${words(1)} said.`,
      () => `*${words(2)}* ${words(1)}`,
    ])();
  const blocks: string[] = [];
  for (let b = 0; b < 3 + Math.floor(next() * 4); b++) {
    if (next() < 0.25) blocks.push(`## ${words(2)}`);
    else
      blocks.push(
        Array.from({ length: 1 + Math.floor(next() * 2) }, () =>
          Array.from({ length: 2 + Math.floor(next() * 3) }, piece).join(" "),
        ).join("\n"),
      );
  }
  return `${front}${blocks.join("\n\n")}\n`;
}

const shape = (source: string) =>
  parse(source)
    .blocks.map((block) => (block.kind === "heading" ? `h${block.level}` : block.kind))
    .join(" ");

describe("Who and How on words selected at random", () => {
  it("keep the words, the book and the shape, and change the words selected alone", () => {
    const next = random(20261112);
    let made = 0;
    for (let round = 0; round < 400; round++) {
      const source = story(next);
      const body = front.length;
      const a = body + Math.floor(next() * (source.length - body));
      const b = Math.min(source.length, a + 1 + Math.floor(next() * 40));
      const before = parse(source);
      const who = next() < 0.5;
      const asked = who
        ? (["Ann", "Bob", "Narrator"][Math.floor(next() * 3)] as string)
        : ([null, "softly", "warmly"][Math.floor(next() * 3)] ?? null);
      const changes = who
        ? setSpeakerWithin(before, a, b, asked as string)
        : setDirectionWithin(before, a, b, asked);
      if (changes.length === 0) continue;
      made++;
      const text = applyChanges(source, changes);
      const after = parse(text);
      const what = `${who ? "Who" : "How"} ${String(asked)} on ${JSON.stringify(source.slice(a, b))} in ${JSON.stringify(source.slice(body))}\n→ ${JSON.stringify(text.slice(body))}`;
      expect(bookText(after), what).toBe(bookText(before));
      expect(shape(text), what).toBe(shape(source));
      const was = heardPlaces(before);
      const now = heardPlaces(after);
      expect(now.map((char) => char.char).join(""), what).toBe(
        was.map((char) => char.char).join(""),
      );
      const lineOf = (at: number) => source.slice(0, at).split("\n").length;
      for (const [i, then] of was.entries()) {
        const char = now[i] as (typeof now)[number];
        if (/[\s\p{P}]/u.test(then.char)) continue;
        if (then.at >= a && then.at < b) {
          // Selected: as asked.
          if (who) {
            expect(char.speaker.toLowerCase(), what).toBe((asked as string).toLowerCase());
            expect(char.direction, what).toBe(then.direction);
          } else if (asked !== null) expect(char.direction, what).toBe(asked);
        } else if (
          lineOf(then.at) !== lineOf(a) &&
          lineOf(then.at) !== lineOf(Math.max(a, b - 1)) &&
          (then.at < a || then.at >= b)
        ) {
          // Well away from it: as before.
          expect([char.speaker, char.direction], what).toEqual([then.speaker, then.direction]);
        }
      }
    }
    // Most made a change: the test tries what writers do, not only what is refused.
    expect(made).toBeGreaterThan(100);
  });
});
