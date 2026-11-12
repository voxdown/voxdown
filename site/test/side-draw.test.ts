// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SideDrawing, partAt, placeIn, restorePlace } from "../src/writer/side-draw";

/**
 * A side laid out as a browser would, simply: each part as far down the page as its place in the
 * story (`data-from`), 50 px tall; a chunk as tall as its parts; the side 800 px tall at the top.
 */
let sheet: HTMLElement;
const rect = (top: number, bottom: number) =>
  ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;
const original = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  sheet = document.createElement("div");
  document.body.replaceChildren(sheet);
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
    run();
    return 0;
  });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this === sheet) return rect(0, 800);
    const parts = this.matches("[data-from]")
      ? [this as HTMLElement]
      : [...this.querySelectorAll<HTMLElement>("[data-from]")];
    const first = parts[0];
    const last = parts.at(-1);
    if (!first || !last) return rect(0, 0);
    return rect(
      Number(first.dataset.from) - sheet.scrollTop,
      Number(last.dataset.from) + 50 - sheet.scrollTop,
    );
  };
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = original;
  vi.unstubAllGlobals();
});

const part = (from: number, words = `Words at ${from}.`) =>
  `<p class="vxd-p" data-from="${from}" data-to="${from + 40}">${words}</p>`;
/** A script of `count` parts a hundred apart, a part to a line, as the renderer writes it. */
const script = (count: number, words = (from: number) => `Words at ${from}.`) =>
  [
    '<article class="vxd vxd-script">',
    '<header class="vxd-header"><div class="vxd-title">Long</div></header>',
    ...Array.from({ length: count }, (_, i) => part(1000 + i * 100, words(1000 + i * 100))),
    "</article>",
  ].join("\n");

describe("the reader's place on the side", () => {
  it("is the part at its top, and how far down it starts; nothing at the very top", () => {
    sheet.innerHTML = script(10);
    expect(placeIn(sheet)).toBeUndefined();
    sheet.scrollTop = 1420;
    // The part at 1400 ends at 1450, below the side's top: it starts 20 px above it.
    expect(placeIn(sheet)).toEqual({ from: 1400, offset: -20 });
  });

  it("finds the part in a chunk", () => {
    sheet.innerHTML = `<article class="vxd"><div class="side-chunk">${part(1000)}${part(1100)}</div><div class="side-chunk">${part(1200)}${part(1300)}</div></article>`;
    sheet.scrollTop = 1290;
    expect(placeIn(sheet)).toEqual({ from: 1300, offset: 10 });
  });

  it("finds a part by where it starts, or the last before it", () => {
    sheet.innerHTML = script(5);
    expect(partAt(sheet, 1200)?.dataset.from).toBe("1200");
    expect(partAt(sheet, 1250)?.dataset.from).toBe("1200");
    expect(partAt(sheet, 999)).toBeUndefined();
  });

  it("is put back as it was", () => {
    sheet.innerHTML = script(10);
    restorePlace(sheet, { from: 1500, offset: -20 });
    expect(sheet.scrollTop).toBe(1520);
  });
});

describe("drawing the side", () => {
  /** The browser's idle moments, run when the test says. */
  const idle: Array<() => void> = [];
  const later = (run: () => void) => {
    idle.push(run);
  };
  const runIdle = () => {
    while (idle.length) idle.shift()?.();
  };
  beforeEach(() => {
    idle.length = 0;
  });

  it("shows a first drawing's start at once, and the rest as the browser is idle", () => {
    const drawn = vi.fn();
    const drawing = new SideDrawing(sheet, drawn, later);
    drawing.draw(script(450), false);
    const shown = () => sheet.querySelectorAll("[data-from]").length;
    expect(shown()).toBeGreaterThan(0);
    expect(shown()).toBeLessThan(450);
    runIdle();
    expect(shown()).toBe(450);
    expect(drawn).toHaveBeenCalledTimes(2);
  });

  it("drawn again, shows what it showed until the new drawing is whole, then it at the reader's place", () => {
    const drawing = new SideDrawing(sheet, () => {}, later);
    drawing.draw(script(450), false);
    runIdle();
    sheet.scrollTop = 20_020;
    expect(placeIn(sheet)).toEqual({ from: 20_000, offset: -20 });
    const shown = vi.fn();
    // Ten characters typed near the start: every part after them moves on by ten.
    drawing.draw(
      script(450, (from) => `New words at ${from}.`).replace(
        /data-from="(\d+)"/g,
        (_, from) => `data-from="${Number(from) + 10}"`,
      ),
      true,
      (from) => from + 10,
      shown,
    );
    // Nothing changed yet: the old drawing, at the same place.
    expect(sheet.textContent).toContain("Words at 20000.");
    expect(sheet.textContent).not.toContain("New words");
    expect(sheet.scrollTop).toBe(20_020);
    expect(shown).not.toHaveBeenCalled();
    runIdle();
    expect(shown).toHaveBeenCalledTimes(1);
    expect(sheet.textContent).toContain("New words at 20000.");
    expect(sheet.querySelectorAll("[data-from]").length).toBe(450);
    // The same part at the top, as far down as it was.
    expect(placeIn(sheet)).toEqual({ from: 20_010, offset: -20 });
  });

  it("stops a drawing when another starts, or the side shows something else", () => {
    const drawing = new SideDrawing(sheet, () => {}, later);
    drawing.draw(script(450), false);
    runIdle();
    const shown = vi.fn();
    drawing.draw(
      script(450, () => "Never shown."),
      true,
      undefined,
      shown,
    );
    drawing.stop();
    runIdle();
    expect(shown).not.toHaveBeenCalled();
    expect(sheet.textContent).not.toContain("Never shown.");
  });
});
