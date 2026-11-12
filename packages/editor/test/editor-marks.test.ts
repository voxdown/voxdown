import { describe, expect, it } from "vitest";
import { inGoodTime } from "../../../test-support/timing";
import { type EditorMark, editorMarks } from "../src/marks";

/** What the editor draws for each mark (src/editor/marks.ts), checked against the text it covers. */
const text = (source: string, mark: EditorMark) => source.slice(mark.from, mark.to);
const kinds = (source: string) => editorMarks(source).map((m) => `${m.kind}:${text(source, m)}`);

describe("editor marks", () => {
  it("works out the marks of images and links nested thousands deep, in good time", () => {
    for (const text of [
      `Hi ${"![".repeat(50_000)}bird${"](a)".repeat(50_000)} end.`,
      `Hi ${"[![".repeat(30_000)}bird${"](a)](b)".repeat(30_000)} end.`,
    ]) {
      let marks: ReturnType<typeof editorMarks> = [];
      inGoodTime(3000, () => {
        marks = editorMarks(text);
      });
      expect(marks.every((m) => m.from >= 0 && m.to <= text.length)).toBe(true);
    }
  });

  it("draws a name, its direction and a character's speech", () => {
    const source = "@Gerald (yawning) “I’m tired,” said the dragon.";
    expect(kinds(source)).toEqual([
      "name:@Gerald",
      "direction:(yawning)",
      "speech:I’m tired,",
      "directed:I’m tired,",
    ]);
  });

  it("warns about a quote opening while another is still open, with a fix to close it", () => {
    const source =
      "He tied the napkin. @Rupert “Where is my spoon? The cook brought an egg. “Lovely.”";
    const warning = editorMarks(source).find(
      (m) => m.kind === "warning" && m.code === "quote-in-quote",
    );
    expect(warning && text(source, warning)).toBe("“");
    expect(warning?.kind === "warning" ? warning.fix : undefined).toMatchObject({ insert: "”" });
    const fix = warning?.kind === "warning" ? warning.fix : undefined;
    const fixed = fix ? source.slice(0, fix.from) + fix.insert + source.slice(fix.to) : source;
    expect(fixed).toContain("“Where is my spoon?” The cook");
    // A quote closed before the next opens is fine.
    expect(
      editorMarks("@Rupert “Where is my spoon?” He sighed. “Lovely.”").some(
        (m) => m.kind === "warning" && m.code === "quote-in-quote",
      ),
    ).toBe(false);
  });

  it("closes a direction left open before the words it directs", () => {
    const source = "@(softly Everyone followed.";
    const warning = editorMarks(source).find(
      (m) => m.kind === "warning" && m.code === "open-direction",
    );
    const fix = warning?.kind === "warning" ? warning.fix : undefined;
    expect(fix?.label).toBe("Close it before “Everyone”");
    const fixed = fix ? source.slice(0, fix.from) + fix.insert + source.slice(fix.to) : source;
    expect(fixed).toBe("@(softly) Everyone followed.");
    expect(warning?.kind === "warning" ? warning.message : "").toMatch(/@\(sleepily\) Everyone/u);
  });

  it("closes a quote's direction left open after its name, the mistake named first", () => {
    const source = "@Beatrice (softly “Wait for me.”";
    const warnings = editorMarks(source).filter((m) => m.kind === "warning");
    expect(warnings.map((m) => (m.kind === "warning" ? m.code : ""))).toEqual(["open-direction"]);
    const fix = warnings[0]?.kind === "warning" ? warnings[0].fix : undefined;
    expect(fix?.label).toBe("Close it before “Wait”");
    const fixed = fix ? source.slice(0, fix.from) + fix.insert + source.slice(fix.to) : source;
    expect(fixed).toBe("@Beatrice (softly) “Wait for me.”");
  });

  it("moves an auto-closed ) to before the quote it took in, the mistake named first", () => {
    const source = "Then @Beatrice (softly “Wait for me.”)";
    const warnings = editorMarks(source).filter((m) => m.kind === "warning");
    expect(warnings.map((m) => (m.kind === "warning" ? m.code : ""))).toEqual(["direction-quote"]);
    const fix = warnings[0]?.kind === "warning" ? warnings[0].fix : undefined;
    expect(fix?.label).toBe("Close it before “Wait”");
    const fixed = fix ? source.slice(0, fix.from) + fix.insert + source.slice(fix.to) : source;
    expect(fixed).toBe("Then @Beatrice (softly) “Wait for me.”");
  });

  it("reads a bare pause length as seconds, in one click", () => {
    for (const [typed, fixed] of [
      ["{pause 2}", "{pause 2s}"],
      ["{pause 1.5 seconds}", "{pause 1.5s}"],
    ] as const) {
      const warning = editorMarks(`Then ${typed} quiet.`).find(
        (m) => m.kind === "warning" && m.code === "pause-value",
      );
      expect(warning?.kind === "warning" ? warning.fix?.insert : undefined).toBe(fixed);
    }
  });

  it("offers to close a quote left open, after its sentence or at the line's end", () => {
    const close = (source: string) => {
      const warning = editorMarks(source).find(
        (m) => m.kind === "warning" && m.code === "unclosed-quote",
      );
      const fix = warning?.kind === "warning" ? warning.fix : undefined;
      return fix ? source.slice(0, fix.from) + fix.insert + source.slice(fix.to) : null;
    };
    expect(close("@Rupert “Hi. At a safe distance.")).toBe("@Rupert “Hi.” At a safe distance.");
    expect(close("@Rupert “Hi there")).toBe("@Rupert “Hi there”");
  });

  it("closes the gap in @ Rupert in one click", () => {
    const source = "He sighed. @ Rupert “Fine.”";
    const warning = editorMarks(source).find((m) => m.kind === "warning" && m.code === "loose-at");
    const fix = warning?.kind === "warning" ? warning.fix : undefined;
    expect(fix?.label).toBe("Change to @Rupert");
    const fixed = fix ? source.slice(0, fix.from) + fix.insert + source.slice(fix.to) : source;
    expect(fixed).toBe("He sighed. @Rupert “Fine.”");
  });

  it("reads a misspelled instruction with a length as a pause, not a page turn", () => {
    const warning = editorMarks("Then {paws 2s} quiet.").find(
      (m) => m.kind === "warning" && m.code === "unknown-instruction",
    );
    expect(warning?.kind === "warning" ? warning.fix?.insert : undefined).toBe("{pause 2s}");
  });

  it("points out an @ with nothing after it, and takes it out in one click", () => {
    const source = "He looked up. @ “Lovely.” And @. Then @Rupert “Fine.” mail@home";
    const lone = editorMarks(source).filter((m) => m.kind === "warning" && m.code === "lone-at");
    expect(lone.map((m) => m.from)).toEqual([source.indexOf("@ “"), source.indexOf("@.")]);
    const fix = lone[0]?.kind === "warning" ? lone[0].fix : undefined;
    expect(fix).toMatchObject({ insert: "", label: "Take it out" });
    // Taken out with its space: no double space left behind.
    const fixed = fix ? source.slice(0, fix.from) + source.slice(fix.to) : source;
    expect(fixed).toContain("He looked up. “Lovely.”");
    expect(editorMarks("Then @").some((m) => m.kind === "warning" && m.code === "lone-at")).toBe(
      true,
    );
  });

  it("takes `@/` for the mark it is, and offers to take out one that ends nothing", () => {
    const source = "Whenever I find @Gerald myself pausing @/ before the door. See @/lib.";
    expect(editorMarks(source).filter((m) => m.kind === "warning")).toEqual([]);
    const idle = "It was late @/ and dark.";
    const warning = editorMarks(idle).find((m) => m.kind === "warning" && m.code === "idle-end");
    const fix = warning?.kind === "warning" ? warning.fix : undefined;
    expect(fix).toMatchObject({ insert: "", label: "Take it out" });
    expect(fix ? idle.slice(0, fix.from) + idle.slice(fix.to) : idle).toBe("It was late and dark.");
  });

  it("offers to close a group left open after its paragraph", () => {
    const source = "::: whispering\nOne.\nTwo.\n\nThree.\n";
    const warning = editorMarks(source).find(
      (m) => m.kind === "warning" && m.code === "unclosed-group",
    );
    const fix = warning?.kind === "warning" ? warning.fix : undefined;
    expect(fix?.label).toBe("Close it after its paragraph");
    const fixed = fix ? source.slice(0, fix.from) + fix.insert + source.slice(fix.to) : source;
    expect(fixed).toBe("::: whispering\nOne.\nTwo.\n:::\n\nThree.\n");
  });

  it("makes a character's sound and its mark one chip", () => {
    const source = "The dragon was snoring. @Gerald [snores] [a distant clang]";
    const marks = editorMarks(source);
    expect(marks.find((m) => m.kind === "vocal")).toMatchObject({
      speaker: "Gerald",
      text: "snores",
    });
    expect(text(source, marks.find((m) => m.kind === "vocal") as EditorMark)).toBe(
      "@Gerald [snores]",
    );
    expect(marks.some((m) => m.kind === "name")).toBe(false);
    expect(marks.find((m) => m.kind === "sound")).toMatchObject({ text: "a distant clang" });
  });

  it("knows a page turn on its own line from one inside a line", () => {
    const marks = editorMarks("He slipped away.\n\n{page}\n\nPeter ran. {page} He hid.");
    const pages = marks.filter((m) => m.kind === "page");
    expect(pages.map((p) => p.kind === "page" && p.ownLine)).toEqual([true, false]);
  });

  it("draws groups, the lines inside them, breaks, headings and notes", () => {
    const source =
      "## The cave {hidden}\n\n::: whispering\nClank.\n:::\n\n---\n\n%% Leave a pause. %%";
    const marks = editorMarks(source);
    expect(marks.find((m) => m.kind === "heading")).toMatchObject({
      text: "The cave",
      hidden: true,
    });
    expect(marks.filter((m) => m.kind === "group")).toHaveLength(2);
    expect(marks.some((m) => m.kind === "in-group")).toBe(true);
    expect(marks.some((m) => m.kind === "break")).toBe(true);
    expect(marks.find((m) => m.kind === "note")).toMatchObject({ text: "Leave a pause." });
  });

  it("hides an escape's backslash, but not one inside front matter", () => {
    const source = "---\ntitle: A \\ B\n---\nShe wrote \\[sic\\].";
    const escapes = editorMarks(source).filter((m) => m.kind === "escape");
    expect(escapes.map((m) => source.slice(m.from, m.to + 1))).toEqual(["\\[", "\\]"]);
  });
});

