import { describe, expect, it } from "vitest";
import { MAX_PRACTICE_LENGTH, PRACTICE_LESSONS, assessPractice } from "../src/studio/learning";

describe("guided Fountain practice", () => {
  it("each example satisfies its own structural lesson while starters require an edit", () => {
    for (const [index, lesson] of PRACTICE_LESSONS.entries()) {
      expect(assessPractice(index, lesson.example).complete, lesson.title).toBe(true);
      expect(assessPractice(index, lesson.starter).complete, lesson.title).toBe(false);
    }
  });
  it.each(["EXT. MARKET - DAWN", ".UNDER THE SEA", "INT. CAFÉ - DAY"])(
    "accepts an original scene heading %s",
    (source) => {
      expect(assessPractice(0, source).complete).toBe(true);
    },
  );
  it.each([
    "INT.",
    "EXT./INT.",
    "EST.",
    "I/E.",
    "INT. - NIGHT",
    "INT.-NIGHT",
    "INT.- NIGHT",
    "An ordinary action.",
    "[[INT. SECRET - DAY]]",
  ])("requires a visible scene with a location: %s", (source) => {
    expect(assessPractice(0, source).complete).toBe(false);
  });
  it("requires action after a scene and accepts original sentences", () => {
    expect(assessPractice(1, "INT. TRAIN - DAY\n\nA cup tips over.").complete).toBe(true);
    expect(assessPractice(1, "INT. TRAIN - DAY\n\n@MARA\nHello.").complete).toBe(false);
    expect(assessPractice(1, "!Action before.\n\nINT. TRAIN - DAY").complete).toBe(false);
  });
  it("requires a real cue and spoken dialogue, accepting forced mixed-case names", () => {
    expect(assessPractice(2, "@Éloïse\nJe suis ici.").complete).toBe(true);
    expect(assessPractice(2, "MARA\n\nHello.").complete).toBe(false);
    expect(assessPractice(2, "@MARA\n(quietly)").complete).toBe(false);
    expect(assessPractice(2, "@MARA\n[[hidden words]]").complete).toBe(false);
  });
  it("requires a nonempty parenthetical inside a speech with dialogue following it", () => {
    expect(assessPractice(3, "@JONAH\n(through the door)\nCome in.").complete).toBe(true);
    expect(assessPractice(3, "!He speaks (quietly).").complete).toBe(false);
    expect(assessPractice(3, "@MARA\n()\nHello.").complete).toBe(false);
    expect(assessPractice(3, "@MARA\nHello.\n(quietly)").complete).toBe(false);
  });
  it("requires a completed nonempty note alongside public text and keeps it out of feedback", () => {
    const result = assessPractice(4, "!A lamp glows. [[SECRET_NOTE]]");
    expect(result.complete).toBe(true);
    expect(result.privatePassages).toBe(1);
    expect(JSON.stringify(result)).not.toContain("SECRET_NOTE");
    expect(assessPractice(4, "[[Only a note]]").complete).toBe(false);
    expect(assessPractice(4, "!A lamp. [[]]").complete).toBe(false);
    expect(assessPractice(4, "!A lamp. /*Omitted*/").complete).toBe(false);
    expect(result.message).toContain("sharing that source also shares its notes");
  });
  it.each(["!Visible [[SECRET", "!Visible /*SECRET", "!Visible [[outer [[inner]] SECRET]]"])(
    "withholds preview and rejects unfinished/nested private text: %s",
    (source) => {
      const result = assessPractice(4, source);
      expect(result.complete).toBe(false);
      expect(result.preview).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("SECRET");
    },
  );
  it("recognizes a linked two-person dual exchange, not an isolated caret", () => {
    expect(assessPractice(5, "@A\nOne.\n\n@B ^\nTwo.").complete).toBe(true);
    expect(assessPractice(5, "@A ^\nOne.").complete).toBe(false);
    expect(assessPractice(5, "@A\nOne.\n\n!Action interrupts.\n\n@B ^\nTwo.").complete).toBe(false);
    expect(assessPractice(5, "@A\nOne.\n\n@A ^\nTwo.").complete).toBe(false);
    expect(assessPractice(5, "@A\nOne.\n\n@B ^\n(quietly)").complete).toBe(false);
  });
  it("bounds source and preview without changing scratch text", () => {
    const source = Array.from({ length: 20 }, () => `!${"x".repeat(210)}`).join("\n\n");
    const result = assessPractice(1, source);
    expect(result.preview).toHaveLength(12);
    expect(result.preview.every((row) => row.text.length <= 200)).toBe(true);
    expect(result.shortened).toBe(true);
    expect(assessPractice(0, "x".repeat(MAX_PRACTICE_LENGTH + 1)).message).toContain("5,000");
    expect(assessPractice(-1, "INT. ROOM").complete).toBe(false);
    expect(assessPractice(0, "\0").message).toContain("NUL");
  });
  it("treats hostile strings as literal preview text", () => {
    const result = assessPractice(1, 'INT. ROOM\n\n!<img src=x onerror=alert(1)> & "quoted"');
    expect(result.complete).toBe(true);
    expect(result.preview.at(-1)?.text).toBe('<img src=x onerror=alert(1)> & "quoted"');
  });
});
