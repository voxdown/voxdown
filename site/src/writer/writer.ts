/**
 * VoxDown Writer: a story's own file, opened, written and saved back, with its scenes down the left
 * and what it becomes on the right. Everything runs in the browser. The story is kept in this
 * browser as it is typed, so a closed tab loses nothing, and goes to a file only when it is saved.
 */
import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  RangeSetBuilder,
  Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  hoverTooltip,
  keymap,
} from "@codemirror/view";
import {
  type Character,
  type ViewSwitches,
  marksField,
  readStory,
  sceneNumbers,
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
  isName,
  lines,
  linesToCsv,
  parse,
  renameCharacter,
  setAbout,
  setFullName,
  setMeta,
  textByCharacter,
} from "voxdown";
import { examples } from "../examples";
import "../style.css";
import "./writer.css";
import "../theme";
import { castPanel } from "./cast";
import { changesOnly, diffLines, withWords } from "./diff";
import { emphasis, toggleEmphasis } from "./emphasis";
import {
  type Opened,
  allowed,
  asStory,
  download,
  keepsFiles,
  mayWriteNow,
  onDisk,
  pickFile,
  pickSaveTarget,
  readText,
  reopen,
  writeFile,
} from "./files";
import { DraftLock } from "./lock";
import { keys, menus } from "./menu";
import { afterParagraph, moveParagraph } from "./paragraphs";
import { type Problem, problems } from "./problems";
import { SceneRail, railScenes } from "./rail";
import type { RenderAsk, RenderReply } from "./render-worker";
import { SaveQueue, autosaveCheck, checkDisk as diskCheck, sameText } from "./saving";
import { moveSection } from "./sections";
import {
  type Draft,
  type Version,
  draftById,
  draftForFile,
  forgetDraft,
  forgetFile,
  keepDraft,
  keepVersion,
  listDrafts,
  loadDraft,
  markSaved,
  newId,
  recentFiles,
  rememberFile,
  versionsOf,
} from "./store";
import { type Speaker, StretchTools, passageNear, speechOfMark } from "./stretch";
import { glimpse, listening, wordCount } from "./words";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;

const rendererStyle = document.createElement("style");
rendererStyle.textContent = stylesheet;
document.head.append(rendererStyle);

// What the writer chose to see, kept on this computer.

type Tab = "script" | "book" | "cast" | "warnings";
type Prefs = ViewSwitches & {
  marks: boolean;
  side: boolean;
  tab: Tab;
  autosave: boolean;
  focus: boolean;
  /** The cursor's line kept in the middle of the page as it goes, focus or not. */
  typewriter: boolean;
  /** Words to write in a sitting; 0 for none. */
  goal: number;
};
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
  focus: false,
  typewriter: false,
  goal: 0,
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
  /** The story's own key in this browser: its draft and its versions go by it. */
  id: newId(),
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

/**
 * The same story, whatever its line breaks: a file with some lines ending in CRLF and some in LF
 * opens as it is, unchanged, and is saved with one kind.
 */

/** The text as it will be saved: with the line breaks the story came with. */
const text = () => view.state.sliceDoc();

/** Whether every line of the text ends with CRLF (§4.1). */
const allCrlf = (source: string): boolean =>
  source.includes("\r\n") && !/(?:^|[^\r])\n|\r(?!\n)/.test(source);

/** CRLF where every line of the text ends so; the editor works on `\n` throughout. */
const lineBreaks = (source: string): Extension =>
  allCrlf(source) ? EditorState.lineSeparator.of("\r\n") : [];

/**
 * Another text in place of the story's, changing only what differs, so the cursor, the page and
 * Undo stay with the words: a version gone back to, the file read again.
 */
function replaceText(next: string, userEvent: string, crlf?: boolean): void {
  const now = view.state.doc.toString();
  const lines = Text.of(next.split(/\r\n?|\n/));
  const then = lines.toString();
  const most = Math.min(now.length, then.length);
  let start = 0;
  while (start < most && now.charCodeAt(start) === then.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < most - start &&
    now.charCodeAt(now.length - 1 - end) === then.charCodeAt(then.length - 1 - end)
  )
    end++;
  // Its line breaks, when they change too, with the words in the same step.
  const effects =
    crlf === undefined || crlf === (view.state.lineBreak === "\r\n")
      ? []
      : [breaks.reconfigure(crlf ? EditorState.lineSeparator.of("\r\n") : [])];
  if (start === now.length && start === then.length && effects.length === 0) return;
  view.dispatch({
    changes: {
      from: start,
      to: now.length - end,
      insert: lines.slice(start, then.length - end),
    },
    effects,
    userEvent,
  });
}

// Focus: the paragraph being written, the rest of the story faded, and the page keeping the
// cursor in its middle as it goes.

const IN_FOCUS = Decoration.line({ class: "in-focus" });

const focusLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(readonly view: EditorView) {
      this.decorations = this.build();
    }
    update(update: ViewUpdate) {
      // A change, a move, a scroll, or focus switched (an effect): drawn again.
      const switched = update.transactions.some((tr) => tr.effects.length > 0);
      if (update.docChanged || update.selectionSet || update.viewportChanged || switched)
        this.decorations = this.build();
      if ((prefs.focus || prefs.typewriter) && update.selectionSet && update.view.hasFocus) {
        const head = update.state.selection.main.head;
        requestAnimationFrame(() =>
          update.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) }),
        );
      }
    }
    build(): DecorationSet {
      if (!prefs.focus) return Decoration.none;
      const doc = this.view.state.doc;
      const blank = (number: number) => doc.line(number).text.trim() === "";
      let first = doc.lineAt(this.view.state.selection.main.head).number;
      let last = first;
      while (first > 1 && !blank(first - 1)) first--;
      while (last < doc.lines && !blank(last + 1)) last++;
      const builder = new RangeSetBuilder<Decoration>();
      for (let number = first; number <= last; number++) {
        const line = doc.line(number);
        builder.add(line.from, line.from, IN_FOCUS);
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Read only while another tab writes the story. */
const editable = new Compartment();
/** The line breaks the story is saved with: changed when the file is read again with others. */
const breaks = new Compartment();
let lockedOut = false;
const editability = () =>
  lockedOut ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];

function editorState(source: string, cursor: number): EditorState {
  return EditorState.create({
    doc: source,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      breaks.of(lineBreaks(source)),
      editable.of(editability()),
      focusLines,
      // The browser's spelling check, in the story's own language.
      // Coming back to the story (from the rail, a warning, the side) marks the place on the side.
      EditorView.domEventHandlers({
        focus: () => {
          requestAnimationFrame(markPlace);
        },
      }),
      EditorView.contentAttributes.of(() => ({
        spellcheck: "true",
        autocapitalize: "sentences",
        lang: story.meta.language ?? "en",
      })),
      history(),
      // The line being written never sits on the window's bottom edge, under the notices.
      EditorView.scrollMargins.of((margins) => ({
        top: 24,
        bottom: Math.min(240, Math.round(margins.scrollDOM.clientHeight / 4)),
      })),
      search({ top: true }),
      // The search panel's words, as the rest of the Writer writes them.
      EditorState.phrases.of({
        Find: "Find",
        Replace: "Replace with",
        next: "Next",
        previous: "Previous",
        all: "All",
        "match case": "Match case",
        "by word": "Whole words",
        regexp: "Pattern",
        replace: "Replace",
        "replace all": "Replace all",
        close: "Close",
        "current match": "Current match",
        "replaced $ matches": "Replaced $ matches",
        "replaced match on line $": "Replaced the match on line $",
        "on line": "on line",
      }),
      Prec.high(
        keymap.of([
          {
            key: "Mod-k",
            run: () => {
              tools.openSpeaker(passageAtCursor());
              return true;
            },
          },
          {
            key: "Mod-j",
            run: () => {
              tools.openDirection(passageAtCursor());
              return true;
            },
          },
          { key: "F8", run: () => nextProblem(1), shift: () => nextProblem(-1) },
          { key: "Mod-.", run: fixHere },
          { key: "Mod-i", run: toggleEmphasis(false) },
          { key: "Mod-b", run: toggleEmphasis(true) },
          { key: "Alt-Shift-ArrowUp", run: () => moveSectionHere(false, -1) },
          { key: "Alt-Shift-ArrowDown", run: () => moveSectionHere(false, 1) },
          { key: "Alt-ArrowUp", run: (v) => moveParagraph(v, -1, frontMatterEnd()) },
          { key: "Alt-ArrowDown", run: (v) => moveParagraph(v, 1, frontMatterEnd()) },
        ]),
      ),
      keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
      emphasis(),
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
        if (update.heightChanged) tools.moved();
        if (update.selectionSet && !update.docChanged) keepPlaceSoon();
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
const warningTips = hoverTooltip(
  (tipView, at) => {
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
          // Pressed, the text keeps the focus; clicked (or Enter, Space, a screen reader), it fixes.
          button.addEventListener("mousedown", (event) => event.preventDefault());
          button.addEventListener("click", () => {
            if (tipView.state.readOnly) return;
            tipView.dispatch({ changes: fix, userEvent: "input.fix" });
            tipView.focus();
          });
          dom.append(button);
        }
        return { dom };
      },
    };
    // The text changed: the tip, and the places its fix knows, go.
  },
  { hideOnChange: true },
);

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

/**
 * Makes an edit the core works out, saying why where it can't: its own reason when it refuses
 * (`There is already a character called “Bob”`), or `declined` when it makes no changes.
 */
function attempt(make: () => TextChange[], declined: string): boolean {
  let changes: TextChange[];
  try {
    changes = make();
  } catch (error) {
    notice(error instanceof Error ? error.message : declined);
    if (prefs.side) showSide();
    return false;
  }
  return apply(changes, declined);
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
async function load(
  opened: Opened,
  kept: {
    id?: string;
    saved?: string;
    savedAt?: number;
    changedAt?: number;
    modified?: number;
  } = {},
): Promise<void> {
  const id = kept.id ?? newId();
  // The story open before is kept as it is (what keep() writes is read at once), and its lock
  // let go of; this one is written here, unless another tab writes it, when it is only read. A
  // new story's key is new: no other tab can be writing it, and it opens at once.
  if (lock.owner && id !== file.id) void keep();
  const claiming = lock.claim(id);
  const mine = kept.id === undefined || (await claiming);
  lockedOut = !mine;
  $("#elsewhere").hidden = mine;
  tools.hide();
  tabStory(id);
  file.id = id;
  file.name = opened.name;
  file.handle = opened.handle;
  file.modified = opened.modified ?? kept.modified;
  // A file read from disk is saved as it is; a screenplay made a story, an example or a new story
  // has yet to be.
  file.saved = kept.saved ?? (opened.imported ? "" : opened.text);
  file.savedAt = kept.savedAt;
  file.changedAt = kept.changedAt ?? Date.now();
  const lf = opened.text.replace(/\r\n/g, "\n");
  // The story's characters and colours first, so its names are drawn right from the start.
  story = readStory(lf);
  colors = characterColors(story);
  const front = story.frontMatter;
  const start = front ? Math.min(front.range.to + 2, lf.length) : 0;
  view.setState(editorState(opened.text, start));
  view.scrollDOM.scrollTop = 0;
  $("#welcome").hidden = true;
  document.body.removeAttribute("data-welcome");
  for (const behind of ["#editor", "#scene-rail", "#side"]) $(behind).inert = false;
  overlaid();
  $("#file-name").textContent = file.name;
  refresh();
  // Ready to type, except on a touch screen, where that would bring up its keyboard unasked.
  if (!lockedOut && !matchMedia("(pointer: coarse)").matches) view.focus();
  // The lock in hand before the draft is kept under it.
  await claiming;
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
  // The draft is kept a moment after typing stops, and every two seconds while it goes on.
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => void keep(), Date.now() - keptAt > 2000 ? 0 : 300);
  scheduleAutosave();
}

/**
 * The story read again, and what shows it: the rail and the save state at once; the counts, the
 * warnings and the side for a short story too, and for a long one when the browser is idle, so a
 * pause in typing never holds the next key.
 */
function refresh(): void {
  clearTimeout(refreshTimer);
  story = readStory(view.state.doc.toString());
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
  showWarningCount();
  // A long story's script or book, and its counts, are worked out in a worker of their own.
  if (view.state.doc.length >= LONG) {
    const tab = prefs.side && (prefs.tab === "script" || prefs.tab === "book") ? prefs.tab : "none";
    const drawn = tab !== "none";
    renderer.postMessage({ id: ++asked, text: view.state.doc.toString(), tab } satisfies RenderAsk);
    if (prefs.side && !drawn) showSide();
    return;
  }
  showCounts(countsOf(story));
  if (prefs.side) showSide();
}

const renderer = new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });
let asked = 0;
renderer.addEventListener("message", ({ data: reply }: MessageEvent<RenderReply>) => {
  // Only the latest: a reply for a text since changed is let go.
  if (reply.id !== asked || storyVersion !== version) return;
  showCounts(reply);
  if (reply.html && prefs.side && (prefs.tab === "script" || prefs.tab === "book")) {
    showSide(reply.html);
  }
});

function countsOf(of: Story): { words: number; said: number; voices: number } {
  const said = lines(of).filter((line) => line.kind === "speech" || line.kind === "vocal");
  return {
    words: bookText(of).match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu)?.length ?? 0,
    said: said.length,
    voices: new Set(said.map((line) => line.speaker)).size,
  };
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

/** Keeps a version of the story as it is now, to go back to (File › Earlier versions). */
let versionAt = Date.now();
/** While writing, and saving by itself, a version is kept at most this often. */
const SNAPSHOT_EVERY = 10 * 60_000;
function snapshot(why: string, content = text()): Promise<void> {
  versionAt = Date.now();
  return keepVersion({ doc: file.id, at: Date.now(), text: content, why });
}

/** Asks the browser, once, not to clear what the Writer keeps when space runs short. */
let persisted = false;
/** Whether the browser promised to keep the drafts: undefined until it says. */
let protectedDrafts: boolean | undefined;
function persistOnce(): void {
  if (persisted) return;
  persisted = true;
  void (async () => {
    try {
      protectedDrafts =
        (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.());
    } catch {
      protectedDrafts = false;
    }
    showDraftState();
  })();
}

/** When the draft was last kept, and the text's version then. */
let keptAt = 0;
let keptVersion = 0;

async function keep(): Promise<void> {
  clearTimeout(keepTimer);
  // Another tab writes the story: this one keeps nothing over it, and says so.
  if (!lock.owner) {
    file.kept = false;
    showDraftState();
    return;
  }
  keptAt = Date.now();
  const keeping = version;
  persistOnce();
  if (Date.now() - versionAt > SNAPSHOT_EVERY) void snapshot("While writing");
  file.kept = await keepDraft({
    id: file.id,
    name: file.name,
    text: text(),
    saved: file.saved,
    changedAt: file.changedAt,
    ...(file.handle ? { handle: file.handle } : {}),
    ...(file.savedAt ? { savedAt: file.savedAt } : {}),
    ...(file.modified !== undefined ? { modified: file.modified } : {}),
    place: place(),
  });
  if (file.kept) {
    keptVersion = Math.max(keptVersion, keeping);
    if (keptVersion === version) forgetRescue();
    lock.kept();
  }
  showDraftState();
}

/** Moving about without typing: where the writer is, kept a moment later. */
let placeTimer: ReturnType<typeof setTimeout> | undefined;
function keepPlaceSoon(): void {
  clearTimeout(placeTimer);
  placeTimer = setTimeout(() => void keep(), 1500);
}
view.scrollDOM.addEventListener("scroll", keepPlaceSoon, { passive: true });

/** Where the writer is: the cursor, and the line at the top of the page. */
function place(): { cursor: number; top: number } {
  const cursor = view.state.selection.main.head;
  const top = view.lineBlockAtHeight(
    Math.max(0, view.scrollDOM.scrollTop - view.contentDOM.offsetTop),
  ).from;
  return { cursor, top };
}

// The words typed since the draft was last kept, written down at once when the page goes, where
// a draft kept a moment later might not be: brought back on the next visit.

const RESCUE = "vxd-writer-rescue";

function rescue(): void {
  commitPending();
  if (!lock.owner || keptVersion === version) return;
  try {
    localStorage.setItem(
      `${RESCUE}:${file.id}`,
      JSON.stringify({
        id: file.id,
        name: file.name,
        text: text(),
        saved: file.saved,
        changedAt: file.changedAt,
        place: place(),
      }),
    );
  } catch {
    // Too long for this storage: the draft from a moment ago is what comes back.
  }
}

