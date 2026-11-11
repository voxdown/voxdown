/**
 * VoxDown Writer: a story's own file, opened, written and saved back, with its scenes down the left
 * and what it becomes on the right. Everything runs in the browser. The story is kept in this
 * browser as it is typed, so a closed tab loses nothing, and goes to a file only when it is saved.
 */
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  type Character,
  type ViewSwitches,
  scriptEditor,
  setShowMarks,
  setView,
  showMarksField,
} from "@voxdown/editor";
import { characterColors, escapeHtml, renderBook, renderScript, stylesheet } from "@voxdown/render";
import { type Story, bookText, format, lines, parse } from "voxdown";
import { examples } from "../examples";
import "../style.css";
import "./writer.css";
import "../theme";
import {
  type Opened,
  asStory,
  download,
  keepsFiles,
  pickFile,
  pickSaveTarget,
  reopen,
  writeFile,
} from "./files";
import { menus } from "./menu";
import { SceneRail } from "./rail";
import { forgetFile, keepDraft, loadDraft, recentFiles, rememberFile } from "./store";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;

const rendererStyle = document.createElement("style");
rendererStyle.textContent = stylesheet;
document.head.append(rendererStyle);

// What the writer chose to see, kept on this computer.

type Tab = "script" | "book" | "warnings";
type Prefs = ViewSwitches & { marks: boolean; side: boolean; tab: Tab };
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
  changedAt: Date.now(),
  /** Whether the browser kept the last draft. */
  kept: true,
};
let story: Story = parse("");
let colors = new Map<string, string>();

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

function editorState(source: string, cursor: number): EditorState {
  return EditorState.create({
    doc: source,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      lineBreaks(source),
      scriptEditor({
        characters,
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
        if (update.docChanged) changed();
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

const view = new EditorView({ parent: $("#editor"), state: editorState("", 0) });
const rail = new SceneRail($("#scene-rail"), view);

/** Puts a story in the editor, with a fresh undo history, the cursor where the story starts. */
function load(
  opened: Opened,
  kept: { saved?: string; savedAt?: number; changedAt?: number } = {},
): Promise<void> {
  file.name = opened.name;
  file.handle = opened.handle;
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
  document.title = `${file.name} · VoxDown Writer`;
  refresh();
  return keep();
}

// After each change: the views a moment later, and the draft kept a moment after that.

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let keepTimer: ReturnType<typeof setTimeout> | undefined;

function changed(): void {
  file.changedAt = Date.now();
  showSaveState(true);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 150);
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => void keep(), 700);
}

function refresh(): void {
  clearTimeout(refreshTimer);
  story = parse(view.state.doc.toString());
  colors = characterColors(story);
  rail.update(story);
  showCounts();
  showWarningCount();
  showSaveState();
  if (prefs.side) showSide();
}

async function keep(): Promise<void> {
  clearTimeout(keepTimer);
  file.kept = await keepDraft({
    name: file.name,
    text: text(),
    saved: file.saved,
    changedAt: file.changedAt,
    ...(file.handle ? { handle: file.handle } : {}),
    ...(file.savedAt ? { savedAt: file.savedAt } : {}),
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
  state.dataset.state = unsaved ? "unsaved" : "saved";
  state.textContent = unsaved
    ? file.saved === "" && !file.handle
      ? "Not saved yet"
      : "Edited"
    : file.savedAt
      ? `Saved ${time(file.savedAt)}`
      : "Saved";
  $("#save-button").classList.toggle("needed", unsaved);
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
  const count = story.warnings.filter((warning) => warning.severity === "warning").length;
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
  if (prefs.tab === "script") sheet.innerHTML = renderScript(story, { positions: true });
  else if (prefs.tab === "book")
    sheet.innerHTML = renderBook(story, { pages: true, positions: true });
  else sheet.replaceChildren(warningList());
  markPlace();
}

function warningList(): HTMLElement {
  if (story.warnings.length === 0) {
    const none = document.createElement("p");
    none.className = "sheet-note";
    none.textContent = "Nothing to warn about: every mark reads as written.";
    return none;
  }
  const list = document.createElement("ol");
  list.className = "warning-list";
  for (const warning of story.warnings) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "warning";
    button.dataset.severity = warning.severity;
    button.innerHTML = `<span class="where">Line ${warning.line}</span><span class="message">${escapeHtml(warning.message)}</span><code>${escapeHtml(warning.code)}</code>`;
    button.addEventListener("click", () => {
      view.dispatch({
        selection: EditorSelection.range(warning.range.from, warning.range.to),
        scrollIntoView: true,
      });
      view.focus();
    });
    item.append(button);
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

const TABS: readonly Tab[] = ["script", "book", "warnings"];
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

/** Marks the smallest part of the script or book that holds the cursor, and keeps it in view. */
function markPlace(): void {
  if (!prefs.side || prefs.tab === "warnings") return;
  const sheet = $("#side-sheet");
  const cursor = view.state.selection.main.head;
  let best: HTMLElement | undefined;
  let size = Number.POSITIVE_INFINITY;
  for (const element of sheet.querySelectorAll<HTMLElement>("[data-from]")) {
    const from = Number(element.dataset.from);
    const to = Number(element.dataset.to);
    if (from <= cursor && cursor <= to && to - from < size) {
      best = element;
      size = to - from;
    }
  }
  for (const old of sheet.querySelectorAll(".linked"))
    if (old !== best) old.classList.remove("linked");
  if (!best || !view.hasFocus) return;
  best.classList.add("linked");
  const box = best.getBoundingClientRect();
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

/** Whether the story may be put aside: saved, or the writer says so. */
async function mayLeave(): Promise<boolean> {
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
    document.title = `${file.name} · VoxDown Writer`;
    await rememberFile(handle.name, handle);
    void showRecent();
  }
  return done;
}

async function write(handle: FileSystemFileHandle): Promise<boolean> {
  const content = text();
  const state = $("#save-state");
  state.dataset.state = "saving";
  state.textContent = "Saving…";
  try {
    await writeFile(handle, content);
    saved(content);
    return true;
  } catch (error) {
    state.dataset.state = "error";
    state.textContent = "Not saved";
    await tell(`${file.name} couldn't be saved: ${(error as Error).message}`);
    return false;
  }
}

function saved(content: string): void {
  file.saved = content;
  file.savedAt = Date.now();
  showSaveState();
  void keep();
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

// Commands, from the menus, the buttons and the keys.

const COMMANDS: Record<string, () => unknown> = {
  new: newStory,
  open,
  save,
  "save-as": saveAs,
  download: () => download(text(), file.name),
  format: () => tidy(false),
  "format-curly": () => tidy(true),
};

const SWITCHES = ["color", "names", "directions", "sounds", "vocal", "pages", "notes"] as const;

function viewCommand(name: string, on: boolean): void {
  if (name === "marks") {
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
  for (const name of [...SWITCHES, "marks"] as const) checkMenu(name, prefs[name]);
  showSidePanel(prefs.side);
  checkMenu("rail-names", rail.names);
  void showRecent();
  const draft = await loadDraft();
  if (!draft) {
    showWelcome();
    refresh();
    showDraftState();
    return;
  }
  await load(
    { name: draft.name, text: draft.text, ...(draft.handle ? { handle: draft.handle } : {}) },
    {
      saved: draft.saved,
      changedAt: draft.changedAt,
      ...(draft.savedAt ? { savedAt: draft.savedAt } : {}),
    },
  );
  if (draft.text !== draft.saved) {
    $("#draft-state").textContent =
      `Brought back the changes you hadn't saved, from ${time(draft.changedAt)}`;
  }
}

void start();
