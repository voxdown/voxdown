import { describe, expect, it } from "vitest";
import { type Speech, type Story, applyChanges, parse, setDirection, setSpeaker } from "voxdown";
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