function forgetRescue(id = file.id): void {
  try {
    localStorage.removeItem(`${RESCUE}:${id}`);
    if (rescuedBefore()?.id === id) localStorage.removeItem(RESCUE);
  } catch {
    // Nothing kept.
  }
}

type Rescued = Pick<Draft, "name" | "text" | "saved" | "changedAt" | "place"> & { id?: string };
/** The words rescued for a story; one written down before each story had its own, if it is this one's. */
function rescued(id: string): Rescued | null {
  try {
    const own = JSON.parse(localStorage.getItem(`${RESCUE}:${id}`) ?? "null") as Rescued | null;
    const before = rescuedBefore();
    return own ?? (before?.id === id ? before : null);
  } catch {
    return null;
  }
}
function rescuedBefore(): Rescued | null {
  try {
    return JSON.parse(localStorage.getItem(RESCUE) ?? "null");
  } catch {
    return null;
  }
}

/** The story this tab has open, kept for its reloads; set with `id`. */
function tabStory(id?: string): string | undefined {
  try {
    if (id) sessionStorage.setItem("vxd-writer-tab", id);
    return sessionStorage.getItem("vxd-writer-tab") ?? undefined;
  } catch {
    return id;
  }
}

window.addEventListener("pagehide", rescue);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    rescue();
    void keep();
  }
});

// What the bars say.

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Saved, or changes to save. Right after a change, without comparing the whole text yet. */
function showSaveState(edited = false): void {
  const unsaved = edited || !sameText(text(), file.saved);
  const state = $("#save-state");
  const words = unsaved
    ? file.saved === "" && !file.handle
      ? "Not saved yet"
      : "Edited"
    : file.savedAt
      ? // Where saving is a download, the copy is in Downloads, maybe under another name.
        `${keepsFiles ? "Saved" : "Downloaded"} ${time(file.savedAt)}`
      : "Saved";
  // Saving automatically stopped: said beside the name until a save goes through.
  if (autosaveStopped && unsaved) return;
  if (state.textContent !== words) {
    state.textContent = words;
    state.title = words;
  }
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
  // A story never saved to a file, in a browser that may clear what pages keep: said, once.
  const unprotected = protectedDrafts === false;
  state.textContent = !lock.owner
    ? "Not kept: another tab writes the story"
    : file.kept
      ? unprotected
        ? "Kept in this browser, for now"
        : "Kept in this browser"
      : "This browser won't keep a draft: save to a file";
  state.title =
    file.kept && unprotected
      ? "This browser may clear what pages keep when space runs short, or after weeks without a visit. Save the story to a file to be safe."
      : "";
  state.dataset.kept = String(file.kept && lock.owner);
  if (
    file.kept &&
    lock.owner &&
    !file.handle &&
    file.saved === "" &&
    Date.now() - startedAt > 15 * 60_000 &&
    nudged !== file.id
  ) {
    nudged = file.id;
    notice(
      `${file.name} is only in this browser so far. Save (${keys("Mod+S")}) keeps a copy as a file.`,
    );
  }
}
/** When this page opened, and the story already told it is only in this browser. */
const startedAt = Date.now();
let nudged = "";

/** The story open, and its words when it was opened here. */
let session: { id: string; words: number; reached: boolean } | undefined;

function showCounts({
  words,
  said,
  voices,
}: { words: number; said: number; voices: number }): void {
  const scenes = Math.max(0, ...sceneNumbers(view.state).values());
  const plural = (n: number, one: string, many = `${one}s`) =>
    `${n.toLocaleString()} ${n === 1 ? one : many}`;
  // The words written since the story was opened here, and the goal for the sitting, if any.
  if (session?.id !== file.id) session = { id: file.id, words, reached: false };
  const since = words - session.words;
  const signed = `${since > 0 ? "+" : since < 0 ? "−" : ""}${Math.abs(since).toLocaleString()}`;
  const goal = prefs.goal > 0 ? ` of ${prefs.goal.toLocaleString()}` : "";
  if (prefs.goal > 0 && since >= prefs.goal && !session.reached) {
    session.reached = true;
    notice(`${prefs.goal.toLocaleString()} words written: the goal is reached.`);
  }
  $("#counts").textContent = [
    `${plural(words, "word")}${since || goal ? ` (${signed}${goal})` : ""}`,
    plural(said, "line said", "lines said"),
    plural(voices, "voice"),
    plural(scenes, "scene"),
    ...(words ? [listening(words)] : []),
  ].join(" · ");
  $("#counts").title = since
    ? `${since > 0 ? "+" : "−"}${Math.abs(since).toLocaleString()} words since the story was opened`
    : "";
}

function cursorMoved(): void {
  const { head, from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  // A selection says how many words it holds, and how long they take to hear.
  const chosen = from === to ? "" : view.state.sliceDoc(from, to);
  const words = chosen ? (chosen.match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu)?.length ?? 0) : 0;
  $("#cursor-place").textContent = words
    ? `${words.toLocaleString()} ${words === 1 ? "word" : "words"} selected · ${listening(words)}`
    : `Line ${line.number}, column ${head - line.from + 1}`;
  markPlace();
}

function showWarningCount(): void {
  const count = currentProblems().filter((problem) => problem.severity === "warning").length;
  $("#warning-count").textContent = String(count);
  const button = $<HTMLButtonElement>("#status-warnings");
  button.hidden = count === 0;
  button.textContent = `${count} ${count === 1 ? "warning" : "warnings"}`;
}

// The side: the script, the book, and the warnings.

