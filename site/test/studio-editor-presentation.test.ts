import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  presentScreenplay,
  screenplayPresentation,
  speakerHue,
} from "../src/studio/editor-presentation";
import { parseFountain } from "../src/studio/fountain";

function editor(source: string, margins = true) {
  const field = screenplayPresentation(() => margins);
  let state = EditorState.create({ doc: source, extensions: field });
  state = state.update({ effects: presentScreenplay.of(parseFountain(source)) }).state;
  return {
    get state() {
      return state;
    },
    edit(from: number, to: number, insert: string) {
      state = state.update({ changes: { from, to, insert } }).state;
    },
    classes(line: number) {
      const at = state.doc.line(line).from;
      const classes: string[] = [];
      state.field(field).between(at, at, (from, to, value) => {
        if (from === at && to === at) classes.push(value.spec.class);
      });
      return classes.join(" ");
    },
    comments() {
      const result: string[] = [];
      state.field(field).between(0, state.doc.length, (from, to, value) => {
        if (value.spec.class === "studio-comment") result.push(state.doc.sliceString(from, to));
      });
      return result;
    },
  };
}

describe("immediate screenplay presentation", () => {
  it("gives a character a stable colour across cue extensions and reordering", () => {
    expect(speakerHue("NORA")).toBe(speakerHue("NORA (V.O.)"));
    expect(speakerHue("**NORA**")).toBe(speakerHue("NORA"));
    expect(speakerHue("NORA")).not.toBe(speakerHue("JORDAN"));
  });
  it("recognizes the cue and speech on the very first character without a worker response", () => {
    const e = editor("INT. ROOM - DAY\n\nNORA\n");
    expect(e.classes(3)).not.toContain("studio-speech");
    e.edit(e.state.doc.length, e.state.doc.length, "H");
    expect(e.classes(3)).toContain("f-character studio-speech");
    expect(e.classes(4)).toContain("f-dialogue studio-speech");
    e.edit(e.state.doc.length - 1, e.state.doc.length, "");
    expect(e.classes(3)).not.toContain("studio-speech");
  });
  it("colours completed inline and multiline private spans without hiding or changing source", () => {
    const source = "Action [[private\nnote]] still here.\n\n/*omitted*/";
    const e = editor(source, false);
    expect(e.comments()).toEqual(["[[private\nnote]]", "/*omitted*/"]);
    expect(e.state.doc.toString()).toBe(source);
    expect(e.classes(1)).not.toContain("f-action");
    e.edit(source.length, source.length, "\n\nNORA\nHi");
    expect(e.classes(6)).toContain("syntax-character studio-speech");
    expect(e.classes(6)).not.toContain("f-character");
  });
  it("does not imply unfinished comments are safely omitted", () => {
    expect(editor("[[unfinished").comments()).toEqual([]);
    expect(editor("/*unfinished").comments()).toEqual([]);
  });
  it("reclassifies a bounded paragraph in a long script immediately", () => {
    const prefix = "An ordinary action paragraph.\n\n".repeat(2000);
    const e = editor(`${prefix}NORA\n`);
    e.edit(e.state.doc.length, e.state.doc.length, "H");
    expect(e.classes(e.state.doc.lines - 1)).toContain("f-character studio-speech");
    expect(e.classes(e.state.doc.lines)).toContain("f-dialogue studio-speech");
    e.edit(e.state.doc.length - 1, e.state.doc.length, "");
    expect(e.classes(e.state.doc.lines - 1)).not.toContain("studio-speech");
  });
  it("does not treat an interior paragraph of a long private span as public dialogue", () => {
    const source = `${"Action.\n\n".repeat(2000)}/*hidden\n\nNORA\nH\n\nend*/`;
    const e = editor(source);
    const at = source.indexOf("\nH\n") + 2;
    e.edit(at, at, "ello");
    expect(e.comments()[0]).toContain("Hello");
    expect(e.classes(e.state.doc.lineAt(at).number)).not.toContain("studio-speech");
  });
});
