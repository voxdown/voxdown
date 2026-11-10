import { type EditorView, WidgetType } from "@codemirror/view";
import { readSceneName } from "./scene-names";

/**
 * The small pieces the editor draws in place of raw marks on lines you aren't typing in: a
 * character's name, a direction, a sound, a page turn. Clicking one puts the cursor there, and the
 * line shows its raw marks for editing.
 */
export type ChipKind =
  | "name"
  | "direction"
  | "cleared"
  | "sound"
  | "vocal"
  | "pause"
  | "page"
  | "note"
  | "instruction"
  | "tool"
  | "warning";

/**
 * The host's own controls inside a page turn's mark (a recording tool's chime and rest buttons,
 * say): mounted into the element given, and taken down by what it returns when the mark goes.
 */
export type PageTurnTools = (
  el: HTMLElement,
  /** Either side of the page turn's label, as a script's page markers have them. */
  place: "before" | "after",
) => (() => void) | undefined;

/**
 * The speaker on a scene's mark: the scene's name, and what the line after the
 * mark says aloud, if anything.
 */
export type ReadAloud = {
  name: string;
  /** What the line reading it aloud says, or null when there is none. */
  said: string | null;
  /** It says an old name (the scene's number changed since). */
  stale: boolean;
  /** The name the scene had (a heading renamed): a line still saying it is out of date. */
  was?: string;
};

const toolsDone = new WeakMap<HTMLElement, () => void>();

/** The host's controls, in a box of their own either side of a mark's label. */
function mountTools(el: HTMLElement, tools: PageTurnTools | undefined) {
  if (!tools) return;
  const dones: Array<() => void> = [];
  for (const place of ["before", "after"] as const) {
    const box = document.createElement("span");
    box.className = "vxd-page-tools";
    box.dataset.place = place;
    box.contentEditable = "false";
    if (place === "before") el.prepend(box);
    else el.append(box);
    const done = tools(box, place);
    if (done) dones.push(done);
  }
  if (dones.length) toolsDone.set(el, () => dones.forEach((done) => done()));
}

const inTools = (event: Event) =>
  event.target instanceof Element &&
  Boolean(event.target.closest(".vxd-page-tools, .vxd-read-aloud"));

export class ChipWidget extends WidgetType {
  constructor(
    readonly kind: ChipKind,
    readonly text: string,
    readonly color: string | undefined,
    readonly title: string,
    readonly onClick?: (view: EditorView, from: number) => void,
    readonly from = 0,
    /** The host's status for what the chip stands for (a take's), drawn as a dot inside it. */
    readonly status?: { name: string; title: string },
    /** The host's controls inside it (a page turn's chime and rest). */
    readonly tools?: PageTurnTools,
    /** Whose it is (a character's sound), for a host that picks out one speaker (Listen as). */
    readonly speaker?: string,
  ) {
    super();
  }

  override eq(other: ChipWidget) {
    return (
      other.kind === this.kind &&
      other.text === this.text &&
      other.color === this.color &&
      other.title === this.title &&
      other.from === this.from &&
      other.status?.name === this.status?.name &&
      other.status?.title === this.status?.title &&
      Boolean(other.tools) === Boolean(this.tools) &&
      other.speaker === this.speaker
    );
  }

  override destroy(dom: HTMLElement) {
    toolsDone.get(dom)?.();
  }

  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = `vxd-chip vxd-chip-${this.kind}`;
    if (this.kind === "sound" || this.kind === "vocal") el.append(soundIcon());
    el.append(document.createTextNode(this.text));
    el.title = this.status ? `${this.title} · ${this.status.title}` : this.title;
    el.dataset.vxdChip = this.kind;
    // Whose name it is, for a host that picks out one speaker (Listen as).
    if (this.speaker) el.dataset.speaker = this.speaker.toLowerCase();
    else if (this.kind === "name" && this.title.startsWith("@"))
      el.dataset.speaker = this.title.slice(1).toLowerCase();
    if (this.status) el.dataset.status = this.status.name;
    if (this.color) el.style.setProperty("--vxd-speaker", this.color);
    if (this.onClick) {
      const onClick = this.onClick;
      el.addEventListener("mousedown", (event) => {
        if (inTools(event)) return;
        event.preventDefault();
        onClick(view, this.from);
      });
    }
    mountTools(el, this.tools);
    return el;
  }

  override ignoreEvent(event: Event) {
    return Boolean(this.onClick) || inTools(event);
  }
}