describe("editor warnings", () => {
  it("underlines an unclosed quote and a bracket left open, but not a closed one", () => {
    const source =
      "@Rupert “Please pass the butter.\nThe plate waited. [a spoon clatters\nAll fine. [a bell]";
    const warnings = editorMarks(source).filter((m) => m.kind === "warning");
    const messages = warnings.map((w) => (w.kind === "warning" ? w.message : ""));
    expect(messages.some((m) => /quote/i.test(m))).toBe(true);
    expect(messages).toContain("A sound needs its closing ]");
    expect(warnings).toHaveLength(2);
  });

  it("underlines marks that would read as words", () => {
    const codes = (source: string) =>
      editorMarks(source).flatMap((m) => (m.kind === "warning" ? [m.code] : []));
    expect(codes("@ Rupert “Hello.”")).toContain("loose-at");
    expect(codes("@Rupert (sleepily “I am tired.”")).toContain("open-direction");
    expect(codes("@Rupert (sleepily “I am tired.”)")).toContain("direction-quote");
    expect(codes("@Rupert (sleepily) “I am tired.”")).toEqual([]);
    expect(codes("Mail me at me@ example.")).toEqual([]);
  });

  it("warns when a direction has lost its @, as it would be read aloud", () => {
    const warnings = (source: string) =>
      editorMarks(source).flatMap((m) => (m.kind === "warning" ? [m] : []));
    expect(warnings("(whispering) Line one.").map((w) => w.message)).toEqual([
      "Did you mean @(whispering)? Without @ it's read aloud.",
    ]);
    const cast = "---\ncast:\n  Rupert: King Rupert\n---\n";
    expect(warnings(`${cast}Rupert (softly) “Hello.”`).map((w) => w.message)).toEqual([
      "Did you mean @Rupert (softly)? Without @ the name and direction are read aloud.",
    ]);
    expect(warnings("@(whispering) Line one.")).toEqual([]);
    expect(warnings(`${cast}@Rupert (softly) “Hello.”`)).toEqual([]);
    expect(warnings("He paused (for effect) and went on.")).toEqual([]);
    // Prose in parentheses is no direction: no warning, and no fix that would silence it.
    expect(warnings("(An aside in parentheses.) Then more.")).toEqual([]);
    expect(warnings("(Later that day) they met.")).toEqual([]);
    expect(warnings("(softly) “Come here.”").map((w) => w.message)).toEqual([
      "Did you mean @(softly)? Without @ it's read aloud.",
    ]);
  });

  it("carries the edit each “Did you mean” suggests", () => {
    const fixed = (source: string) => {
      const fix = editorMarks(source).find((m) => m.kind === "warning" && m.fix);
      if (fix?.kind !== "warning" || !fix.fix) return null;
      return source.slice(0, fix.fix.from) + fix.fix.insert + source.slice(fix.fix.to);
    };
    expect(fixed("(whispering) Line one.")).toBe("@(whispering) Line one.");
    const cast = "---\ncast:\n  Rupert: King Rupert\n---\n";
    expect(fixed(`${cast}Rupert (softly) “Hello.”`)).toBe(`${cast}@Rupert (softly) “Hello.”`);
    expect(fixed("A line. {pasue 2s}")).toBe("A line. {pause 2s}");
    expect(fixed("A line. {pau}")).toBe("A line. {pause}");
    expect(fixed("A line. {boo}")).toBe("A line. {book only}");
    // A name the text writes with @ elsewhere counts as known, with no cast list.
    expect(fixed("@Rupert “Hi.”\nRupert (softly) “No crumbs.”")).toBe(
      "@Rupert “Hi.”\n@Rupert (softly) “No crumbs.”",
    );
    expect(fixed("@Rupert softly “No crumbs.”")).toBe("@Rupert (softly) “No crumbs.”");
    expect(fixed("@Rupert very, very softly “No.”")).toBe("@Rupert (very, very softly) “No.”");
    expect(fixed("A line. {zzzzzz}")).toBeNull();
  });
});

