/**
 * VoxDown Writer: a story's own file, opened, written and saved back, with its scenes down the left
 * and what it becomes on the right. Everything runs in the browser. The story is kept in this
 * browser as it is typed, so a closed tab loses nothing, and goes to a file only when it is saved.
 */
import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap } from "@codemirror/view";
import {
  type Character,
  type ViewSwitches,
  marksField,
  scriptEditor,
  setShowMarks,
  setView,
  showMarksField,
} from "@voxdown/editor";
import {
  characterColors,
  escapeHtml,
  renderBook,
  renderDocument,
  renderScript,
  stylesheet,
} from "@voxdown/render";
import {
  type Story,
  type TextChange,
  bookText,
  format,
  insertLine,
  insertSound,
  lines,
  linesToCsv,
  parse,
  renameCharacter,
  setFullName,
  textByCharacter,
} from "voxdown";
import { examples } from "../examples";
import "../style.css";
import "./writer.css";
import "../theme";
import { castPanel } from "./cast";
import {
  type Opened,
  asStory,
  download,
  keepsFiles,
  mayWriteNow,
  onDisk,
  pickFile,
  pickSaveTarget,
  reopen,
  writeFile,
} from "./files";
import { DraftLock } from "./lock";
import { keys, menus } from "./menu";
import { moveParagraph } from "./paragraphs";
import { SceneRail } from "./rail";
import { type Draft, forgetFile, keepDraft, loadDraft, recentFiles, rememberFile } from "./store";
import { type Speaker, StretchTools, speechAt, speechOfMark } from "./stretch";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;

const rendererStyle = document.createElement("style");
rendererStyle.textContent = stylesheet;
document.head.append(rendererStyle);

// What the writer chose to see, kept on this computer.

type Tab = "script" | "book" | "cast" | "warnings";
type Prefs = ViewSwitches & { marks: boolean; side: boolean; tab: Tab; autosave: boolean };
const PREFS_KEY = "vxd-writer-view";
const prefs: Prefs = {
  color: true,
  names: true,
  directions: true,
  sounds: true,
  vocal: true,
  pages: true,
  notes: true,
  marks: false,
  side: window.matchMedia("(min-width: 1100px)").matches,
  tab: "script",
  autosave: true,
  ...savedPrefs(),
};

function savedPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
  } catch {
    return {};
  }
}

function keepPrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Kept for this visit only.
  }
}

// The story being written, and its file.

const file = {
  name: "Untitled.vxd",
  handle: undefined as FileSystemFileHandle | undefined,
  /** The text as last opened or saved: the story has changes to save while it differs. */
  saved: "",
  savedAt: undefined as number | undefined,
  /** When the file was last changed on disk, as the Writer last read or wrote it. */
  modified: undefined as number | undefined,
  changedAt: Date.now(),
  /** Whether the browser kept the last draft. */
  kept: true,
};
let story: Story = parse("");
let colors = new Map<string, string>();
/** Each change to the text counts up; the story is current when it was read at the latest. */
let version = 0;
let storyVersion = 0;

/** The story as the editor has it now: read again if the text changed since. */
function current(): Story {
  if (storyVersion !== version) refresh();
  return story;
}

const characters = (): readonly Character[] =>
  [...colors].map(([handle, color]) => ({
    handle,
    name: story.cast.find((member) => member.handle === handle)?.name ?? handle,
    color,
    ...(story.cast.some((member) => member.handle === handle) ? {} : { provisional: true }),
  }));

/** The text as it will be saved: with the line breaks the story came with. */
const text = () => view.state.sliceDoc();

/** CRLF where every line of the text ends so (§4.1); the editor works on `\n` throughout. */
const lineBreaks = (source: string): Extension =>
  source.includes("\r\n") && !/(?:^|[^\r])\n|\r(?!\n)/.test(source)
    ? EditorState.lineSeparator.of("\r\n")
    : [];

/** Read only while another tab writes the story. */
const editable = new Compartment();
let lockedOut = false;
const editability = () =>
  lockedOut ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];

function editorState(source: string, cursor: number): EditorState {
  return EditorState.create({
    doc: source,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      lineBreaks(source),
      editable.of(editability()),
      // The browser's spelling check, in the story's own language.
      EditorView.contentAttributes.of(() => ({
        spellcheck: "true",
        autocapitalize: "sentences",
        lang: story.meta.language ?? "en",
      })),
      history(),
      search({ top: true }),
      Prec.high(
        keymap.of([
          { key: "Alt-ArrowUp", run: (v) => moveParagraph(v, -1, frontMatterEnd()) },
          { key: "Alt-ArrowDown", run: (v) => moveParagraph(v, 1, frontMatterEnd()) },
        ]),
      ),
      keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
      warningTips,
      scriptEditor({
        characters,
        onNameClick: (_view, at) => {
          const speech = speechOfMark(current(), at.from);
          if (speech) tools.openSpeaker(speech.range.from);
        },
        showMarks: prefs.marks,
        view: {
          color: prefs.color,
          names: prefs.names,
          directions: prefs.directions,
          sounds: prefs.sounds,
          vocal: prefs.vocal,
          pages: prefs.pages,
          notes: prefs.notes,
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          version++;
          tools.hide();
          changed();
        }
        if (update.docChanged || update.selectionSet) cursorMoved();
        const raw = update.state.field(showMarksField);
        if (raw !== prefs.marks) {
          prefs.marks = raw;
          keepPrefs();
          checkMenu("marks", raw);
        }
      }),
      EditorView.contentAttributes.of({ "aria-label": "Story" }),
    ],
  });
}

