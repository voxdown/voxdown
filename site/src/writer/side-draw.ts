/**
 * The script or book on the side, drawn as the story changes. A first drawing (a story opened, the
 * other tab chosen) shows its start at once, and a long one's rest as the browser is idle. Drawn
 * again (a pause in typing, words from another tab), the side goes on showing what it showed until
 * the new drawing is whole, off the page, and then shows it at the reader's place: the part that
 * was at its top, as far down as it was. (It was put in a part at a time, from the start: a long
 * book's side showed its first page for a moment after every pause, and a tab that only reads
 * never came back from there.)
 */
import { chunks } from "./chunks";

/**
 * Where the reader is on the side: the part at its top, by where it starts in the story, and how
 * far below the side's top that part starts (less than nothing: it starts above).
 */
export type Place = { from: number; offset: number };

/** The first of `elements`, in order down the side, whose foot is below `top`: found by halves. */
function firstBelow(elements: readonly Element[], top: number): Element | undefined {
  let low = 0;
  let high = elements.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((elements[middle] as Element).getBoundingClientRect().bottom <= top) low = middle + 1;
    else high = middle;
  }
  return elements[low];
}

/** The part with a place in the story at `element`: itself, or the first inside it. */
const placed = (element: Element | undefined): HTMLElement | undefined =>
  (element?.matches("[data-from]") ? element : element?.querySelector("[data-from]")) as
    | HTMLElement
    | undefined;

/** The part at the top of the side; nothing at its very top, which a new drawing keeps anyway. */
export function placeIn(sheet: HTMLElement): Place | undefined {
  if (sheet.scrollTop <= 0) return undefined;
  const article = sheet.querySelector(":scope > article");
  if (!article) return undefined;
  const top = sheet.getBoundingClientRect().top;
  let at = firstBelow([...article.children], top);
  // A chunk (chunks.ts): the part in it at the top.
  if (at?.classList.contains("side-chunk")) at = firstBelow([...at.children], top);
  const part = placed(at);
  const from = Number(part?.dataset.from);
  if (!part || Number.isNaN(from)) return undefined;
  return { from, offset: part.getBoundingClientRect().top - top };
}

/** The part that starts at `from` on the side, or the last that starts before it. */
export function partAt(sheet: HTMLElement, from: number): HTMLElement | undefined {
  const exact = sheet.querySelector<HTMLElement>(`[data-from="${from}"]`);
  if (exact) return exact;
  const all = [...sheet.querySelectorAll<HTMLElement>("[data-from]")];
  let low = 0;
  let high = all.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (Number(all[middle]?.dataset.from) <= from) low = middle + 1;
    else high = middle;
  }
  return all[low - 1];
}

/**
 * The side put back at `place`: its part as far below the side's top as it was. Parts off screen
 * are laid out only once they come into view (content-visibility), so the browser is asked where
 * the part is, and again on the next frame, once those around it are laid out.
 */
export function restorePlace(sheet: HTMLElement, place: Place | undefined): void {
  if (!place) return;
  const part = partAt(sheet, place.from);
  if (!part) return;
  const drift = () =>
    part.getBoundingClientRect().top - sheet.getBoundingClientRect().top - place.offset;
  sheet.scrollTop += drift();
  requestAnimationFrame(() => {
    if (!part.isConnected) return;
    const still = drift();
    if (Math.abs(still) >= 1) sheet.scrollTop += still;
  });
}

export class SideDrawing {
  /** Each drawing: one going on in parts stops when a newer one starts. */
  private run = 0;

  constructor(
    private readonly sheet: HTMLElement,
    /** A drawing whole, or its first part shown: its parts indexed, the cursor's marked. */
    private readonly drawn: () => void,
    /** When the browser is next idle. */
    private readonly later: (run: () => void) => void,
  ) {}

  /** Any drawing still going on stops: the side shows something else now. */
  stop(): void {
    this.run++;
  }

  /**
   * Draws `html`, a script or a book (an `<article>`, a block to a line). `again`: the side shows
   * the same story's same tab, and keeps the reader's place, where the drawing shown has it,
   * mapped to the new drawing's text by `map`. `shown` once the new drawing is on the page.
   */
  draw(
    html: string,
    again: boolean,
    map: (from: number) => number = (from) => from,
    shown: () => void = () => {},
  ): void {
    const run = ++this.run;
    const { sheet } = this;
    // Where the reader is as it is put on the page (they may have scrolled while it was drawn).
    const place = () => {
      const before = again ? placeIn(sheet) : undefined;
      return before && { from: map(before.from), offset: before.offset };
    };
    const lines = html.split("\n");
    const head = lines[0] ?? "";
    const tail = lines.at(-1) ?? "";
    if (!/^<article\b/.test(head) || tail !== "</article>" || lines.length < 400) {
      const at = place();
      sheet.innerHTML = html;
      shown();
      restorePlace(sheet, at);
      this.drawn();
      return;
    }
    const pieces = chunks(lines.slice(1, -1));
    const parts: string[] = [];
    for (let i = 0; i < pieces.length; i += 5) parts.push(pieces.slice(i, i + 5).join("\n"));
    if (!again) {
      // Its start at once, the rest as the browser is idle.
      sheet.innerHTML = `${head}\n${parts.shift() ?? ""}\n${tail}`;
      shown();
      const article = sheet.firstElementChild;
      this.drawn();
      const next = () => {
        if (run !== this.run || !article) return;
        const more = parts.shift();
        if (more === undefined) return this.drawn();
        article.insertAdjacentHTML("beforeend", more);
        this.later(next);
      };
      this.later(next);
      return;
    }
    // Off the page, a few chunks at a time; then in place of what was shown, at once.
    const holder = document.createElement("div");
    holder.innerHTML = `${head}\n${tail}`;
    const article = holder.firstElementChild as Element;
    const next = () => {
      if (run !== this.run) return;
      const more = parts.shift();
      if (more !== undefined) {
        article.insertAdjacentHTML("beforeend", more);
        this.later(next);
        return;
      }
      const at = place();
      sheet.replaceChildren(article);
      shown();
      restorePlace(sheet, at);
      this.drawn();
    };
    next();
  }
}
