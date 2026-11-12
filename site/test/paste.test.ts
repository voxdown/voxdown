// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { pastedStory } from "../src/writer/paste";

const pastedText = (html: string, plain = "") => pastedStory(html, plain)?.text;

describe("a paste from a web page, Word or Google Docs", () => {
  it("keeps its italics, bold and paragraphs as the story writes them", () => {
    expect(
      pastedText("<p>She said <i>“no”</i> and <b>left</b>.</p><p>It was <em>over</em>.</p>"),
    ).toBe("She said *“no”* and **left**.\n\nIt was *over*.");
  });

  it("makes its headings the story's, so a book's chapters come with it", () => {
    expect(pastedText("<h2>CHAPTER 1. Loomings.</h2><p>Call me Ishmael.</p><hr><p>Then.</p>")).toBe(
      "## CHAPTER 1. Loomings.\n\nCall me Ishmael.\n\n* * *\n\nThen.",
    );
  });

  it("reads Google Docs as Google Docs copies it: every run in pre-wrap, which isn't code", () => {
    expect(
      pastedText(
        '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-2"><h1 dir="ltr"><span style="font-size:20pt;white-space:pre;white-space:pre-wrap;">Chapter One</span></h1><p dir="ltr"><span style="font-style:italic;white-space:pre;white-space:pre-wrap;">Softly</span><span style="white-space:pre;white-space:pre-wrap;"> now, she said.</span></p><p dir="ltr"><span style="white-space:pre;white-space:pre-wrap;">The second paragraph.</span></p></b>',
        "Chapter One\nSoftly now, she said.\nThe second paragraph.",
      ),
    ).toBe("# Chapter One\n\n*Softly* now, she said.\n\nThe second paragraph.");
  });

  it("reads a page with a few blocks of code in it as a page", () => {
    expect(
      pastedText(
        "<h2>CHAPTER 1. Loomings.</h2><p>Call me <i>Ishmael</i>. Some years ago, never mind how long precisely, I thought I would sail about a little and see the watery part of the world.</p><pre>table</pre>",
        "CHAPTER 1. Loomings.\nCall me Ishmael.",
      ),
    ).toContain("Call me *Ishmael*.");
  });

  it("reads Google Docs' and Word's own styling, not their wrapping", () => {
    // Google Docs wraps everything in a bold that says it isn't.
    expect(
      pastedText(
        '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-style:italic;">Softly</span> now.</p><p>Go.</p></b>',
      ),
    ).toBe("*Softly* now.\n\nGo.");
    expect(
      pastedText(
        '<style>.Emph { font-style: italic }</style><p class="MsoNormal">A <span class="Emph">quiet</span> word.</p><p class="MsoNormal">Two.</p>',
      ),
    ).toBe("A *quiet* word.\n\nTwo.");
  });

  it("leaves a plain sentence to paste as itself, and writes no marks by accident", () => {
    expect(pastedText("<span>Just words.</span>")).toBeUndefined();
    // A line of dashes alone is a scene break, as a document sets one.
    expect(pastedText("<p># not a heading</p><p>---</p>")).toBe("\\# not a heading\n\n* * *");
  });

  it("leaves VoxDown as written, from a code editor or an AI's answer, to paste as its text", () => {
    // VS Code copies its lines in `white-space: pre`.
    expect(
      pastedStory(
        '<div style="white-space: pre"><div><span>@Ann “Hello,” she said. *Softly.*</span></div><div><span>{pause 2s} [door creaks]</span></div></div>',
        "@Ann “Hello,” she said. *Softly.*\n{pause 2s} [door creaks]",
      ),
    ).toBeUndefined();
    // An AI's answer, set out as paragraphs: its marks are what is meant.
    expect(
      pastedStory(
        "<p>@Ann “Hello.”</p><p>@Bob (gruffly) “Go.”</p>",
        "@Ann “Hello.”\n\n@Bob (gruffly) “Go.”",
      ),
    ).toBeUndefined();
    expect(pastedStory("<pre>---\ntitle: T\n---</pre>", "---\ntitle: T\n---")).toBeUndefined();
  });

  it("says when it wrote one of VoxDown's signs as text", () => {
    expect(
      pastedStory("<p>Write to me @home.</p><p>Bye.</p>", "Write to me @home.\n\nBye."),
    ).toEqual({
      text: "Write to me \\@home.\n\nBye.",
      escaped: true,
      marks: "Write to me @home.\n\nBye.",
    });
    expect(pastedStory("<p>One <i>two</i>.</p>", "One two.")?.escaped).toBe(false);
    // As VoxDown: the page's shape kept, its signs marks.
    expect(
      pastedStory(
        "<h1>The Inn</h1><p>Write to me @home, she said [quietly].</p><p>Then <i>left</i>.</p>",
        "The Inn\nWrite to me @home, she said [quietly].\nThen left.",
      )?.marks,
    ).toBe("# The Inn\n\nWrite to me @home, she said [quietly].\n\nThen *left*.");
  });
});
