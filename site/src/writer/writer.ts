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
  type EditorMark,
  type ViewSwitches,
  marksElsewhere,
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
import { type AiContext, openAi } from "./ai-dialog";
import { castPanel } from "./cast";
import { paragraphsOf } from "./convert";
import { type Counts, countsOf } from "./counts";
import { changesOnly, diffLines, withWords } from "./diff";
import { emphasis, plainText, toggleEmphasis } from "./emphasis";
import {
  type Opened,
  allowed,
  asStory,
  download,
  keepsFiles,
  mayWriteNow,
  onDisk,
  openedFile,
  pickFile,
  pickSaveTarget,
  readFile,
  reopen,
  writeFile,
} from "./files";
import { Hearing, toHear } from "./hear";
import { keepPairing, pairingIn } from "./helper";
import { DraftLock } from "./lock";
import { keys, menus } from "./menu";
import { rankScenes } from "./outline";
import { afterParagraph, moveParagraph } from "./paragraphs";
import { type Problem, problems } from "./problems";
import { SceneRail, numbered, railScenes } from "./rail";
import type { RenderAsk, RenderReply } from "./render-worker";
import { Rescue, tabStory as tabStoryIn } from "./rescue";
import { SaveFlow } from "./save-flow";
import { sameText } from "./saving";
import { moveSection } from "./sections";
import { sidesHtml, sidesText } from "./sides";
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
import { type CastView, castOf, passageIn } from "./story-data";
import {
  type Speaker,
  StretchTools,
  asPassage,
  mapped,
  nextNarratedQuote,
  passageNear,
  speechAt,
  speechOfMark,
} from "./stretch";
import {
  fileNameFor,
  glimpse,
  listening,
  proseWords,
  timeToHear,
  wordCount,
  words as wordsSaid,
} from "./words";

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
  /** Resting the pointer on a passage brings its bar. */
  hoverBar: boolean;
  /** The manuscript's font, its size in pixels, and its line length in rem. */
  font: "story" | "ui" | "mono";
  size: number;
  measure: number;
  /** The side's width, as a share of the window (percent); 0 for the usual. */
  sideWidth: number;
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
  side: window.matchMedia("(min-width: 900px)").matches,
  tab: "script",
  autosave: true,
  focus: false,
  typewriter: false,
  goal: 0,
  hoverBar: true,
  font: "story",
  size: 17,
  measure: 52,
  sideWidth: 0,
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
              tools.openSpeaker(passageAtCursor(), undefined, view.state.selection.main.head);
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
          { key: "F9", run: () => hearFromHere() },
          { key: "Mod-.", run: fixHere },
          // Redo on Ctrl+Shift+Z everywhere, as the menu says (Windows has Ctrl+Y too).
          { key: "Mod-Shift-z", run: redo, preventDefault: true },
          { key: "Mod-y", run: redo, preventDefault: true },
          { key: "Mod-i", run: (v) => italics(v) },
          { key: "Mod-b", run: (v) => bold(v) },
          { key: "Alt-Shift-ArrowUp", run: () => moveSectionHere(false, -1) },
          { key: "Alt-Shift-ArrowDown", run: () => moveSectionHere(false, 1) },
          { key: "Alt-ArrowUp", run: (v) => moveParagraph(v, -1, frontMatterEnd()) },
          { key: "Alt-ArrowDown", run: (v) => moveParagraph(v, 1, frontMatterEnd()) },
        ]),
      ),
      keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
      emphasis(),
      // A long story's marks, worked out in the worker once typing pauses.
      marksElsewhere.of((text) => marksFromWorker(text)),
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
    // The warning as the list has it, with the same fixes, once the story is read again after
    // typing (the pointer passing by never makes the page read a long story at once).
    const problem =
      storyVersion === version
        ? currentProblems().find(
            (found) => found.code === mark.code && found.from <= at && at <= found.to,
          )
        : undefined;
    const fix = problem?.fix ?? mark.fix;
    const cast = problem?.cast;
    return {
      pos: mark.from,
      end: mark.to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "warning-tip";
        const message = document.createElement("span");
        message.textContent = problem?.message ?? mark.message;
        dom.append(message);
        const button = (label: string, run: () => void) => {
          const made = document.createElement("button");
          made.type = "button";
          made.className = "button";
          made.textContent = label;
          // Pressed, the text keeps the focus; clicked (or Enter, Space, a screen reader), it acts.
          made.addEventListener("mousedown", (event) => event.preventDefault());
          made.addEventListener("click", () => {
            if (tipView.state.readOnly) return;
            run();
            tipView.focus();
          });
          dom.append(made);
        };
        if (fix)
          button(fix.label ?? "Fix it", () =>
            tipView.dispatch({ changes: fix, userEvent: "input.fix" }),
          );
        if (cast)
          button(`Add ${cast} to the cast`, () =>
            attempt(
              () => setFullName(current(), cast, cast),
              `${cast} can’t be added to the cast.`,
            ),
          );
        return { dom };
      },
    };
  },
  // The text changed: the tip, and the places its fixes know, go.
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
  onHover: () => prefs.hoverBar,
  passageAt: (at) => {
    if (storyVersion === version) {
      const speech = speechAt(story, at);
      return speech ? asPassage(speech) : undefined;
    }
    return read && readNow() ? passageIn(read.reply.passages, at) : undefined;
  },
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

