import { describe, expect, it } from "vitest";
import {
  addedMarks,
  applyChanges,
  chosenChanges,
  directingPassages,
  directingPrompt,
  directingRequest,
  parse,
  readDirected,
  whyNot,
} from "../src/index";

const STORY = `---
title: The Owl
cast:
  Mara: Mara Stone, a fisherwoman
---

# One

Night fell over the harbour. Somewhere a door slammed.

@Mara “Who’s there?” she whispered. “I never asked you to come.”

@Tom “Only me.”

# Two

The owl said nothing at all.
`;

const story = parse(STORY);

describe("directing a reading", () => {
  it("cuts the story into passages, the words as written, with what came before", () => {
    const passages = directingPassages(story, { words: 5 });
    expect(passages.map((passage) => passage.heading)).toEqual(["One", "One", "One", "Two"]);
    expect(passages[0]?.text).toBe("Night fell over the harbour. Somewhere a door slammed.");
    expect(passages[1]?.before).toContain("Night fell");
    expect(passages[3]?.line).toBe(17);
    const prompt = directingPrompt(story, passages[0] as (typeof passages)[0]);
    expect(prompt).toContain("- Mara (Mara Stone");
    expect(prompt).toContain("Night fell over the harbour.");
    expect(directingRequest(story)).toContain("Answer with only the passage");
  });

  it("finds the marks added, and only marks", () => {
    expect(addedMarks("@Mara “Hi.”", "@Mara (softly) “Hi.”")).toEqual([
      { at: 6, text: "(softly) " },
    ]);
    // Straight quotes for curly, three dots for an ellipsis: the writer's own stay.
    expect(addedMarks("“Wait…” he said.", '"Wait..." he said. {pause}')).toEqual([
      { at: 16, text: " {pause}" },
    ]);
    // A word added, a comma added, a word taken out: not marks.
    expect(addedMarks("I never said that.", "I really never said that.")).toBeUndefined();
    expect(addedMarks("I never said that.", "I never, said that.")).toBeUndefined();
    expect(addedMarks("I never said that.", "I said that.")).toBeUndefined();
    // A mark just before a space stays before it; a space left out stays in.
    expect(addedMarks("I never asked.", "I *never* asked.")).toEqual([
      { at: 2, text: "*" },
      { at: 7, text: "*" },
    ]);
    expect(addedMarks("Stop. Now.", "Stop.{pause}Now.")).toEqual([{ at: 5, text: "{pause}" }]);
    // A mark on a line of its own would move the words after it.
    expect(addedMarks("a b", "a\n{pause}\nb")).toBeUndefined();
  });

  it("refuses marks that would change who speaks, the printed words or the writer's marks", () => {
    expect(whyNot("“Hi.” said Tom.", "@Tom “Hi.” said Tom.")).toBe("it would change who says what");
    expect(whyNot("He left (quietly).", "He left (quietly) (slowly).")).toBe(
      "it would change the printed words",
    );
    expect(whyNot("@Mara (softly) “Hi.”", "@Mara (softly) “Hi.”")).toBeUndefined();
    expect(whyNot("@Mara “Hi.” {page}", "@Mara “Hi.” {pause}")).toBe(
      "it would change a mark you wrote",
    );
    expect(whyNot("@Mara “I *never* did.”", "@Mara (softly) “I *never* did.”")).toBeUndefined();
  });

  it("reads an answer as suggestions, each one change to take or leave", () => {
    const answer = `Here you are:

\`\`\`
Night fell over the harbour. {pause} Somewhere a door slammed. [door slams]

@Mara (softly) "Who's there?" she whispered. "I *never* asked you to come."

@Tom “Only me!”
\`\`\``;
    const read = readDirected(story, answer);
    expect(read.suggestions.map((suggestion) => [suggestion.kind, suggestion.label])).toEqual([
      ["pause", "{pause}"],
      ["sound", "[door slams]"],
      ["direction", "(softly)"],
      ["stress", "*never*"],
    ]);
    // Tom's line came back with other punctuation: left as it is, and said.
    expect(read.refused).toEqual([
      { line: 13, words: "@Tom “Only me.”", why: "its words weren’t given back as written" },
    ]);
    expect(read.missing).toBe(1);
    const stress = read.suggestions[3];
    expect(stress?.changes.length).toBe(2);
    expect(stress?.preview.text).toContain("“I *never* asked");
    const { changes, dropped } = chosenChanges(story, read.suggestions);
    expect(dropped).toBe(0);
    const marked = applyChanges(STORY, changes);
    expect(marked).toContain(
      "Night fell over the harbour. {pause} Somewhere a door slammed. [door slams]",
    );
    expect(marked).toContain(
      "@Mara (softly) “Who’s there?” she whispered. “I *never* asked you to come.”",
    );
    // Only some chosen: the rest stay out.
    const some = chosenChanges(story, read.suggestions.slice(2, 3));
    expect(applyChanges(STORY, some.changes)).toContain("@Mara (softly) “Who’s there?”");
    expect(applyChanges(STORY, some.changes)).not.toContain("{pause}");
  });

  it("reads JSON answers, and keeps a suggestion's id while the story changes elsewhere", () => {
    const answer = JSON.stringify({ text: "@Tom (flatly) “Only me.”" });
    const first = readDirected(story, answer);
    expect(first.suggestions.map((suggestion) => suggestion.label)).toEqual(["(flatly)"]);
    const edited = parse(STORY.replace("Night fell", "Dark fell"));
    const again = readDirected(edited, answer);
    expect(again.suggestions[0]?.id).toBe(first.suggestions[0]?.id);
    // "Dark" is a letter shorter than "Night".
    expect(again.suggestions[0]?.changes[0]?.from).toBe(
      (first.suggestions[0]?.changes[0]?.from ?? 0) - 1,
    );
  });

  it("reads only the reach asked about", () => {
    const two = STORY.indexOf("# Two");
    const answer = "Night fell over the harbour. {pause} Somewhere a door slammed.";
    expect(readDirected(story, answer, { from: two }).suggestions).toEqual([]);
    expect(readDirected(story, answer, { to: two }).suggestions.length).toBe(1);
  });

  it("lists a paragraph whose words were changed, and reads a group's paragraphs", () => {
    const story = parse(
      "# One\n\nSir Percival stopped.\n\n@Gerald “Could you not?”\n\n::: whispering\nHe crept.\nClank.\n:::\n\nThe end.\n",
    );
    const changed = readDirected(
      story,
      "Sir Percival stopped dead.\n\n@Gerald (sleepily) “Could you not?”\n\n::: whispering\nHe crept.\nClank.\n:::\n\nThe end.",
    );
    expect(changed.refused).toEqual([
      expect.objectContaining({ line: 3, why: "its words weren’t given back as written" }),
    ]);
    expect(changed.missing).toBe(0);
    expect(changed.missed).toEqual([]);
    // A paragraph of marks alone ({page}, a sound) is never missed.
    const paged = parse("Night fell.\n\n{page}\n\n[door slams]\n\nMorning.\n");
    const back = readDirected(paged, "Night *fell*.\n\n{page}\n\nMorning.");
    expect([back.missing, back.missed, back.suggestions.length]).toEqual([0, [], 1]);
    // A paragraph not given back at all: said by its line and words.
    const short = readDirected(story, "Sir Percival stopped.\n\nThe beginning.");
    expect(short.missed.map((each) => [each.line, each.words])).toEqual([
      [5, "@Gerald “Could you not?”"],
      [8, "He crept. Clank."],
      [12, "The end."],
    ]);
    expect(changed.suggestions.map((each) => each.label)).toEqual(["(sleepily)"]);
    // A pause given a line of its own inside a group: put before the line after it.
    const paused = readDirected(
      story,
      "Sir Percival stopped.\n\n@Gerald “Could you not?”\n\n::: whispering\nHe crept.\n{pause}\nClank.\n:::\n\nThe end.",
    );
    expect(paused.missing).toBe(0);
    expect(paused.refused).toEqual([]);
    expect(paused.suggestions.map((each) => each.label)).toEqual(["{pause}"]);
    expect(paused.suggestions[0]?.line).toBe(9);
  });

  it("knows a paragraph given back that isn't directed, and says why marks were refused", () => {
    const story = parse(
      "@Sun (mildly) “Take off your coat.”\n\n{book only} *Moral: Persuasion is better than force.*\n\n{audio only} And that is the moral.\n",
    );
    const back = readDirected(
      story,
      "@Sun (mildly) “Take off your coat.”\n\n{book only} *Moral: Persuasion is better than force.*\n\n{audio only} And that is the moral.",
    );
    expect([back.refused, back.missing]).toEqual([[], 0]);
    const direction = readDirected(story, "@Sun (mildly, with a smile) “Take off your coat.”");
    expect(direction.refused.map((each) => each.why)).toEqual([
      "it would change a direction you wrote",
    ]);
    const speaker = readDirected(story, "@Moon (mildly) “Take off your coat.”");
    expect(speaker.refused.map((each) => each.why)).toEqual(["it would change who says what"]);
  });
});
