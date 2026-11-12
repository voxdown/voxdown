/**
 * The scene rail down the left: the story from start to finish, top to bottom, with a node for each
 * chapter, heading and scene break, and a window over the stretch on screen. A node takes the
 * cursor to its scene; dragging the window, or a click on the rail, scrolls the story. Scenes are
 * spaced by where they come in the text, and never closer than a node and its name need.
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sceneNumbers } from "@voxdown/editor";
import type { Story } from "voxdown";
import { frontMatterEnd } from "./emphasis";
import { type SceneData, scenesOf } from "./story-data";

/** Room above the story's start and below its end, for a node's ring. */
const PAD = 12;
/** Scenes never sit closer than this where there is room, so every node and name stays readable. */
const GAP = 22;
/** A name's height: names closer than this to another are left out. */
const LABEL = 18;

type Point = { at: number; y: number };

/**
 * A node: where it starts in the text, its name, whether it opens a chapter, and whether it is
 * above the chapters (a book's title, a part): shown as a chapter, moved as none.
 */
export type RailScene = { from: number; name: string; chapter: boolean; title: boolean };

/**
 * Where each place in the text sits on the rail: in proportion to the text, except that scene
 * starts keep GAP apart. The start, every scene and the end are points; between them the text is
 * spread evenly, so the window lines up with the nodes.
 */
export function railPoints(
  starts: readonly number[],
  length: number,
  height: number,
  /** Where the story starts: after its front matter, which the rail doesn't give room to. */
  start = 0,
): Point[] {
  const top = PAD;
  const bottom = Math.max(top + 1, height - PAD);
  const span = bottom - top;
  const total = Math.max(1, length);
  const begin = Math.min(Math.max(0, start), total - 1);
  const gap = Math.min(GAP, span / Math.max(1, starts.length));
  const at = starts.map((offset) => Math.min(Math.max(begin, offset), total));
  const ys = at.map((offset) => top + ((offset - begin) / (total - begin)) * span);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i] ?? 0, (ys[i - 1] ?? top) + gap);
  for (let i = ys.length - 1; i >= 0; i--)
    ys[i] = Math.min(ys[i] ?? 0, i === ys.length - 1 ? bottom : (ys[i + 1] ?? bottom) - gap);
  return [
    { at: begin, y: top },
    ...at.map((offset, i) => ({ at: offset, y: Math.max(top, ys[i] ?? top) })),
    { at: total, y: bottom },
  ];
}

/** The height a place in the text sits at. */
export function railY(points: readonly Point[], at: number): number {
  // The front matter, before the story: at the top.
  if (at <= (points[0]?.at ?? 0)) return points[0]?.y ?? 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    if (at <= b.at) return b.at === a.at ? a.y : a.y + ((at - a.at) / (b.at - a.at)) * (b.y - a.y);
  }
  return points.at(-1)?.y ?? 0;
}

/** The place in the text at a height. */
export function railAt(points: readonly Point[], y: number): number {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    if (y <= b.y) return b.y === a.y ? a.at : a.at + ((y - a.y) / (b.y - a.y)) * (b.at - a.at);
  }
  return points.at(-1)?.at ?? 0;
}

/** The story's chapters, headings and scene breaks, in order, its breaks numbered. */
export function railScenes(story: Story, numbers: ReadonlyMap<number, number>): RailScene[] {
  return numbered(scenesOf(story), numbers);
}

/** Scenes read from a story (on the page or in a worker), their breaks given their numbers. */
export function numbered(
  scenes: readonly SceneData[],
  numbers: ReadonlyMap<number, number>,
): RailScene[] {
  return scenes.map((scene) => {
    const number = scene.break ? numbers.get(scene.from) : undefined;
    return {
      from: scene.from,
      name: scene.break ? (number ? `Scene ${number}` : "Scene") : scene.name,
      chapter: scene.chapter,
      title: scene.title,
    };
  });
}

const LABELS_KEY = "vxd-writer-rail";

export class SceneRail {
  private scenes: RailScene[] = [];
  private points: Point[] = [];
  private height = 0;
  private frame = 0;
  private shown = { from: 0, to: 0 };

  constructor(
    private readonly root: HTMLElement,
    private readonly view: EditorView,
  ) {
    const track = this.part("#rail-track");
    new ResizeObserver(() => {
      this.height = track.clientHeight;
      this.layout();
    }).observe(track);
    this.height = track.clientHeight;
    view.scrollDOM.addEventListener("scroll", () => this.soon(), { passive: true });
    track.addEventListener("pointerdown", (event) => this.drag(event));
    this.part("#rail-toggle").addEventListener("click", () => this.showNames(!this.names));
    this.showNames(this.savedNames());
  }

  /** Whether the rail shows the scenes' names, or only their nodes. */
  get names(): boolean {
    return this.root.hasAttribute("data-labels");
  }

