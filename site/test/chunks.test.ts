import { renderBook, renderScript } from "@voxdown/render";
import { describe, expect, it } from "vitest";
// @vitest-environment happy-dom
import { parse } from "voxdown";
import { chunks } from "../src/writer/chunks";

const p = (n: number) => `<p class="vxd-p" data-from="${n}" data-to="${n + 1}">Words ${n}.</p>`;
const inside = (piece: string) => piece.split("\n").slice(1, -1);

describe("a long side, in chunks", () => {
  it("cuts only between two paragraphs, and loses nothing", () => {
    const body = [
      '<header class="vxd-header"><div class="vxd-title">Long</div></header>',
      ...Array.from({ length: 50 }, (_, i) => p(i)),
      '<h2 class="vxd-heading" data-from="900" data-to="910">Two</h2>',
      ...Array.from({ length: 50 }, (_, i) => p(1000 + i)),
    ];
    const pieces = chunks(body, 10);
    // The header stands outside them.
    expect(pieces[0]).toBe(body[0]);
    for (const piece of pieces.slice(1)) {
      expect(piece).toMatch(/^<div class="side-chunk" style="--parts: \d+">\n/);
      expect(piece.endsWith("\n</div>")).toBe(true);
    }
    // Every chunk but the last ends with a paragraph, and the next starts with one.
    for (const [i, piece] of pieces.slice(1, -1).entries()) {
      expect(inside(piece).at(-1)).toMatch(/^<p class="vxd-p"/);
      expect(inside(pieces[i + 2] as string)[0]).toMatch(/^<p class="vxd-p"/);
    }
    expect(pieces.slice(1).flatMap(inside)).toEqual(body.slice(1));
    // The heading is never at a chunk's edge.
    const heading = pieces.find((piece) => piece.includes("vxd-heading")) as string;
    expect(inside(heading)[0]).not.toMatch(/heading/);
    expect(inside(heading).at(-1)).not.toMatch(/heading/);
  });

  it("never cuts a paragraph of several lines, or a group, in two", () => {
    const body = [
      ...Array.from({ length: 9 }, (_, i) => p(i)),
      '<p class="vxd-p" data-from="50" data-to="80"><span class="vxd-line">One line,</span>',
      '<span class="vxd-line">and the next.</span></p>',
      '<div class="vxd-group"><div class="vxd-group-label">book only</div><div class="vxd-group-body">',
      p(90),
      "</div></div>",
      ...Array.from({ length: 30 }, (_, i) => p(100 + i)),
    ];
    const pieces = chunks(body, 10);
    for (const piece of pieces) {
      const lines = inside(piece);
      expect(lines[0]).not.toMatch(
        /^<span class="vxd-line"|^<\/div>|^<p class="vxd-p" data-from="90"/,
      );
    }
    expect(pieces.flatMap(inside)).toEqual(body);
  });

  it("cuts at four times the size where two paragraphs never meet", () => {
    const group = (n: number) =>
      `<div class="vxd-group"><div class="vxd-group-body">${p(n)}</div></div>`;
    const pieces = chunks(
      Array.from({ length: 100 }, (_, i) => group(i)),
      10,
    );
    expect(pieces.length).toBe(3);
    expect(pieces.map((piece) => inside(piece).length)).toEqual([40, 40, 20]);
  });

  it("holds a real book's script and book whole", () => {
    const text = Array.from(
      { length: 60 },
      (_, i) =>
        `# Chapter ${i + 1}\n\n${Array.from({ length: 12 }, (_, j) => `@Ann “Line ${j}, said twice\nover two lines.” She went on.`).join("\n\n")}\n\n---`,
    ).join("\n\n");
    const story = parse(`---\ntitle: Long\ncast:\n  Ann: Ann\n---\n\n${text}`);
    for (const html of [
      renderScript(story, { positions: true }),
      renderBook(story, { pages: true, positions: true }),
    ]) {
      const lines = html.split("\n");
      const pieces = chunks(lines.slice(1, -1));
      const rebuilt = pieces.flatMap((piece) =>
        piece.startsWith('<div class="side-chunk"') ? inside(piece) : piece.split("\n"),
      );
      expect(rebuilt).toEqual(lines.slice(1, -1));
      const document = new DOMParser().parseFromString(
        `${lines[0]}${pieces.join("\n")}</article>`,
        "text/html",
      );
      // As many parts as before, each whole, and every chunk between two paragraphs.
      const plain = new DOMParser().parseFromString(html, "text/html");
      expect(document.querySelectorAll("[data-from]").length).toBe(
        plain.querySelectorAll("[data-from]").length,
      );
      const all = [...document.querySelectorAll(".side-chunk")];
      expect(all.length).toBeGreaterThan(5);
      for (const chunk of all.slice(0, -1)) {
        expect(chunk.lastElementChild?.className).toBe("vxd-p");
        expect(chunk.nextElementSibling?.firstElementChild?.className).toBe("vxd-p");
      }
    }
  });
});