describe("runs of one direction", () => {
  const kinds = (source: string) => editorMarks(source).map((m) => m.kind);
  it("draws lines that each carry the same direction like a group, the direction once", () => {
    const source = "@(whispering) One.\n@(whispering) Two.\n\n@(whispering) Three.\nLoud.";
    const marks = editorMarks(source);
    // Three lines, and the blank line between Two and Three so the bar doesn't break.
    expect(
      marks
        .filter((m) => m.kind === "in-group")
        .map((m) => m.from)
        .sort((a, b) => a - b),
    ).toEqual([0, 19, 38, 39]);
    expect(marks.filter((m) => m.kind === "run-repeat")).toHaveLength(2);
    expect(marks.filter((m) => m.kind === "direction")).toHaveLength(1);
    expect(marks.some((m) => m.kind === "directed")).toBe(false);
  });

  it("carries the bar through blank lines within a run or group, never between two", () => {
    const bars = (source: string) =>
      editorMarks(source)
        .filter((m) => m.kind === "in-group")
        .sort((a, b) => a.from - b.from)
        .map((m) => source.slice(m.from, source.indexOf("\n", m.from) + 1 || undefined));
    expect(bars("::: whispering\nOne.\n\n\nTwo.\n:::")).toEqual(["One.\n", "\n", "\n", "Two.\n"]);
    expect(
      bars("@(whispering) One.\n\n@(whispering) Two.\n\n@(loudly) Three.\n\n@(loudly) Four."),
    ).toEqual([
      "@(whispering) One.\n",
      "\n",
      "@(whispering) Two.\n",
      "@(loudly) Three.\n",
      "\n",
      "@(loudly) Four.",
    ]);
  });

  it("leaves a single directed line, and lines with different directions, as they are", () => {
    expect(kinds("@(whispering) One.\nTwo.")).not.toContain("in-group");
    expect(kinds("@(whispering) One.\n@(loudly) Two.")).not.toContain("run-repeat");
  });
});