/** The side, drawn again: the script or the book (`drawn`, when the worker drew it), cast or warnings. */
function showSide(drawn?: string): void {
  const sheet = $("#side-sheet");
  for (const tab of document.querySelectorAll<HTMLElement>(".side-tab")) {
    const selected = tab.dataset.tab === prefs.tab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  sheet.setAttribute("aria-labelledby", `tab-${prefs.tab}`);
  // A name being typed on the side isn't redrawn under the writer's fingers.
  if (sheet.contains(document.activeElement) && document.activeElement?.matches("input")) return;
  const long = view.state.doc.length >= LONG;
  if (prefs.tab === "script" || prefs.tab === "book") {
    // A long story's comes from the worker: until it does, the page shows what it showed.
    if (drawn !== undefined) sheet.innerHTML = drawn;
    else if (!long)
      sheet.innerHTML =
        prefs.tab === "script"
          ? renderScript(story, { positions: true })
          : renderBook(story, { pages: true, positions: true });
    else {
      renderer.postMessage({
        id: ++asked,
        text: view.state.doc.toString(),
        tab: prefs.tab,
      } satisfies RenderAsk);
      return;
    }
  } else if (prefs.tab === "cast")
    sheet.replaceChildren(
      castPanel(story, colors, {
        rename: (from, to) =>
          attempt(
            () => renameCharacter(current(), from, to),
            `${from} can’t be renamed ${to} here.`,
          ),
        fullName: (handle, name) =>
          attempt(
            () => setFullName(current(), handle, name),
            `The cast can’t give ${handle} that name as written.`,
          ),
        about: (handle, about) =>
          attempt(
            () => setAbout(current(), handle, about || null),
            `The cast can’t say that about ${handle} as written.`,
          ),
        // Their next line after the cursor, round to the first after the last.
        find: (handle) => {
          const doc = view.state.doc;
          const theirs = lines(current())
            .filter((row) => row.speaker?.toLowerCase() === handle.toLowerCase())
            .map((row) => Math.min(doc.line(row.line).from + row.column - 1, doc.length));
          if (theirs.length === 0) return notice(`${handle} has no lines yet.`);
          const here = view.state.selection.main.head;
          const at = theirs.find((place) => place > here) ?? (theirs[0] as number);
          view.dispatch({
            selection: EditorSelection.cursor(at),
            effects: EditorView.scrollIntoView(at, { y: "center" }),
          });
          announce(`${handle}, line ${theirs.indexOf(at) + 1} of ${theirs.length}`);
          view.focus();
        },
        notice,
      }),
    );
  else sheet.replaceChildren(warningList());
  indexSheet();
  markPlace();
}

/**
 * F8 and Shift+F8: the next warning after the cursor, or the one before, selected and said; its
 * fix is a key away (Ctrl+.).
 */
function nextProblem(by: 1 | -1): boolean {
  if (storyVersion !== version) refresh();
  const all = currentProblems();
  if (all.length === 0) {
    notice("Nothing to put right.");
    return true;
  }
  const here = view.state.selection.main.from;
  const next =
    by > 0
      ? (all.find((problem) => problem.from > here) ?? all[0])
      : ([...all].reverse().find((problem) => problem.from < here) ?? all.at(-1));
  if (!next) return true;
  view.dispatch({
    selection: EditorSelection.range(next.from, next.to),
    effects: EditorView.scrollIntoView(next.from, { y: "center" }),
  });
  const fix = next.fix?.label ?? (next.cast ? `Add ${next.cast} to the cast` : undefined);
  const message = /[.!?…]$/.test(next.message) ? next.message : `${next.message}.`;
  const told = `Line ${next.line} (${all.indexOf(next) + 1} of ${all.length}): ${message}${fix ? ` ${keys("Mod+.")}: ${fix}.` : ""}`;
  // The notice is read out too: it is a live region of its own.
  notice(told);
  return true;
}

/** Ctrl+.: the fix for the warning at the cursor. */
function fixHere(): boolean {
  if (lockedOut) return true;
  if (storyVersion !== version) refresh();
  const { from, to } = view.state.selection.main;
  const problem = currentProblems().find(
    (found) => found.from <= to && from <= found.to && (found.fix || found.cast),
  );
  if (!problem) {
    notice("No fix here. F8 goes to the next warning.");
    return true;
  }
  if (problem.fix) {
    view.dispatch({ changes: problem.fix, userEvent: "input.fix" });
    refresh();
    announce(`Done: ${problem.fix.label ?? "fixed"}.`);
  } else if (problem.cast) {
    const name = problem.cast;
    attempt(() => setFullName(current(), name, name), `${name} can’t be added to the cast.`);
  }
  return true;
}

/**
 * The scene the cursor is in (from its heading or break to the next), or its chapter (from its
 * `#` heading to the next), moved past the one before or after; one step to undo.
 */
function moveSectionHere(chapters: boolean, by: 1 | -1): boolean {
  if (lockedOut) return true;
  if (storyVersion !== version) refresh();
  const starts = railScenes(current(), sceneNumbers(view.state))
    .filter((scene) => !chapters || scene.chapter)
    .map((scene) => scene.from);
  const spec = moveSection(view.state, starts, by);
  if (!spec) {
    const what = chapters ? "chapter" : "scene";
    notice(
      starts.some((start) => start <= view.state.selection.main.head)
        ? `No ${what} ${by < 0 ? "before" : "after"} this one to move it past.`
        : `Put the cursor in a ${what} first: one starts at a ${chapters ? "# heading" : "heading or a scene break"}.`,
    );
    return true;
  }
  view.dispatch({ ...spec, scrollIntoView: true, userEvent: "move.section" });
  refresh();
  return true;
}

/** A warning's fix as the story is now: the same warning, over the same words, nearest `near`. */
function fixNow(code: string, words: string, near: number): Problem["fix"] {
  if (storyVersion !== version) refresh();
  return currentProblems()
    .filter(
      (problem) =>
        problem.code === code &&
        problem.fix &&
        view.state.sliceDoc(problem.from, problem.to) === words,
    )
    .sort((a, b) => Math.abs(a.from - near) - Math.abs(b.from - near))[0]?.fix;
}

/** What to put right, with its fixes. */
function currentProblems(): Problem[] {
  const doc = view.state.doc;
  return problems(
    story,
    view.state.field(marksField),
    (at) => doc.lineAt(Math.min(at, doc.length)).number,
  );
}

function warningList(): HTMLElement {
  const all = currentProblems();
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
      const drawn = version;
      const words = view.state.sliceDoc(problem.from, problem.to);
      mend.addEventListener("click", () => {
        if (lockedOut) return;
        // Typed in since the list was drawn: the warning found again where it is now, or not
        // fixed at all.
        const now = drawn === version ? fix : fixNow(problem.code, words, problem.from);
        if (!now) {
          notice("That warning has changed since; the list shows it as it is now.");
          refresh();
          return;
        }
        view.dispatch({ changes: now, userEvent: "input.fix" });
        refresh();
        view.focus();
      });
      item.append(mend);
    }
    const name = problem.cast;
    if (name) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "button fix";
      add.textContent = `Add ${name} to the cast`;
      add.addEventListener("click", () =>
        attempt(() => setFullName(current(), name, name), `${name} can’t be added to the cast.`),
      );
      item.append(add);
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
  bringIntoView(element);
}

/**
 * Scrolls the side to a part of it. Parts off screen aren't laid out (content-visibility), so their
 * sizes are guesses until they are: the browser scrolls, and once they are laid out, again.
 */
function bringIntoView(element: HTMLElement): void {
  const sheet = $("#side-sheet");
  const shown = () => {
    const box = element.getBoundingClientRect();
    const frame = sheet.getBoundingClientRect();
    return box.top >= frame.top && box.bottom <= frame.bottom;
  };
  if (shown()) return;
  element.scrollIntoView({ block: "center", behavior: "auto" });
  requestAnimationFrame(() => {
    if (!shown()) element.scrollIntoView({ block: "center", behavior: "auto" });
  });
}

function showSidePanel(shown: boolean): void {
  prefs.side = shown;
  keepPrefs();
  $("#workspace").toggleAttribute("data-side", shown);
  checkMenu("side", shown);
  if (shown) showSide();
  overlaid();
}

/**
 * On a narrow window the side lies over the manuscript: then it is what is read, and what is
 * behind it can't be reached by the keyboard or a screen reader until it is closed.
 */
const narrow = window.matchMedia("(max-width: 1099px)");
function overlaid(): void {
  const over = narrow.matches && prefs.side;
  const toggle = $("#preview-toggle");
  toggle.setAttribute("aria-pressed", String(over));
  toggle.textContent = over ? "Write" : "Preview";
  if (document.body.hasAttribute("data-welcome")) return;
  $(".manuscript").inert = over;
  $("#scene-rail").inert = over;
}
narrow.addEventListener("change", overlaid);
$("#preview-toggle").addEventListener("click", () => {
  const preview = !(narrow.matches && prefs.side);
  showSidePanel(preview);
  if (preview) document.querySelector<HTMLElement>('.side-tab[aria-selected="true"]')?.focus();
  else view.focus();
});

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
/** A question with a box to type in: what was typed, or null if the writer changed their mind. */
async function askText(
  message: string,
  placeholder: string,
  action: string,
): Promise<string | null> {
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
  return answer === "ok" ? input.value.trim() : null;
}

/** Whether the story may be put aside: saved, or the writer says so. */
async function mayLeave(): Promise<boolean> {
  // A story another tab writes is that tab's to save: this one leaves it as it is.
  if (lockedOut) return true;
  if (!(await mayWrite())) return false;
  if (sameText(text(), file.saved)) return true;
  const answer = await ask(
    `Save the changes to ${file.name} first? If you don't, they stay in this browser: File › Recover a draft brings them back.`,
    [
      { label: "Cancel", value: "cancel" },
      { label: "Don't save", value: "discard" },
      { label: "Save", value: "save", main: true },
    ],
  );
  if (answer === "discard") await keep();
  if (answer === "discard") return true;
  if (answer === "save") {
    if (!(await save())) return false;
    // Words typed while it saved are changes too: asked about again, never left behind.
    return sameText(text(), file.saved) || mayLeave();
  }
  return false;
}

async function open(): Promise<void> {
  if (!(await mayLeave())) return;
  try {
    const opened = await pickFile(input);
    if (!opened) return;
    await openStory(opened);
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
    await openStory(opened);
    await rememberFile(opened.name, handle);
  } catch {
    await forgetFile(handle);
    await tell(`${handle.name} can't be opened any more: it may have been moved or deleted.`);
  }
  void showRecent();
}

/**
 * Opens a file as a story: with the draft this browser keeps for it, if there is one, and with the
 * changes in it that were never saved, if the writer wants them.
 */
