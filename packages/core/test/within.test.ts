import { describe, expect, it } from "vitest";
import {
  applyChanges,
  bookText,
  lines,
  parse,
  setDirectionWithin,
  setSpeakerWithin,
  wordsSelected,
} from "../src/index";

const front = "---\ncast:\n  Gerald:\n  Mara:\n---\n";

/** The story after an edit of the words `pick`, and how it is heard, a line to a voice. */
function edited(
  body: string,
  pick: string,
  edit: (story: ReturnType<typeof parse>, from: number, to: number) => unknown[],
) {
  const source = front + body;
  const story = parse(source);
  const from = source.indexOf(pick);
  const changes = edit(story, from, from + pick.length) as Parameters<typeof applyChanges>[1];
  if (changes.length === 0) return null;
  const text = applyChanges(source, changes);
  const after = parse(text);
  // An edit adds marks, never print.
  expect(bookText(after)).toBe(bookText(story));
  return {
    text: text.slice(front.length),
    heard: lines(after).map(
      (line) => `${line.speaker}${line.direction ? ` (${line.direction})` : ""}: ${line.text}`,
    ),
  };
}

const moby =
  "It is a way I have of driving off the spleen and regulating the circulation. Whenever I find myself involuntarily pausing before coffin warehouses.";

describe("who says a few words of a line", () => {
  it("gives them alone, the narrator back with @/", () => {
    expect(
      edited(moby, "myself involuntarily pausing before", (story, from, to) =>
        setSpeakerWithin(story, from, to, "Gerald"),
      ),
    ).toEqual({
      text: "It is a way I have of driving off the spleen and regulating the circulation. Whenever I find @Gerald myself involuntarily pausing before @/ coffin warehouses.",
      heard: [
        "Narrator: It is a way I have of driving off the spleen and regulating the circulation. Whenever I find",
        "Gerald: myself involuntarily pausing before",
        "Narrator: coffin warehouses.",
      ],
    });
  });

  it("takes whole words, and the marks that close them", () => {
    expect(
      edited(moby, "egulating the circulatio", (story, from, to) =>
        setSpeakerWithin(story, from, to, "Mara"),
      )?.text,
    ).toContain("the spleen and @Mara regulating the circulation. @/ Whenever");
  });

  it("keeps a quote further on its line as it was", () => {
    expect(
      edited(
        "Whenever I find myself pausing before “Stop!” he said.",
        "myself pausing",
        (s, f, t) => setSpeakerWithin(s, f, t, "Gerald"),
      )?.heard,
    ).toEqual([
      "Narrator: Whenever I find",
      "Gerald: myself pausing",
      "Narrator: before “Stop!” he said.",
    ]);
  });

  it("gives back whoever was speaking: a character, or a group's own", () => {
    expect(
      edited("@Gerald I think we should go home now.", "we should", (s, f, t) =>
        setSpeakerWithin(s, f, t, "Mara"),
      )?.text,
    ).toBe("@Gerald I think @Mara we should @Gerald go home now.");
    expect(
      edited(
        "::: @Mara\nI read it twice and then I read it again.\n:::",
        "then I read",
        (s, f, t) => setSpeakerWithin(s, f, t, "Gerald"),
      )?.text,
    ).toBe("::: @Mara\nI read it twice and @Gerald then I read @/ it again.\n:::");
  });

  it("needs nothing after words that end the line", () => {
    expect(
      edited(moby, "coffin warehouses", (s, f, t) => setSpeakerWithin(s, f, t, "Gerald"))?.text,
    ).toMatch(/pausing before @Gerald coffin warehouses\.$/);
  });

  it("never splits a quote", () => {
    expect(
      edited("@Gerald “I know. I’m tired.”", "I’m tired", (s, f, t) =>
        setSpeakerWithin(s, f, t, "Mara"),
      ),
    ).toBeNull();
  });
});

describe("how a few words of a line are said", () => {
  it("says them so, and the rest as before with @()", () => {
    expect(
      edited(moby, "spleen and regulating the circulation", (s, f, t) =>
        setDirectionWithin(s, f, t, "localized direction"),
      ),
    ).toEqual({
      text: "It is a way I have of driving off the @(localized direction) spleen and regulating the circulation. @() Whenever I find myself involuntarily pausing before coffin warehouses.",
      heard: [
        "Narrator: It is a way I have of driving off the",
        "Narrator (localized direction): spleen and regulating the circulation.",
        "Narrator: Whenever I find myself involuntarily pausing before coffin warehouses.",
      ],
    });
  });

  it("inside a quote, giving back the quote's own direction after them", () => {
    expect(
      edited("@Gerald (happily) “I know. I’m tired, she said.”", "I’m tired", (s, f, t) =>
        setDirectionWithin(s, f, t, "yawning"),
      )?.text,
    ).toBe("@Gerald (happily) “I know. @(yawning) I’m tired, @(happily) she said.”");
  });
});