/** The file's name in the bar, whole on hover where the bar has no room for it. */
function showFileName(name: string): void {
  const shown = $("#file-name");
  shown.textContent = name;
  shown.title = name;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
/** A word to the writer at the foot of the manuscript, for a few seconds. */
/** Whether the notice up is about a place in the text, gone once the text changes. */
let noticeOfPlace = false;
function notice(message: string, ofPlace = false): void {
  const box = $("#notice");
  noticeOfPlace = ofPlace;
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
  storyCommands(true);
  for (const behind of ["#editor", "#scene-rail", "#side"]) $(behind).inert = false;
  overlaid();
  showFileName(file.name);
  refresh();
  cursorMoved();
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
  // A notice about a place ("the narrator reads this quote") no longer holds once it changes.
  if (noticeOfPlace) {
    noticeOfPlace = false;
    $("#notice").hidden = true;
  }
  showSaveState(true);
  clearTimeout(refreshTimer);
  cancelIdle();
  // A long story's is read in the worker once typing pauses (marksFromWorker): here only what
  // needs no reading.
  refreshTimer = setTimeout(
    () => (view.state.doc.length < LONG ? refresh() : showSaveState()),
    view.state.doc.length < LONG ? 150 : 450,
  );
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
  // A long story's script or book, and its counts, are worked out in the worker.
  if (view.state.doc.length >= LONG) {
    const doc = view.state.doc;
    void readInWorker(doc.toString()).then((reply) => {
      if (view.state.doc !== doc) return;
      read = { doc, reply };
      showRead();
    });
    return;
  }
  showCounts(countsOf(story));
  if (prefs.side) showSide();
}

// A long story is read in a worker (render-worker.ts): once each time typing pauses, for
// everything the page shows of it, so that the page never reads a long book again while it is
// written. Only the page's explicit acts (an edit, the outline) read it on the page.
const reader = new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });
let asked = 0;
const replies = new Map<number, (reply: RenderReply) => void>();
reader.addEventListener("message", ({ data: reply }: MessageEvent<RenderReply>) => {
  replies.get(reply.id)?.(reply);
  replies.delete(reply.id);
});
function readInWorker(text: string): Promise<RenderReply> {
  const id = ++asked;
  const tab = prefs.side && (prefs.tab === "script" || prefs.tab === "book") ? prefs.tab : "none";
  return new Promise((resolve) => {
    replies.set(id, resolve);
    reader.postMessage({ id, text, tab } satisfies RenderAsk);
  });
}

/** What the worker last read of a long story, and the text it read (the editor's own). */
let read: { doc: Text; reply: RenderReply } | undefined;
/** Whether the worker's reading is of the text as it is now. */
const readNow = () => read !== undefined && read.doc === view.state.doc;

/** The editor's marks for a long story, from the worker; the rest put in once they are. */
async function marksFromWorker(text: string): Promise<EditorMark[] | undefined> {
  const doc = view.state.doc;
  const reply = await readInWorker(text);
  if (view.state.doc !== doc) return undefined;
  read = { doc, reply };
  // After the editor has the marks (the scenes' numbers come from them).
  setTimeout(() => showRead(), 0);
  return reply.marks;
}

/**
 * A long story as the worker read it: the rail, the counts and the warnings at once; the side
 * (a whole script or book to lay out again) once typing has stopped for a moment, never in the
 * pauses between words.
 */
function showRead(): void {
  if (!read || !readNow()) return;
  const { reply } = read;
  colors = new Map(reply.colors);
  rail.show(numbered(reply.scenes, sceneNumbers(view.state)));
  showCounts(reply);
  showWarningCount();
  if (prefs.side) whenStill(() => readNow() && showSide(read?.reply.html || undefined));
}

/** Runs `run` once the text has been still for a moment, in the browser's idle time. */
let stillTimer: ReturnType<typeof setTimeout> | undefined;
function whenStill(run: () => unknown, still = 1500): void {
  clearTimeout(stillTimer);
  const wait = Math.max(0, still - (Date.now() - file.changedAt));
  stillTimer = setTimeout(() => {
    if (Date.now() - file.changedAt < still) return whenStill(run, still);
    if ("requestIdleCallback" in window) window.requestIdleCallback(() => run(), { timeout: 2000 });
    else run();
  }, wait);
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

const rescues = new Rescue(localStorage);

/** Writes the last words down as the page goes: true if nothing of them would be lost. */
function rescue(): boolean {
  commitPending();
  if (!lock.owner || keptVersion === version) return true;
  return rescues.write(file.id, {
    name: file.name,
    text: text(),
    saved: file.saved,
    changedAt: file.changedAt,
    place: place(),
  });
}
const forgetRescue = (id = file.id) => rescues.forget(id);
const rescued = (id: string) => rescues.read(id);
/** The story this tab has open, kept for its reloads; set with `id`. */
const tabStory = (id?: string) => tabStoryIn(sessionStorage, id);

window.addEventListener("pagehide", () => {
  void rescue();
  // A tab that reads the story waits a moment, in case this one is only reloading.
  lock.leaving();
});
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
  if (saving.stopped && unsaved) return;
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

function showCounts({ words, said, voices, heard }: Counts): void {
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
    notice(`${wordsSaid(prefs.goal)} written: the goal is reached.`);
  }
  $("#counts").textContent = [
    `${plural(words, "word")}${since || goal ? ` (${signed}${goal})` : ""}`,
    plural(said, "line said", "lines said"),
    plural(voices, "voice"),
    plural(scenes, "scene"),
    // How long it takes to hear: what is read aloud, and its pauses, not what is printed.
    ...(heard > 0 ? [timeToHear(heard)] : []),
  ].join(" · ");
  $("#counts").title = since
    ? `${since > 0 ? "+" : "−"}${wordsSaid(Math.abs(since))} since the story was opened`
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
  if (sheet.contains(document.activeElement) && document.activeElement?.matches("input, textarea"))
    return;
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
      // A long story's comes from the worker, read for this side.
      const doc = view.state.doc;
      void readInWorker(doc.toString()).then((reply) => {
        if (view.state.doc !== doc) return;
        read = { doc, reply };
        showRead();
      });
      return;
    }
  } else if (prefs.tab === "cast")
    sheet.replaceChildren(
      castPanel(
        castData(),
        colors,
        {
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
            toTheText();
          },
          notice,
        },
        lockedOut,
      ),
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
  const fix = next.fix
    ? (next.fix.label ?? "Fix it")
    : next.cast
      ? `Add ${next.cast} to the cast`
      : undefined;
  const message = /[.!?…]$/.test(next.message) ? next.message : `${next.message}.`;
  const told = `Line ${next.line} (${all.indexOf(next) + 1} of ${all.length}): ${message}${fix ? ` ${keys("Mod+.")}: ${fix}.` : ""}`;
  // The notice is read out too: it is a live region of its own.
  notice(told, true);
  return true;
}