/** Where the front matter ends, which a paragraph never moves above. */
const frontMatterEnd = () => current().frontMatter?.range.to ?? null;

/** A warning's message, and its fix as one click, over the words it underlines. */
const warningTips = hoverTooltip((tipView, at) => {
  const mark = tipView.state
    .field(marksField)
    .find((m) => m.kind === "warning" && m.from <= at && at <= m.to);
  if (!mark || mark.kind !== "warning") return null;
  return {
    pos: mark.from,
    end: mark.to,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "warning-tip";
      const message = document.createElement("span");
      message.textContent = mark.message;
      dom.append(message);
      const fix = mark.fix;
      if (fix) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button";
        button.textContent = fix.label ?? "Fix it";
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          if (tipView.state.readOnly) return;
          tipView.dispatch({ changes: fix, userEvent: "input.fix" });
          tipView.focus();
        });
        dom.append(button);
      }
      return { dom };
    },
  };
});

const view = new EditorView({ parent: $("#editor"), state: editorState("", 0) });
const rail = new SceneRail($("#scene-rail"), view);
// The editor's listeners use it only once the story changes, after it is made.
const tools: StretchTools = new StretchTools({
  view,
  host: $(".manuscript"),
  story: current,
  speakers,
  apply,
});

/** Everyone a passage can be given to: the narrator, the cast, and anyone else the story names. */
function speakers(): Speaker[] {
  const now = current();
  const narrator = now.meta.narrator;
  const names = [...colors.keys()];
  if (!names.some((name) => name.toLowerCase() === narrator.toLowerCase())) names.unshift(narrator);
  const rank = (name: string) =>
    name.toLowerCase() === narrator.toLowerCase()
      ? -1
      : (() => {
          const at = now.cast.findIndex((m) => m.handle.toLowerCase() === name.toLowerCase());
          return at < 0 ? now.cast.length : at;
        })();
  return names
    .sort((a, b) => rank(a) - rank(b))
    .map((handle) => ({
      handle,
      name: now.cast.find((m) => m.handle === handle)?.name ?? handle,
      ...(colors.get(handle) ? { color: colors.get(handle) as string } : {}),
    }));
}

/** Makes one of the core's edits, as one step to undo; with none, says why. */
function apply(changes: TextChange[], declined: string): boolean {
  if (lockedOut) {
    notice("This story is being written in another tab: choose Write here instead first.");
    return false;
  }
  if (changes.length === 0) {
    notice(declined);
    return false;
  }
  view.dispatch({
    changes: changes.map(({ from, to, insert }) => ({ from, to, insert })),
    userEvent: "input.edit",
  });
  refresh();
  return true;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
/** A word to the writer at the foot of the manuscript, for a few seconds. */
function notice(message: string): void {
  const box = $("#notice");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    box.hidden = true;
  }, 6000);
}

/** Puts a story in the editor, with a fresh undo history, the cursor where the story starts. */
function load(
  opened: Opened,
  kept: { saved?: string; savedAt?: number; changedAt?: number; modified?: number } = {},
): Promise<void> {
  file.name = opened.name;
  file.handle = opened.handle;
  file.modified = opened.modified ?? kept.modified;
  // A file read from disk is saved as it is; a screenplay made a story, an example or a new story
  // has yet to be.
  file.saved = kept.saved ?? (opened.imported ? "" : opened.text);
  file.savedAt = kept.savedAt;
  file.changedAt = kept.changedAt ?? Date.now();
  const lf = opened.text.replace(/\r\n/g, "\n");
  const front = parse(lf).frontMatter;
  const start = front ? Math.min(front.range.to + 2, lf.length) : 0;
  view.setState(editorState(opened.text, start));
  view.scrollDOM.scrollTop = 0;
  $("#welcome").hidden = true;
  document.body.removeAttribute("data-welcome");
  $("#file-name").textContent = file.name;
  refresh();
  return keep();
}

// After each change: the views a moment later, and the draft kept a moment after that.

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let keepTimer: ReturnType<typeof setTimeout> | undefined;

/** Above this length, a story is long: what isn't needed at once waits for a longer pause. */
const LONG = 30_000;

function changed(): void {
  file.changedAt = Date.now();
  showSaveState(true);
  clearTimeout(refreshTimer);
  cancelIdle();
  refreshTimer = setTimeout(refresh, view.state.doc.length < LONG ? 150 : 450);
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => void keep(), 700);
  scheduleAutosave();
}

/**
 * The story read again, and what shows it: the rail and the save state at once; the counts, the
 * warnings and the side for a short story too, and for a long one when the browser is idle, so a
 * pause in typing never holds the next key.
 */
function refresh(): void {
  clearTimeout(refreshTimer);
  story = parse(view.state.doc.toString());
  storyVersion = version;
  colors = characterColors(story);
  rail.update(story);
  showSaveState();
  cancelIdle();
  if (view.state.doc.length < LONG) showRest();
  else whenIdle(showRest);
}

function showRest(): void {
  if (storyVersion !== version) return;
  showCounts();
  showWarningCount();
  if (prefs.side) showSide();
}

