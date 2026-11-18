import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  dialogueContinuation,
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

describe("empty dialogue continuation", () => {
  function continuation(source: string, margins = true) {
    const syntax = screenplayPresentation(() => margins);
    const pending = dialogueContinuation(syntax, () => margins);
    let state = EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [syntax, pending],
    });
    state = state.update({ effects: presentScreenplay.of(parseFountain(source)) }).state;
    return {
      get state() {
        return state;
      },
      get active() {
        return state.field(pending).size > 0;
      },
      type(insert: string) {
        state = state.update(state.replaceSelection(insert)).state;
      },
      select(anchor: number) {
        state = state.update({ selection: { anchor } }).state;
      },
      worker() {
        state = state.update({
          effects: presentScreenplay.of(parseFountain(state.doc.toString())),
        }).state;
      },
      decoration() {
        return state.field(pending).iter().value;
      },
    };
  }
  it("indents and colours the first empty continuation before and after worker parsing, without changing source", () => {
    for (const prefix of ["", "An action.\n\n".repeat(2000)]) {
      const source = `${prefix}@JOHN\n(quietly)\nHello.`;
      const e = continuation(source);
      e.type("\n");
      expect(e.active).toBe(true);
      expect(e.decoration()?.spec.class).toContain("f-dialogue");
      expect(e.decoration()?.spec.attributes.style).toBe(
        `--studio-speaker-hue: ${speakerHue("JOHN")}`,
      );
      e.worker();
      expect(e.active).toBe(true);
      expect(e.state.doc.toString()).toBe(`${source}\n`);
      expect(parseFountain(e.state.doc.toString()).elements.at(-1)?.kind).toBe("blank");
      e.type("\n");
      expect(e.active).toBe(false);
      e.worker();
      expect(e.active).toBe(false);
    }
  });
  it("leaves a blank after a natural or forced cue unresolved", () => {
    for (const source of ["NORA\n", "@NORA\n", "Action.\n", "# Section\n", "INT. ROOM - DAY\n"])
      expect(continuation(source).active).toBe(false);
  });
  it("continues after a parenthetical and yields to the actual next line type", () => {
    const e = continuation("NORA\n(quietly)");
    e.type("\n");
    expect(e.active).toBe(true);
    e.type("(louder)");
    expect(e.active).toBe(false);
    expect(parseFountain(e.state.doc.toString()).elements.at(-1)?.kind).toBe("parenthetical");
    e.type("\n");
    expect(e.active).toBe(true);
    e.type("Hello");
    expect(e.active).toBe(false);
    expect(parseFountain(e.state.doc.toString()).elements.at(-1)?.kind).toBe("dialogue");
  });
  it("tracks the caret, respects margins and never formats an empty private line as speech", () => {
    const e = continuation("NORA\nHi.\n", false);
    expect(e.active).toBe(true);
    expect(e.decoration()?.spec.class).not.toContain("f-dialogue");
    e.select(0);
    expect(e.active).toBe(false);
    e.select(e.state.doc.length);
    expect(e.active).toBe(true);
    for (const marker of [
      ["[[", "]]", "  "],
      ["/*", "*/", ""],
    ] as const) {
      const source = `NORA\nHi.\n${marker[0]}\n${marker[2]}\n${marker[1]}`;
      const note = continuation(source);
      note.select(source.indexOf(marker[0]) + marker[0].length + 1);
      expect(note.active).toBe(false);
    }
  });
});
