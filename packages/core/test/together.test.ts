/** `@Name+`: said by a character together with others (§5.10, new in 1.4). */
import { describe, expect, it } from "vitest";
import {
  type Speech,
  type Story,
  applyChanges,
  bookText,
  format,
  lines,
  linesToCsv,
  parse,
  renameCharacter,
  setDirection,
  setSpeaker,
  setSpeakerWithin,
  spokenScript,
  textByCharacter,
  tokens,
} from "../src/index";

const speeches = (story: Story): Speech[] =>
  story.blocks
    .flatMap((block) =>
      block.kind === "paragraph" ? block.lines : block.kind === "heading" ? [block.line] : [],
    )
    .flatMap((line) => line.items)
    .filter((item): item is Speech => item.kind === "speech" && /\p{L}/u.test(item.text));

const codes = (source: string) => parse(source).warnings.map((warning) => warning.code);

describe("@Name+ is read", () => {
  it("gives the quote to the character, said with others, and prints no +", () => {
    const story = parse("@FirstPig+ “Wolfie, Wolfie, let us come in!” said the three little pigs.");
    expect(spokenScript(story)).toBe(
      "FirstPig+: Wolfie, Wolfie, let us come in!\nNarrator: said the three little pigs.",
    );
    expect(bookText(story)).toBe("“Wolfie, Wolfie, let us come in!” said the three little pigs.");
    expect(story.warnings).toEqual([]);
  });

  it("takes a direction with or without a space", () => {
    for (const source of ["@FirstPig+(giggling) “Hee!”", "@FirstPig+ (giggling) “Hee!”"]) {
      expect(spokenScript(parse(source))).toBe("FirstPig+ (giggling): Hee!");
    }
  });

  it("lasts as long as the mark's speaker: a quote carried on, then a plain mark alone", () => {
    expect(spokenScript(parse("@FirstPig+ “One,” they said. “Two.”\n@FirstPig “Three.”"))).toBe(
      "FirstPig+: One,\nNarrator: they said.\nFirstPig+: Two.\nFirstPig: Three.",
    );
  });

  it("carries on over lines and paragraphs, and @() keeps it", () => {
    expect(
      spokenScript(parse("@FirstPig+ “Not by the hair\nof my chinny chin chin.\n\n“@(loud) No!”")),
    ).toBe(
      "FirstPig+: Not by the hair\nFirstPig+: of my chinny chin chin.\n\nFirstPig+ (loud): No!",
    );
  });

  it("ends with @/ in words without quotes", () => {
    expect(spokenScript(parse("@FirstPig+ Let us in, @/ they cried."))).toBe(
      "FirstPig+: Let us in,\nNarrator: they cried.",
    );
  });

  it("on a group, gives everything unmarked inside to the character with others", () => {
    expect(
      spokenScript(parse("::: @FirstPig+ whispering\nWe are coming.\n@Wolf “Who?”\nUs.\n:::")),
    ).toBe("FirstPig+ (whispering): We are coming.\nWolf: Who?\nFirstPig+ (whispering): Us.");
  });

  it("on a sound: they all make it, and @[…] inside the speech too", () => {
    expect(spokenScript(parse("@FirstPig+ [giggles]"))).toBe("FirstPig+ [giggles]");
    expect(spokenScript(parse("@FirstPig+ “Ha @[giggles] ha.”"))).toBe(
      "FirstPig+: Ha\nFirstPig+ [giggles]\nFirstPig+: ha.",
    );
  });

  it("reads names after the + as part of the mark, with a gentle warning", () => {
    const story = parse("@FirstPig+SecondPig+ThirdPig “Not by the hair of my chinny chin chin!”");
    expect(spokenScript(story)).toBe("FirstPig+: Not by the hair of my chinny chin chin!");
    expect(bookText(story)).toBe("“Not by the hair of my chinny chin chin!”");
    expect(
      story.warnings.map(({ code, severity, column }) => ({ code, severity, column })),
    ).toEqual([{ code: "together-names", severity: "info", column: 11 }]);
  });

  it("needs a name straight after the +: anything else is text", () => {
    expect(spokenScript(parse("@A+ B said."))).toBe("A+: B said.");
    expect(spokenScript(parse("@A++ “Hi.”"))).toBe("A+: Hi.");
    expect(bookText(parse("@A++ “Hi.”"))).toBe("+ “Hi.”");
  });

  it("warns of a mark that gives nothing, and uses the cast's spelling", () => {
    expect(codes("@FirstPig+")).toEqual(["idle-mark"]);
    expect(
      spokenScript(parse("---\ncast:\n  FirstPig: The First Little Pig\n---\n@firstpig+ “Hi.”")),
    ).toBe("FirstPig+: Hi.");
  });

  it("is a mark: @, name and the + highlighted as one", () => {
    const source = "@FirstPig+SecondPig (giggling) “Hee!”";
    const found = tokens(parse(source)).map((token) => [
      token.kind,
      source.slice(token.range.from, token.range.to),
    ]);
    expect(found).toContainEqual(["mark", "+SecondPig"]);
    expect(found).toContainEqual(["name", "FirstPig"]);
  });
});