let idle: number | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
function whenIdle(run: () => void): void {
  // A moment of quiet first, then the browser's own idle time where it has one.
  idleTimer = setTimeout(() => {
    if ("requestIdleCallback" in window) idle = window.requestIdleCallback(run, { timeout: 2000 });
    else run();
  }, 400);
}
function cancelIdle(): void {
  clearTimeout(idleTimer);
  if (idle !== undefined && "cancelIdleCallback" in window) window.cancelIdleCallback(idle);
  idle = undefined;
}

async function keep(): Promise<void> {
  clearTimeout(keepTimer);
  // Another tab writes the story: this one keeps nothing over it.
  if (!lock.owner) return;
  file.kept = await keepDraft({
    name: file.name,
    text: text(),
    saved: file.saved,
    changedAt: file.changedAt,
    ...(file.handle ? { handle: file.handle } : {}),
    ...(file.savedAt ? { savedAt: file.savedAt } : {}),
    ...(file.modified !== undefined ? { modified: file.modified } : {}),
  });
  showDraftState();
}

// What the bars say.

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Saved, or changes to save. Right after a change, without comparing the whole text yet. */
function showSaveState(edited = false): void {
  const unsaved = edited || text() !== file.saved;
  const state = $("#save-state");
  const words = unsaved
    ? file.saved === "" && !file.handle
      ? "Not saved yet"
      : "Edited"
    : file.savedAt
      ? `Saved ${time(file.savedAt)}`
      : "Saved";
  if (state.textContent !== words) state.textContent = words;
  state.dataset.state = unsaved ? "unsaved" : "saved";
  $("#save-button").classList.toggle("needed", unsaved);
  // The tab says so too: a dot before the name while there are changes to save.
  const title = `${unsaved ? "• " : ""}${file.name} · VoxDown Writer`;
  if (document.title !== title) document.title = title;
}

/** Said to a screen reader: saves, failures and what came back, never each keystroke. */
function announce(message: string): void {
  const live = $("#announce");
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = message;
  });
}

function showDraftState(): void {
  const state = $("#draft-state");
  state.textContent = file.kept
    ? "Kept in this browser"
    : "This browser won't keep a draft: save to a file";
  state.dataset.kept = String(file.kept);
}

function showCounts(): void {
  const words = bookText(story).match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu)?.length ?? 0;
  const said = lines(story).filter((line) => line.kind === "speech" || line.kind === "vocal");
  const voices = new Set(said.map((line) => line.speaker)).size;
  const scenes = story.blocks.filter((b) => b.kind === "heading" || b.kind === "break").length;
  const plural = (n: number, one: string, many = `${one}s`) =>
    `${n.toLocaleString()} ${n === 1 ? one : many}`;
  $("#counts").textContent = [
    plural(words, "word"),
    plural(said.length, "line said", "lines said"),
    plural(voices, "voice"),
    plural(scenes, "scene"),
  ].join(" · ");
}

function cursorMoved(): void {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  $("#cursor-place").textContent = `Line ${line.number}, column ${head - line.from + 1}`;
  markPlace();
}

function showWarningCount(): void {
  const count = problems().filter((problem) => problem.severity === "warning").length;
  $("#warning-count").textContent = String(count);
  const button = $<HTMLButtonElement>("#status-warnings");
  button.hidden = count === 0;
  button.textContent = `${count} ${count === 1 ? "warning" : "warnings"}`;
}

// The side: the script, the book, and the warnings.

