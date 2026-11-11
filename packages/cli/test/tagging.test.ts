import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Story, applyChanges, parse, quotesOf } from "voxdown";
import type { Ask, Backend } from "../src/ai";
import { CHEATSHEET } from "../src/cheatsheet";
import { scoreAgainst, tagStory, withoutSpeakers } from "../src/tag";
import {
  answerSchema,
  jsonIn,
  passagePrompt,
  passagesOf,
  readAnswer,
  shortName,
  speakersOf,
  tagGifts,
} from "../src/tagging";
import { root } from "./memory";

const books = readdirSync(join(root, "corpus"))
  .filter((name) => name.endsWith(".vxd"))
  .map((name) => ({ name, source: readFileSync(join(root, "corpus", name), "utf8") }));

describe("the cheat sheet a model reads", () => {
  it("is the spec's", () => {
    // If this fails, copy spec/CHEATSHEET.md into src/cheatsheet.ts again (backticks and ${
    // escaped).
    expect(CHEATSHEET).toBe(readFileSync(join(root, "spec", "CHEATSHEET.md"), "utf8"));
  });
});

const STORY = `---
title: The Owl
cast:
  Mara: Mara Stone
  Tom:
    name: Tom Hale
    about: A gruff ferryman.
---

# One

“Who’s there?” asked Tom.

“Only me,” said Mara. “Open up.”

# Two

@Tom “Go away.”

“Please,” she said.
`;

describe("passages to ask about", () => {
  it("number each quote that waits for a speaker, once, in its passage", () => {
    const story = parse(STORY);
    const passages = passagesOf(story, { words: 8 });
    const numbers = passages.flatMap((passage) => passage.numbers);
    expect(numbers).toEqual(
      quotesOf(story)
        .filter((quote) => quote.narrated)
        .map((q) => q.number),
    );
    expect(passages[0]?.text).toContain("⟦1⟧“Who’s there?” asked Tom.");
    expect(passages[0]?.heading).toBe("One");
    // The quote Tom already says is context, not asked about.
    expect(numbers).not.toContain(4);
    const last = passages.at(-1);
    expect(last?.heading).toBe("Two");
    expect(last?.before).toContain("Only me");
  });

  it("ask in words a model can follow, with the cast and the dialogue tags", () => {
    const story = parse(STORY);
    const [passage] = passagesOf(story);
    const prompt = passagePrompt(story, passage as NonNullable<typeof passage>);
    expect(prompt).toContain("“The Owl”");
    expect(prompt).toContain("- Tom (Tom Hale): A gruff ferryman.");
    expect(prompt).toContain("Quotes to attribute: ⟦1⟧ ⟦2⟧ ⟦3⟧ ⟦5⟧");
    expect(prompt).toContain("⟦1⟧ Tom, ⟦2⟧ Mara");
  });
});

describe("the answer's schema", () => {
  it("holds speakers to the cast, and suits strict structured output", () => {
    const schema = answerSchema(parse(STORY)) as {
      properties: { answers: { items: Record<string, unknown> } };
    };
    const item = schema.properties.answers.items as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(item.properties.speaker?.enum).toEqual(["Mara", "Tom", "Narrator", "new", "unknown"]);
    // Every property required, none other allowed: what strict modes ask.
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.additionalProperties).toBe(false);
  });
});

describe("a model's answer", () => {
  const story = parse(STORY);
  const passage = { ...(passagesOf(story)[0] as NonNullable<ReturnType<typeof passagesOf>[0]>) };

  it("is read from JSON, fenced or not, as gifts", () => {
    const answer = [
      "Here you are:",
      "```json",
      JSON.stringify({
        answers: [
          { quote: 1, cue: "tag", speaker: "Tom", newName: "", confidence: "high" },
          { quote: 2, cue: "tag", speaker: "Mara Stone", newName: "", confidence: "high" },
          { quote: 3, cue: "continues", speaker: "new", newName: "Old Nan", confidence: "low" },
          { quote: 5, cue: "?", speaker: "unknown", newName: "", confidence: "low" },
          { quote: 9, cue: "", speaker: "Tom", newName: "", confidence: "high" },
        ],
      }),
      "```",
    ].join("\n");
    const newcomers = new Map<string, string>();
    const reading = readAnswer(story, passage, answer, newcomers);
    expect(reading.gifts).toEqual([
      { quote: 1, speaker: "Tom", confidence: "high", cue: "tag" },
      { quote: 2, speaker: "Mara", confidence: "high", cue: "tag" },
      { quote: 3, speaker: "OldNan", fullName: "Old Nan", confidence: "low", cue: "continues" },
    ]);
    expect(reading.unknown).toEqual([5]);
    expect(reading.problems).toEqual(["quote 9 wasn't asked about"]);
    expect(newcomers.get("old nan")).toBe("OldNan");
  });

  it("that isn't JSON says so", () => {
    expect(readAnswer(story, passage, "I think Tom.").problems).toEqual([
      "the answer wasn't the JSON asked for",
    ]);
    expect(jsonIn('{"a": 1} trailing')).toEqual({ a: 1 });
  });

  it("names someone new with one word", () => {
    expect(shortName("Old Tom")).toBe("OldTom");
    expect(shortName("the Queen")).toBe("Queen");
    expect(shortName("Mrs. Rabbit")).toBe("Rabbit");
    expect(shortName("Zoë")).toBe("Zoë");
  });
});

