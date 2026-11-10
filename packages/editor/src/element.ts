/**
 * `<voxdown-editor>`: the script editor as a web component, for pages that don't use CodeMirror
 * themselves. Import `@voxdown/editor/element` once and write the tag:
 *
 *   <voxdown-editor show-marks>@Gerald “Could you not?”</voxdown-editor>
 *
 * The story is its `value`. It fires `input` on every change and `change` when it loses focus
 * after one. Characters and their colors come from the story itself: its cast, then every name it
 * marks. Style it with the `--vxd-*` variables (see the editor's theme); they reach inside.
 */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { characterColors, parse } from "voxdown";
import type { Character } from "./decorations";
import { setShowMarks } from "./decorations";
import { scriptEditor } from "./index";

/** The characters a story names, with their colors, as the editor wants them. */
export function charactersOf(text: string): Character[] {
  const story = parse(text);
  return [...characterColors(story)].map(([handle, color]) => {
    const member = story.cast.find((entry) => entry.handle === handle);
    return {
      handle,
      name: member?.name ?? handle,
      color,
      ...(member ? {} : { provisional: true }),
    };
  });
}

/** Indentation the HTML gave the story, and the blank line after the tag, aren't part of it. */
function dedent(text: string): string {
  const lines = text
    .replace(/^\s*\n/, "")
    .replace(/\n\s*$/, "")
    .split("\n");
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(cut)).join("\n");
}

export class VoxdownEditorElement extends HTMLElement {
  static observedAttributes = ["show-marks", "readonly"];

  #view: EditorView | null = null;
  #value: string | null = null;
  #characters: Character[] = [];
  #changed = false;
  readonly #editable = new Compartment();

  /** The story as written. */
  get value(): string {
    return this.#view ? this.#view.state.doc.toString() : (this.#value ?? this.#initial());
  }

  set value(text: string) {
    if (!this.#view) {
      this.#value = text;
      return;
    }
    if (text === this.value) return;
    this.#view.dispatch({ changes: { from: 0, to: this.#view.state.doc.length, insert: text } });
  }

  /** The CodeMirror view, for hosts that want to add their own extensions or commands. */
  get view(): EditorView | null {
    return this.#view;
  }

  connectedCallback(): void {
    if (this.#view) return;
    const given = this.#value !== null || this.hasAttribute("value") || this.hasChildNodes();
    if (given) this.#mount();
    // Made by the HTML parser or innerHTML, it is in the page before its children are: wait for
    // them, until the document has loaded if it is still loading.
    else if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.#mount(), { once: true });
    } else queueMicrotask(() => this.#mount());
  }

  #mount(): void {
    if (this.#view || !this.isConnected) return;
    const text = this.#value ?? this.#initial();
    this.#characters = charactersOf(text);
    this.textContent = "";
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ":host { display: block; } .cm-editor { height: 100%; }";
    root.append(style);
    this.#view = new EditorView({
      root,
      parent: root,
      doc: text,
      extensions: [
        scriptEditor({
          characters: () => this.#characters,
          showMarks: this.hasAttribute("show-marks"),
          smartQuotes: this.getAttribute("smart-quotes") !== "off",
        }),
        this.#editable.of(this.#readOnly()),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.#characters = charactersOf(update.state.doc.toString());
            this.#changed = true;
            this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          }
          if (update.focusChanged && !update.view.hasFocus && this.#changed) {
            this.#changed = false;
            this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          }
        }),
      ],
    });
  }

  disconnectedCallback(): void {
    // Kept, so the element can be moved in the page without losing its story or undo history.
  }

  attributeChangedCallback(name: string): void {
    if (!this.#view) return;
    if (name === "show-marks") {
      this.#view.dispatch({ effects: setShowMarks.of(this.hasAttribute("show-marks")) });
    } else if (name === "readonly") {
      this.#view.dispatch({ effects: this.#editable.reconfigure(this.#readOnly()) });
    }
  }

  /** Puts the cursor in the story. */
  override focus(): void {
    this.#view?.focus();
  }

  #readOnly() {
    const readOnly = this.hasAttribute("readonly");
    return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
  }

  /** The story given in the page: a `value` attribute, a `<script type="text/voxdown">`, or text. */
  #initial(): string {
    const attribute = this.getAttribute("value");
    if (attribute !== null) return attribute;
    const script = this.querySelector('script[type="text/voxdown"]');
    return dedent(script ? (script.textContent ?? "") : (this.textContent ?? ""));
  }
}

/** Registers the element, as `voxdown-editor` unless another name is given. */
export function defineVoxdownEditor(name = "voxdown-editor"): void {
  if (!customElements.get(name)) customElements.define(name, class extends VoxdownEditorElement {});
}

declare global {
  interface HTMLElementTagNameMap {
    "voxdown-editor": VoxdownEditorElement;
  }
}