/** A line that is only a mark (a page turn, a scene break, a heading, a group's opening): drawn across the page. */
export class LineWidget extends WidgetType {
  constructor(
    readonly kind: "turn" | "break" | "heading" | "group",
    readonly text: string,
    readonly title: string,
    /** The host's controls inside it (a page turn's chime and rest). */
    readonly tools?: PageTurnTools,
    /** After a paragraph's words (a page turn ending it): drawn below them, across the page. */
    readonly trailing = false,
    /** Whose lines it holds (a group's), for a host that picks out one speaker (Listen as). */
    readonly speaker?: string,
    /** A scene's speaker, reading its name aloud. */
    readonly readAloud?: ReadAloud,
  ) {
    super();
  }

  override eq(other: LineWidget) {
    return (
      other.kind === this.kind &&
      other.text === this.text &&
      other.title === this.title &&
      other.trailing === this.trailing &&
      other.speaker === this.speaker &&
      Boolean(other.tools) === Boolean(this.tools) &&
      other.readAloud?.name === this.readAloud?.name &&
      other.readAloud?.said === this.readAloud?.said &&
      other.readAloud?.stale === this.readAloud?.stale &&
      other.readAloud?.was === this.readAloud?.was
    );
  }

  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = `vxd-line-${this.kind}`;
    const label = document.createElement("span");
    label.textContent = this.text;
    el.append(label);
    el.title = this.title;
    el.dataset.vxdLine = this.kind;
    if (this.trailing) el.dataset.trailing = "";
    if (this.speaker) el.dataset.speaker = this.speaker.toLowerCase();
    if (this.kind === "turn" || this.kind === "break" || this.kind === "heading")
      el.style.display = "flex";
    if (this.readAloud) el.append(readAloudButton(view, el, this.readAloud));
    mountTools(el, this.tools);
    return el;
  }

  override destroy(dom: HTMLElement) {
    toolsDone.get(dom)?.();
  }

  override ignoreEvent(event: Event) {
    return inTools(event);
  }
}

/** A waveform, as Voice Lab's icon draws it: a sound chip starts with it. */
const WAVEFORM = "M2 10v3 M6 6v11 M10 3v18 M14 8v7 M18 5v13 M22 10v3";
/** A speaker, and the sound coming from it when it's on. */
const SPEAKER = "M11 5 6 9H2v6h4l5 4V5z";
const SPEAKING = "M15.5 8.5a5 5 0 0 1 0 7 M19 5a10 10 0 0 1 0 14";

function icon(path: string, className: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add(className);
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}

const soundIcon = () => icon(WAVEFORM, "vxd-chip-icon");

/**
 * The speaker beside a scene's name: pressed, the scene's name is read aloud as
 * the scene starts, written as a line of its own after the mark; pressed again, it isn't.
 */
function readAloudButton(view: EditorView, line: HTMLElement, read: ReadAloud) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "vxd-read-aloud";
  const on = read.said !== null;
  button.setAttribute("aria-pressed", String(on));
  button.setAttribute("aria-label", `Read “${read.name}” aloud`);
  if (read.stale) button.dataset.stale = "";
  button.title = !on
    ? `Read “${read.name}” aloud as the scene starts: a line of its own after this mark`
    : read.stale
      ? `Reads “${read.said}” aloud, but the scene is ${read.name} now: click to say its name now`
      : `Reads “${read.said}” aloud as the scene starts. Click to take the line out`;
  button.append(icon(on ? `${SPEAKER} ${SPEAKING}` : SPEAKER, "vxd-read-aloud-icon"));
  // The text keeps its cursor and the line stays as it reads.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    const at = view.posAtDOM(line);
    readSceneName(view, at, read.name, read.was);
    view.focus();
  });
  return button;
}
