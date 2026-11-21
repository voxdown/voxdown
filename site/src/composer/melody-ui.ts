/**
 * Edit › Find melody…: a panel beside the text. The melody is typed as ABC notes (read in the
 * current tune's key), taken from the selection, or played on a MIDI keyboard. Results list each
 * place it is played; choosing one selects its notes in the text and the score; F3 and Shift F3
 * step through them.
 */
import "./melody.css";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  DEFAULT_OPTIONS,
  type MelodyMatch,
  type MelodyOptions,
  describeMatch,
  queryNotes,
  searchFile,
} from "./melody";
import { type Draft, getDraft, listDrafts } from "./storage";
import { type FileIndex, type TuneInfo, indexFile, tuneAt } from "./tunes";

export type MelodyContext = {
  view: EditorView;
  file: () => FileIndex;
  /** The id of this tab's draft, left out of "every draft". */
  draftId: () => string;
  /** Opens another draft, then selects ranges in it. */
  openDraft: (id: string, ranges: { from: number; to: number }[]) => void;
  /** Spells MIDI pitches as ABC in a key (from the keyboard module), when the keyboard is on. */
  keyboard: () => Promise<{
    listen: (take: (pitches: number[]) => void) => () => void;
    spell: (pitches: number[], key: string) => string;
    status: () => string;
  } | null>;
};

type Scope = "tune" | "file" | "drafts";
type Found = MelodyMatch & { draft?: { id: string; name: string } };

let panel: HTMLElement | null = null;
let results: Found[] = [];
let current = -1;
let context: MelodyContext | null = null;
let stopListening: (() => void) | null = null;

function element(
  tag: string,
  props: Record<string, unknown> = {},
  ...children: (Node | string)[]
): HTMLElement {
  const made = Object.assign(document.createElement(tag), props);
  made.append(...children);
  return made;
}

/** The key and unit the typed notes are read in: the current tune's. */
function readingOf(
  view: EditorView,
  file: FileIndex,
): { key: string; unit: string; tune: TuneInfo | null } {
  const tune = tuneAt(file, view.state.selection.main.head);
  return {
    key: tune?.key.split(/\s+/)[0] || "C",
    unit: tune?.unit || "1/8",
    tune,
  };
}

/** Selects a match's notes in the text (the score follows the selection). */
function choose(at: number) {
  if (!context || !results.length) return;
  current = ((at % results.length) + results.length) % results.length;
  const match = results[current] as Found;
  for (const [index, row] of [...(panel?.querySelectorAll(".melody-result") ?? [])].entries())
    row.setAttribute("aria-current", String(index === current));
  panel?.querySelector(".melody-result[aria-current='true']")?.scrollIntoView({ block: "nearest" });
  const count = panel?.querySelector(".melody-count");
  if (count) count.textContent = `${current + 1} of ${results.length}`;
  if (match.draft) {
    context.openDraft(match.draft.id, match.ranges);
    return;
  }
  const { view } = context;
  view.dispatch({
    selection: EditorSelection.create(
      match.ranges.map((range) => EditorSelection.range(range.from, range.to)),
      0,
    ),
    effects: [],
    scrollIntoView: true,
  });
}

/** F3 and Shift F3: the next or previous match; false when there are none to step through. */
export function stepMelody(direction: 1 | -1): boolean {
  if (!panel || !results.length) return false;
  choose(current + direction);
  return true;
}

export function closeMelody() {
  stopListening?.();
  stopListening = null;
  panel?.remove();
  panel = null;
  results = [];
  current = -1;
}

/** Opens the panel; with notes selected, it starts from them. */
export async function openMelody(given: MelodyContext, fromSelection = false) {
  context = given;
  const { view } = given;
  if (!panel) build(given);
  const input = panel?.querySelector<HTMLInputElement>("#melody-query") as HTMLInputElement;
  const selection = view.state.selection.ranges.filter((range) => !range.empty);
  if (fromSelection && selection.length)
    input.value = selection
      .map((range) => view.state.sliceDoc(range.from, range.to))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  input.focus();
  input.select();
  await search();
}

