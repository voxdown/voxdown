import { describe, expect, it } from "vitest";
import { prepareRehearsal } from "../src/studio/rehearsal";

describe("read-only rehearsal snapshots", () => {
  it("groups cue extensions and normalized cast identities while preserving complete speeches", () => {
    const source =
      "INT. ROOM - DAY\n\n@Café (V.O.)\n(quietly)\nFirst **bold**.\n  \nThird.\n\n@CAFE\u0301 (O.S.)\n~Sung words.";
    const project = prepareRehearsal(source);
    expect(project.roles).toEqual([{ name: "Café", cues: 2 }]);
    expect(project.cards("Café").map((card) => card.text)).toEqual([
      "(quietly)\nFirst bold.\n\nThird.",
      "Sung words.",
    ]);
    expect(project.cards("Café")[0]?.cue).toBe("Café (V.O.)");
    expect(project.cards("Café")[1]?.context).toMatchObject({ kind: "speech", cue: "Café (V.O.)" });
  });
  it("uses the preceding public event, never a cue from another scene or section", () => {
    const project = prepareRehearsal(
      "@MARA\nBefore.\n\nINT. ROOM\n\n!A door opens.\nThen closes.\n\n@MARA\nHello.\n\n@JON\nHi.\n\n# ACT TWO\n\n@MARA\nAgain.",
    );
    expect(project.scenes.map((scene) => scene.heading)).toEqual([
      "Before the first scene",
      "INT. ROOM",
    ]);
    expect(project.cards("MARA")[0]?.context).toBeUndefined();
    expect(project.cards("MARA")[1]?.context).toEqual({
      kind: "action",
      text: "A door opens.\nThen closes.",
    });
    expect(project.cards("JON")[0]?.context).toEqual({
      kind: "speech",
      cue: "MARA",
      text: "Hello.",
    });
    expect(project.cards("MARA")[2]?.context).toBeUndefined();
    expect(project.cards("MARA", 0)).toHaveLength(1);
    expect(project.cards("MARA", 1)).toHaveLength(2);
  });
  it("keeps duplicate scene headings distinct by occurrence", () => {
    const project = prepareRehearsal("INT. ROOM\n\n@MARA\nOne.\n\nINT. ROOM\n\n@MARA\nTwo.");
    expect(project.scenes.map((scene) => scene.id)).toEqual([1, 2]);
    expect(project.cards("MARA", 2)[0]?.text).toBe("Two.");
  });
  it("removes private and title/outline content from every returned field", () => {
    const source =
      "Title: PRIVATE TITLE\nAuthor: PRIVATE AUTHOR\n\n# PRIVATE OUTLINE\n= PRIVATE SUMMARY\n\nINT. ROOM [[PRIVATE HEADING]]\n\n!Public [[PRIVATE ACTION]] action.\n\n@MARA [[PRIVATE CUE]]\nHello [[PRIVATE SPEECH]].\n/*PRIVATE OMITTED\n@SECRET\nSecret.\n*/\n\n@JON\nReply.";
    const project = prepareRehearsal(source);
    const serialized = JSON.stringify({
      roles: project.roles,
      scenes: project.scenes,
      cards: project.roles.flatMap((role) => project.cards(role.name)),
    });
    expect(serialized).not.toMatch(/PRIVATE|SECRET|Secret/);
    expect(project.cards("MARA")[0]?.text).toBe("Hello .");
    expect(project.cards("JON")[0]?.context?.text).toBe("Hello .");
  });
  it.each([
    "!Public [[secret",
    "!Public /*secret",
    "!Public [[one [[two]] tail]]",
    "!Public /*one /*two*/ tail*/",
    "!Public /*one [[two]]*/",
  ])("refuses ambiguous private syntax: %s", (source) => {
    expect(() => prepareRehearsal(source)).toThrow(/private|Nested/);
  });
  it("retains escaped delimiters as literal public text", () => {
    expect(prepareRehearsal("@MARA\nLiteral \\[[shown\\]].").cards("MARA")[0]?.text).toBe(
      "Literal [[shown]].",
    );
  });
  it("labels both halves of a dual pair and provides simultaneous partner context", () => {
    const project = prepareRehearsal(
      "@MARA\nLeft.\n\n[[private]]\n@JON ^\nRight.\n\n@ELSE ^\nThird.",
    );
    expect(project.cards("MARA")[0]).toMatchObject({
      dual: "paired",
      context: { kind: "simultaneous", cue: "JON", text: "Right." },
    });
    expect(project.cards("JON")[0]).toMatchObject({
      dual: "paired",
      context: { kind: "simultaneous", cue: "MARA", text: "Left." },
    });
    expect(project.cards("ELSE")[0]?.dual).toBe("unpaired");
  });
  it.each(["INT. ROOM", "!Action.", "===", "# ACT TWO"])(
    "never links dual speeches across %s",
    (boundary) => {
      const project = prepareRehearsal(`@MARA\nLeft.\n\n${boundary}\n\n@JON ^\nRight.`);
      expect(project.cards("JON")[0]?.dual).toBe("unpaired");
      expect(project.cards("MARA")[0]?.dual).toBe("none");
    },
  );
  it("excludes empty cues and parenthetical-only speeches", () => {
    const project = prepareRehearsal(
      "@EMPTY\n\n@DIRECTION\n(quietly)\n\n@PRIVATE\n[[omitted speech]]\n\n@MARA\nWords.",
    );
    expect(project.roles.map((role) => role.name)).toEqual(["MARA"]);
  });
  it("does not truncate long answers or context and returns frozen data", () => {
    const text = "Long words ".repeat(1000).trimEnd();
    const source = `@MARA\n${text}\n\n@JON\nReply.`;
    const project = prepareRehearsal(source);
    expect(project.cards("MARA")[0]?.text).toBe(text);
    expect(project.cards("JON")[0]?.context?.text).toBe(text);
    expect(Object.isFrozen(project)).toBe(true);
    expect(Object.isFrozen(project.cards("MARA"))).toBe(true);
    expect(Object.isFrozen(project.cards("MARA")[0])).toBe(true);
    expect(project.cards("missing")).toEqual([]);
  });
  it("preserves caller source, accepts BOM/newline spelling, and bounds input", () => {
    const source = "\uFEFF@MARA\r\nHi.\r\n\r@JON\nHello.";
    expect(prepareRehearsal(source).roles).toHaveLength(2);
    expect(source).toBe("\uFEFF@MARA\r\nHi.\r\n\r@JON\nHello.");
    expect(() => prepareRehearsal("!".repeat(500001))).toThrow(/500,000/);
    expect(() => prepareRehearsal("\n".repeat(20000))).toThrow(/20,000/);
  });
  it("supports thousands of complete speeches without clipping the sequence", () => {
    const project = prepareRehearsal("@MARA\nHello.\n\n".repeat(5000));
    expect(project.cards("MARA")).toHaveLength(5000);
  });
});
