// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { pastedStory } from "../src/writer/paste";

describe("a paste from a web page, Word or Google Docs", () => {
  it("keeps its italics, bold and paragraphs as the story writes them", () => {
    expect(
      pastedStory("<p>She said <i>“no”</i> and <b>left</b>.</p><p>It was <em>over</em>.</p>"),
    ).toBe("She said *“no”* and **left**.\n\nIt was *over*.");
  });

  it("makes its headings the story's, so a book's chapters come with it", () => {
    expect(
      pastedStory("<h2>CHAPTER 1. Loomings.</h2><p>Call me Ishmael.</p><hr><p>Then.</p>"),
    ).toBe("## CHAPTER 1. Loomings.\n\nCall me Ishmael.\n\n* * *\n\nThen.");
  });

  it("reads Google Docs' and Word's own styling, not their wrapping", () => {
    // Google Docs wraps everything in a bold that says it isn't.
    expect(
      pastedStory(
        '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-style:italic;">Softly</span> now.</p><p>Go.</p></b>',
      ),
    ).toBe("*Softly* now.\n\nGo.");
    expect(
      pastedStory(
        '<style>.Emph { font-style: italic }</style><p class="MsoNormal">A <span class="Emph">quiet</span> word.</p><p class="MsoNormal">Two.</p>',
      ),
    ).toBe("A *quiet* word.\n\nTwo.");
  });

  it("leaves a plain sentence to paste as itself, and writes no marks by accident", () => {
    expect(pastedStory("<span>Just words.</span>")).toBeUndefined();
    // A line of dashes alone is a scene break, as a document sets one.
    expect(pastedStory("<p># not a heading</p><p>---</p>")).toBe("\\# not a heading\n\n* * *");
  });
});