function showSide(): void {
  const sheet = $("#side-sheet");
  for (const tab of document.querySelectorAll<HTMLElement>(".side-tab")) {
    const selected = tab.dataset.tab === prefs.tab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  // A name being typed on the side isn't redrawn under the writer's fingers.
  if (sheet.contains(document.activeElement) && document.activeElement?.matches("input")) return;
  if (prefs.tab === "script") sheet.innerHTML = renderScript(story, { positions: true });
  else if (prefs.tab === "book")
    sheet.innerHTML = renderBook(story, { pages: true, positions: true });
  else if (prefs.tab === "cast")
    sheet.replaceChildren(
      castPanel(story, colors, {
        rename: (from, to) =>
          apply(
            renameCharacter(current(), from, to),
            `${from} can’t be renamed ${to} here: another character may have that name.`,
          ),
        fullName: (handle, name) =>
          apply(
            setFullName(current(), handle, name),
            `The cast can’t give ${handle} that name as written.`,
          ),
        find: (handle) => {
          const line = lines(current()).find(
            (row) => row.speaker?.toLowerCase() === handle.toLowerCase(),
          );
          if (!line) return notice(`${handle} has no lines yet.`);
          const doc = view.state.doc;
          const at = Math.min(doc.line(line.line).from + line.column - 1, doc.length);
          view.dispatch({
            selection: EditorSelection.cursor(at),
            effects: EditorView.scrollIntoView(at, { y: "center" }),
          });
          view.focus();
        },
        notice,
      }),
    );
  else sheet.replaceChildren(warningList());
  indexSheet();
  markPlace();
}

type Problem = {
  from: number;
  to: number;
  line: number;
  message: string;
  code: string;
  severity: string;
  fix?: { from: number; to: number; insert: string; label?: string };
};

/**
 * What to put right: the parser's warnings, in the editor's words where it has some, with its fix;
 * and the slips only the editor sees as you type (`@ Wanda`, a direction left open), with theirs.
 */
function problems(): Problem[] {
  const doc = view.state.doc;
  const drawn = view.state
    .field(marksField)
    .flatMap((mark) => (mark.kind === "warning" ? [mark] : []));
  const used = new Set<(typeof drawn)[number]>();
  const found: Problem[] = story.warnings.map((warning) => {
    const mine = drawn.find(
      (mark) =>
        !used.has(mark) &&
        mark.code === warning.code &&
        mark.from <= warning.range.to &&
        warning.range.from <= mark.to,
    );
    if (mine) used.add(mine);
    return {
      from: warning.range.from,
      to: warning.range.to,
      line: warning.line,
      message: mine?.message ?? warning.message,
      code: warning.code,
      severity: warning.severity,
      ...(mine?.fix ? { fix: mine.fix } : {}),
    };
  });
  for (const mark of drawn) {
    if (used.has(mark) || mark.from > doc.length) continue;
    found.push({
      from: mark.from,
      to: mark.to,
      line: doc.lineAt(mark.from).number,
      message: mark.message,
      code: mark.code,
      severity: "warning",
      ...(mark.fix ? { fix: mark.fix } : {}),
    });
  }
  return found.sort((a, b) => a.from - b.from);
}

function warningList(): HTMLElement {
  const all = problems();
  if (all.length === 0) {
    const none = document.createElement("p");
    none.className = "sheet-note";
    none.textContent = "Nothing to warn about: every mark reads as written.";
    return none;
  }
  const list = document.createElement("ol");
  list.className = "warning-list";
  for (const problem of all) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "warning";
    button.dataset.severity = problem.severity;
    button.innerHTML = `<span class="where">Line ${problem.line}</span><span class="message">${escapeHtml(problem.message)}</span><code>${escapeHtml(problem.code)}</code>`;
    button.addEventListener("click", () => {
      view.dispatch({
        selection: EditorSelection.range(problem.from, problem.to),
        scrollIntoView: true,
      });
      view.focus();
    });
    item.append(button);
    const fix = problem.fix;
    if (fix) {
      const mend = document.createElement("button");
      mend.type = "button";
      mend.className = "button fix";
      mend.textContent = fix.label ?? "Fix it";
      mend.addEventListener("click", () => {
        if (lockedOut) return;
        view.dispatch({ changes: fix, userEvent: "input.fix" });
        refresh();
        view.focus();
      });
      item.append(mend);
    }
    list.append(item);
  }
  return list;
}

function selectTab(tab: Tab, focus = false): void {
  prefs.tab = tab;
  keepPrefs();
  showSide();
  if (focus) document.querySelector<HTMLElement>(`.side-tab[data-tab="${tab}"]`)?.focus();
}

const TABS: readonly Tab[] = ["script", "book", "cast", "warnings"];
for (const tab of document.querySelectorAll<HTMLButtonElement>(".side-tab")) {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab as Tab));
  tab.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    selectTab(TABS[(TABS.indexOf(prefs.tab) + step + TABS.length) % TABS.length] as Tab, true);
  });
}

$("#status-warnings").addEventListener("click", () => {
  showSidePanel(true);
  selectTab("warnings", true);
});

/** A click on the script or the book puts the cursor where that part comes from. */
$("#side-sheet").addEventListener("click", (event) => {
  const target = event.target as Element;
  if (target.closest("a, button") || window.getSelection()?.toString()) return;
  const placed = target.closest<HTMLElement>("[data-from]");
  if (!placed) return;
  const at = Math.min(Number(placed.dataset.from), view.state.doc.length);
  view.dispatch({
    selection: EditorSelection.cursor(at),
    effects: EditorView.scrollIntoView(at, { y: "center" }),
  });
  view.focus();
});

/** The script's or book's parts by where they start in the story, read once each time it is drawn. */
let placed: Array<{ from: number; to: number; element: HTMLElement }> = [];
let marked: HTMLElement | undefined;

function indexSheet(): void {
  placed = [...$("#side-sheet").querySelectorAll<HTMLElement>("[data-from]")]
    .map((element) => ({
      from: Number(element.dataset.from),
      to: Number(element.dataset.to),
      element,
    }))
    .sort((a, b) => a.from - b.from);
  marked = undefined;
}

/**
 * Marks the smallest part of the script or book that holds the cursor, and keeps it in view: found
 * by halves among the parts, not by reading every one on each key.
 */
function markPlace(): void {
  if (!prefs.side || prefs.tab === "warnings" || prefs.tab === "cast") return;
  const cursor = view.state.selection.main.head;
  let low = 0;
  let high = placed.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((placed[middle]?.from ?? 0) <= cursor) low = middle + 1;
    else high = middle;
  }
  // Parts hold the parts inside them, so the one holding the cursor starts a little before it.
  let best: (typeof placed)[number] | undefined;
  for (let i = low - 1, looked = 0; i >= 0 && looked < 64; i--, looked++) {
    const part = placed[i];
    if (part && part.to >= cursor && (!best || part.to - part.from < best.to - best.from))
      best = part;
  }
  const element = view.hasFocus ? best?.element : undefined;
  if (element === marked) return;
  marked?.classList.remove("linked");
  marked = element;
  if (!element) return;
  element.classList.add("linked");
  const sheet = $("#side-sheet");
  const box = element.getBoundingClientRect();
  const frame = sheet.getBoundingClientRect();
  if (box.top < frame.top || box.bottom > frame.bottom) {
    sheet.scrollTo({
      top: sheet.scrollTop + box.top - frame.top - frame.height / 3,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
}

function showSidePanel(shown: boolean): void {
  prefs.side = shown;
  keepPrefs();
  $("#workspace").toggleAttribute("data-side", shown);
  checkMenu("side", shown);
  if (shown) showSide();
}

// Files: open, save, and asking first.

const input = $<HTMLInputElement>("#file-input");

/** A question with buttons, answered by the value of the one chosen ("" if dismissed). */
function ask(message: string, buttons: Array<{ label: string; value: string; main?: boolean }>) {
  const dialog = $<HTMLDialogElement>("#ask");
  $("#ask-message").textContent = message;
  $<HTMLInputElement>("#ask-input").hidden = true;
  $("#ask-buttons").replaceChildren(
    ...buttons.map(({ label, value, main }) => {
      const button = document.createElement("button");
      button.className = main ? "button primary" : "button";
      button.value = value;
      button.textContent = label;
      return button;
    }),
  );
  dialog.returnValue = "";
  dialog.showModal();
  (dialog.querySelector(".primary") as HTMLElement | null)?.focus();
  return new Promise<string>((resolve) =>
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true }),
  );
}