/**
 * Ctrl+Shift+K: the next quote no one is marked to say, which the narrator would read, selected;
 * Ctrl+K then gives it to someone, the name its tag gives first.
 */
function nextQuote(): boolean {
  if (storyVersion !== version) refresh();
  const quote = nextNarratedQuote(current(), view.state.selection.main.head);
  if (!quote) {
    notice("Every quote has its speaker: none is left for the narrator to read.");
    return true;
  }
  view.dispatch({
    selection: EditorSelection.range(quote.from, quote.to),
    effects: EditorView.scrollIntoView(quote.from, { y: "center" }),
  });
  notice(
    `Line ${view.state.doc.lineAt(quote.from).number}: the narrator reads this quote. ${keys("Mod+K")} gives it to someone; ${keys("Mod+Shift+K")} goes to the next.`,
    true,
  );
  return true;
}

/**
 * F9: the story read aloud by the browser from the cursor to the end of its scene, each speaker
 * in a voice of their own, the cursor going with it; F9 or Escape again stops it.
 */
const hearing = new Hearing();
function hearFromHere(): boolean {
  if (hearing.on) {
    hearing.stop();
    notice("Stopped reading aloud.");
    return true;
  }
  if (!("speechSynthesis" in window)) {
    notice("This browser can’t read aloud.");
    return true;
  }
  void (async () => {
    // The browser's voices load after the page: a moment's wait, then a word if there are none.
    if (!(await voicesReady())) {
      notice(
        "This browser has no voices to read aloud with: your system's speech settings add them.",
      );
      return;
    }
    readFromHere();
  })();
  return true;
}

/** Whether the browser has voices, after waiting for them a moment if it is still loading them. */
async function voicesReady(): Promise<boolean> {
  const synth = window.speechSynthesis;
  if (synth.getVoices().length) return true;
  await new Promise<void>((done) => {
    const timer = setTimeout(done, 1500);
    synth.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(timer);
        done();
      },
      { once: true },
    );
  });
  return synth.getVoices().length > 0;
}

function readFromHere(): boolean {
  if (storyVersion !== version) refresh();
  const story = current();
  const rows = toHear(lines(story), view.state.doc.lineAt(view.state.selection.main.head).number);
  if (rows.length === 0) {
    notice("Nothing to hear from here to the end of the scene.");
    return true;
  }
  notice(`Reading aloud to the end of the scene. ${keys("F9")} or Escape stops it.`);
  void hearing.read(rows, story.meta.language ?? navigator.language, story.meta.narrator, (row) => {
    const line = view.state.doc.line(Math.min(row.line, view.state.doc.lines));
    const at = Math.min(line.from + row.column - 1, line.to);
    view.dispatch({
      selection: EditorSelection.cursor(at),
      effects: EditorView.scrollIntoView(at, { y: "nearest" }),
    });
  });
  return true;
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && hearing.on) {
    hearing.stop();
    $("#notice").hidden = true;
  }
});

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
 * Italics and bold, never inside a mark: `@*Ann*` is no name, and `(*softly*)` keeps its signs.
 * Around a whole mark, or beside one, they go.
 */
function insideMark(state: EditorState, from: number, to: number): string | undefined {
  const mark = state
    .field(marksField)
    .find(
      (found) =>
        (found.kind === "name" ||
          found.kind === "direction" ||
          found.kind === "sound" ||
          found.kind === "vocal" ||
          found.kind === "instruction" ||
          found.kind === "pause" ||
          found.kind === "page" ||
          found.kind === "note" ||
          found.kind === "frontmatter") &&
        found.from < to &&
        from < found.to &&
        !(from <= found.from && found.to <= to),
    );
  if (!mark) {
    // Nor from one passage into another: the script would split them, signs and all.
    const crossed = state
      .field(marksField)
      .some(
        (found) =>
          found.kind === "speech" &&
          ((from < found.from && found.from < to) || (from < found.to && found.to < to)),
      );
    return crossed
      ? "Italics and bold go within one passage: this runs from one speaker’s words into another’s."
      : undefined;
  }
  const what: Record<string, string> = {
    name: "a name",
    direction: "a direction",
    sound: "a sound",
    vocal: "a character's sound",
    instruction: "an instruction",
    pause: "a pause",
    page: "a page turn",
    note: "a note",
    frontmatter: "the front matter",
  };
  return `Italics and bold can’t go inside ${what[mark.kind] ?? "a mark"}: only on the words around it.`;
}
const italics = toggleEmphasis(false, insideMark, (message) => notice(message));
const bold = toggleEmphasis(true, insideMark, (message) => notice(message));