  showNames(names: boolean): void {
    this.root.toggleAttribute("data-labels", names);
    const toggle = this.part("#rail-toggle");
    const label = names ? "Hide scene names" : "Show scene names";
    toggle.title = label;
    toggle.querySelector(".sr-only")?.replaceChildren(label);
    toggle.querySelector("path")?.setAttribute("d", names ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5");
    try {
      localStorage.setItem(LABELS_KEY, names ? "names" : "nodes");
    } catch {
      // Remembered for this visit only.
    }
    this.root.dispatchEvent(new CustomEvent("rail-names", { detail: names, bubbles: true }));
  }

  /** Where the story starts: after its front matter and the blank lines after that. */
  private storyStart(): number {
    const { state } = this.view;
    const front = frontMatterEnd(state);
    const next = state.sliceDoc(front, Math.min(state.doc.length, front + 400));
    return front + next.length - next.trimStart().length;
  }

  /** How many scenes the rail shows: its chapters, headings and scene breaks. */
  get size(): number {
    return this.scenes.length;
  }

  /** The story's scenes, read again after a change. */
  update(story: Story): void {
    this.show(railScenes(story, sceneNumbers(this.view.state)));
  }

  /** The scenes as read (by the page or its worker), drawn again if they changed. */
  show(next: RailScene[]): void {
    const same =
      next.length === this.scenes.length &&
      next.every((scene, i) => {
        const was = this.scenes[i];
        return was && was.from === scene.from && was.name === scene.name;
      });
    this.scenes = next;
    if (!same) this.draw();
    this.layout();
  }

  private savedNames(): boolean {
    try {
      const saved = localStorage.getItem(LABELS_KEY);
      if (saved) return saved === "names";
    } catch {
      // Nothing kept.
    }
    // Names beside the nodes where the window is wide enough to give them room.
    return window.matchMedia("(min-width: 1440px)").matches;
  }

  private part<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector(selector) as T;
  }

  private draw(): void {
    const list = this.part("#rail-scenes");
    list.replaceChildren(
      ...this.scenes.map((scene, index) => {
        const item = document.createElement("li");
        if (scene.chapter) item.dataset.chapter = "";
        const button = document.createElement("button");
        button.type = "button";
        button.title = scene.name;
        button.setAttribute("aria-label", `Go to ${scene.name}`);
        button.innerHTML =
          '<span class="scene-rail-node" aria-hidden="true"></span><span class="scene-rail-name" aria-hidden="true"></span>';
        (button.lastElementChild as HTMLElement).textContent = scene.name;
        button.addEventListener("click", () => this.go(index));
        // One tab stop for the whole rail: arrows go from scene to scene, Enter goes there.
        button.tabIndex = -1;
        button.addEventListener("keydown", (event) => this.step(event, index));
        item.append(button);
        return item;
      }),
    );
  }

  /** Places the nodes, and then the window. */
  private layout(): void {
    const length = this.view.state.doc.length;
    this.points = railPoints(
      this.scenes.map((scene) => scene.from),
      length,
      this.height,
      this.storyStart(),
    );
    const line = this.part("#rail-line");
    line.style.top = `${this.points[0]?.y ?? PAD}px`;
    line.style.height = `${(this.points.at(-1)?.y ?? 0) - (this.points[0]?.y ?? 0)}px`;
    const items = this.part("#rail-scenes").children;
    // Where scenes crowd together, only some keep their names: chapters first, then the rest in
    // order, each a label's height from the next. The others are nodes, named when pointed at.
    const ys = this.scenes.map((_, index) => this.points[index + 1]?.y ?? 0);
    const order = this.scenes
      .map((scene, index) => ({ scene, index }))
      .sort((a, b) => Number(b.scene.chapter) - Number(a.scene.chapter) || a.index - b.index);
    const named: number[] = [];
    const labelled = new Set<number>();
    for (const { index } of order) {
      const y = ys[index] ?? 0;
      if (named.every((other) => Math.abs(other - y) >= LABEL)) {
        named.push(y);
        labelled.add(index);
      }
    }
    // So many scenes that their nodes would touch: the chapters keep theirs, the scenes become
    // ticks (each still a button, named by its title).
    const packed = ys.some((y, index) => index > 0 && y - (ys[index - 1] ?? 0) < 11);
    for (const [index, scene] of this.scenes.entries()) {
      const item = items[index] as HTMLElement | undefined;
      if (!item) continue;
      const y = ys[index] ?? 0;
      item.style.top = `${y}px`;
      item.toggleAttribute("data-crowded", !labelled.has(index));
      item.toggleAttribute("data-minor", packed && !scene.chapter);
      // Its target as tall as the room it has, half to each side: crowded nodes' targets meet
      // without covering each other, so a node's centre is its own (151 of Moby-Dick's chapters
      // on one rail: each was another's to click).
      const room = Math.min(
        y - (ys[index - 1] ?? Number.NEGATIVE_INFINITY),
        (ys[index + 1] ?? Number.POSITIVE_INFINITY) - y,
      );
      const button = item.firstElementChild as HTMLElement | null;
      if (button) {
        // Its target's height, named (20px) or not (12px): tighter than that, tiled.
        const tight = room < (labelled.has(index) ? 20 : 12);
        button.style.height = tight ? `${Math.max(2, room)}px` : "";
        button.style.top = tight ? `${-Math.max(2, room) / 2}px` : "";
        item.toggleAttribute("data-tight", tight);
      }
    }
    this.place();
  }

