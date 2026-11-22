import { type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { presentScreenplay } from "./editor-presentation";
import type { FountainDocument } from "./fountain";
import { sceneNumberSuggestions } from "./production-numbering";
import { parsedSource } from "./syntax";

/** Numbers are editor furniture, never source text until explicitly accepted. */
export function sceneNumberMargins(accept: (line: number, number: string) => void): Extension {
  class NumberWidget extends WidgetType {
    constructor(
      readonly number: string,
      readonly suggested: boolean,
    ) {
      super();
    }
    eq(other: NumberWidget) {
      return this.number === other.number && this.suggested === other.suggested;
    }
    toDOM(view: EditorView) {
      const wrap = document.createElement("span");
      wrap.className = "studio-scene-numbers";
      for (const side of ["left", "right"]) {
        const control = document.createElement(this.suggested ? "button" : "span");
        control.className = `studio-scene-number${this.suggested ? " is-suggested" : ""}${side === "right" ? " scene-number-right" : ""}`;
        const number = document.createElement("span");
        number.textContent = this.number;
        control.append(number);
        if (control instanceof HTMLButtonElement) {
          control.type = "button";
          const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ Option N" : "Ctrl Alt N";
          const label = `Accept scene number ${this.number}`;
          control.title = `Suggested scene ${this.number} · not included in PDF. ${label} (${shortcut}) to add #${this.number}#.`;
          control.setAttribute("aria-label", label);
          const arrow = document.createElement("span");
          arrow.className = "scene-number-accept-icon";
          arrow.textContent = "↵";
          arrow.setAttribute("aria-hidden", "true");
          control.append(arrow);
          control.onmousedown = (event) => event.preventDefault();
          control.onclick = () => {
            const line = view.state.doc.lineAt(view.posAtDOM(wrap)).number;
            accept(line, this.number);
          };
        } else {
          control.title = `Committed scene ${this.number} · included in PDF.`;
          control.setAttribute("aria-hidden", "true");
        }
        wrap.append(control);
      }
      return wrap;
    }
    ignoreEvent() {
      return true;
    }
  }
  function decorate(source: string, parsed: FountainDocument): DecorationSet {
    const suggestions = new Map<number, string>();
    try {
      for (const item of sceneNumberSuggestions(source, parsed))
        suggestions.set(item.line, item.number);
    } catch {
      /* Explicit actions report unsafe or incomplete numbering context. */
    }
    const ranges: Range<Decoration>[] = [];
    for (const element of parsed.elements) {
      if (element.kind !== "scene") continue;
      const number = element.sceneNumber ?? suggestions.get(element.line);
      if (!number) continue;
      ranges.push(Decoration.line({ class: "studio-numbered-heading" }).range(element.from));
      ranges.push(
        Decoration.widget({
          widget: new NumberWidget(number, !element.sceneNumber),
          side: -1,
        }).range(element.from),
      );
    }
    return Decoration.set(ranges, true);
  }
  return StateField.define<DecorationSet>({
    create(state) {
      return state.doc.length <= 16_384
        ? decorate(state.doc.toString(), parsedSource(state.doc))
        : Decoration.none;
    },
    update(value, tr) {
      for (const effect of tr.effects)
        if (effect.is(presentScreenplay)) return decorate(tr.newDoc.toString(), effect.value);
      if (!tr.docChanged) return value;
      if (tr.newDoc.length <= 16_384)
        return decorate(tr.newDoc.toString(), parsedSource(tr.newDoc));
      // Keep stable numbers during ordinary prose typing. Structural edits can
      // change ordering; hide those suggestions until the fresh worker result.
      let structural = false;
      tr.changes.iterChanges((from, to, _c, _d, inserted) => {
        if (
          inserted.lines > 1 ||
          tr.startState.doc.lineAt(from).number !== tr.startState.doc.lineAt(to).number
        )
          structural = true;
        const first = tr.startState.doc.lineAt(from).from;
        const last = tr.startState.doc.lineAt(to).to;
        value.between(first, last, (_from, _to, decoration) => {
          if (decoration.spec.class === "studio-numbered-heading") structural = true;
        });
        if (/[#\[\]/*]/.test(inserted.toString())) structural = true;
      });
      return structural ? Decoration.none : value.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