/**
 * The scene the cursor is in (from its heading or break to the next), or its chapter (from its
 * `#` heading to the next), moved past the one before or after; one step to undo.
 */
function moveSectionHere(chapters: boolean, by: 1 | -1): boolean {
  if (lockedOut) return true;
  if (storyVersion !== version) refresh();
  const all = railScenes(current(), sceneNumbers(view.state));
  const heads = all.filter((scene) => scene.chapter).map((scene) => scene.from);
  const moved = chapters
    ? moveSection(view.state, heads, by)
    : moveSection(
        view.state,
        all.filter((scene) => !scene.chapter).map((scene) => scene.from),
        by,
        heads,
      );
  if (typeof moved === "string") {
    notice(
      moved === "outside"
        ? `Put the cursor in a ${chapters ? "chapter first: one starts at a # heading" : "scene first: one starts at a ## heading or a scene break"}.`
        : chapters
          ? `No chapter ${by < 0 ? "before" : "after"} this one to move it past.`
          : `This is the ${by < 0 ? "first" : "last"} scene of its chapter: a scene stays in its chapter.`,
    );
    return true;
  }
  view.dispatch({ ...moved, scrollIntoView: true, userEvent: "move.section" });
  refresh();
  return true;
}

/** The cast as the story is now: the worker's reading of a long story, else read here. */
function castData(): CastView {
  return storyVersion !== version && read && readNow() ? read.reply.cast : castOf(current());
}

/** A warning as the story is now: the same one, over the same words, nearest `near`. */
function problemNow(code: string, words: string, near: number): Problem | undefined {
  if (storyVersion !== version) refresh();
  return currentProblems()
    .filter(
      (problem) => problem.code === code && view.state.sliceDoc(problem.from, problem.to) === words,
    )
    .sort((a, b) => Math.abs(a.from - near) - Math.abs(b.from - near))[0];
}

/** From the side to the text: on a narrow window the side lies over it, so it goes first. */
function toTheText(): void {
  if (narrow.matches && prefs.side) showSidePanel(false);
  view.focus();
}

/** What to put right, with its fixes. */
function currentProblems(): Problem[] {
  // A long story read in the worker since it changed: its reading of what to put right.
  if (storyVersion !== version && read && readNow()) return read.reply.problems;
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
  const drawn = version;
  for (const problem of all) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "warning";
    button.dataset.severity = problem.severity;
    button.innerHTML = `<span class="where">Line ${problem.line}</span><span class="message">${escapeHtml(problem.message)}</span><code>${escapeHtml(problem.code)}</code>`;
    const words = view.state.sliceDoc(problem.from, problem.to);
    button.addEventListener("click", () => {
      // Typed in since the list was drawn: the warning where it is now, or none.
      const now = drawn === version ? problem : problemNow(problem.code, words, problem.from);
      if (!now) {
        notice("That warning has changed since; the list shows it as it is now.");
        refresh();
        return;
      }
      view.dispatch({
        selection: EditorSelection.range(now.from, now.to),
        scrollIntoView: true,
      });
      toTheText();
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
        // Typed in since the list was drawn: the warning found again where it is now, or not
        // fixed at all.
        const now = drawn === version ? fix : problemNow(problem.code, words, problem.from)?.fix;
        if (!now) {
          notice("That warning has changed since; the list shows it as it is now.");
          refresh();
          return;
        }
        view.dispatch({ changes: now, userEvent: "input.fix" });
        refresh();
        toTheText();
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
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      selectTab((event.key === "Home" ? TABS[0] : TABS.at(-1)) as Tab, true);
      return;
    }
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
  toTheText();
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
const narrow = window.matchMedia("(max-width: 899px)");
function overlaid(): void {
  const over = narrow.matches && prefs.side;
  const toggle = $("#preview-toggle");
  // Its words say what it does; the side showing is marked for the eye alone.
  toggle.toggleAttribute("data-on", over);
  toggle.textContent = over ? "Write" : "Preview";
  if (document.body.hasAttribute("data-welcome")) return;
  $(".manuscript").inert = over;
  $("#scene-rail").inert = over;
}
narrow.addEventListener("change", overlaid);
// The side lying over the manuscript closes at a click beside it, on the manuscript it covers.
document.addEventListener("pointerdown", (event) => {
  if (!narrow.matches || !prefs.side || onWelcome()) return;
  const side = $("#side").getBoundingClientRect();
  const work = $("#workspace").getBoundingClientRect();
  if (event.clientX < side.left && event.clientY > work.top && event.clientY < work.bottom) {
    event.preventDefault();
    showSidePanel(false);
    view.focus();
  }
});

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
  else if (opened.document)
    notice(
      `${opened.document === "docx" ? "That Word document" : "That ebook"} was opened as a new story, its headings, paragraphs and emphasis kept: Ctrl+Shift+K finds the quotes to give their speakers, and Save writes it as VoxDown to a file of its own.`,
    );
  else if (opened.encoding)
    // Its letters read as what they were, never written back over the original by themselves.
    notice(
      `That file wasn't UTF-8, so it was read as ${ENCODINGS[opened.encoding] ?? opened.encoding} and opened as a new story: Save writes it as UTF-8 to a file of its own, leaving the original as it was.`,
    );
}

/** Whether two handles are the same file, where the browser can tell. */
async function sameEntry(a: FileSystemFileHandle, b: FileSystemFileHandle): Promise<boolean> {
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
}

/** Encodings by the names a writer knows them. */
const ENCODINGS: Record<string, string> = {
  "windows-1252": "Western (Windows-1252)",
  "utf-16le": "UTF-16",
  "utf-16be": "UTF-16",
};

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

// Saving: Save, Save as, Keep both, reading the file again and saving by itself (save-flow.ts),
// given what it needs from the page.
const saving = new SaveFlow({
  file,
  text: () => text(),
  owner: () => lock.owner && !lockedOut,
  mayWrite: () => mayWrite(),
  commitPending: () => commitPending(),
  autosaveOn: () => prefs.autosave,
  keepsFiles,
  suggestedName: () => suggestedName(),
  files: {
    allowed: (handle, mode) => allowed(handle, mode),
    mayWriteNow: (handle) => mayWriteNow(handle),
    onDisk: (handle) => onDisk(handle),
    writeFile: (handle, content) => writeFile(handle, content),
    pickSaveTarget: (name) => pickSaveTarget(name),
    download: (content, name) => download(content, name),
    sameEntry: (a, b) => sameEntry(a, b),
  },
  ask: (message, buttons) => ask(message, buttons),
  tell: (message) => tell(message),
  notice: (message) => notice(message),
  announce: (message) => announce(message),
  showSaveState: () => showSaveState(),
  showState: (state, words, title) => {
    const shown = $("#save-state");
    shown.dataset.state = state;
    shown.textContent = words;
    if (title !== undefined) shown.title = title;
  },
  named: (name) => {
    showFileName(name);
  },
  remember: async (handle) => {
    await rememberFile(handle.name, handle);
    void showRecent();
  },
  replaceText: (next) => replaceText(next, "input.disk", allCrlf(next)),
  keep: () => keep(),
  snapshot: (why, content) => snapshot(why, content),
  versionDue: () => Date.now() - versionAt > SNAPSHOT_EVERY,
  markSaved: (id, content, modified) => markSaved(id, content, modified),
});
const save = () => saving.save();
const saveAs = (keepBoth = false) => saving.saveAs(keepBoth);
const checkDisk = () => saving.checkDisk();
window.addEventListener("focus", () => void checkDisk());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkDisk();
});

