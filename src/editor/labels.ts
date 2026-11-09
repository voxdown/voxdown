import { type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

/**
 * A direction drawn as Performance draws it (1082): a small label above the words it directs.
 * The widget is a zero-width anchor where the direction is written, as tall as the labels
 * stacked above it, so the row of text it sits on makes room; the label hangs from it.
 */
export class LabelWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly title: string,
    readonly from: number,
  ) {
    super();
  }

  override eq(other: LabelWidget) {
    return other.text === this.text && other.title === this.title && other.from === this.from;
  }

  toDOM() {
    const anchor = document.createElement("span");
    anchor.className = "am-label-anchor";
    const label = document.createElement("span");
    label.className = "am-label";
    label.textContent = this.text;
    label.title = this.title;
    label.dataset.amChip = "direction";
    anchor.append(label);
    return anchor;
  }

  // A click on a label puts the cursor at its direction, to change it.
  override ignoreEvent() {
    return false;
  }
}

/** Space kept between two labels on one row, in pixels. */
const GAP = 8;

/**
 * Labels that would overlap on a row of text are stacked (option A): the later one moves up a row
 * and the row makes room, so every label is whole and readable. A label that would run past the
 * text's right edge slides left to fit.
 */
export const stackLabels = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.effects.length > 0)
      )
        this.schedule();
    }

    schedule() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const content = view.contentDOM.getBoundingClientRect();
          const limit = content.right - 18;
          const rows = new Map<number, Array<{ el: HTMLElement; left: number; width: number }>>();
          for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".am-label")) {
            const anchor = el.parentElement;
            if (!anchor) continue;
            const box = anchor.getBoundingClientRect();
            const key = Math.round(box.bottom / 2);
            const row = rows.get(key) ?? [];
            row.push({ el, left: box.left, width: el.offsetWidth });
            rows.set(key, row);
          }
          const out: Array<{ el: HTMLElement; row: number; shift: number }> = [];
          for (const row of rows.values()) {
            const ends: number[] = [];
            for (const label of row.sort((a, b) => a.left - b.left)) {
              const shift = Math.max(
                0,
                Math.min(label.left + label.width - limit, label.left - content.left),
              );
              const left = label.left - shift;
              let r = ends.findIndex((end) => end + GAP <= left);
              if (r < 0) r = ends.length;
              ends[r] = left + label.width;
              out.push({ el: label.el, row: r, shift });
            }
          }
          return out;
        },
        write: (out, view) => {
          let changed = false;
          for (const { el, row, shift } of out) {
            const anchor = el.parentElement;
            if (!anchor) continue;
            const key = `${row}:${Math.round(shift)}`;
            if (anchor.dataset.place === key) continue;
            anchor.dataset.place = key;
            anchor.style.setProperty("--am-row", String(row));
            el.style.setProperty("--am-shift", `${-Math.round(shift)}px`);
            changed = true;
          }
          // Taller rows move the text: let the editor measure its lines again.
          if (changed) view.requestMeasure();
        },
      });
    }
  },
);
