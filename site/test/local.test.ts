import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Speech,
  type Story,
  applyChanges,
  parse,
  setDirection,
  setDirectionWithin,
  setSpeaker,
  setSpeakerWithin,
} from "voxdown";
import { paragraphScope } from "../src/writer/local";
import { nextNarratedQuote } from "../src/writer/stretch";

const speechAt = (story: Story, at: number): Speech | undefined =>
  story.blocks
    .flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
    .flatMap((line) => line.items)
    .find(
      (item): item is Speech =>
        item.kind === "speech" && item.range.from <= at && at < item.range.to,
    );

const STORY = `---
title: The Owl
cast:
  Ann:
---

# One

The night was still.

“Who’s there?” said Bob, at the door.

@Ann “Me.”
`;

describe("an edit in a long book's paragraph alone", () => {
  it("makes the same changes as reading the whole story", () => {
    const at = STORY.indexOf("Who’s");
    const scope = paragraphScope(STORY, at);
    if (!scope) throw new Error("no scope");
    const local = scope.back(
      setSpeaker(scope.story, speechAt(scope.story, scope.at(at)) as Speech, "Bob"),
    );
    const whole = parse(STORY);
    const everywhere = setSpeaker(whole, speechAt(whole, at) as Speech, "Bob");
    expect(applyChanges(STORY, local)).toBe(applyChanges(STORY, everywhere));
    expect(applyChanges(STORY, local)).toContain("@Bob “Who’s there?” said Bob");
    // A direction too, and the cast, in the front matter, where it is.
    const ann = STORY.indexOf("Me.");
    const there = paragraphScope(STORY, ann);
    if (!there) throw new Error("no scope");
    const how = there.back(
      setDirection(there.story, speechAt(there.story, there.at(ann)) as Speech, "softly"),
    );
    expect(applyChanges(STORY, how)).toContain("@Ann (softly) “Me.”");
    expect(there.toDoc(there.at(ann))).toBe(ann);
  });

  it("reads a place before its paragraph as outside it, the paragraph before however short", () => {
    // Shorter than the front matter: mapped on, it fell inside the scope's own front matter, and
    // a selection over both paragraphs was taken as the second alone.
    const source =
      "---\ntitle: A story with a long title\nauthor: Someone\n---\n\nShort.\n\nTwo here.\n";
    const scope = paragraphScope(source, source.indexOf("Two"));
    if (!scope) throw new Error("no scope");
    expect(scope.at(source.indexOf("Short"))).toBeLessThan(0);
    expect(scope.toDoc(scope.at(source.indexOf("Two")))).toBe(source.indexOf("Two"));
    const both = paragraphScope(source, source.indexOf("Short"), source.indexOf("here"));
    expect(both?.at(source.indexOf("Short"))).toBeGreaterThanOrEqual(0);
    expect(both?.story.source).toContain("Short.\n\nTwo here.");
  });

  it("isn't taken where the paragraph doesn't stand alone", () => {
    const grouped = "::: @Ann\n“One.”\n\n“Two.”\n:::\n";
    expect(paragraphScope(grouped, grouped.indexOf("Two"))).toBeUndefined();
    const noted = "%% A note\n\nover paragraphs %%\n\n“Hi.”\n";
    expect(paragraphScope(noted, noted.indexOf("over"))).toBeUndefined();
    const running = "“A speech over\n\n“two paragraphs.”\n";
    expect(paragraphScope(running, running.indexOf("two"))).toBeUndefined();
    expect(paragraphScope(running, running.indexOf("speech"))).toBeUndefined();
    expect(paragraphScope(STORY, 3)).toBeUndefined();
  });
});