  private soon(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.place();
    });
  }

  /** The window over the stretch on screen, and the scene it is in. */
  private place(): void {
    const scroller = this.view.scrollDOM;
    const top = scroller.scrollTop;
    const contentTop = this.view.contentDOM.offsetTop;
    const first = this.view.lineBlockAtHeight(Math.max(0, top - contentTop));
    const last = this.view.lineBlockAtHeight(
      Math.max(0, top + scroller.clientHeight - contentTop - 1),
    );
    this.shown = { from: first.from, to: last.to };
    const shownBox = this.part("#rail-window");
    // No scene to place it among: no window over an empty rail.
    shownBox.hidden = this.scenes.length === 0;
    const y = railY(this.points, first.from);
    shownBox.style.top = `${y}px`;
    const tall = railY(this.points, last.to) - y;
    shownBox.style.height = `${Math.max(8, tall)}px`;
    // A thin window is a band, not two lines that would strike through a name.
    shownBox.toggleAttribute("data-thin", tall < 16);
    // The scene being read: the one a quarter of the way down, not a line just scrolled past.
    const reading = this.view.lineBlockAtHeight(
      Math.max(0, top + Math.min(80, scroller.clientHeight / 4) - contentTop),
    ).from;
    let current = -1;
    for (const [index, scene] of this.scenes.entries()) if (scene.from <= reading) current = index;
    for (const [index, item] of [...this.part("#rail-scenes").children].entries()) {
      const button = item.querySelector("button");
      if (index === current) button?.setAttribute("aria-current", "true");
      else button?.removeAttribute("aria-current");
    }
    // The keyboard comes in at the scene being read, unless it is already on the rail.
    if (!this.root.contains(document.activeElement)) this.focusable(Math.max(0, current));
  }

  /** Up, down, Home and End along the scenes. */
  private step(event: KeyboardEvent, index: number): void {
    const to =
      event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? this.scenes.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    this.focusable(Math.max(0, Math.min(this.scenes.length - 1, to)))?.focus();
  }

  /** The scene the keyboard reaches the rail at: the one being read, else the first. */
  private focusable(index: number): HTMLButtonElement | undefined {
    const buttons = [...this.part("#rail-scenes").querySelectorAll<HTMLButtonElement>("button")];
    for (const [at, button] of buttons.entries()) button.tabIndex = at === index ? 0 : -1;
    return buttons[index];
  }

  /** Takes the cursor to a scene's start, with the scene at the top of the page. */
  private go(index: number): void {
    const scene = this.scenes[index];
    if (!scene) return;
    this.view.dispatch({
      selection: EditorSelection.cursor(scene.from),
      effects: EditorView.scrollIntoView(scene.from, { y: "start", yMargin: 24 }),
    });
    this.view.focus();
  }

  /** Scrolls the story so a place in the text is at the top. */
  private scrollTo(at: number): void {
    const place = Math.max(0, Math.min(this.view.state.doc.length, Math.round(at)));
    this.view.dispatch({ effects: EditorView.scrollIntoView(place, { y: "start" }) });
  }

  /**
   * Dragging the window scrolls the story with it; a click on the rail beside the window brings
   * that stretch to the middle of the window.
   */
  private drag(event: PointerEvent): void {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const track = event.currentTarget as HTMLElement;
    const box = track.getBoundingClientRect();
    const onWindow = (event.target as HTMLElement).closest("[data-rail-window]");
    const shownHeight = railY(this.points, this.shown.to) - railY(this.points, this.shown.from);
    const topAt = onWindow
      ? railY(this.points, this.shown.from)
      : event.clientY - box.top - shownHeight / 2;
    const go = (y: number) => this.scrollTo(railAt(this.points, y));
    if (!onWindow) go(topAt);
    track.setPointerCapture(event.pointerId);
    const from = event.clientY;
    let pending = 0;
    let latest = from;
    const move = (next: PointerEvent) => {
      latest = next.clientY;
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        go(topAt + (latest - from));
      });
    };
    const up = () => {
      cancelAnimationFrame(pending);
      track.removeEventListener("pointermove", move);
      track.removeEventListener("pointerup", up);
      track.removeEventListener("pointercancel", up);
    };
    track.addEventListener("pointermove", move);
    track.addEventListener("pointerup", up);
    track.addEventListener("pointercancel", up);
  }
}
