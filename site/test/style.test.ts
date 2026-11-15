import { describe, expect, it } from "vitest";
import { overusedWords, styleHints, wordsOnly } from "../src/writer/style";

describe("the style check", () => {
  it("reads the story's words alone, at their places", () => {
    const text = "@Mara (softly) “Hush.” [owl hoots] {pause} %% a note %% <!-- mine --> Night.";
    const plain = wordsOnly(text);
    expect(plain).toHaveLength(text.length);
    expect(plain.trim().split(/\s+/)).toEqual(["“Hush.”", "Night."]);
  });

  it("finds a word said again too soon, never a common one or a mark's", () => {
    const text = "The harbour was quiet. Boats knocked in the harbour. She said she said.";
    const hints = styleHints(text, 100);
    expect(hints).toEqual([
      {
        from: 100 + text.lastIndexOf("harbour"),
        to: 100 + text.lastIndexOf("harbour") + 7,
        kind: "again",
        message: "“harbour” again, 6 words after the last",
      },
    ]);
    expect(styleHints("@Gerald yawned. @Gerald yawned again, later.")).toHaveLength(1);
    // A name comes back as often as it must.
    expect(styleHints("Peter ran. Then Peter hid.")).toEqual([]);
    // Far enough apart, it's no repetition.
    expect(styleHints("Harbour. Far away, the harbour.", 0, { within: 2 })).toEqual([]);
  });

  it("finds a sentence long enough to lose a listener", () => {
    const long = `${"and then the boat ".repeat(12)}stopped.`;
    const hints = styleHints(`Short one. ${long} Another.`, 0, { within: 0 });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ kind: "long", from: 11 });
    expect(hints[0]?.message).toBe("A sentence of 49 words: a listener may lose its thread");
  });

  it("lists the words the story leans on most, and the ones drafts lean on", () => {
    const text = `${"The lantern swung. Peter ran. ".repeat(9)}She just smiled. He just left. It just was. Really.`;
    const found = overusedWords(text);
    expect(found.map((word) => [word.word, word.count, word.crutch])).toEqual([
      ["lantern", 9, false],
      ["swung", 9, false],
      ["just", 3, true],
    ]);
    expect(found[0]?.perThousand).toBeGreaterThan(100);
  });

  it("leaves headings out: a chapter's name is no sentence of the story's", () => {
    const hints = styleHints(
      "And that was chapter nineteen.\n\n## Chapter Twenty\n\nMorning came.",
    );
    expect(hints).toEqual([]);
  });
});