describe("dialogue tags alone", () => {
  it("give quotes to the cast members their tags name", () => {
    const story = parse(STORY);
    expect(tagGifts(story)).toEqual([
      { quote: 1, speaker: "Tom" },
      { quote: 2, speaker: "Mara" },
    ]);
  });
});

/**
 * An AI that knows the answers: the book's own marks. With it, tagging a book whose marks were
 * taken out must put every one back, passage after passage.
 */
function knowing(marked: Story, options: { confidence?: string; failAfter?: number } = {}) {
  const truth = quotesOf(marked);
  const asked: Ask[] = [];
  const backend: Backend = {
    id: "oracle",
    label: "An oracle",
    kind: "local",
    async ask(ask) {
      asked.push(ask);
      if (options.failAfter !== undefined && asked.length > options.failAfter)
        throw new Error("The oracle is tired");
      const numbers = [
        ...(/Quotes to attribute: (.*)/.exec(ask.prompt)?.[1] ?? "").matchAll(/⟦(\d+)⟧/g),
      ].map((match) => Number(match[1]));
      const names = (
        ask.schema as {
          properties: { answers: { items: { properties: { speaker: { enum: string[] } } } } };
        }
      ).properties.answers.items.properties.speaker.enum;
      return JSON.stringify({
        answers: numbers.map((number) => {
          const speaker = truth[number - 1]?.speaker ?? "unknown";
          const known = names.find((name) => name.toLowerCase() === speaker.toLowerCase());
          return {
            quote: number,
            cue: "known",
            speaker: known ?? "new",
            newName: known ? "" : speaker,
            confidence: options.confidence ?? "high",
          };
        }),
      });
    },
  };
  return { backend, asked };
}

describe("tagging a book", () => {
  it.each(books)("puts back every speaker $name had", async ({ source }) => {
    const marked = parse(source);
    const bare = parse(withoutSpeakers(marked));
    const { backend, asked } = knowing(marked);
    const tagged = await tagStory(bare, { backend, words: 800 });
    const score = scoreAgainst(marked, parse(tagged.source), bare);
    expect(score.wrong).toEqual([]);
    expect(tagged.stopped).toBeUndefined();
    // Each passage asked once, and later ones see the speakers given before them.
    expect(asked.length).toBe(tagged.asked);
    if (asked.length > 1) expect(asked[1]?.prompt).toMatch(/@\p{L}/u);
  });

  it("holds back speakers less sure than asked for, and gives them when asked to", async () => {
    const marked = parse(books[0]?.source ?? "");
    const bare = parse(withoutSpeakers(marked));
    const unsure = await tagStory(bare, {
      backend: knowing(marked, { confidence: "low" }).backend,
    });
    expect(unsure.source).toBe(bare.source);
    expect(unsure.proposals.every((proposal) => proposal.outcome === "held")).toBe(true);
    const all = await tagStory(bare, {
      backend: knowing(marked, { confidence: "low" }).backend,
      minimum: "low",
    });
    expect(scoreAgainst(marked, parse(all.source), bare).wrong).toEqual([]);
  });

  it("stops at a failure, keeping what was given before it", async () => {
    const marked = parse(books.find((book) => book.name.startsWith("alice"))?.source ?? "");
    const bare = parse(withoutSpeakers(marked));
    const tagged = await tagStory(bare, {
      backend: knowing(marked, { failAfter: 1 }).backend,
      words: 400,
    });
    expect(tagged.stopped).toBe("The oracle is tired");
    expect(tagged.proposals.length).toBeGreaterThan(0);
    expect(tagged.source).not.toBe(bare.source);
    // Words untouched all the same.
    expect(parse(tagged.source).blocks.length).toBe(bare.blocks.length);
  });

  it("asks again, once, when an answer can't be read", async () => {
    const story = parse(STORY);
    let calls = 0;
    const backend: Backend = {
      id: "flaky",
      label: "Flaky",
      kind: "local",
      async ask(ask) {
        calls++;
        if (calls === 1) return "Sorry, here is prose.";
        expect(ask.prompt).toContain("couldn't be used");
        return JSON.stringify({
          answers: [{ quote: 1, cue: "tag", speaker: "Tom", newName: "", confidence: "high" }],
        });
      },
    };
    const tagged = await tagStory(story, { backend });
    expect(calls).toBe(2);
    expect(applyChanges(story.source, []) !== tagged.source).toBe(true);
    expect(tagged.source).toContain("@Tom “Who’s there?” asked Tom.");
    expect(tagged.unknown).toEqual([2, 3, 5]);
  });

  it("with dialogue tags alone, needs no AI", async () => {
    const tagged = await tagStory(parse(STORY), { backend: "tags" });
    expect(tagged.source).toContain("@Tom “Who’s there?” asked Tom.");
    expect(tagged.source).toContain("@Mara “Only me,” said Mara. “Open up.”");
    expect(speakersOf(parse(tagged.source)).map((member) => member.name)).toEqual(["Mara", "Tom"]);
  });
});
