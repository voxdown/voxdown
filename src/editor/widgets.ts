import { type EditorView, WidgetType } from "@codemirror/view";

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
  | "warning";

export class ChipWidget extends WidgetType {
  constructor(
    readonly kind: ChipKind,
    readonly text: string,
    readonly color: string | undefined,
    readonly title: string,
    readonly onClick?: (view: EditorView, from: number) => void,
    readonly from = 0,
  ) {
    super();
  }

  override eq(other: ChipWidget) {
    return (
      other.kind === this.kind &&
      other.text === this.text &&
      other.color === this.color &&
      other.title === this.title &&
      other.from === this.from
    );
  }

  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = `am-chip am-chip-${this.kind}`;
    if (this.kind === "sound" || this.kind === "vocal") el.append(soundIcon());
    el.append(document.createTextNode(this.text));
    el.title = this.title;
    el.dataset.amChip = this.kind;
    if (this.color) el.style.setProperty("--am-speaker", this.color);
    if (this.onClick) {
      const onClick = this.onClick;
      el.addEventListener("mousedown", (event) => {
        event.preventDefault();
        onClick(view, this.from);
      });
    }
    return el;
  }

  override ignoreEvent() {
    return Boolean(this.onClick);
  }
}

/** A line that is only a mark (a page turn, a scene break, a heading, a group's opening): drawn across the page. */
export class LineWidget extends WidgetType {
  constructor(
    readonly kind: "turn" | "break" | "heading" | "group",
    readonly text: string,
    readonly title: string,
  ) {
    super();
  }

  override eq(other: LineWidget) {
    return other.kind === this.kind && other.text === this.text && other.title === this.title;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = `am-line-${this.kind}`;
    el.textContent = this.text;
    el.title = this.title;
    el.dataset.amLine = this.kind;
    if (this.kind === "turn" || this.kind === "break") el.style.display = "flex";
    return el;
  }

  override ignoreEvent() {
    return false;
  }
}

/** A waveform, as Voice Lab's icon draws it: a sound chip starts with it. */
const WAVEFORM = "M2 10v3 M6 6v11 M10 3v18 M14 8v7 M18 5v13 M22 10v3";

function soundIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("am-chip-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", WAVEFORM);
  svg.append(path);
  return svg;
}
