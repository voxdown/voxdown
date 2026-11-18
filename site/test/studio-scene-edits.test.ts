import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { listSceneCards, planSceneMove } from "../src/studio/scene-edits";

const a = "INT. A - DAY #10#\n= First scene\n\n@MARA\nHello. [[private A]]";
const b = "EXT. B - NIGHT #20#\n= Second scene\n\n/*private B*/\n!Rain.";
const c = "INT. C - DAY #30#\n\n!Sunlight.";

describe("safe scene rearrangement", () => {
  it("describes scenes with exact content ranges, synopses and explicit section ownership", () => {
    const prefix = "Title: Film\n\n# Act one\n\n";
    const source = `${prefix}${a}\n\n${b}\n\n## Act two\n\n${c}`;
    const cards = listSceneCards(source);
    expect(
      cards.map(({ heading, number, synopsis, section }) => ({
        heading,
        number,
        synopsis,
        section,
      })),
    ).toEqual([
      {
        heading: "INT. A - DAY",
        number: "10",
        synopsis: "First scene",
        section: { line: 3, title: "Act one" },
      },
      {
        heading: "EXT. B - NIGHT",
        number: "20",
        synopsis: "Second scene",
        section: { line: 3, title: "Act one" },
      },
      {
        heading: "INT. C - DAY",
        number: "30",
        synopsis: "",
        section: { line: 17, title: "Act two" },
      },
    ]);
    expect(cards.map((card) => source.slice(card.from, card.to))).toEqual([a, b, c]);
  });

  it("moves an EOF scene before the first without inventing or losing separators", () => {
    const source = `${a}\n\n${b}\n\n${c}`;
    const plan = planSceneMove(source, 2, 0, "before");
    expect(plan.candidate).toBe(`${c}\n\n${a}\n\n${b}`);
    expect(plan.candidate.length).toBe(source.length);
    expect(plan.order).toEqual([2, 0, 1]);
    expect(plan.moved).toEqual({ fromIndex: 2, toIndex: 0, heading: "INT. C - DAY" });
    expect(plan.warnings).toEqual([
      "Existing explicit scene numbers are preserved. Moving scenes does not renumber them.",
    ]);
  });

  it("moves before/after an interior target and leaves unaffected source byte-for-byte", () => {
    const prefix = "Title: Film\nAuthor: Writer\n\n[[Global note]]\n\n";
    const source = `${prefix}${a}\n\n${b}\n\n${c}\n\n`;
    const plan = planSceneMove(source, 0, 1, "after");
    expect(plan.candidate).toBe(`${prefix}${b}\n\n${a}\n\n${c}\n\n`);
    expect(plan.order).toEqual([1, 0, 2]);
    expect(plan.changes).toEqual([
      { from: prefix.length, to: prefix.length + a.length + 2 + b.length, insert: `${b}\n\n${a}` },
    ]);
    expect(planSceneMove(source, 2, 1, "before").candidate).toBe(
      `${prefix}${a}\n\n${c}\n\n${b}\n\n`,
    );
  });

  it("keeps BOM, title, mixed line endings, whitespace separators and trailing bytes exact", () => {
    const first = "INT. A\r\n\r\n!A.";
    const second = "EXT. B\n\n!B.";
    const prefix = "\uFEFFTitle: Film\r\n\r\n";
    const separator = "\r\n \r\n\t\r\n";
    const source = `${prefix}${first}${separator}${second}\r`;
    const plan = planSceneMove(source, 0, 1, "after");
    expect(plan.candidate).toBe(`${prefix}${second}${separator}${first}\r`);
    expect(plan.candidate.length).toBe(source.length);
    expect(listSceneCards(source)[0]?.from).toBe(prefix.length);
  });

  it("keeps a BOM fixed even when the first heading is on the first line", () => {
    const source = `\uFEFF${a}\n\n${b}`;
    expect(planSceneMove(source, 0, 1, "after").candidate).toBe(`\uFEFF${b}\n\n${a}`);
    expect(listSceneCards(source)[0]?.from).toBe(1);
  });

  it("keeps attached private passages, synopsis, explicit breaks and two-space continuation lines", () => {
    const first = "INT. A\n= Synopsis\n\n@MARA\nHello.\n  \nAgain.\n[[private\ncontinued]]\n\n===";
    const second = "EXT. B\n\n!Rain.";
    const source = `${first}\n\n${second}`;
    const plan = planSceneMove(source, 1, 0, "before");
    expect(plan.candidate).toBe(`${second}\n\n${first}`);
    const before = parseFountain(source);
    const after = parseFountain(plan.candidate);
    expect(after.omissions.map((span) => plan.candidate.slice(span.from, span.to))).toEqual(
      before.omissions.map((span) => source.slice(span.from, span.to)),
    );
    expect(
      after.elements
        .filter((element) => element.kind === "dialogue")
        .map((element) => element.text),
    ).toEqual(["Hello.", "", "Again."]);
  });

  it("makes leading/trailing-note ownership explicit rather than guessing association", () => {
    const prefix = "[[Global before any scene]]\n\n";
    const first = "INT. A\n\n!Action.\n\n[[Before B belongs to A by the documented boundary rule]]";
    const second = "EXT. B\n= B synopsis\n\n!Rain.";
    const source = `${prefix}${first}\n\n${second}`;
    expect(planSceneMove(source, 0, 1, "after").candidate).toBe(`${prefix}${second}\n\n${first}`);
  });

  it("reorders inside a section while preserving all surrounding labels and section notes", () => {
    const prefix = "# Act one\n= Act synopsis\n[[Act note]]\n\n";
    const boundary = "\n\n## Act two\n[[Act two note]]\n\n";
    const source = `${prefix}${a}\n\n${b}${boundary}${c}`;
    expect(planSceneMove(source, 1, 0, "before").candidate).toBe(
      `${prefix}${b}\n\n${a}${boundary}${c}`,
    );
    expect(() => planSceneMove(source, 0, 2, "after")).toThrow(/separated by a section heading/);
    expect(() => planSceneMove(source, 2, 1, "before")).toThrow(/separated by a section heading/);
  });

  it("does not confuse repeated section titles or nested section boundaries", () => {
    const source = `# Act\n\n${a}\n\n# Act\n\n${b}`;
    expect(() => planSceneMove(source, 0, 1, "after")).toThrow(/section heading/);
    const nested = `# Act\n\n${a}\n\n## Sequence\n\n${b}`;
    expect(() => planSceneMove(nested, 0, 1, "after")).toThrow(/section heading/);
  });

  it("refuses a move whose changed adjacency would reinterpret content", () => {
    const source = "INT. A\n\nMARA\n.B\n\nAction.";
    expect(listSceneCards(source)).toHaveLength(2);
    expect(() => planSceneMove(source, 0, 1, "after")).toThrow(/interpretation/);
  });

  it("rejects a completed private passage spanning the source boundary of a heading", () => {
    const source = "INT. A\n\n!Action.\n/*private\n*/.B\n\n!Rain.";
    expect(listSceneCards(source)).toHaveLength(2);
    expect(() => planSceneMove(source, 1, 0, "before")).toThrow(/private passage crosses/);
  });

  it("rejects malformed omissions and invalid/stale out-of-range requests", () => {
    for (const omission of ["[[unclosed", "/*unclosed"])
      expect(() => planSceneMove(`${a}\n\n${b}\n${omission}`, 0, 1, "after")).toThrow(
        /incomplete private/,
      );
    for (const index of [-1, 2, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => planSceneMove(`${a}\n\n${b}`, index, 0, "before")).toThrow(/Choose two scenes/);
    expect(() => planSceneMove("!No scenes.", 0, 0, "before")).toThrow(/Choose two scenes/);
  });

  it("returns no-op plans for self moves and already satisfied adjacency", () => {
    const source = `${a}\n\n${b}\n\n${c}`;
    for (const [from, target, where] of [
      [0, 0, "before"],
      [0, 1, "before"],
      [2, 1, "after"],
    ] as const) {
      const plan = planSceneMove(source, from, target, where);
      expect(plan.changes).toEqual([]);
      expect(plan.candidate).toBe(source);
      expect(plan.order).toEqual([0, 1, 2]);
    }
  });

  it("applies as one exact atomic change set with one-step undo", () => {
    const source = `${a}\n\n${b}\n\n${c}`;
    const plan = planSceneMove(source, 0, 2, "after");
    const target = {
      state: EditorState.create({ doc: source, extensions: [history()] }),
      dispatch(transaction: Transaction) {
        target.state = transaction.state;
      },
    };
    target.dispatch(target.state.update({ changes: plan.changes, userEvent: "input.move" }));
    expect(target.state.doc.toString()).toBe(plan.candidate);
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe(source);
  });

  it("checks every before/after permutation with duplicate headings and private bytes", () => {
    const bodies = Array.from(
      { length: 5 },
      (_, index) => `INT. SAME\n\n@PERSON${index} (V.O.)\nLine ${index}. [[secret${index}]]`,
    );
    const source = bodies.join("\n\n");
    for (let from = 0; from < bodies.length; from++) {
      for (let to = 0; to < bodies.length; to++) {
        for (const placement of ["before", "after"] as const) {
          const plan = planSceneMove(source, from, to, placement);
          expect(plan.candidate).toBe(plan.order.map((index) => bodies[index]).join("\n\n"));
          expect(new Set(plan.order).size).toBe(bodies.length);
        }
      }
    }
  });

  it("handles thousands of scenes without losing omitted passages or source bytes", () => {
    const scenes = Array.from(
      { length: 2_000 },
      (_, index) => `INT. ROOM ${index}\n\n!Action ${index}. [[private${index}]]`,
    );
    const source = scenes.join("\n\n");
    const plan = planSceneMove(source, 1_999, 0, "before");
    expect(plan.order).toHaveLength(2_000);
    expect(plan.candidate).toBe([scenes[1_999], ...scenes.slice(0, -1)].join("\n\n"));
  });
});