/** A question answered in a few words ("" if the writer changes their mind). */
async function askText(message: string, placeholder: string, action: string): Promise<string> {
  const input = $<HTMLInputElement>("#ask-input");
  const answered = ask(message, [
    { label: "Cancel", value: "cancel" },
    { label: action, value: "ok", main: true },
  ]);
  input.hidden = false;
  input.value = "";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", message);
  input.focus();
  const enter = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    $<HTMLDialogElement>("#ask").close("ok");
  };
  input.addEventListener("keydown", enter);
  const answer = await answered;
  input.removeEventListener("keydown", enter);
  return answer === "ok" ? input.value.trim() : "";
}

/** Whether the story may be put aside: saved, or the writer says so. */
async function mayLeave(): Promise<boolean> {
  if (!(await mayWrite())) return false;
  if (text() === file.saved) return true;
  const answer = await ask(`Save the changes to ${file.name} first?`, [
    { label: "Cancel", value: "cancel" },
    { label: "Don't save", value: "discard" },
    { label: "Save", value: "save", main: true },
  ]);
  if (answer === "discard") return true;
  if (answer === "save") return await save();
  return false;
}

async function open(): Promise<void> {
  if (!(await mayLeave())) return;
  try {
    const opened = await pickFile(input);
    if (!opened) return;
    void load(opened);
    if (opened.handle) await rememberFile(opened.name, opened.handle);
    void showRecent();
  } catch (error) {
    await tell(`That file couldn't be opened: ${(error as Error).message}`);
  }
}

async function openRecent(handle: FileSystemFileHandle): Promise<void> {
  if (!(await mayLeave())) return;
  try {
    const opened = await reopen(handle);
    void load(opened);
    await rememberFile(opened.name, handle);
  } catch {
    await forgetFile(handle);
    await tell(`${handle.name} can't be opened any more: it may have been moved or deleted.`);
  }
  void showRecent();
}

/** Saves to the story's file, or asks where. True once it is saved. */
async function save(): Promise<boolean> {
  if (!file.handle) return saveAs();
  return write(file.handle);
}

async function saveAs(): Promise<boolean> {
  if (!keepsFiles) {
    // Where a page can't keep a file, saving is a download.
    const content = text();
    download(content, file.name);
    saved(content);
    return true;
  }
  const handle = await pickSaveTarget(file.name);
  if (!handle) return false;
  const done = await write(handle);
  if (done) {
    file.handle = handle;
    file.name = handle.name;
    $("#file-name").textContent = file.name;
    showSaveState();
    await rememberFile(handle.name, handle);
    void showRecent();
  }
  return done;
}

async function write(handle: FileSystemFileHandle): Promise<boolean> {
  // Changed on disk since the Writer read it (another app, another computer syncing it): asked
  // first, never overwritten unseen.
  if (handle === file.handle && file.modified !== undefined) {
    const disk = await onDisk(handle);
    if (disk && disk.modified !== file.modified && disk.text !== file.saved) {
      const answer = await ask(
        `${file.name} was changed outside the Writer since it was opened here. Save over those changes, or open the file as it is now?`,
        [
          { label: "Cancel", value: "cancel" },
          { label: "Open it as it is now", value: "theirs" },
          { label: "Save over it", value: "mine", main: true },
        ],
      );
      if (answer === "theirs") {
        if (await confirmDiscard())
          await load({ name: file.name, text: disk.text, handle, modified: disk.modified });
        return false;
      }
      if (answer !== "mine") return false;
    }
  }
  const content = text();
  const state = $("#save-state");
  state.dataset.state = "saving";
  state.textContent = "Saving…";
  try {
    file.modified = await writeFile(handle, content);
    saved(content);
    announce(`Saved ${file.name}`);
    return true;
  } catch (error) {
    state.dataset.state = "error";
    state.textContent = "Not saved";
    announce(`${file.name} wasn't saved`);
    await tell(`${file.name} couldn't be saved: ${(error as Error).message}`);
    return false;
  }
}

/** Whether the changes here may be put aside for the file as it is on disk. */
async function confirmDiscard(): Promise<boolean> {
  if (text() === file.saved) return true;
  const answer = await ask(
    "Open the file as it is on disk? The changes you made here since you last saved will be lost.",
    [
      { label: "Cancel", value: "cancel" },
      { label: "Open it, losing mine", value: "discard", main: true },
    ],
  );
  return answer === "discard";
}

