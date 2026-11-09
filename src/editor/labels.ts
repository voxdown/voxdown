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
    /** Where the direction's mark ends, so a click can pick its words. */
    readonly to = from,
  ) {
    super();
  }

  override eq(other: LabelWidget) {
    return (
      other.text === this.text &&
      other.title === this.title &&
      other.from === this.from &&
      other.to === this.to
    );
  }

  toDOM(view: EditorView) {
    const anchor = document.createElement("span");
    anchor.className = "am-label-anchor";
    const label = document.createElement("span");
    label.className = "am-label";
    label.textContent = this.text;
    label.title = this.title;
    label.dataset.amChip = "direction";
    // A click picks the direction's words, ready to type over.
    label.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const raw = view.state.sliceDoc(this.from, this.to);
      const open = raw.indexOf("(");
      const close = raw.lastIndexOf(")");
      if (open < 0 || close <= open) return;
      view.dispatch({ selection: { anchor: this.from + open + 1, head: this.from + close } });
      view.focus();
    });
    anchor.append(label);
    return anchor;
  }

  override ignoreEvent() {
    return true;
  }
}

/** Space kept between two labels on one row, and between stacked ones, in pixels. */
const GAP = 8;
const LIFT_GAP = 2;

/**
 * Labels that would overlap on a row of text are stacked (option A): the later one moves up, above
 * the one it would meet, and the row makes room, so every label is whole and readable. A label
 * that would run past the text's right edge slides left to fit; one wider than the text column
 * wraps at the column's width, and stacks by its real height.
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
          const style = getComputedStyle(view.contentDOM);
          const left = content.left + Number.parseFloat(style.paddingLeft || "0");
          const right = content.right - Number.parseFloat(style.paddingRight || "0") - 12;
          const column = Math.max(120, right - left);
          type Label = {
            el: HTMLElement;
            left: number;
            width: number;
            height: number;
            wrap: number;
          };
          const rows = new Map<number, Label[]>();
          for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".am-label")) {
            const anchor = el.parentElement;
            if (!anchor) continue;
            const box = anchor.getBoundingClientRect();
            const key = Math.round(box.bottom / 2);
            // Its width on one line, kept from before it was wrapped.
            const natural = Number(el.dataset.natural) || el.offsetWidth;
            el.dataset.natural = String(natural);
            const wrap = natural > column ? column : 0;
            const width = wrap || natural;
            const height = el.offsetHeight || 14;
            const row = rows.get(key) ?? [];
            row.push({ el, left: box.left, width, height, wrap });
            rows.set(key, row);
          }
          const out: Array<{
            el: HTMLElement;
            lift: number;
            shift: number;
            wrap: number;
            height: number;
          }> = [];
          for (const row of rows.values()) {
            const placed: Array<{ left: number; right: number; lift: number; top: number }> = [];
            for (const label of row.sort((a, b) => a.left - b.left)) {
              const shift = Math.max(
                0,
                Math.min(label.left + label.width - right, label.left - left),
              );
              const from = label.left - shift;
              const to = from + label.width;
              const meets = placed.filter((p) => p.left < to + GAP && from < p.right + GAP);
              // The lowest place clear of every label it meets.
              const tries = [0, ...meets.map((p) => p.top + LIFT_GAP)].sort((a, b) => a - b);
              const lift =
                tries.find((t) =>
                  meets.every((p) => t + label.height <= p.lift || t >= p.top + LIFT_GAP),
                ) ?? 0;
              placed.push({ left: from, right: to, lift, top: lift + label.height });
              out.push({ el: label.el, lift, shift, wrap: label.wrap, height: label.height });
            }
          }
          return out;
        },
        write: (out, view) => {
          let changed = false;
          for (const { el, lift, shift, wrap, height } of out) {
            const anchor = el.parentElement;
            if (!anchor) continue;
            const key = `${Math.round(lift)}:${Math.round(shift)}:${Math.round(wrap)}:${Math.round(height)}`;
            if (anchor.dataset.place === key) continue;
            anchor.dataset.place = key;
            anchor.style.setProperty("--am-lift", `${Math.round(lift)}px`);
            anchor.style.setProperty("--am-height", `${Math.round(height)}px`);
            el.style.setProperty("--am-shift", `${-Math.round(shift)}px`);
            if (wrap) {
              el.style.whiteSpace = "normal";
              el.style.width = `${Math.round(wrap)}px`;
            } else {
              el.style.whiteSpace = "";
              el.style.width = "";
            }
            changed = true;
          }
          // Taller rows move the text, and a wrapped label has a new height: measure again.
          if (changed) view.requestMeasure();
        },
      });
    }
  },
);
