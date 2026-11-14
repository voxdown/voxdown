import { describe, expect, it } from "vitest";
import {
  applyChanges,
  bookText,
  declareVersion,
  lines,
  parse,
  readDirected,
  spokenScript,
  tokens,
} from "../src/index";

describe("the writer's comments (§10.1)", () => {
  it("are never heard, printed or listed, inside a line or over several", () => {
    const story = parse(
      "Night fell. <!-- Was it raining? --> The harbour was quiet.\n\n<!--\n@Gerald “Cut?”\n\nNot yet.\n-->\n\n@Tom “Hi.” %% loud %%\n",
    );
    expect(lines(story).map((line) => `${line.kind}:${line.text}`)).toEqual([
      "speech:Night fell.",
      "speech:The harbour was quiet.",
      "speech:Hi.",
      "note:loud",
    ]);
    expect(bookText(story)).toBe("Night fell. The harbour was quiet.\n\n“Hi.”");
    expect(spokenScript(story)).not.toContain("Cut");
    expect(story.cast.map((member) => member.handle)).not.toContain("Gerald");
    expect(story.warnings).toEqual([]);
    const items = story.blocks.flatMap((block) =>
      block.kind === "paragraph" ? block.lines.flatMap((line) => line.items) : [],
    );
    expect(items.filter((item) => item.kind === "comment").map((item) => item.text)).toEqual([
      "Was it raining?",
      "@Gerald “Cut?” Not yet.",
    ]);
    expect(tokens(story).filter((token) => token.kind === "comment")).toHaveLength(2);
  });

  it("end what a mark does at a line break they run over, as notes do", () => {
    const story = parse("@Alice “Hello.” <!-- a comment\nover two lines --> “Goodbye.”\n");
    expect(lines(story).map((line) => `${line.speaker}:${line.text}`)).toEqual([
      "Alice:Hello.",
      "Narrator:“Goodbye.”",
    ]);
  });

  it("hold no marks, end at their first close, and stay text when never closed", () => {
    expect(lines(parse("A <!-- %% not a note --> b.")).map((line) => line.text)).toEqual([
      "A",
      "b.",
    ]);
    expect(lines(parse("%% a note <!-- in it %% then")).map((line) => line.text)).toEqual([
      "a note <!-- in it",
      "then",
    ]);
    const open = parse("Open <!-- never closed\n");
    expect(open.warnings.map((warning) => warning.code)).toEqual(["unclosed-comment"]);
    expect(lines(open)[0]?.text).toBe("Open <!-- never closed");
  });

  it("are kept when an AI directs the reading: a paragraph given back without one is left alone", () => {
    const story = parse("Night fell. <!-- check --> The end.\n");
    expect(readDirected(story, "Night fell. {pause} The end.").suggestions).toEqual([]);
    const kept = readDirected(story, "Night fell. <!-- check --> {pause} The end.");
    expect(kept.suggestions.map((suggestion) => suggestion.label)).toEqual(["{pause}"]);
  });

  it("make a story that declares an older version declare 1.3 when one is written", () => {
    const story = parse("---\nvoxdown: 1.2\n---\nHello.\n");
    const bump = declareVersion(story, "1.3");
    expect(bump && applyChanges(story.source, [bump])).toBe("---\nvoxdown: 1.3\n---\nHello.\n");
    expect(declareVersion(parse("---\nvoxdown: 1.3\n---\nHi.\n"), "1.3")).toBeUndefined();
    expect(declareVersion(parse("Hi.\n"), "1.3")).toBeUndefined();
  });
});