/**
 * Coming back to the Writer: if the file changed on disk meanwhile, a story with nothing unsaved
 * here is read again; one with changes here is left as it is, and Save will ask.
 */
async function checkDisk(): Promise<void> {
  const handle = file.handle;
  if (!handle || file.modified === undefined || !lock.owner) return;
  const disk = await onDisk(handle);
  if (!disk || disk.modified === file.modified || handle !== file.handle) return;
  if (disk.text === file.saved) {
    file.modified = disk.modified;
    void keep();
    return;
  }
  if (text() === file.saved) {
    await load({ name: file.name, text: disk.text, handle, modified: disk.modified });
    notice(`${file.name} changed outside the Writer, so it was read again.`);
  } else {
    notice(`${file.name} changed outside the Writer. Saving will ask which to keep.`);
  }
}
window.addEventListener("focus", () => void checkDisk());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkDisk();
});

function saved(content: string): void {
  file.saved = content;
  file.savedAt = Date.now();
  showSaveState();
  void keep();
}

// Saving automatically: to the story's own file, two seconds after typing stops, where the browser
// already lets the page write it. Never asks: a file changed on disk waits for Save.

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAutosave(): void {
  clearTimeout(autosaveTimer);
  if (!prefs.autosave || !keepsFiles || !file.handle) return;
  autosaveTimer = setTimeout(() => void autosave(), 2000);
}

async function autosave(): Promise<void> {
  const handle = file.handle;
  if (!handle || !lock.owner || lockedOut || text() === file.saved) return;
  if (!(await mayWriteNow(handle))) return;
  if (file.modified !== undefined) {
    const disk = await onDisk(handle);
    if (disk && disk.modified !== file.modified && disk.text !== file.saved) {
      notice(
        `${file.name} changed outside the Writer, so it wasn’t saved automatically. Save will ask which to keep.`,
      );
      return;
    }
  }
  if (handle !== file.handle) return;
  const content = text();
  try {
    file.modified = await writeFile(handle, content);
    saved(content);
  } catch {
    // Save shows what went wrong.
  }
}

// One tab writes the story at a time.

const lock = new DraftLock(
  () => {
    lockedOut = true;
    view.dispatch({ effects: editable.reconfigure(editability()) });
    $("#elsewhere").hidden = false;
    tools.hide();
  },
  () => keep(),
);

/** Takes the story from the tab that writes it, and reads the draft it kept. */
async function writeHere(): Promise<boolean> {
  if (!(await lock.claim(true))) return false;
  lockedOut = false;
  $("#elsewhere").hidden = true;
  const draft = await loadDraft();
  if (draft) await restore(draft);
  else view.dispatch({ effects: editable.reconfigure(editability()) });
  view.focus();
  return true;
}
$("#edit-here").addEventListener("click", () => void writeHere());

/** Whether this tab may change the story: it writes it, or the writer says it should. */
async function mayWrite(): Promise<boolean> {
  if (lock.owner) return true;
  const answer = await ask(
    "This story is being written in another tab. Write here instead? The other tab will only read it.",
    [
      { label: "Cancel", value: "cancel" },
      { label: "Write here", value: "here", main: true },
    ],
  );
  return answer === "here" && (await writeHere());
}

function tell(message: string): Promise<string> {
  return ask(message, [{ label: "OK", value: "ok", main: true }]);
}

const NEW_STORY = [
  "---",
  "voxdown: 1.1",
  "title: A new story",
  "language: en-US",
  "cast:",
  "  Wanda:",
  "---",
  "",
  "# A new story",
  "",
  "@(warmly) Once upon a time, there was a witch called Wanda.",
  "",
  "@Wanda “Hello,” said Wanda. [a cat purrs]",
  "",
].join("\n");

async function newStory(): Promise<void> {
  if (!(await mayLeave())) return;
  void load({ name: "Untitled.vxd", text: NEW_STORY }, { saved: "" });
  view.focus();
}

/** Tidies the story as `format` does, changing only what it changes, as one step to undo. */
function tidy(curly: boolean): void {
  if (lockedOut) return;
  const before = view.state.doc.toString();
  const after = format(before, curly ? { quotes: "curly" } : {});
  if (after === before) return;
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  view.dispatch({ changes: { from: start, to: endBefore, insert: after.slice(start, endAfter) } });
}

// Insert: marks put in where the cursor is, each as one step to undo.

async function insertSoundHere(): Promise<void> {
  if (!(await mayWrite())) return;
  const at = view.state.selection.main.head;
  const description = await askText("What does the listener hear?", "a door creaks", "Put it in");
  if (description)
    apply(
      insertSound(current(), at, description),
      "A sound can’t go there without changing what is heard: put the cursor after a word.",
    );
  view.focus();
}

/** Puts `text` in at the cursor, the part `select` selected, with a space before it if needed. */
function insertAtCursor(text: string, select?: string): void {
  if (lockedOut) return;
  const { from, to } = view.state.selection.main;
  const before = view.state.sliceDoc(Math.max(0, from - 1), from);
  const insert = before && !/\s/.test(before) ? ` ${text}` : text;
  const at = select ? insert.indexOf(select) : -1;
  view.dispatch({
    changes: { from, to, insert },
    selection:
      at >= 0
        ? EditorSelection.range(from + at, from + at + (select?.length ?? 0))
        : EditorSelection.cursor(from + insert.length),
    scrollIntoView: true,
    userEvent: "input.insert",
  });
  view.focus();
}

