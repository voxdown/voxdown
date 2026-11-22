import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screenplayPdf } from "../src/studio/pdf";
import { prepareActorSides } from "../src/studio/sides";

const text = (result: ReturnType<ReturnType<typeof prepareActorSides>["build"]>) =>
  result.layout.pages
    .flatMap((page) => page.lines)
    .map((line) => line.text)
    .join("\n");

afterEach(() => vi.unstubAllGlobals());

describe("actor sides snapshots", () => {
  it("selects complete scenes with real speech, retaining other characters and action", () => {
    const source =
      "INT. A\n\n!Context A.\n\n@MARA\nHello.\n\n@BOB\nReply.\n\nEXT. B\n\n@BOB\nUnselected speech.\n\nINT. C\n\n@MARA\nFinal speech.\n\n!Last action.";
    const project = prepareActorSides(source);
    expect(project.characters).toEqual([
      { name: "MARA", segments: 2, cues: 2 },
      { name: "BOB", segments: 2, cues: 2 },
    ]);
    const packet = project.build("Mara");
    expect(packet.segments.map((segment) => segment.heading)).toEqual(["INT. A", "INT. C"]);
    for (const expected of ["Context A.", "Reply.", "Final speech.", "Last action."])
      expect(text(packet)).toContain(expected);
    expect(text(packet)).not.toContain("Unselected speech.");
    expect(packet.layout.pages).toHaveLength(3);
    expect(packet.warnings.join(" ")).toMatch(/repaginated/i);
  });

  it("excludes original title/contact/author and all private/outline content by default", () => {
    const source =
      "Title: ORIGINAL_TITLE\nAuthor: ORIGINAL_AUTHOR\nContact: PRIVATE_CONTACT\nCopyright: ORIGINAL_COPYRIGHT\n\n# PRIVATE_OUTLINE\n= PRIVATE_SYNOPSIS\n\nINT. ROOM\n\n@MARA\nVisible [[PRIVATE_INLINE]] speech.\n\n[[PRIVATE_NOTE]]\n/*PRIVATE_BONEYARD*/";
    const project = prepareActorSides(source);
    const packet = project.build("MARA");
    expect(text(packet)).toContain("MARA — actor sides");
    expect(text(packet)).not.toMatch(/PRIVATE_|ORIGINAL_/);
    expect(text(project.build("MARA", "letter", { includeScriptTitle: true }))).toContain(
      "ORIGINAL_TITLE",
    );
    expect(text(project.build("MARA", "letter", { includeScriptTitle: true }))).not.toMatch(
      /PRIVATE_|ORIGINAL_AUTHOR|ORIGINAL_COPYRIGHT/,
    );
  });

  it("includes speech before a first scene as a named segment, even in a script without headings", () => {
    const project = prepareActorSides(
      "Title: Film\n\n!Prologue context.\n\n@MARA\nPrologue speech.\n\nINT. ROOM\n\n@MARA\nScene speech.",
    );
    const packet = project.build("MARA");
    expect(packet.segments[0]).toMatchObject({
      heading: "Before the first scene",
      beforeFirstScene: true,
      cues: 1,
    });
    expect(text(packet)).toContain("BEFORE THE FIRST SCENE");
    expect(text(packet)).toContain("Prologue context.");
    expect(prepareActorSides("@MARA\nHello.").build("MARA").segments).toHaveLength(1);
  });

  it("does not treat empty cues, parentheticals, private speech or unassigned lyrics as speech", () => {
    const project = prepareActorSides(
      "INT. ROOM\n\n@SILENT\n(quietly)\n\n@EMPTY\n  \n\n/*@PRIVATE\nSecret.*/\n\n~Unassigned song.\n\n@REAL\n...\n\n@SINGER\n~La la.",
    );
    expect(project.characters.map((entry) => entry.name)).toEqual(["REAL", "SINGER"]);
    expect(() => project.build("SILENT")).toThrow(/spoken dialogue/);
  });

  it("uses canonical Unicode/extended cast identities and preserves complete dual dialogue", () => {
    const source =
      "INT. ROOM\n\n@ÉLISE (V.O.)\nFirst.\n\n@BOB ^\nTogether.\n\nEXT. PARK\n\n@E\u0301lise (CONT'D) (O.S.)\nSecond.";
    const project = prepareActorSides(source);
    expect(project.characters[0]).toEqual({ name: "ÉLISE", segments: 2, cues: 2 });
    const packet = project.build("élise");
    expect(packet.segments).toHaveLength(2);
    expect(text(packet)).toContain("Together.");
    expect(text(packet)).toContain("(V.O.)");
    expect(packet.layout.warnings).toHaveLength(1);
    expect(packet.layout.warnings[0]).toContain("U+0301 (combining mark)");
    expect(text(packet)).toContain("E\u0301lise");
  });

  it("treats comment-fragmented cue identities using the same visible cast index", () => {
    const project = prepareActorSides("INT. ROOM\n\n@MA[[secret]]RA\nHello.");
    expect(project.characters[0]?.name).toBe("MARA");
    expect(text(project.build("MARA"))).not.toContain("secret");
  });

  it("blocks malformed private passages anywhere rather than exporting their text", () => {
    for (const ending of ["[[unclosed", "/*unclosed"])
      expect(() => prepareActorSides(`INT. ROOM\n\n@MARA\nHello.\n\n${ending}`)).toThrow(
        /incomplete private/,
      );
  });

  it("does not let returned display values mutate the captured snapshot", () => {
    const project = prepareActorSides("@MARA\nHello.");
    const first = project.build("MARA", "a4");
    first.layout.pages.length = 0;
    if (first.segments[0]) first.segments[0].heading = "Changed";
    if (project.characters[0]) project.characters[0].name = "Changed";
    const second = project.build("MARA", "letter");
    expect(second.layout.width).toBe(612);
    expect(second.layout.pages.length).toBeGreaterThan(0);
    expect(second.character).toBe("MARA");
  });

  it("handles long bounded scripts without dropping selected scenes", () => {
    const source = Array.from(
      { length: 1_000 },
      (_, index) => `INT. ROOM ${index}\n\n@MARA\nLine ${index}. [[private${index}]]`,
    ).join("\n\n");
    const packet = prepareActorSides(source).build("MARA");
    expect(packet.segments).toHaveLength(1_000);
    expect(packet.layout.pages).toHaveLength(1_001);
    expect(text(packet)).not.toContain("private");
  });

  it("generates a passive embedded-font PDF with synthetic metadata and no original contacts", async () => {
    vi.stubGlobal("location", {
      href: "https://sides.example/studio/",
      origin: "https://sides.example",
    });
    vi.stubGlobal("fetch", async (input: string) => {
      const file = new URL(input).pathname.split("/").at(-1);
      if (!file || !/^CourierPrime-(Regular|Bold|Italic|BoldItalic)\.ttf$/.test(file))
        throw new Error("Unexpected asset");
      return new Response(readFileSync(new URL(`../src/studio/fonts/${file}`, import.meta.url)));
    });
    const packet = prepareActorSides(
      "Title: PRIVATE_TITLE\nAuthor: PRIVATE_AUTHOR\nContact: PRIVATE_EMAIL\n\nINT. ROOM\n\n@MARA\nHello. [[PRIVATE_NOTE]]",
    ).build("MARA");
    const pdf = await PDFDocument.load(await screenplayPdf(packet.layout, packet.title));
    expect(pdf.getTitle()).toBe("MARA — actor sides");
    expect(pdf.getAuthor()).toBeUndefined();
    expect(pdf.getPageCount()).toBe(packet.layout.pages.length);
    for (const [, object] of pdf.context.enumerateIndirectObjects())
      expect(object.toString()).not.toMatch(
        /\/(?:OpenAction|JavaScript|Launch|URI|EmbeddedFiles|AcroForm)\b/,
      );
  });
});
