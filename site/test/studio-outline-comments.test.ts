// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { parseFountain } from "../src/studio/fountain";
import { mountOutlineComments, outlineCommentGroups } from "../src/studio/outline-comments";

const source =
  "[[Opening note]]\n\n# Act one\n\n[[Section note]]\n\nINT. ROOM - DAY\n\nAction. [[Inline note]]\n\n/*Omitted\npassage*/\n\nEXT. PARK - NIGHT\n\n[[Second scene]]";
beforeEach(() => document.body.replaceChildren());
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing test fixture");
  return value;
}
function button(selector: string) {
  return required(document.querySelector<HTMLButtonElement>(selector));
}

describe("private comments in the scene outline", () => {
  it("groups parser omissions under their nearest scene or section with exact source lines", () => {
    const groups = outlineCommentGroups(source, parseFountain(source));
    expect(
      [...groups.entries()].map(([line, group]) => [line, group.comments.map((note) => note.line)]),
    ).toEqual([
      [0, [1]],
      [3, [5]],
      [7, [9, 11]],
      [14, [16]],
    ]);
    expect(groups.get(7)?.comments.map((note) => [note.kind, note.text])).toEqual([
      ["note", "Inline note"],
      ["boneyard", "Omitted\npassage"],
    ]);
  });
  it("does not mislabel escaped or incomplete comments as private", () => {
    const input = "INT. ROOM - DAY\n\n\\[[Literal]]\n\n[[Unclosed\n\n/*unfinished";
    expect(
      [...outlineCommentGroups(input, parseFountain(input)).values()].flatMap(
        (group) => group.comments,
      ),
    ).toEqual([]);
  });
  it("handles CRLF offsets and notes within headings", () => {
    const input = "INT. ROOM [[heading note]] - DAY\r\n\r\n[[other note]]";
    const groups = outlineCommentGroups(input, parseFountain(input));
    expect(groups.get(1)?.comments.map((comment) => comment.line)).toEqual([1, 3]);
  });
  it("rejects stale offsets that no longer point to the same comment delimiters", () => {
    expect(
      [...outlineCommentGroups(`new ${source}`, parseFountain(source)).values()].flatMap(
        (group) => group.comments,
      ),
    ).toEqual([]);
  });
  it("preserves heading semantics, lazily expands literal text and jumps to its source", () => {
    const input = "INT. ROOM - DAY\n\n[[<img src=x onerror=alert(1)>]]";
    let current = { id: "draft", source: input };
    const jumps: number[] = [];
    const ui = mountOutlineComments({ current: () => current, jump: (line) => jumps.push(line) });
    const parsed = parseFountain(input);
    ui.update(current, parsed);
    const item = required(parsed.elements[0]);
    const heading = document.createElement("button");
    heading.dataset.line = "1";
    heading.setAttribute("aria-current", "true");
    document.body.append(ui.row(item, heading));
    expect(document.querySelector(".outline-comment-link")).toBeNull();
    const toggle = button(".outline-comment-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Show 1 comment for INT. ROOM - DAY");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const comment = button(".outline-comment-link");
    expect(comment.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(comment.querySelector("img")).toBeNull();
    expect(heading.getAttribute("aria-current")).toBe("true");
    comment.click();
    expect(jumps).toEqual([3]);
    current = { id: "other-draft", source: input };
    comment.click();
    toggle.click();
    expect(jumps).toEqual([3]);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
  it("keeps disclosures open across edits before a heading, without sharing state across drafts", () => {
    let current = { id: "draft", source };
    const ui = mountOutlineComments({ current: () => current, jump: () => {} });
    const render = () => {
      const parsed = parseFountain(current.source);
      ui.update(current, parsed);
      const item = required(parsed.elements.find((element) => element.kind === "scene"));
      document.body.replaceChildren(ui.row(item, document.createElement("button")));
      return button(".outline-comment-toggle");
    };
    render().click();
    current = { ...current, source: `\n${source}` };
    expect(render().getAttribute("aria-expanded")).toBe("true");
    current = { ...current, id: "other" };
    expect(render().getAttribute("aria-expanded")).toBe("false");
  });
  it("bounds initial expanded rendering and excerpt lengths, then reveals more with focus", () => {
    const input = `INT. ROOM - DAY\n\n${Array.from({ length: 120 }, (_, i) => `[[${i} ${"x".repeat(700)}]]`).join("\n\n")}`;
    const current = { id: "large", source: input };
    const ui = mountOutlineComments({ current: () => current, jump: () => {} });
    const parsed = parseFountain(input);
    ui.update(current, parsed);
    document.body.append(ui.row(required(parsed.elements[0]), document.createElement("button")));
    button(".outline-comment-toggle").click();
    expect(document.querySelectorAll(".outline-comment-link")).toHaveLength(50);
    expect(button(".outline-comment-link").textContent).toHaveLength(401);
    button(".outline-comment-more").click();
    expect(document.querySelectorAll(".outline-comment-link")).toHaveLength(100);
    expect(document.activeElement?.textContent?.startsWith("50 ")).toBe(true);
  });
  it("offers leading comments without inventing a scene and omits empty groups", () => {
    const current = { id: "draft", source: "[[A private thought]]" };
    const ui = mountOutlineComments({ current: () => current, jump: () => {} });
    ui.update(current, parseFountain(current.source));
    expect(ui.leading()?.textContent).toContain("Before the first scene");
    ui.update({ ...current, source: "Just action." }, parseFountain("Just action."));
    expect(ui.leading()).toBeNull();
  });
});