let timer: ReturnType<typeof setTimeout> | undefined;
function build(given: MelodyContext) {
  const query = element("input", {
    id: "melody-query",
    type: "text",
    placeholder: "dfed cBAG",
    autocomplete: "off",
    spellcheck: false,
  }) as HTMLInputElement;
  query.setAttribute("aria-describedby", "melody-reading");
  const reading = element("p", { id: "melody-reading", className: "melody-reading" });
  const fromSelection = element("button", { type: "button", textContent: "From the selection" });
  const fromKeyboard = element("button", { type: "button", textContent: "From the keyboard" });
  fromKeyboard.setAttribute("aria-pressed", "false");
  const mode = element("select", { id: "melody-mode" }) as HTMLSelectElement;
  mode.append(
    element("option", { value: "intervals", textContent: "Exact intervals" }),
    element("option", { value: "contour", textContent: "Contour (up, down, same)" }),
  );
  const rhythm = element("input", { type: "checkbox", id: "melody-rhythm" }) as HTMLInputElement;
  const repeats = element("input", {
    type: "checkbox",
    id: "melody-repeats",
    checked: true,
  }) as HTMLInputElement;
  const scope = element("select", { id: "melody-scope" }) as HTMLSelectElement;
  scope.append(
    element("option", { value: "tune", textContent: "This tune" }),
    element("option", { value: "file", textContent: "This file", selected: true }),
    element("option", { value: "drafts", textContent: "Every draft in this browser" }),
  );
  const count = element("p", { className: "melody-count", textContent: "" });
  count.setAttribute("role", "status");
  const list = element("ol", { className: "melody-results" });
  const close = element("button", {
    type: "button",
    className: "melody-close",
    textContent: "Close",
  });
  const label = (text: string, control: HTMLElement) => {
    const made = element("label", {}, text, control);
    return made;
  };
  const check = (control: HTMLInputElement, text: string) =>
    element("label", { className: "melody-check" }, control, ` ${text}`);
  panel = element(
    "section",
    { id: "melody-panel", className: "melody-panel" },
    element(
      "div",
      { className: "melody-head" },
      element("h2", { textContent: "Find melody" }),
      close,
    ),
    label("Notes", query),
    reading,
    element("div", { className: "melody-sources" }, fromSelection, fromKeyboard),
    element(
      "div",
      { className: "melody-options" },
      label("Match", mode),
      label("Search", scope),
      check(repeats, "Ignore repeated notes"),
      check(rhythm, "Same rhythm"),
    ),
    count,
    list,
  );
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Find melody");
  document.body.append(panel);
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void search(), 120);
  };
  query.addEventListener("input", later);
  for (const control of [mode, rhythm, repeats, scope])
    control.addEventListener("change", () => void search());
  query.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      choose(event.shiftKey ? current - 1 : current + 1);
    }
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMelody();
      given.view.focus();
    } else if (event.key === "F3") {
      event.preventDefault();
      stepMelody(event.shiftKey ? -1 : 1);
    }
  });
  close.addEventListener("click", () => {
    closeMelody();
    given.view.focus();
  });
  fromSelection.addEventListener("click", () => void openMelody(given, true));
  fromKeyboard.addEventListener("click", async () => {
    if (stopListening) {
      stopListening();
      stopListening = null;
      fromKeyboard.setAttribute("aria-pressed", "false");
      return;
    }
    const keyboard = await given.keyboard();
    if (!keyboard) {
      count.textContent = "Turn on a MIDI keyboard in Play › MIDI keyboard… first.";
      return;
    }
    fromKeyboard.setAttribute("aria-pressed", "true");
    count.textContent = `Play the melody: ${keyboard.status()}`;
    stopListening = keyboard.listen((pitches) => {
      const { key } = readingOf(given.view, given.file());
      query.value = `${query.value} ${keyboard.spell(pitches, key)}`.trim();
      later();
    });
  });
}

let generation = 0;
async function search() {
  if (!panel || !context) return;
  const run = ++generation;
  const { view } = context;
  const file = context.file();
  const query = (panel.querySelector("#melody-query") as HTMLInputElement).value;
  const options: MelodyOptions = {
    ...DEFAULT_OPTIONS,
    mode: (panel.querySelector("#melody-mode") as HTMLSelectElement).value as MelodyOptions["mode"],
    rhythm: (panel.querySelector("#melody-rhythm") as HTMLInputElement).checked,
    foldRepeats: (panel.querySelector("#melody-repeats") as HTMLInputElement).checked,
  };
  const scope = (panel.querySelector("#melody-scope") as HTMLSelectElement).value as Scope;
  const reading = readingOf(view, file);
  (panel.querySelector("#melody-reading") as HTMLElement).textContent =
    `Read in K:${reading.key}, the current tune's key. Any key, octave and length matches.`;
  const notes = queryNotes(query, reading.key, reading.unit);
  const count = panel.querySelector(".melody-count") as HTMLElement;
  const list = panel.querySelector(".melody-results") as HTMLElement;
  if (notes.length < 2) {
    results = [];
    current = -1;
    list.replaceChildren();
    count.textContent = query.trim() ? "Write two notes or more." : "";
    return;
  }
  const started = performance.now();
  const text = view.state.doc.toString();
  const found: Found[] =
    scope === "tune"
      ? reading.tune
        ? searchFile(notes, text, file, options, reading.tune)
        : []
      : searchFile(notes, text, file, options);
  if (scope === "drafts") {
    const others = (await listDrafts(200)).filter((draft) => draft.id !== context?.draftId());
    for (const summary of others) {
      const draft: Draft | undefined = await getDraft(summary.id).catch(() => undefined);
      if (!draft) continue;
      const draftFile = indexFile(draft.text);
      for (const match of searchFile(notes, draft.text, draftFile, options))
        found.push({ ...match, draft: { id: draft.id, name: draft.name } });
    }
  }
  if (run !== generation) return;
  results = found;
  current = -1;
  const took = Math.round(performance.now() - started);
  list.replaceChildren(
    ...found.slice(0, 500).map((match, index) => {
      const row = element(
        "button",
        { type: "button", className: "melody-result" },
        element("span", {
          className: "melody-where",
          textContent: `${match.draft ? `${match.draft.name}: ` : ""}${describeMatch(match)}`,
        }),
        element("code", { textContent: match.excerpt }),
      );
      row.addEventListener("click", () => choose(index));
      return element("li", {}, row);
    }),
  );
  count.textContent = results.length
    ? `${results.length} ${results.length === 1 ? "match" : "matches"} (${took} ms). F3 for the next, Shift F3 the previous.`
    : "No match.";
}