async function openStory(opened: Opened): Promise<void> {
  const kept = opened.handle ? await draftForFile(opened.handle) : undefined;
  if (kept && !sameText(kept.text, kept.saved) && !sameText(kept.text, opened.text)) {
    const answer = await ask(
      `This browser kept changes to ${kept.name} from ${time(kept.changedAt)} that were never saved. Open them, or the file as it is?`,
      [
        { label: "The file as it is", value: "file" },
        { label: "My unsaved changes", value: "mine", main: true },
      ],
    );
    if (answer === "mine") {
      await restore({ ...kept, ...(opened.handle ? { handle: opened.handle } : {}) });
      void checkDisk();
      return;
    }
    // The changes aren't lost: they become a version of the story.
    await keepVersion({ doc: kept.id, at: kept.changedAt, text: kept.text, why: "Not saved" });
  }
  await load(opened, kept ? { id: kept.id } : {});
  if (!opened.imported) void snapshot("Opened", opened.text);
}

/** Saves to the story's file, or asks where. True once it is saved. */
/**
 * A field on the side changed but not yet left (a name in the cast, what it says about someone):
 * made now, so that Save and leaving the page take it with them.
 */
function commitPending(): void {
  const field = document.activeElement;
  if (
    (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
    field.closest("#side-sheet") &&
    field.value !== field.defaultValue
  )
    field.blur();
}

async function save(): Promise<boolean> {
  commitPending();
  // Only the tab that writes the story saves it: another would save what it last saw.
  if (!(await mayWrite())) return false;
  if (!file.handle) return saveAs();
  return write(file.handle);
}

async function saveAs(): Promise<boolean> {
  commitPending();
  if (!(await mayWrite())) return false;
  if (!keepsFiles) {
    // Where a page can't keep a file, saving is a download.
    const content = text();
    download(content, file.name);
    saved(content);
    return true;
  }
  const handle = await pickSaveTarget(file.name);
  if (!handle) return false;
  // The new file is the story's from here: its name and handle go with what is kept, and back to
  // the old ones if it can't be written.
  const before = { handle: file.handle, name: file.name, modified: file.modified };
  file.handle = handle;
  file.name = handle.name;
  file.modified = undefined;
  $("#file-name").textContent = file.name;
  const done = await write(handle);
  if (done) {
    await rememberFile(handle.name, handle);
    void showRecent();
  } else {
    file.handle = before.handle;
    file.name = before.name;
    file.modified = before.modified;
    $("#file-name").textContent = file.name;
    showSaveState();
  }
  return done;
}

async function write(handle: FileSystemFileHandle): Promise<boolean> {
  // The browser may want to ask before the page writes the file again (after a restart): asked
  // now, on the click, so that the file can be read before it is written.
  try {
    if (!(await allowed(handle, "readwrite"))) {
      await tell(`${file.name} wasn’t saved: the browser didn’t allow writing it.`);
      return false;
    }
  } catch {
    // Writing will say what is wrong.
  }
  // Changed on disk since the Writer read it (another app, another computer syncing it): asked
  // first, never overwritten unseen; and whichever is kept, the other is in Earlier versions.
  const check =
    handle === file.handle && file.modified !== undefined
      ? diskCheck(await onDisk(handle), { modified: file.modified, saved: file.saved })
      : ({ kind: "write" } as const);
  if (check.kind === "unread") {
    const answer = await ask(
      `${file.name} couldn’t be read to see whether it changed outside the Writer. Save over it anyway?`,
      [
        { label: "Cancel", value: "cancel", main: true },
        { label: "Save over it", value: "mine" },
      ],
    );
    if (answer !== "mine") return false;
  } else if (check.kind === "changed") {
    const disk = check.disk;
    const answer = await ask(
      `${file.name} was changed outside the Writer since it was opened here. Keep both, open the file as it is now, or save over it? The one you don’t keep stays in Earlier versions.`,
      [
        { label: "Cancel", value: "cancel" },
        { label: "Open it as it is now", value: "theirs" },
        { label: "Save over it", value: "mine" },
        { label: "Keep both…", value: "both", main: true },
      ],
    );
    if (answer === "theirs") {
      await readAgain(disk);
      return false;
    }
    if (answer === "both") {
      // Theirs stays in the file, and among this story's versions; mine goes to a new file.
      await snapshot("As it was on disk", disk.text);
      return saveAs();
    }
    if (answer !== "mine") return false;
    await snapshot("As it was on disk, before it was saved over", disk.text);
  }
  const content = text();
  const state = $("#save-state");
  state.dataset.state = "saving";
  state.textContent = "Saving…";
  try {
    const id = file.id;
    const modified = await queued(() => {
      // Checked again when its turn comes: another tab may have taken the story meanwhile.
      if (!lock.owner) throw new Error("another tab writes this story now");
      return writeFile(handle, content);
    });
    if (!savedAs(id, content, modified)) return false;
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

/**
 * The file as it is on disk now, in place of the story here: the same story with its versions,
 * the cursor and the page where they were, Undo to take it back; and what was here kept as a
 * version first.
 */
async function readAgain(disk: { text: string; modified: number }): Promise<void> {
  await snapshot("Before the file was read again", text());
  file.saved = disk.text;
  file.savedAt = Date.now();
  file.modified = disk.modified;
  replaceText(disk.text, "input.disk", allCrlf(disk.text));
  showSaveState();
  await keep();
  await snapshot("Read again from disk", disk.text);
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
  if (sameText(disk.text, file.saved)) {
    file.modified = disk.modified;
    void keep();
    return;
  }
  if (sameText(text(), file.saved)) {
    await readAgain(disk);
    notice(
      `${file.name} changed outside the Writer, so it was read again. Undo (Ctrl+Z) takes it back.`,
    );
  } else {
    notice(`${file.name} changed outside the Writer. Saving will ask which to keep.`);
  }
}
window.addEventListener("focus", () => void checkDisk());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkDisk();
});

/** Saved: a version kept each time it is saved by hand, and at most every ten minutes by itself. */
function saved(content: string, automatic = false): void {
  file.saved = content;
  file.savedAt = Date.now();
  autosaveStopped = false;
  showSaveState();
  void keep();
  if (!automatic || Date.now() - versionAt > SNAPSHOT_EVERY) void snapshot("Saved", content);
}

// Saving automatically: to the story's own file, two seconds after typing stops, where the browser
// already lets the page write it. Never asks: a file changed on disk waits for Save.

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAutosave(): void {
  clearTimeout(autosaveTimer);
  if (!prefs.autosave || !keepsFiles || !file.handle) return;
  autosaveTimer = setTimeout(() => void autosave(), 2000);
}

/** The change on disk last told about, so that it is told once. */
let toldDisk = "";

async function autosave(): Promise<void> {
  const handle = file.handle;
  const base = {
    on: prefs.autosave,
    owner: lock.owner && !lockedOut,
    hasFile: Boolean(handle),
    unsaved: !sameText(text(), file.saved),
  };
  // Nothing to do (off, another tab's, no file, nothing changed): no need to look at the file.
  const first = autosaveCheck({ ...base, mayWriteNow: true, disk: { kind: "write" } });
  if (first.kind === "wait" || !handle) return;
  const may = await mayWriteNow(handle);
  const check = autosaveCheck({
    ...base,
    mayWriteNow: may,
    disk: may
      ? diskCheck(await onDisk(handle), { modified: file.modified, saved: file.saved })
      : { kind: "write" },
  });
  if (check.kind === "ask") {
    // The browser asks again after a restart, and only on a click: Save asks, once.
    stopped(`Saving ${file.name} automatically needs your go-ahead: press Save once (Ctrl+S).`);
    return;
  }
  if (check.kind === "stop") {
    // Said once for each change on disk, not at every pause in typing.
    const what = check.check;
    const seen = `${file.id}:${what.kind === "changed" ? what.disk.modified : "unread"}`;
    if (toldDisk !== seen)
      notice(
        what.kind === "changed"
          ? `${file.name} changed outside the Writer, so it wasn’t saved automatically. Save will ask which to keep.`
          : `${file.name} couldn’t be read, so it wasn’t saved automatically. Save will ask what to do.`,
      );
    toldDisk = seen;
    return;
  }
  if (check.kind !== "write" || handle !== file.handle) return;
  const content = text();
  const id = file.id;
  try {
    const modified = await queued(() => {
      if (!prefs.autosave || !lock.owner) throw new Error("saving automatically was stopped");
      return writeFile(handle, content);
    });
    savedAs(id, content, modified, true);
    autosaveStopped = false;
  } catch (error) {
    // Switched off, or taken by another tab, while it waited its turn: nothing to say.
    if (!prefs.autosave || !lock.owner) return;
    stopped(`${file.name} couldn’t be saved automatically: ${(error as Error).message}`);
  }
}

/** Saving automatically stopped: said once, and shown beside the file's name until it saves. */
let autosaveStopped = false;
function stopped(message: string): void {
  const state = $("#save-state");
  state.dataset.state = "error";
  state.textContent = "Not saved: press Save";
  state.title = message;
  if (autosaveStopped) return;
  autosaveStopped = true;
  notice(message);
}

/**
 * Saving one at a time: a save started while another is under way waits for it, so two never
 * write the same file at once, and the later always lands last.
 */
const saves = new SaveQueue();
const queued = <T>(work: () => Promise<T>): Promise<T> => saves.run(work);

/**
 * A save finished: the story it was for is saved as `content`. If another story is open by now,
 * only that story's kept draft learns it; the open one is left as it is. True if it is the open
 * story.
 */
function savedAs(id: string, content: string, modified: number, automatic = false): boolean {
  if (id !== file.id) {
    void markSaved(id, content, modified);
    return false;
  }
  file.modified = modified;
  saved(content, automatic);
  return true;
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
  () => void follow(),
);

/** A tab that only reads follows the one that writes: its words, a moment after it keeps them. */
let following = Promise.resolve();
function follow(): Promise<void> {
  following = following.then(async () => {
    if (!lockedOut && lock.owner) return;
    const draft = await draftById(file.id);
    if (!draft || lock.owner || draft.id !== file.id) return;
    file.saved = draft.saved;
    file.name = draft.name;
    $("#file-name").textContent = file.name;
    if (draft.handle) file.handle = draft.handle;
    file.modified = draft.modified;
    replaceText(draft.text, "follow");
    showSaveState();
  });
  return following;
}

/** Takes the story from the tab that writes it, and reads the draft it kept. */
async function writeHere(): Promise<boolean> {
  if (!(await lock.claim(file.id, true))) return false;
  lockedOut = false;
  $("#elsewhere").hidden = true;
  const draft = await draftById(file.id);
  if (draft) await restore(draft);
  else view.dispatch({ effects: editable.reconfigure(editability()) });
  view.focus();
  return true;
}
$("#edit-here").addEventListener("click", () => void writeHere());

/** Whether this tab may change the story: it writes it, or the writer says it should. */
async function mayWrite(): Promise<boolean> {
  // With no story open yet, there is nothing another tab could be writing.
  if (lock.owner || !lock.story) return true;
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

/** A new story: its details, a title, and a page to write on. The examples show the marks. */
const NEW_STORY = [
  "---",
  "voxdown: 1.1",
  "title: Untitled",
  `language: ${navigator.language || "en"}`,
  "cast:",
  "---",
  "",
  "# Untitled",
  "",
  "",
].join("\n");

async function newStory(): Promise<void> {
  if (!(await mayLeave())) return;
  await load({ name: "Untitled.vxd", text: NEW_STORY }, { saved: "" });
  // The cursor on the page under the title, ready to write.
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length), scrollIntoView: true });
  view.focus();
}