/** Puts a line of its own after the paragraph the cursor is in, a blank line around it. */
function insertAfterParagraph(line: string, select?: string): void {
  if (lockedOut) return;
  const doc = view.state.doc;
  let number = doc.lineAt(view.state.selection.main.head).number;
  while (number < doc.lines && doc.line(number).text.trim() !== "") number++;
  const blank = doc.line(number).text.trim() === "";
  const end = blank ? doc.line(number).from : doc.line(number).to;
  const insert = `${blank ? "\n" : "\n\n"}${line}\n\n`;
  const at = select ? insert.indexOf(select) : insert.length;
  view.dispatch({
    changes: { from: end, insert },
    selection: select
      ? EditorSelection.range(end + at, end + at + select.length)
      : EditorSelection.cursor(end + insert.length),
    scrollIntoView: true,
    userEvent: "input.insert",
  });
  view.focus();
}

// Export: what the story becomes, as files.

const baseName = () => file.name.replace(/\.(?:vxd|md|txt)$/i, "") || "story";

/** Prints the book from a frame of its own, as a reader would see it. */
function printBook(): void {
  const frame = document.createElement("iframe");
  frame.className = "print-frame";
  frame.setAttribute("aria-hidden", "true");
  frame.srcdoc = renderDocument(current(), "book", { pages: true });
  frame.addEventListener("load", () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  });
  document.body.append(frame);
}

// Keyboard shortcuts, as this computer writes them.

const SHORTCUTS: Array<[string, string]> = [
  ["Mod+S", "Save"],
  ["Mod+Shift+S", "Save as…"],
  ["Mod+O", "Open a file"],
  ["Mod+P", "Print the book"],
  ["Mod+Z", "Undo"],
  ["Mod+Shift+Z", "Redo"],
  ["Mod+F", "Find and replace"],
  ["Alt+↑ / Alt+↓", "Move the paragraph up or down"],
  ["Enter", "In a quote: close it, and open it again on a new line for the same speaker"],
  ["Mod+Shift+M", "Every mark raw, or drawn"],
  ["Ctrl+Space", "Suggest names, directions, sounds and instructions"],
  ["Mod+/", "These shortcuts"],
];

function showShortcuts(): void {
  $("#shortcut-list").replaceChildren(
    ...SHORTCUTS.flatMap(([combo, what]) => {
      const term = document.createElement("dt");
      const kbd = document.createElement("kbd");
      kbd.textContent = combo
        .split(" / ")
        .map((part) => keys(part))
        .join(" / ");
      term.append(kbd);
      const detail = document.createElement("dd");
      detail.textContent = what;
      return [term, detail];
    }),
  );
  $<HTMLDialogElement>("#shortcuts").showModal();
}

// Commands, from the menus, the buttons and the keys.

const COMMANDS: Record<string, () => unknown> = {
  new: newStory,
  open,
  save,
  "save-as": saveAs,
  download: () => download(text(), file.name),
  format: () => tidy(false),
  "format-curly": () => tidy(true),
  undo: () => {
    undo(view);
    view.focus();
  },
  redo: () => {
    redo(view);
    view.focus();
  },
  find: () => openSearchPanel(view),
  who: () => tools.openSpeaker(passageAtCursor()),
  how: () => tools.openDirection(passageAtCursor()),
  "paragraph-up": () => {
    moveParagraph(view, -1, frontMatterEnd());
    view.focus();
  },
  "insert-sound": insertSoundHere,
  "insert-pause": () => insertAtCursor("{pause 1s}", "1s"),
  "insert-page": () =>
    apply(
      insertLine(current(), view.state.selection.main.head, "{page}"),
      "A page turn can’t go before this line.",
    ),
  "insert-note": () => insertAtCursor("%% note %%", "note"),
  "insert-break": () => insertAfterParagraph("* * *"),
  "insert-chapter": () => insertAfterParagraph("# A new chapter", "A new chapter"),
  "insert-scene": () => insertAfterParagraph("## A new scene", "A new scene"),
  "export-book": () =>
    download(renderDocument(current(), "book", { pages: true }), `${baseName()}.html`, "text/html"),
  "export-script": () =>
    download(renderDocument(current(), "script"), `${baseName()}-script.html`, "text/html"),
  "export-csv": () =>
    download(linesToCsv(lines(current(), { speechOnly: true })), `${baseName()}.csv`, "text/csv"),
  "export-json": () =>
    download(
      `${JSON.stringify(lines(current()), null, 2)}\n`,
      `${baseName()}.json`,
      "application/json",
    ),
  "export-sides": () =>
    download(
      [...textByCharacter(current())].map(([name, said]) => `== ${name} ==\n${said}`).join("\n"),
      `${baseName()}-sides.txt`,
      "text/plain",
    ),
  print: printBook,
  shortcuts: showShortcuts,
  "paragraph-down": () => {
    moveParagraph(view, 1, frontMatterEnd());
    view.focus();
  },
};

/** Where the passage the cursor is in starts, or the cursor, for the pickers to find it. */
function passageAtCursor(): number {
  const head = view.state.selection.main.head;
  return speechAt(current(), head)?.range.from ?? head;
}

const SWITCHES = ["color", "names", "directions", "sounds", "vocal", "pages", "notes"] as const;