describe("@Name+ as data", () => {
  const story = parse("@FirstPig+ “Let us in!” said the pigs. @FirstPig+ [giggles]");

  it("marks such lines together, and no others", () => {
    const rows = lines(story);
    expect(rows.map((row) => row.together)).toEqual([true, undefined, true]);
    expect(Object.keys(rows[0] ?? {}).slice(0, 4)).toEqual([
      "kind",
      "speaker",
      "together",
      "direction",
    ]);
    expect("together" in (rows[1] ?? {})).toBe(false);
  });

  it("puts a together column last in CSV, yes or empty", () => {
    expect(linesToCsv(lines(story))).toBe(
      "kind,speaker,direction,text,scene,page,together\r\nspeech,FirstPig,,Let us in!,1,1,yes\r\nspeech,Narrator,,said the pigs.,1,1,\r\nvocal,FirstPig,,giggles,1,1,yes\r\n",
    );
  });

  it("gives the line to the named character's sides, said with others", () => {
    const sides = textByCharacter(parse("@FirstPig+ (giggling) “Hee!” @FirstPig “Me.”"));
    expect(sides.get("FirstPig")).toBe("(giggling; with others) Hee!\nMe.\n");
  });
});

describe("@Name+ edited (§13)", () => {
  const edit = (source: string, make: (story: Story) => ReturnType<typeof setSpeaker>) => {
    const story = parse(source);
    return applyChanges(source, make(story));
  };

  it("Who keeps the + with the new speaker, or takes it out when asked", () => {
    const source = "@FirstPig+ “Let us in!” said the pigs.";
    expect(edit(source, (story) => setSpeaker(story, speeches(story)[0] as Speech, "Pig"))).toBe(
      "@Pig+ “Let us in!” said the pigs.",
    );
    expect(
      edit(source, (story) =>
        setSpeaker(story, speeches(story)[0] as Speech, "Pig", { together: false }),
      ),
    ).toBe("@Pig “Let us in!” said the pigs.");
  });

  it("Who keeps the quote it carries on said together too", () => {
    const source = "@FirstPig+ “One,” they said. “Two.”";
    expect(edit(source, (story) => setSpeaker(story, speeches(story)[0] as Speech, "Wolf"))).toBe(
      "@Wolf+ “One,” they said. @FirstPig+ “Two.”",
    );
  });

  it("Who can make a line said together, and declares 1.4 where an older version is declared", () => {
    const source = "---\nvoxdown: 1.3\n---\n“Let us in!” cried the pigs.";
    expect(
      edit(source, (story) =>
        setSpeaker(story, speeches(story)[0] as Speech, "FirstPig", { together: true }),
      ),
    ).toBe("---\nvoxdown: 1.4\n---\n@FirstPig+ “Let us in!” cried the pigs.");
  });

  it("Who on a few words keeps them said together", () => {
    const source = "@FirstPig+ Let us in now @/ they cried.";
    const at = source.indexOf("now");
    expect(edit(source, (story) => setSpeakerWithin(story, at, at + 3, "Wolf"))).toBe(
      "@FirstPig+ Let us in @Wolf+ now @/ they cried.",
    );
  });

  it("How writes the direction after the +, and takes it out leaving the +", () => {
    expect(
      edit("@FirstPig+ “Hee!”", (story) =>
        setDirection(story, speeches(story)[0] as Speech, "giggling"),
      ),
    ).toBe("@FirstPig+ (giggling) “Hee!”");
    expect(
      edit("@FirstPig+ (giggling) “Hee!”", (story) =>
        setDirection(story, speeches(story)[0] as Speech, null),
      ),
    ).toBe("@FirstPig+ “Hee!”");
    expect(
      edit("@FirstPig+ (giggling) Hee!", (story) =>
        setDirection(story, speeches(story)[0] as Speech, null),
      ),
    ).toBe("@FirstPig+ Hee!");
  });

  it("renaming keeps the + and the names after it", () => {
    expect(
      edit("@FirstPig+SecondPig (giggling) “Hee!”", (story) =>
        renameCharacter(story, "FirstPig", "Pig"),
      ),
    ).toBe("@Pig+SecondPig (giggling) “Hee!”");
  });

  it("the formatter keeps it, writing the name as the cast spells it", () => {
    expect(format("---\ncast:\n  FirstPig:\n---\n@firstpig+   (giggling)  “Hee!”\n")).toBe(
      "---\ncast:\n  FirstPig:\n---\n\n@FirstPig+ (giggling) “Hee!”\n",
    );
  });
});