/** Tidies the story as `format` does, changing only what it changes, as one step to undo. */
function tidy(curly: boolean): void {
  if (lockedOut) return;
  const before = view.state.doc.toString();
  const after = format(before, curly ? { quotes: "curly" } : {});
  if (after === before) return;
  void snapshot("Before tidying");
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
    attempt(
      () => insertSound(current(), at, description),
      "A sound can’t go there without changing what is heard: put the cursor after a word.",
    );
  view.focus();
}

/** Puts `text` in at the cursor, the part `select` selected, with a space before it if needed. */
function insertAtCursor(text: string, select?: string): void {
  if (lockedOut) return;
  let { from, to } = view.state.selection.main;
  // Inside a mark (an instruction, a sound, a note, a direction), the new one goes after it.
  const inside = view.state
    .field(marksField)
    .find(
      (mark) =>
        (mark.kind === "instruction" ||
          mark.kind === "pause" ||
          mark.kind === "page" ||
          mark.kind === "sound" ||
          mark.kind === "vocal" ||
          mark.kind === "note" ||
          mark.kind === "direction") &&
        mark.from < from &&
        from < mark.to,
    );
  if (inside) {
    from = inside.to;
    to = inside.to;
  }
  // Inside a word, after it: a pause or a note never splits one.
  const letter = /[\p{L}\p{N}’'-]/u;
  if (from === to) {
    const line = view.state.doc.lineAt(from);
    let end = from;
    if (letter.test(view.state.sliceDoc(from - 1, from)))
      while (end < line.to && letter.test(view.state.sliceDoc(end, end + 1))) end++;
    from = end;
    to = end;
  }
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
  view.dispatch({
    ...afterParagraph(view.state, frontMatterEnd(), line, select),
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

// Drafts and versions kept in this browser, to go back to.

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** A list in a dialog: each row a title, a line about it, and its buttons. */
function showList(
  title: string,
  note: string,
  rows: Array<{
    title: string;
    detail: string;
    /** A few of its words, to know it by. */
    excerpt?: string;
    current?: boolean;
    actions: Array<{ label: string; main?: boolean; run: () => unknown }>;
  }>,
): void {
  const dialog = $<HTMLDialogElement>("#list-dialog");
  $("#list-title").textContent = title;
  $("#list-note").textContent = note;
  $("#list-items").replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement("li");
      if (row.current) item.dataset.current = "";
      const words = document.createElement("div");
      words.className = "list-words";
      const heading = document.createElement("strong");
      heading.textContent = row.title;
      const detail = document.createElement("span");
      detail.textContent = row.detail;
      words.append(heading, detail);
      if (row.excerpt) {
        const excerpt = document.createElement("span");
        excerpt.className = "list-excerpt";
        excerpt.textContent = row.excerpt;
        words.append(excerpt);
      }
      const buttons = document.createElement("div");
      buttons.className = "list-actions";
      for (const action of row.actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = action.main ? "button primary" : "button";
        button.textContent = action.label;
        button.addEventListener("click", () => {
          dialog.close();
          void action.run();
        });
        buttons.append(button);
      }
      item.append(words, buttons);
      return item;
    }),
  );
  dialog.showModal();
}

async function showDrafts(): Promise<void> {
  await keep();
  const drafts = await listDrafts();
  showList(
    "Recover a draft",
    "Every story written here is kept in this browser as it was typed, saved or not, until you let it go.",
    drafts.map((draft) => {
      const open = draft.id === file.id;
      const unsaved = !sameText(draft.text, draft.saved);
      const { title, words } = glimpse(draft.text);
      return {
        title:
          title && title !== draft.name.replace(/\.[^.]+$/, "")
            ? `${title} · ${draft.name}`
            : draft.name,
        excerpt: words,
        detail: `${open ? "Open now · " : ""}${unsaved ? "changes not saved · " : ""}${wordCount(draft.text).toLocaleString()} words · ${when(draft.changedAt)}`,
        current: open,
        actions: open
          ? []
          : [
              {
                label: "Let it go",
                run: async () => {
                  const answer = await ask(
                    `Let the draft of ${draft.name} go? ${unsaved ? "Its changes were never saved, and will be lost." : "The file itself is left as it is."}`,
                    [
                      { label: "Cancel", value: "cancel" },
                      { label: "Let it go", value: "forget", main: true },
                    ],
                  );
                  if (answer === "forget") await forgetDraft(draft.id);
                  void showDrafts();
                },
              },
              {
                label: "Open",
                main: true,
                run: async () => {
                  // The story open now is kept as it is: nothing to ask.
                  await restore(draft);
                  void checkDisk();
                },
              },
            ],
      };
    }),
  );
}

async function showVersions(): Promise<void> {
  const versions = await versionsOf(file.id);
  showList(
    `Earlier versions of ${file.name}`,
    versions.length
      ? "Kept when the story was opened, each time it was saved, every ten minutes of writing and before tidying. Going back to one is a change like any other: Undo takes it back."
      : "None yet: a version is kept when the story is opened or saved, and every ten minutes of writing.",
    versions.map((kept) => ({
      title: `${when(kept.at)} · ${kept.why}`,
      detail: `${wordCount(kept.text).toLocaleString()} words${sameText(kept.text, text()) ? " · the same as now" : ""}`,
      actions: sameText(kept.text, text())
        ? []
        : [
            { label: "Compare", run: () => compare(kept) },
            { label: "Go back to it", main: true, run: () => goBack(kept) },
          ],
    })),
  );
}

function goBack(kept: Version): void {
  if (lockedOut) return;
  void snapshot("Before going back");
  replaceText(kept.text, "input.version");
  notice(`Back to the version from ${when(kept.at)}. Undo (Ctrl+Z) takes it back.`);
  view.focus();
}

/** The story's details, from its front matter, changed in a form rather than in YAML. */
function showDetails(): void {
  const dialog = $<HTMLDialogElement>("#details");
  const fields = [...dialog.querySelectorAll<HTMLInputElement>("input[data-key]")];
  const written = (key: string) => {
    const value = current().frontMatter?.data[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  };
  for (const field of fields) field.value = written(field.dataset.key ?? "");
  dialog.returnValue = "";
  dialog.onclose = () => {
    if (dialog.returnValue !== "done" || lockedOut) return;
    for (const field of fields) {
      const key = field.dataset.key ?? "";
      const value = field.value.trim();
      if (value === written(key)) continue;
      // Each detail is one value: set, or taken out.
      if (key === "narrator" && value && !isName(value)) {
        notice(`“${value}” isn’t a name: one word of letters, digits, - and _.`);
        continue;
      }
      attempt(
        () => setMeta(current(), key, value || null),
        `The ${key} can’t be set to that as written.`,
      );
    }
    view.focus();
  };
  dialog.showModal();
  fields[0]?.focus();
}

/** A version beside the story now: what it had that is gone, what is new since. */
function compare(kept: Version): void {
  const dialog = $<HTMLDialogElement>("#compare");
  $("#compare-title").textContent = `${when(kept.at)} · ${kept.why}, and now`;
  const rows = withWords(changesOnly(diffLines(kept.text, text())));
  const shown = rows.slice(0, 3000);
  $("#compare-lines").replaceChildren(
    ...shown.map((row) => {
      const line = document.createElement(
        row.kind === "gone" ? "del" : row.kind === "new" ? "ins" : "div",
      );
      line.className = `compare-${row.kind}`;
      if (row.kind === "changed")
        // One line, its words gone struck through and its new ones underlined.
        line.append(
          ...row.parts.map((part) => {
            if (part.kind === "same") return document.createTextNode(part.text);
            const word = document.createElement(part.kind === "gone" ? "del" : "ins");
            word.textContent = part.text;
            return word;
          }),
        );
      else
        line.textContent =
          row.kind === "skip"
            ? `${row.count.toLocaleString()} ${row.count === 1 ? "line" : "lines"} the same`
            : row.text || " ";
      return line;
    }),
  );
  if (rows.length > shown.length) {
    const more = document.createElement("div");
    more.className = "compare-skip";
    more.textContent = "And more changes after these.";
    $("#compare-lines").append(more);
  }
  const back = $<HTMLButtonElement>("#compare-back");
  back.onclick = () => {
    dialog.close();
    goBack(kept);
  };
  dialog.showModal();
  $("#compare-lines").scrollTop = 0;
}

/**
 * Each character's lines, with their cues: the end of the line before each one, as a performer's
 * sides give it, and what the line is said like.
 */
function sides(of: Story): string {
  const said = lines(of).filter((line) => line.kind === "speech" || line.kind === "vocal");
  const parts: string[] = [];
  for (const name of textByCharacter(of).keys()) {
    const out = [`== ${name} ==`, ""];
    for (const [index, line] of said.entries()) {
      if (line.speaker !== name) continue;
      const before = said[index - 1];
      if (before && before.speaker !== name) {
        const words = before.text.split(/\s+/).filter(Boolean);
        out.push(`    …${words.slice(-8).join(" ")} (${before.speaker})`);
      }
      const text = line.kind === "vocal" ? `[${line.text}]` : line.text;
      out.push(`${name}${line.direction ? ` (${line.direction})` : ""}: ${text}`, "");
    }
    parts.push(out.join("\n"));
  }
  return `${parts.join("\n\n")}\n`;
}

function focusMode(on: boolean): void {
  prefs.focus = on;
  keepPrefs();
  checkMenu("focus", on);
  document.body.toggleAttribute("data-focus", on);
  // Redrawn: the faded lines, and the page about the cursor.
  view.dispatch({
    effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
  });
}

// The outline: every chapter and scene, found by typing, gone to with Enter.

function showOutline(): void {
  const dialog = $<HTMLDialogElement>("#outline");
  const filter = $<HTMLInputElement>("#outline-filter");
  const list = $("#outline-list");
  const scenes = railScenes(current(), sceneNumbers(view.state));
  // Each scene with the chapter it is in, to tell apart scenes of the same name.
  let chapter = "";
  const within = scenes.map((scene) => {
    if (scene.chapter) chapter = scene.name;
    return scene.chapter ? "" : chapter;
  });
  const here = view.state.selection.main.head;
  let active = Math.max(
    0,
    scenes.reduce((last, scene, index) => (scene.from <= here ? index : last), -1),
  );
  const draw = () => {
    const typed = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = scenes
      .map((scene, index) => ({ scene, index }))
      .filter(({ scene, index }) => {
        const words = `${scene.name} ${within[index]}`.toLowerCase();
        return typed.every((word) => words.includes(word));
      });
    if (!shown.some(({ index }) => index === active)) active = shown[0]?.index ?? -1;
    list.replaceChildren(
      ...shown.map(({ scene, index }) => {
        const option = document.createElement("li");
        option.id = `outline-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === active));
        if (scene.chapter) option.dataset.chapter = "";
        option.textContent = scene.name;
        if (within[index]) {
          const where = document.createElement("span");
          where.className = "outline-in";
          where.textContent = within[index] as string;
          option.append(where);
        }
        option.addEventListener("click", () => go(index));
        return option;
      }),
    );
    if (shown.length === 0) {
      const none = document.createElement("li");
      none.className = "outline-none";
      none.textContent = scenes.length
        ? "No chapter or scene by that name."
        : "No chapters or scenes yet: a # heading or a scene break makes one.";
      list.append(none);
    }
    filter.setAttribute("aria-activedescendant", active >= 0 ? `outline-${active}` : "");
    document.getElementById(`outline-${active}`)?.scrollIntoView({ block: "nearest" });
    return shown;
  };
  const go = (index: number) => {
    const scene = scenes[index];
    dialog.close();
    if (!scene) return;
    view.dispatch({
      selection: EditorSelection.cursor(scene.from),
      effects: EditorView.scrollIntoView(scene.from, { y: "start", yMargin: 24 }),
    });
    view.focus();
  };
  filter.value = "";
  // Typing picks the first chapter or scene that matches.
  filter.oninput = () => {
    active = -1;
    draw();
  };
  filter.onkeydown = (event) => {
    const shown = draw();
    const at = shown.findIndex(({ index }) => index === active);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        shown[Math.max(0, Math.min(shown.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) active = next.index;
      draw();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0) go(active);
    }
  };
  draw();
  dialog.showModal();
  filter.focus();
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
  ["Mod+Shift+O", "Go to a chapter or scene"],
  ["F8", "Next warning (Shift+F8: the one before)"],
  ["Mod+.", "Fix the warning at the cursor"],
  ["Alt+Shift+↑", "Move the scene up (Alt+Shift+↓: down)"],
  ["Mod+I", "Italics"],
  ["Mod+B", "Bold"],
  ["Mod+K", "Who says this passage"],
  ["Mod+J", "How it’s said"],
  ["Alt+↑ / Alt+↓", "Move the paragraph up or down"],
  ["Enter", "In a quote: close it, and open it again on a new line for the same speaker"],
  ["Mod+Shift+M", "Every mark raw, or drawn"],
  ["Mod+Shift+F", "Focus: the paragraph being written, in the middle of the page"],
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
  "scene-up": () => moveSectionHere(false, -1),
  "scene-down": () => moveSectionHere(false, 1),
  "chapter-up": () => moveSectionHere(true, -1),
  "chapter-down": () => moveSectionHere(true, 1),
  goal: async () => {
    const answer = await askText(
      `Words to write in this sitting${prefs.goal ? ` (now ${prefs.goal.toLocaleString()})` : ""}. Empty or 0 for none.`,
      "500",
      "Set the goal",
    );
    // Cancel or Escape leave the goal as it was; an empty answer takes it away.
    if (answer === null) return;
    const wanted = Number.parseInt(answer.replace(/[^\d]/g, ""), 10);
    prefs.goal = Number.isFinite(wanted) && wanted > 0 ? wanted : 0;
    keepPrefs();
    if (session) session.reached = false;
    refresh();
    view.focus();
  },
  details: showDetails,
  "next-warning": () => {
    nextProblem(1);
    view.focus();
  },
  "fix-here": () => {
    fixHere();
    view.focus();
  },
  italic: () => {
    toggleEmphasis(false)(view);
    view.focus();
  },
  bold: () => {
    toggleEmphasis(true)(view);
    view.focus();
  },
  who: () => tools.openSpeaker(passageAtCursor()),
  how: () => tools.openDirection(passageAtCursor()),
  "paragraph-up": () => {
    moveParagraph(view, -1, frontMatterEnd());
    view.focus();
  },
  "insert-sound": insertSoundHere,
  "insert-pause": () => insertAtCursor("{pause 1s}", "1s"),
  "insert-page": () =>
    attempt(
      () => insertLine(current(), view.state.selection.main.head, "{page}"),
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
  "export-sides": () => download(sides(current()), `${baseName()}-sides.txt`, "text/plain"),
  print: printBook,
  recover: showDrafts,
  versions: showVersions,
  shortcuts: showShortcuts,
  outline: showOutline,
  "paragraph-down": () => {
    moveParagraph(view, 1, frontMatterEnd());
    view.focus();
  },
};

/** Where the passage the cursor is in starts, or the cursor, for the pickers to find it. */
function passageAtCursor(): number {
  const head = view.state.selection.main.head;
  return passageNear(current(), head)?.range.from ?? head;
}

const SWITCHES = ["color", "names", "directions", "sounds", "vocal", "pages", "notes"] as const;

function viewCommand(name: string, on: boolean): void {
  if (name === "focus") {
    focusMode(on);
  } else if (name === "typewriter") {
    prefs.typewriter = on;
    keepPrefs();
    if (on) {
      const head = view.state.selection.main.head;
      view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
    }
  } else if (name === "autosave") {
    prefs.autosave = on;
    keepPrefs();
    if (on) scheduleAutosave();
    else clearTimeout(autosaveTimer);
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

menus(
  $(".menus"),
  (command, item) => {
    if (item.dataset.view)
      viewCommand(item.dataset.view, item.getAttribute("aria-checked") === "true");
    else if (command.startsWith("recent:")) {
      const handle = recentHandles[Number(command.slice(7))];
      if (handle) void openRecent(handle);
    } else void COMMANDS[command]?.();
    // Back to the text, unless the command opened a dialog or a picker of its own.
    requestAnimationFrame(() => {
      const at = document.activeElement;
      const left = !at || at === document.body || Boolean(at.closest(".menus"));
      if (left && !document.querySelector("dialog[open]") && !lockedOut) view.focus();
    });
  },
  () => view.focus(),
);

// Undo and Redo from a field on the side that hasn't been changed (a name just renamed in the
// cast): the story's, as anywhere else.
$("#side").addEventListener("keydown", (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement) || field.value !== field.defaultValue) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  event.preventDefault();
  (key === "y" || event.shiftKey ? redo : undo)(view);
  view.focus();
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
    // The outline, focus, and every mark raw, wherever the keyboard is.
    if (key === "o" && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      showOutline();
      return;
    }
    if (key === "f" && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      focusMode(!prefs.focus);
      return;
    }
    if (key === "m" && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ effects: setShowMarks.of(!prefs.marks) });
      return;
    }
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
// Caught on its way down, before the editor, which would put the file's text into the story.
document.addEventListener(
  "drop",
  (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void openDropped(event);
  },
  true,
);

async function openDropped(event: DragEvent): Promise<void> {
  const dropped = event.dataTransfer?.files[0];
  if (!dropped) return;
  // The file's handle, for saving back to it, is only given while the drop is under way.
  const item = event.dataTransfer?.items[0] as
    | (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
    | undefined;
  const handlePromise = item?.getAsFileSystemHandle?.() ?? Promise.resolve(null);
  if (!(await mayLeave())) return;
  const handle = await handlePromise.catch(() => null);
  const kept = handle?.kind === "file" ? (handle as FileSystemFileHandle) : undefined;
  await openStory(asStory(dropped.name, await readText(dropped), kept, dropped.lastModified));
  if (kept) {
    await rememberFile(dropped.name, kept);
    void showRecent();
  }
}

// Leaving with nothing kept anywhere: the browser asks first.
window.addEventListener("beforeunload", (event) => {
  rescue();
  // Nothing of this tab's changes kept anywhere: the browser asks first.
  if (lock.owner && !file.kept && !sameText(text(), file.saved)) event.preventDefault();
});

$("#side-close").addEventListener("click", () => {
  showSidePanel(false);
  view.focus();
});

// The welcome, for a first visit: open a file, start one, or begin from an example.

function showWelcome(): void {
  $("#welcome").hidden = false;
  document.body.setAttribute("data-welcome", "");
  for (const behind of ["#editor", "#scene-rail", "#side"]) $(behind).inert = true;
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
      button.addEventListener("click", async () => {
        if (!(await mayLeave())) return;
        await load({ name: example.name, text: example.text }, { saved: "" });
        view.focus();
      });
      item.append(button);
      return item;
    }),
  );
}

// Start: the draft from last time, or the welcome.

async function start(): Promise<void> {
  for (const name of [...SWITCHES, "marks", "autosave", "focus", "typewriter"] as const)
    checkMenu(name, prefs[name]);
  focusMode(prefs.focus);
  // Where the browser can't keep files, there's no file to save to automatically.
  $("#autosave-item").hidden = !keepsFiles;
  showSidePanel(prefs.side);
  checkMenu("rail-names", rail.names);
  void showRecent();
  // This tab's own story after a reload; in a new tab, the one written last.
  const mine = tabStory();
  const draft = (mine ? await draftById(mine) : undefined) ?? (await loadDraft());
  if (!draft) {
    showWelcome();
    refresh();
    showDraftState();
    return;
  }
  // Another tab writes the story: this one shows it, read only, until asked to write here.
  await restore(draft);
  if (draft.text !== draft.saved && lock.owner) {
    const back = `Brought back the changes you hadn't saved, from ${time(draft.changedAt)}`;
    $("#draft-state").textContent = back;
    announce(back);
  }
  void checkDisk();
}

/**
 * Puts the kept draft in the editor, with the words typed just before the page went if they were
 * written down later than it, and the writer back where they were.
 */
async function restore(draft: Draft): Promise<void> {
  const late = rescued(draft.id);
  const newer = late && late.changedAt > draft.changedAt ? late : null;
  const kept = newer ? { ...draft, ...newer } : draft;
  await load(
    { name: kept.name, text: kept.text, ...(kept.handle ? { handle: kept.handle } : {}) },
    {
      id: kept.id,
      saved: kept.saved,
      changedAt: kept.changedAt,
      ...(kept.savedAt ? { savedAt: kept.savedAt } : {}),
      ...(kept.modified !== undefined ? { modified: kept.modified } : {}),
    },
  );
  if (kept.place) goTo(kept.place);
  if (newer) {
    forgetRescue();
    await keep();
  }
}

/** Puts the cursor and the page back where they were, within the story. */
function goTo({ cursor, top }: { cursor: number; top: number }): void {
  const length = view.state.doc.length;
  view.dispatch({
    selection: EditorSelection.cursor(Math.min(cursor, length)),
    effects: EditorView.scrollIntoView(Math.min(top, length), { y: "start" }),
  });
}

void start();

// Offline: the Writer opens again with no network, once it has been opened with one.
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  void navigator.serviceWorker
    .register("../writer-sw.js", { scope: "./" })
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      const urls = [
        location.href.split("#")[0] as string,
        ...performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(location.origin)),
      ];
      registration.active?.postMessage({ type: "keep", urls });
    })
    .catch(() => {});
}