// Saving automatically: two seconds after typing stops.
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAutosave(): void {
  clearTimeout(autosaveTimer);
  if (!prefs.autosave || !keepsFiles || !file.handle) return;
  autosaveTimer = setTimeout(() => void saving.autosave(), 2000);
}

// One tab writes the story at a time.

const lock = new DraftLock(
  () => {
    lockedOut = true;
    view.dispatch({ effects: editable.reconfigure(editability()) });
    $("#elsewhere").hidden = false;
    tools.hide();
    // The cast is shown, not changed, here now.
    showSide();
  },
  // Before another tab takes the story: what is typed on the side too, then the draft.
  () => {
    commitPending();
    return keep();
  },
  () => void follow(),
  () => void gained(),
);

/** The tab that wrote this story closed it: this one writes it now, from its last words. */
async function gained(): Promise<void> {
  lockedOut = false;
  $("#elsewhere").hidden = true;
  const draft = await draftById(file.id);
  if (draft) await restore(draft);
  else view.dispatch({ effects: editable.reconfigure(editability()) });
  notice("The tab that was writing this story has closed it: it is written here now.");
}

/** A tab that only reads follows the one that writes: its words, a moment after it keeps them. */
let following = Promise.resolve();
function follow(): Promise<void> {
  following = following.then(async () => {
    if (!lockedOut && lock.owner) return;
    const draft = await draftById(file.id);
    if (!draft || lock.owner || draft.id !== file.id) return;
    file.saved = draft.saved;
    file.name = draft.name;
    showFileName(file.name);
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
// No title in its details: the heading names it until the writer gives it one (Story details).
const NEW_STORY = [
  "---",
  "voxdown: 1.1",
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
  if (after === before) {
    notice("Already tidy: nothing to change.");
    return;
  }
  void snapshot("Before tidying");
  const changedLines = diffLines(before, after).filter((line) => line.kind === "new").length;
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  view.dispatch({ changes: { from: start, to: endBefore, insert: after.slice(start, endAfter) } });
  notice(
    `Tidied: ${changedLines.toLocaleString()} ${changedLines === 1 ? "line" : "lines"} changed. Undo (${keys("Mod+Z")}) takes it back; Earlier versions has it as it was.`,
  );
}

// Insert: marks put in where the cursor is, each as one step to undo.

async function insertSoundHere(): Promise<void> {
  if (!(await mayWrite())) return;
  const at = view.state.selection.main.head;
  const description = await askText("What does the listener hear?", "a door creaks", "Put it in");
  let made: TextChange[] = [];
  if (
    description &&
    attempt(() => {
      made = insertSound(current(), at, description);
      return made;
    }, "A sound can’t go there without changing what is heard: put the cursor after a word.")
  ) {
    // The cursor after the sound, to go on writing.
    const sound = made.find((change) => change.insert.includes(`[${description}`)) ?? made.at(-1);
    if (sound) {
      const end = mapped(made, sound.from) + sound.insert.length;
      view.dispatch({ selection: EditorSelection.cursor(Math.min(end, view.state.doc.length)) });
    }
  }
  view.focus();
}

/** Puts `text` in at the cursor, the part `select` selected, with a space before it if needed. */
function insertAtCursor(text: string, select?: string): void {
  if (lockedOut) return;
  // After what is selected, never over it.
  let from = view.state.selection.main.to;
  let to = from;
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

/** The book as a Word document or an ebook: its headings, paragraphs and emphasis. */
async function exportDocument(kind: "docx" | "epub"): Promise<void> {
  const story = current();
  const body = new DOMParser().parseFromString(renderBook(story), "text/html").body;
  const paragraphs = paragraphsOf(body);
  const { title = baseName(), author, language } = story.meta;
  const details = { title, ...(author ? { author } : {}), ...(language ? { language } : {}) };
  if (kind === "docx") {
    const { docxOf } = await import("./docx");
    download(
      docxOf(paragraphs, details),
      `${baseName()}.docx`,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  } else {
    const { epubOf } = await import("./epub");
    download(
      epubOf(paragraphs, { ...details, id: newId(), when: new Date() }),
      `${baseName()}.epub`,
      "application/epub+zip",
    );
  }
}

/**
 * The name to save under: the file's own, or for a new story never saved, its title's, or, while
 * its title is still Untitled, its first heading's.
 */
function suggestedName(): string {
  if (!/^untitled\.vxd$/i.test(file.name) || file.handle) return file.name;
  const story = current();
  const title = story.meta.title;
  const heading = railScenes(story, new Map()).find((scene) => scene.name !== "Scene")?.name;
  const named =
    title && title !== "Untitled" ? title : heading && heading !== "Untitled" ? heading : undefined;
  return named ? `${fileNameFor(named)}.vxd` : file.name;
}
const baseName = () => suggestedName().replace(/\.(?:vxd|md|txt)$/i, "") || "story";

/** Prints the book from a frame of its own, as a reader would see it. */
/**
 * Prints a page from a frame of its own: the book, the script or the sides, each page with the
 * story's title and what it is at its head, and its number at its foot.
 */
function printPage(html: string, what: string): void {
  const title = current().meta.title ?? baseName();
  // A CSS string that can hold no sign HTML or CSS would read: every one but letters, digits
  // and spaces written as its code, so a title such as `</style><script>` stays words.
  const quoted = (text: string) =>
    `"${text.replace(/[^\p{L}\p{N} ]/gu, (sign) => `\\${(sign.codePointAt(0) ?? 32).toString(16)} `)}"`;
  const margins = `<style>@page { margin: 18mm 16mm 20mm;
  @top-left { content: ${quoted(title)}; font: 9pt system-ui, sans-serif; color: #666; }
  @top-right { content: ${quoted(what)}; font: 9pt system-ui, sans-serif; color: #666; }
  @bottom-center { content: counter(page) " / " counter(pages); font: 9pt system-ui, sans-serif; color: #666; } }
body { padding: 0 !important; }</style>`;
  const frame = document.createElement("iframe");
  frame.className = "print-frame";
  frame.setAttribute("aria-hidden", "true");
  // Nothing in the page runs: it is only printed (by this page, which shares its origin).
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.srcdoc = html.replace("</head>", `${margins}</head>`);
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
    "Every story written here is kept in this browser as it was typed. One with changes never saved stays until you let it go; past a hundred, those saved and untouched for a month go, with their versions.",
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
        detail: `${open ? "Open now · " : ""}${unsaved ? "changes not saved · " : ""}${wordsSaid(proseWords(draft.text))} · ${when(draft.changedAt)}`,
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
      detail: `${wordsSaid(proseWords(kept.text))}${sameText(kept.text, text()) ? " · the same as now" : ""}`,
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

/** The first `# heading` after the front matter, if it says `was`, says `now`. */
function retitleHeading(was: string, now: string): void {
  const doc = view.state.doc;
  const start = doc.lineAt(Math.min(frontMatterEnd() ?? 0, doc.length)).number;
  for (let number = start; number <= Math.min(doc.lines, start + 40); number++) {
    const line = doc.line(number);
    const heading = /^#[ \t]+(.*?)[ \t]*$/.exec(line.text);
    if (!heading) continue;
    if (heading[1] !== was) return;
    const from = line.from + line.text.indexOf(was, 1);
    view.dispatch({
      changes: { from, to: from + was.length, insert: now },
      userEvent: "input.edit",
    });
    refresh();
    return;
  }
}

/** The story's details, from its front matter, changed in a form rather than in YAML. */
function showDetails(): void {
  const dialog = $<HTMLDialogElement>("#details");
  const fields = [...dialog.querySelectorAll<HTMLInputElement>("input[data-key]")];
  // A story with no title yet is named by its first heading: that is its title until changed.
  const heading = railScenes(current(), new Map()).find((scene) => scene.chapter)?.name ?? "";
  const written = (key: string) => {
    const value = current().frontMatter?.data[key];
    if (key === "title" && value === undefined) return heading;
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  };
  for (const field of fields) field.value = written(field.dataset.key ?? "");
  dialog.returnValue = "";
  // Enter in a field is Done (the form's first submit button); Cancel is a button of its own.
  $("#details-cancel").onclick = () => dialog.close("cancel");
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
      const was = written(key);
      const done = attempt(
        () => setMeta(current(), key, value || null),
        `The ${key} can’t be set to that as written.`,
      );
      // A title heading the story as it was titled goes with the title.
      if (done && key === "title" && was && value) retitleHeading(was, value);
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
  // And its words: a scene's to the next, a chapter's to the next chapter.
  const doc = view.state.doc;
  const own = scenes.map((scene, index) =>
    proseWords(doc.sliceString(scene.from, scenes[index + 1]?.from ?? doc.length)),
  );
  const counts = scenes.map((scene, index) => {
    if (!scene.chapter) return own[index] ?? 0;
    let total = own[index] ?? 0;
    for (let next = index + 1; next < scenes.length && !scenes[next]?.chapter; next++)
      total += own[next] ?? 0;
    return total;
  });
  const here = view.state.selection.main.head;
  let active = Math.max(
    0,
    scenes.reduce((last, scene, index) => (scene.from <= here ? index : last), -1),
  );
  const draw = () => {
    const shown = rankScenes(scenes, within, filter.value).map((index) => ({
      scene: scenes[index] as (typeof scenes)[number],
      index,
    }));
    if (!shown.some(({ index }) => index === active)) active = shown[0]?.index ?? -1;
    list.replaceChildren(
      ...shown.map(({ scene, index }) => {
        const option = document.createElement("li");
        option.id = `outline-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === active));
        if (scene.chapter) option.dataset.chapter = "";
        option.textContent = scene.name;
        const where = document.createElement("span");
        where.className = "outline-in";
        where.textContent = [within[index], wordsSaid(counts[index] ?? 0)]
          .filter(Boolean)
          .join(" · ");
        option.append(where);
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
  ["F9", "Hear it read aloud, to the end of the scene"],
  ["Mod+K", "Who says this passage"],
  ["Mod+Shift+K", "The next quote with no speaker"],
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
  "save-as": () => saveAs(),
  download: () => download(text(), suggestedName()),
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
  page: showPageSettings,
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
  hear: () => {
    hearFromHere();
    view.focus();
  },
  "next-quote": () => {
    nextQuote();
    view.focus();
  },
  "next-warning": () => {
    nextProblem(1);
    view.focus();
  },
  "fix-here": () => {
    fixHere();
    view.focus();
  },
  italic: () => {
    italics(view);
    view.focus();
  },
  bold: () => {
    bold(view);
    view.focus();
  },
  who: () => tools.openSpeaker(passageAtCursor(), undefined, view.state.selection.main.head),
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
  // A cue sheet: every line, sound, pause and page turn in order, in plain words.
  "export-csv": () =>
    download(
      linesToCsv(
        lines(current()).map((line) => ({ ...line, text: plainText(line.text) })),
        ["line", "kind", "speaker", "direction", "text", "scene", "page"],
      ),
      `${baseName()}.csv`,
      "text/csv",
    ),
  "export-json": () =>
    download(
      `${JSON.stringify(lines(current()), null, 2)}\n`,
      `${baseName()}.json`,
      "application/json",
    ),
  "export-docx": () => void exportDocument("docx"),
  "export-epub": () => void exportDocument("epub"),
  "export-sides": () => download(sidesText(current()), `${baseName()}-sides.txt`, "text/plain"),
  // Everything heard, with ids, chapters and pauses: for `vxd produce` and other voice tools.
  "export-production": () =>
    void import("@voxdown/produce").then(({ productionScript }) =>
      download(
        `${JSON.stringify(productionScript(current()), null, 1)}\n`,
        `${baseName()}.production.json`,
        "application/json",
      ),
    ),
  print: () => printPage(renderDocument(current(), "book", { pages: true }), "The book"),
  "print-script": () => printPage(renderDocument(current(), "script"), "The script"),
  "print-sides": () => printPage(sidesHtml(current(), current().meta.title ?? baseName()), "Sides"),
  recover: showDrafts,
  versions: showVersions,
  "ai-speakers": () => void openAi("speakers", aiContext),
  audiobook: () => void openAi("audiobook", aiContext),
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
  } else if (name === "hover-bar") {
    prefs.hoverBar = on;
    keepPrefs();
    if (!on) tools.hide();
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
    // With no story open, only what opens one.
    if (onWelcome() && (key === "s" || key === "p" || event.shiftKey)) {
      if (key === "s" || key === "p") event.preventDefault();
      return;
    }
    // The next quote with no speaker: Shift told apart here, where the editor's keys might not.
    if (key === "k" && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      nextQuote();
      return;
    }
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
  await openStory(await openedFile(dropped, kept));
  if (kept) {
    await rememberFile(dropped.name, kept);
    void showRecent();
  }
}

// Leaving with nothing kept anywhere: the browser asks first.
window.addEventListener("beforeunload", (event) => {
  // The last words neither in the draft yet nor written down now (the storage full): the
  // browser asks first, and staying lets the draft catch up.
  const safe = rescue();
  if (lock.owner && (!safe || !file.kept) && !sameText(text(), file.saved)) {
    event.preventDefault();
    void keep();
  }
});

$("#side-close").addEventListener("click", () => {
  showSidePanel(false);
  view.focus();
});

// The welcome, for a first visit: open a file, start one, or begin from an example.

/** What can be done on the welcome, with no story open: the rest waits for one. */
const ON_WELCOME = new Set(["new", "open", "recover", "shortcuts"]);
const onWelcome = () => document.body.hasAttribute("data-welcome");

/** The commands that need a story: unavailable while the welcome shows, and available after. */
function storyCommands(available: boolean): void {
  for (const item of document.querySelectorAll<HTMLElement>(".menus [data-command]")) {
    const command = item.dataset.command ?? "";
    if (ON_WELCOME.has(command) || command.startsWith("recent:")) continue;
    if (available) item.removeAttribute("aria-disabled");
    else item.setAttribute("aria-disabled", "true");
  }
  $<HTMLButtonElement>("#save-button").disabled = !available;
}

function showWelcome(): void {
  $("#welcome").hidden = false;
  document.body.setAttribute("data-welcome", "");
  storyCommands(false);
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

// A dialog closed, with nothing else asking: the keyboard goes back to the text.
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => {
    requestAnimationFrame(() => {
      const at = document.activeElement;
      const lost = !at || at === document.body || Boolean(at.closest(".menus, dialog"));
      if (lost && !document.querySelector("dialog[open]") && !onWelcome()) view.focus();
    });
  });
}

// The page and its text: font, size and line length, as the writer likes them.

function applyPage(): void {
  const style = document.body.style;
  style.setProperty("--page-font", `var(--${prefs.font})`);
  style.setProperty("--page-size", `${prefs.size}px`);
  style.setProperty("--page-measure", `${prefs.measure}rem`);
  if (prefs.sideWidth) style.setProperty("--side-width", `minmax(18rem, ${prefs.sideWidth}%)`);
  else style.removeProperty("--side-width");
  $("#side-resize").setAttribute("aria-valuenow", String(prefs.sideWidth || 34));
  view.requestMeasure();
}

function showPageSettings(): void {
  const dialog = $<HTMLDialogElement>("#page-settings");
  const size = $<HTMLInputElement>("#page-size");
  const measure = $<HTMLInputElement>("#page-measure");
  const fonts = [...dialog.querySelectorAll<HTMLInputElement>('input[name="font"]')];
  const show = () => {
    for (const font of fonts) font.checked = font.value === prefs.font;
    size.value = String(prefs.size);
    measure.value = String(prefs.measure);
    $("#page-size-shown").textContent = `${prefs.size} px`;
    $("#page-measure-shown").textContent = `about ${Math.round(prefs.measure * 1.6)} letters`;
  };
  const change = () => {
    prefs.font = (fonts.find((font) => font.checked)?.value ?? "story") as Prefs["font"];
    prefs.size = Number(size.value);
    prefs.measure = Number(measure.value);
    keepPrefs();
    applyPage();
    show();
  };
  for (const input of [size, measure, ...fonts]) input.oninput = change;
  $("#page-reset").onclick = () => {
    Object.assign(prefs, { font: "story", size: 17, measure: 52 });
    keepPrefs();
    applyPage();
    show();
  };
  show();
  dialog.showModal();
}

// The edge between the manuscript and the side: dragged, or moved with the arrow keys.
{
  const edge = $("#side-resize");
  const set = (percent: number) => {
    prefs.sideWidth = Math.round(Math.min(60, Math.max(20, percent)));
    keepPrefs();
    applyPage();
  };
  edge.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    edge.setPointerCapture(event.pointerId);
    edge.toggleAttribute("data-dragging", true);
    const work = $("#workspace").getBoundingClientRect();
    const move = (moved: PointerEvent) => set(((work.right - moved.clientX) / work.width) * 100);
    const done = () => {
      edge.removeAttribute("data-dragging");
      edge.removeEventListener("pointermove", move);
    };
    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", done, { once: true });
    edge.addEventListener("pointercancel", done, { once: true });
  });
  edge.addEventListener("keydown", (event) => {
    const now = prefs.sideWidth || 34;
    const to =
      event.key === "ArrowLeft"
        ? now + 2
        : event.key === "ArrowRight"
          ? now - 2
          : event.key === "Home"
            ? 20
            : event.key === "End"
              ? 60
              : null;
    if (to === null) return;
    event.preventDefault();
    set(to);
  });
  // A double click: back to the usual width.
  edge.addEventListener("dblclick", () => {
    prefs.sideWidth = 0;
    keepPrefs();
    applyPage();
  });
}
applyPage();

// Start: the draft from last time, or the welcome.

async function start(): Promise<void> {
  for (const name of [...SWITCHES, "marks", "autosave", "focus", "typewriter"] as const)
    checkMenu(name, prefs[name]);
  checkMenu("hover-bar", prefs.hoverBar);
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

/** What the AI dialog needs of the Writer. */
const aiContext: AiContext = {
  text: () => view.state.doc.toString(),
  apply: (changes) => apply(changes, "Nothing to give."),
  notice: (message) => notice(message),
  goToLine: (number) => {
    const line = view.state.doc.line(Math.max(1, Math.min(number, view.state.doc.lines)));
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  },
  name: () => file.name,
};

// Opened by `vxd connect`: the key to the helper on this computer, kept, and taken out of the address.
{
  const pairing = pairingIn(location.hash);
  if (pairing) {
    keepPairing(pairing);
    window.history.replaceState(null, "", location.href.split("#")[0]);
    setTimeout(
      () =>
        notice(
          "Connected to this computer: Edit › Name the speakers with AI…, and File › Make an audiobook….",
        ),
      1200,
    );
  }
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