describe("the paragraph shortcut, against the whole story", () => {
  // The repository's root, whether the tests run from it or from the site's folder.
  const root = existsSync(join(process.cwd(), "corpus"))
    ? process.cwd()
    : join(process.cwd(), "..");
  const books = ["corpus", "examples"].flatMap((folder) =>
    readdirSync(join(root, folder))
      .filter((name) => name.endsWith(".vxd"))
      .map((name) => ({
        name,
        source: readFileSync(join(root, folder, name), "utf8").replace(/\r\n/g, "\n"),
      })),
  );
  const edit = (story: Story, at: number, how: "speaker" | "direction") => {
    const speech = speechAt(story, at);
    if (!speech) return "none";
    try {
      return how === "speaker"
        ? setSpeaker(story, speech, "Tester")
        : setDirection(story, speech, "softly");
    } catch (error) {
      return `refused: ${(error as Error).message}`;
    }
  };

  it.each(books)(
    "gives what the whole story gives, in $name",
    ({ source }) => {
      const whole = parse(source);
      const differ: string[] = [];
      let taken = 0;
      for (const block of whole.blocks) {
        if (block.kind !== "paragraph") continue;
        for (const line of block.lines)
          for (const item of line.items) {
            if (item.kind !== "speech" || !/[\p{L}\p{N}]/u.test(item.text)) continue;
            const at = item.textRange.from;
            const scope = paragraphScope(source, at);
            if (!scope) continue;
            taken++;
            for (const how of ["speaker", "direction"] as const) {
              const local = edit(scope.story, scope.at(at), how);
              const everywhere = edit(whole, at, how);
              const a = typeof local === "string" ? local : applyChanges(source, scope.back(local));
              const b =
                typeof everywhere === "string" ? everywhere : applyChanges(source, everywhere);
              if (a !== b) differ.push(`${how} at line ${source.slice(0, at).split("\n").length}`);
            }
          }
      }
      expect(differ).toEqual([]);
      expect(taken).toBeGreaterThan(0);
      // Every passage of a book, edited twice each way: more time than a test usually needs.
    },
    60_000,
  );

  it.each(books)(
    "gives words selected over one to three paragraphs as the whole story does, in $name",
    ({ source }) => {
      const whole = parse(source);
      // Seeded, so a failure comes back the same.
      let seed = 7;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const paragraphs = whole.blocks.filter((block) => block.kind === "paragraph");
      const run = (story: Story, from: number, to: number, how: "speaker" | "direction") => {
        try {
          return how === "speaker"
            ? setSpeakerWithin(story, from, to, "Tester")
            : setDirectionWithin(story, from, to, "softly");
        } catch (error) {
          return `refused: ${(error as Error).message}`;
        }
      };
      const differ: string[] = [];
      let taken = 0;
      for (let round = 0; round < 25 && paragraphs.length > 0; round++) {
        const first = Math.floor(random() * paragraphs.length);
        const last = Math.min(paragraphs.length - 1, first + Math.floor(random() * 3));
        const start = paragraphs[first]?.range.from ?? 0;
        const end = paragraphs[last]?.range.to ?? 0;
        const from = start + Math.floor(random() * Math.max(1, (end - start) / 2));
        const to = Math.max(from + 1, end - Math.floor(random() * Math.max(1, (end - from) / 2)));
        // As the Writer reads them in a long book: the paragraphs the selection runs over.
        const scope = paragraphScope(source, from, to);
        if (!scope || scope.at(from) < 0) continue;
        taken++;
        for (const how of ["speaker", "direction"] as const) {
          const local = run(scope.story, scope.at(from), scope.at(to), how);
          const everywhere = run(whole, from, to, how);
          const a = typeof local === "string" ? local : applyChanges(source, scope.back(local));
          const b = typeof everywhere === "string" ? everywhere : applyChanges(source, everywhere);
          if (a !== b) differ.push(`${how} ${from}-${to}`);
        }
      }
      expect(differ).toEqual([]);
      if (paragraphs.length > 3) expect(taken).toBeGreaterThan(0);
    },
    60_000,
  );

  it("isn't taken in a speech over paragraphs in single quotes, or carried past a page turn", () => {
    const single =
      "@Ann ‘When I started, it was gas.\n\n‘Then they put in the electric, and I don’t hold with it.’\n\nThe end.\n";
    expect(paragraphScope(single, single.indexOf("Then"))).toBeUndefined();
    expect(paragraphScope(single, single.indexOf("When"))).toBeUndefined();
    expect(paragraphScope(single, single.indexOf("The end"))).toBeDefined();
    const paged = "@Holmes “Once upon a time.\n\n{page}\n\n“He believed he was the king.”\n";
    expect(paragraphScope(paged, paged.indexOf("He believed"))).toBeUndefined();
  });
});

describe("the next quote that wants a speaker", () => {
  it("is also one carried on from the speech before it whose tag names someone else", () => {
    const story = parse("@Ann “Hi,” said Ann. “Bye,” said Bob.\n\n@Ann “Yes,” she said. “Fine.”\n");
    const next = nextNarratedQuote(story, -1);
    expect(next?.text).toBe("Bye,");
    expect(next?.carried).toEqual({ speaker: "Ann", tag: "Bob" });
    // A quote carried on with no tag naming anyone else is left as it is.
    expect(nextNarratedQuote(story, next?.from ?? 0)?.text).toBe("Bye,");
  });
});