function viewCommand(name: string, on: boolean): void {
  if (name === "autosave") {
    prefs.autosave = on;
    keepPrefs();
    if (on) scheduleAutosave();
  } else if (name === "marks") {
    view.dispatch({ effects: setShowMarks.of(on) });
  } else if (name === "side") {
    showSidePanel(on);
  } else if (name === "rail-names") {
    rail.showNames(on);
  } else if ((SWITCHES as readonly string[]).includes(name)) {
    prefs[name as (typeof SWITCHES)[number]] = on;
    keepPrefs();
    view.dispatch({ effects: setView.of({ [name]: on }) });
  }
}

function checkMenu(name: string, on: boolean): void {
  document.querySelector(`[data-view="${name}"]`)?.setAttribute("aria-checked", String(on));
}

menus($(".menus"), (command, item) => {
  if (item.dataset.view)
    viewCommand(item.dataset.view, item.getAttribute("aria-checked") === "true");
  else if (command.startsWith("recent:")) {
    const handle = recentHandles[Number(command.slice(7))];
    if (handle) void openRecent(handle);
  } else void COMMANDS[command]?.();
});

for (const button of document.querySelectorAll<HTMLElement>(
  "#save-button, .welcome [data-command]",
)) {
  button.addEventListener("click", () => void COMMANDS[button.dataset.command ?? ""]?.());
}

$("#scene-rail").addEventListener("rail-names", (event) =>
  checkMenu("rail-names", (event as CustomEvent<boolean>).detail),
);

// Ctrl+S, Ctrl+Shift+S and Ctrl+O, wherever the focus is.
document.addEventListener(
  "keydown",
  (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const command =
      key === "s"
        ? event.shiftKey
          ? "save-as"
          : "save"
        : key === "o" && !event.shiftKey
          ? "open"
          : key === "p" && !event.shiftKey
            ? "print"
            : key === "/"
              ? "shortcuts"
              : "";
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    void COMMANDS[command]?.();
  },
  true,
);

// Open recent, where the browser keeps files.

let recentHandles: FileSystemFileHandle[] = [];

async function showRecent(): Promise<void> {
  const recent = keepsFiles ? await recentFiles() : [];
  recentHandles = recent.map((entry) => entry.handle);
  $("#recent-group").hidden = recent.length === 0;
  $("#recent-list").replaceChildren(
    ...recent.map((entry, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.dataset.command = `recent:${index}`;
      item.textContent = entry.name;
      return item;
    }),
  );
}

// A file dropped anywhere on the page opens.

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", async (event) => {
  const dropped = event.dataTransfer?.files[0];
  if (!dropped) return;
  event.preventDefault();
  // The file's handle, for saving back to it, is only given while the drop is under way.
  const item = event.dataTransfer?.items[0] as
    | (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
    | undefined;
  const handlePromise = item?.getAsFileSystemHandle?.() ?? Promise.resolve(null);
  if (!(await mayLeave())) return;
  const handle = await handlePromise.catch(() => null);
  const kept = handle?.kind === "file" ? (handle as FileSystemFileHandle) : undefined;
  void load(asStory(dropped.name, await dropped.text(), kept));
  if (kept) {
    await rememberFile(dropped.name, kept);
    void showRecent();
  }
});

// Leaving with nothing kept anywhere: the browser asks first.
window.addEventListener("beforeunload", (event) => {
  if (!file.kept && text() !== file.saved) event.preventDefault();
});

// The welcome, for a first visit: open a file, start one, or begin from an example.

function showWelcome(): void {
  $("#welcome").hidden = false;
  document.body.setAttribute("data-welcome", "");
  $("#welcome-examples").replaceChildren(
    ...examples.map((example) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "welcome-example";
      button.dataset.name = example.name;
      button.innerHTML = `<span class="title"></span><span class="by"></span>`;
      (button.firstElementChild as HTMLElement).textContent = example.title;
      (button.lastElementChild as HTMLElement).textContent = example.byline;
      button.addEventListener("click", () => {
        void load({ name: example.name, text: example.text }, { saved: "" });
        view.focus();
      });
      item.append(button);
      return item;
    }),
  );
}

// Start: the draft from last time, or the welcome.

async function start(): Promise<void> {
  for (const name of [...SWITCHES, "marks", "autosave"] as const) checkMenu(name, prefs[name]);
  // Where the browser can't keep files, there's no file to save to automatically.
  $("#autosave-item").hidden = !keepsFiles;
  showSidePanel(prefs.side);
  checkMenu("rail-names", rail.names);
  void showRecent();
  const draft = await loadDraft();
  if (!draft) {
    await lock.claim();
    showWelcome();
    refresh();
    showDraftState();
    return;
  }
  // Another tab writes the story: this one shows it, read only, until asked to write here.
  if (!(await lock.claim())) {
    lockedOut = true;
    $("#elsewhere").hidden = false;
  }
  await restore(draft);
  if (draft.text !== draft.saved && lock.owner) {
    const back = `Brought back the changes you hadn't saved, from ${time(draft.changedAt)}`;
    $("#draft-state").textContent = back;
    announce(back);
  }
  void checkDisk();
}

/** Puts the kept draft in the editor. */
function restore(draft: Draft): Promise<void> {
  return load(
    { name: draft.name, text: draft.text, ...(draft.handle ? { handle: draft.handle } : {}) },
    {
      saved: draft.saved,
      changedAt: draft.changedAt,
      ...(draft.savedAt ? { savedAt: draft.savedAt } : {}),
      ...(draft.modified !== undefined ? { modified: draft.modified } : {}),
    },
  );
}

void start();