describe("words selected across voices and lines", () => {
  it("are given alone: the marks inside them go, and the voice after them comes back", () => {
    expect(
      edited("One @Mara two three @/ four five.", "One @Mara two", (s, f, t) =>
        setSpeakerWithin(s, f, t, "Gerald"),
      ),
    ).toEqual({
      text: "@Gerald One two @Mara three @/ four five.",
      heard: ["Gerald: One two", "Mara: three", "Narrator: four five."],
    });
  });

  it("are changed line by line, every line or none", () => {
    const body = "Whenever I find myself pausing.\nThen I go to sea and stay there.";
    expect(
      edited(body, "pausing.\nThen I go", (s, f, t) => setSpeakerWithin(s, f, t, "Gerald"))?.heard,
    ).toEqual([
      "Narrator: Whenever I find myself",
      "Gerald: pausing.",
      "Gerald: Then I go",
      "Narrator: to sea and stay there.",
    ]);
    expect(
      edited(body, "pausing.\nThen I go", (s, f, t) => setDirectionWithin(s, f, t, "softly"))?.text,
    ).toBe(
      "Whenever I find myself @(softly) pausing.\n@(softly) Then I go @() to sea and stay there.",
    );
    // A quote in the second line: nothing changes on either.
    expect(
      edited(
        "Whenever I find myself pausing.\n@Mara “Go,” she said.",
        "pausing.\n@Mara “Go",
        (s, f, t) => setSpeakerWithin(s, f, t, "Gerald"),
      ),
    ).toBeNull();
  });
});

describe("@/ before a letter or digit", () => {
  it("is text, whatever plane the letter is from", () => {
    for (const after of ["lib", "𐐀bc", "𝟘"])
      expect(
        lines(parse(`${front}@Gerald hello @/${after} there`)).map((line) => line.text),
      ).toEqual([`hello @/${after} there`]);
  });
});

describe("words given back to the line's own voice", () => {
  const narrator = (body: string, pick: string) =>
    edited(body, pick, (s, f, t) => setSpeakerWithin(s, f, t, "Narrator"))?.text ?? null;

  it("takes their marks out, or writes @/, never the narrator's name", () => {
    expect(narrator("She said @Mara hello @/ to me.", "hello")).toBe("She said hello to me.");
    expect(narrator("@Gerald Could you not? I’m tired.", "Could you not?")).toBe(
      "Could you not? @Gerald I’m tired.",
    );
    expect(narrator("@Gerald Could you not? I’m tired.", "I’m tired")).toBe(
      "@Gerald Could you not? @/ I’m tired.",
    );
  });

  it("changes nothing for words that are the narrator's already", () => {
    expect(
      narrator("Whenever I find myself pausing, “I knock,” he said.", "myself pausing"),
    ).toBeNull();
  });

  it("in a group, gives back with @/ and @(), which follow the group", () => {
    const group = "::: whispering\nIt was late and so very dark outside.\n:::";
    expect(
      edited(group, "so very dark", (s, f, t) => setSpeakerWithin(s, f, t, "Gerald"))?.text,
    ).toBe("::: whispering\nIt was late and @Gerald so very dark @/ outside.\n:::");
    expect(
      edited(group, "so very dark", (s, f, t) => setDirectionWithin(s, f, t, "loudly"))?.text,
    ).toBe("::: whispering\nIt was late and @(loudly) so very dark @() outside.\n:::");
  });
});

describe("a story that declares an older version", () => {
  it("declares 1.2 once an edit writes @/ in it", () => {
    const source = "---\nvoxdown: 1.1\ncast:\n  Gerald:\n---\nWhenever I find myself pausing here.";
    const from = source.indexOf("myself pausing");
    const changes = setSpeakerWithin(parse(source), from, from + "myself pausing".length, "Gerald");
    expect(applyChanges(source, changes)).toBe(
      "---\nvoxdown: 1.2\ncast:\n  Gerald:\n---\nWhenever I find @Gerald myself pausing @/ here.",
    );
  });
});

describe("what words selected are", () => {
  it("says who says them, and whether a quote or an unspaced dash keeps them from a mark", () => {
    const source = `${front}It was dark—very dark—and @Mara “Go,” she said.`;
    const story = parse(source);
    const at = (words: string) => {
      const from = source.indexOf(words);
      return wordsSelected(story, from, from + words.length);
    };
    expect(at("very")).toMatchObject({ speakers: ["Narrator"], glued: true, quoted: false });
    expect(at("It was")).toMatchObject({ glued: false });
    expect(at("Go")).toMatchObject({ speakers: ["Mara"], quoted: true });
  });
});