describe("groups that keep their lines from being heard or printed", () => {
  it("say what they do on their line, and draw the lines not heard as such", () => {
    const text =
      "Heard.\n\n::: {book only}\nFirst published 1902.\nFrederick Warne.\n:::\n\n::: {audio only}\nRead aloud only.\n:::";
    const marks = editorMarks(text);
    const groups = marks.filter(
      (mark) => mark.kind === "group" && !("close" in mark && mark.close),
    );
    expect(groups.map((mark) => (mark.kind === "group" ? mark.text : ""))).toEqual([
      "book only",
      "audio only",
    ]);
    const unheard = marks
      .filter((mark) => mark.kind === "unheard")
      .map((mark) => text.slice(mark.from, text.indexOf("\n", mark.from)));
    expect(unheard).toEqual(["First published 1902.", "Frederick Warne."]);
  });
});

describe("headings", () => {
  it("know their level, and what they are for when not both heard and printed", () => {
    const text = "# Book One {hidden}\n\n## Chapter 1\n\n### Smaller {book only}\n\nText.";
    const headings = editorMarks(text).flatMap((mark) =>
      mark.kind === "heading" ? [[mark.level, mark.tag ?? null]] : [],
    );
    expect(headings).toEqual([
      [1, "hidden"],
      [2, null],
      [3, "book only"],
    ]);
  });
});
