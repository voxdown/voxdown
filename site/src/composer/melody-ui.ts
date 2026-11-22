/**
 * Edit › Find melody…: a panel beside the text. The melody is typed as ABC notes (read in the
 * current tune's key), taken from the selection, or played on a MIDI keyboard. Results list each
 * place it is played; choosing one selects its notes in the text and the score; F3 and Shift F3
 * step through them.
 */
import "./melody.css";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { dockPanel, undockPanel } from "./dock";
import {
  DEFAULT_OPTIONS,
  type MelodyMatch,
  type MelodyOptions,
  describeMatch,
  mapMatches,
  queryFromSelection,
  queryNotes,
  rankMatches,
  searchFile,
} from "./melody";
import { type Draft, draftIds, getDraft } from "./storage";
import { type FileIndex, type TuneInfo, indexFile, tuneAt } from "./tunes";

export type MelodyContext = {
  view: EditorView;
  file: () => FileIndex;
  /** The id of this tab's draft, left out of "every draft". */
  draftId: () => string;
  /** Opens another draft, then selects ranges in it. */
  openDraft: (id: string, ranges: { from: number; to: number }[]) => void;
  /** Brings the lit match into view in the score. */
  reveal?: () => void;
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
/** Results drawn so far; more are drawn on request. */
const PAGE = 500;
let shown = 0;
const phone = () => window.matchMedia("(max-width: 760px)").matches;

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

/**
 * After every edit: the results mapped through it, those it touched dropped (round 8, item 5),
 * and the list drawn again, the current one kept.
 */
export function mapMelody(changes: Parameters<typeof mapMatches>[2], length: number) {
  if (!panel || !results.length) return;
  const mapped = mapMatches(results, current, changes, length);
  if (mapped.matches.length === results.length && mapped.current === current) {
    results = mapped.matches;
    return;
  }
  results = mapped.matches;
  current = mapped.current;
  const list = panel.querySelector(".melody-results");
  if (list) list.replaceChildren();
  shown = 0;
  showMore();
  for (const [index, row] of [...panel.querySelectorAll(".melody-result")].entries())
    row.setAttribute("aria-current", String(index === current));
  const count = panel.querySelector(".melody-count");
  if (count)
    count.textContent = results.length
      ? `${results.length} ${results.length === 1 ? "match" : "matches"} left`
      : "No matches left: search again.";
}

/** Selects a match's notes in the text (the score follows the selection). */
function choose(at: number) {
  if (!context || !results.length) return;
  current = ((at % results.length) + results.length) % results.length;
  const match = results[current] as Found;
  // (Never outside the text, whatever happened to it since.)
  const length = context.view.state.doc.length;
  const inside = match.draft
    ? match.ranges
    : match.ranges
        .map((range) => ({ from: Math.min(range.from, length), to: Math.min(range.to, length) }))
        .filter((range) => range.from <= range.to);
  while (current >= shown) showMore();
  // On a phone the panel folds to one line, so the match is in view.
  panel?.classList.toggle("collapsed", phone());
  for (const [index, row] of [...(panel?.querySelectorAll(".melody-result") ?? [])].entries())
    row.setAttribute("aria-current", String(index === current));
  panel?.querySelector(".melody-result[aria-current='true']")?.scrollIntoView({ block: "nearest" });
  const count = panel?.querySelector(".melody-count");
  if (count) count.textContent = `${current + 1} of ${results.length}`;
  const where = panel?.querySelector(".melody-bar-count");
  if (where) where.textContent = `${current + 1} of ${results.length}`;
  if (match.draft) {
    context.openDraft(match.draft.id, match.ranges);
    return;
  }
  const { view } = context;
  if (!inside.length) return;
  view.dispatch({
    selection: EditorSelection.create(
      inside.map((range) => EditorSelection.range(range.from, range.to)),
      0,
    ),
    effects: EditorView.scrollIntoView(Math.min(match.from, length), { y: "center" }),
  });
  context.reveal?.();
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
  if (panel) undockPanel(panel);
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
  if (fromSelection && selection.length) {
    // The notes the selection plays, not its text (./melody's queryFromSelection).
    const found = queryFromSelection(
      view.state.doc.toString(),
      given.file(),
      selection.map((range) => ({ from: range.from, to: range.to })),
      Math.max(0, selection.indexOf(view.state.selection.main)),
    );
    if (found) input.value = found.query;
  }
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
  // On a phone, once a result is chosen: one line ("2 of 7 ‹ › Close"); the count opens it again.
  const barCount = element("button", {
    type: "button",
    className: "melody-bar-count",
    title: "Show the search",
  });
  barCount.addEventListener("click", () => panel?.classList.remove("collapsed"));
  const previous = element("button", { type: "button", textContent: "‹", title: "Previous match" });
  previous.setAttribute("aria-label", "Previous match");
  previous.addEventListener("click", () => stepMelody(-1));
  const next = element("button", { type: "button", textContent: "›", title: "Next match" });
  next.setAttribute("aria-label", "Next match");
  next.addEventListener("click", () => stepMelody(1));
  const barClose = element("button", { type: "button", textContent: "Close" });
  barClose.addEventListener("click", () => {
    closeMelody();
    given.view.focus();
  });
  const bar = element("div", { className: "melody-bar" }, barCount, previous, next, barClose);
  panel = element(
    "section",
    { id: "melody-panel", className: "melody-panel" },
    bar,
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
  dockPanel(panel, () => {
    closeMelody();
    given.view.focus();
  });
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
    if (event.key === "F3") {
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

/** What the typed notes are read as, and what counts as a match, as the options stand. */
function hint(key: string, options: MelodyOptions): string {
  const read = `Read in K:${key}, the current tune's key.`;
  if (options.mode === "contour")
    return `${read} Any key, octave and length matches; only the ups and downs count${options.rhythm ? ", with the same relative lengths" : ""}.`;
  return options.rhythm
    ? `${read} Any key and octave matches, with the same relative lengths.`
    : `${read} Any key, octave and length matches.`;
}

/** Draws the next page of results, with "Show more" while some are left. */
function showMore() {
  const list = panel?.querySelector(".melody-results");
  if (!list) return;
  list.querySelector(".melody-more")?.remove();
  const end = Math.min(results.length, shown + PAGE);
  for (let index = shown; index < end; index++) {
    const match = results[index] as Found;
    const row = element(
      "button",
      { type: "button", className: "melody-result" },
      element("span", {
        className: "melody-where",
        textContent: `${match.draft ? `${match.draft.name}: ` : ""}${describeMatch(match)}`,
      }),
      element("code", { textContent: match.excerpt }),
      ...(match.folded
        ? [element("span", { className: "melody-folded", textContent: "repeats folded" })]
        : []),
    );
    row.addEventListener("click", () => choose(index));
    list.append(element("li", {}, row));
  }
  shown = end;
  if (shown < results.length) {
    const more = element("button", {
      type: "button",
      className: "melody-more-button",
      textContent: `Showing ${shown.toLocaleString("en")} of ${results.length.toLocaleString("en")}. Show ${Math.min(PAGE, results.length - shown)} more`,
    });
    more.addEventListener("click", showMore);
    list.append(element("li", { className: "melody-more" }, more));
  }
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
  (panel.querySelector("#melody-reading") as HTMLElement).textContent = hint(reading.key, options);
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
    // Every draft, read one at a time.
    const ids = (await draftIds()).filter((id) => id !== context?.draftId());
    for (const [index, id] of ids.entries()) {
      if (run !== generation) return;
      if (index % 20 === 0) count.textContent = `Searching drafts… ${index} of ${ids.length}`;
      const draft: Draft | undefined = await getDraft(id).catch(() => undefined);
      if (!draft || typeof draft.text !== "string") continue;
      const draftFile = indexFile(draft.text);
      for (const match of searchFile(notes, draft.text, draftFile, options))
        found.push({ ...match, draft: { id: draft.id, name: draft.name } });
    }
  }
  if (run !== generation) return;
  results = rankMatches(found);
  current = -1;
  shown = 0;
  const took = Math.round(performance.now() - started);
  list.replaceChildren();
  showMore();
  panel.classList.remove("collapsed");
  count.textContent = results.length
    ? `${results.length.toLocaleString("en")} ${results.length === 1 ? "match" : "matches"} (${took} ms), closest first. F3 for the next, Shift F3 the previous.`
    : "No match.";
}
