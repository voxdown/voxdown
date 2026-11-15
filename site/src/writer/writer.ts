/**
 * VoxDown Writer: a story's own file, opened, written and saved back, with its scenes down the left
 * and what it becomes on the right. Everything runs in the browser. The story is kept in this
 * browser as it is typed, so a closed tab loses nothing, and goes to a file only when it is saved.
 */
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from "@codemirror/commands";
import {
  SearchQuery,
  findNext,
  openSearchPanel,
  search,
  searchKeymap,
  setSearchQuery,
} from "@codemirror/search";
import {
  ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  RangeSetBuilder,
  StateEffect,
  Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  dropCursor,
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
  setSmartPunctuation,
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
  SPEC_VERSION,
  type Shape,
  type Story,
  type TextChange,
  bookText,
  castMemberNamed,
  declareVersion,
  diffChanges,
  findShape,
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
  shapeStory,
  textByCharacter,
} from "voxdown";
import { examples } from "../examples";
import { commentBack, commentOut, speakersChanged } from "./comment-out";
import "../style.css";
import "./writer.css";
import { type AiContext, chapterAt, openAi } from "./ai-dialog";
import { type BoardScene, type SceneState, boardOf } from "./board";
import { openBoard } from "./board-dialog";
import { castPanel } from "./cast";
import { commentsPanel } from "./comments-panel";
import { paragraphsOf } from "./convert";
import { type Counts, countsOf } from "./counts";
import { addCloseButton, closeOnClickOutside } from "./dialogs";
import { changesOnly, diffLines, withWords } from "./diff";
import { openDirect } from "./direct-dialog";
import {
  emphasis,
  frontMatterEnd as emphasisFrom,
  emphasisIn,
  plainText,
  toggleEmphasis,
} from "./emphasis";
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
import {
  clock,
  dayOf,
  daysWritten,
  endSprint,
  sprintNow,
  sprintsDone,
  startSprint,
  writtenToday,
} from "./goal";
import { Hearing, onlineService, speaksOnline, toHear } from "./hear";
import { keepPairing, pairingIn } from "./helper";
import { paragraphScope } from "./local";
import { DraftLock } from "./lock";
import { LOOKS, type Look, SWATCH_INK, chooseLook, lookLabel, savedLook } from "./looks";
import { keys, menus } from "./menu";
import { rankScenes } from "./outline";
import { afterParagraph, moveParagraph } from "./paragraphs";
import { pastedStory } from "./paste";
import { type Problem, problems } from "./problems";
import { type RailScene, SceneRail, numbered, railScenes } from "./rail";
import type { RenderAsk, RenderReply } from "./render-worker";
import { Rescue, tabStory as tabStoryIn } from "./rescue";
import { SaveFlow } from "./save-flow";
import { sameText } from "./saving";
import {
  type Scrap,
  deletedScraps,
  findDeleted,
  forgetDeleted,
  joinScraps,
  keepDeleted,
  keepScraps,
  markScrapsSaved,
  mergeScraps,
  newScrapId,
  readScrapsFile,
  scrapsByName,
  scrapsFile,
  scrapsFileName,
  scrapsOf,
  scrapsStanding,
} from "./scraps";
import { ScrapsFiles } from "./scraps-files";
import { type ScrapsHost, scrapsPanel } from "./scraps-panel";
import { StoryScrollbar } from "./scrollbar";
import { searchCount } from "./search-count";
import { moveSection } from "./sections";
import { SideDrawing } from "./side-draw";
import { sidesHtml, sidesText } from "./sides";
import {
  type Draft,
  type Version,
  draftById,
  draftForFile,
  forgetDraft,
  forgetFile,
  forgetVersion,
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
import { type Wanting, nextWanting } from "./story-data";
import { type CastView, castOf, chapterLevelIn, newChapterLevel, passageIn } from "./story-data";
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
import { overusedWords, styleHints } from "./style";
import { toolbar } from "./toolbar";
import {
  fileNameFor,
  glimpse,
  listening,
  proseWords,
  spokenOf,
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

/** The preview's tabs, on the right: what the story becomes. */
type Tab = "script" | "book";
/** The workbench's tabs, on the left: what the story is made with. */
type BenchTab = "scenes" | "cast" | "scraps" | "comments" | "warnings";
type Prefs = ViewSwitches & {
  marks: boolean;
  side: boolean;
  tab: Tab;
  autosave: boolean;
  focus: boolean;
  /** The cursor's line kept in the middle of the page as it goes, focus or not. */
  typewriter: boolean;
  /** The workbench on the left, its tab, and its width (percent; 0 for the usual). */
  bench: boolean;
  benchTab: BenchTab;
  benchWidth: number;
  /** The preview's word about drawn marks, put away. */
  drawnTipDone: boolean;
  /** A word said again too soon, and a sentence too long, quietly underlined. */
  styleHints: boolean;
  /** The writer agreed to the browser's online voices, its only ones: the words go to be spoken. */
  onlineVoices: boolean;
  /** Words to write a day; 0 for none. */
  goal: number;
  /** A sprint's length last chosen, in minutes; Focus while it runs; a chime at its end. */
  sprintMinutes: number;
  sprintFocus: boolean;
  sprintChime: boolean;
  /** Resting the pointer on a passage brings its bar. */
  hoverBar: boolean;
  /** The toolbar under the menus. */
  toolbar: boolean;
  /** Quotes made curly and hyphens dashes (`--` –, `---` —) as they are typed. */
  smart: boolean;
  /** The manuscript's font, its size in pixels, and its line length in rem. */
  font: "story" | "ui" | "mono";
  size: number;
  measure: number;
  /** The space between lines, as a share of the text's size. */
  leading: number;
  /** Paragraphs with an empty line between them, or set in as in a book. */
  paragraphs: "spaced" | "indented";
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
  // Marks as written, steady as the writer moves, with the preview beside them; drawn is a choice.
  marks: true,
  side: window.matchMedia("(min-width: 900px)").matches,
  tab: "script",
  autosave: true,
  focus: false,
  typewriter: false,
  onlineVoices: false,
  bench: false,
  benchTab: "scenes",
  benchWidth: 0,
  drawnTipDone: false,
  styleHints: false,
  goal: 0,
  sprintMinutes: 25,
  sprintFocus: false,
  sprintChime: true,
  hoverBar: true,
  toolbar: true,
  smart: true,
  font: "story",
  size: 17,
  measure: 52,
  leading: 1.65,
  paragraphs: "spaced",
  sideWidth: 0,
  ...savedPrefs(),
};

// A tab of the side from before the workbench (cast, warnings, scraps) is the workbench's now.
if (!["script", "book"].includes(prefs.tab)) {
  prefs.benchTab = prefs.tab as unknown as BenchTab;
  prefs.tab = "script";
}

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

/** A long story's cast as the worker last read it: newer than `story` until the page reads it. */
let castRead: ReadonlyArray<{ handle: string; name: string }> | undefined;

const characters = (): readonly Character[] => {
  const cast = castRead ?? story.cast;
  return [...colors].map(([handle, color]) => ({
    handle,
    name: cast.find((member) => member.handle === handle)?.name ?? handle,
    color,
    ...(cast.some((member) => member.handle === handle) ? {} : { provisional: true }),
  }));
};

/** Tells the editor the cast was read again: its names and colors drawn again, if they changed. */
const castChanged = StateEffect.define<null>();
let castShown = "";
function showCast(): void {
  queueMicrotask(() => {
    const now = JSON.stringify(characters());
    if (now === castShown) return;
    castShown = now;
    view.dispatch({ effects: castChanged.of(null) });
  });
}

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

// Paragraphs as in a book (View › Page and text): the one empty line between two paragraphs drawn
// short, and the second one's first line set in. Headings, breaks, lists and the front matter keep
// their lines; two empty lines or more stay as the writer left them.

/** Nothing changes but the way the page is drawn. */
const redrawn = StateEffect.define<null>();
const PARA_GAP = Decoration.line({ class: "para-gap" });
const PARA_INDENT = Decoration.line({ class: "para-indent" });
const NOT_PROSE = /^(#|>|```|~~~|\||<!--|!\[|[-*+] |\d+[.)] |([-*_])( *\2){2,} *$)/;

const bookLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(readonly view: EditorView) {
      this.decorations = this.build();
    }
    update(update: ViewUpdate) {
      const switched = update.transactions.some((tr) => tr.effects.length > 0);
      if (update.docChanged || update.selectionSet || update.viewportChanged || switched)
        this.decorations = this.build();
    }
    build(): DecorationSet {
      if (prefs.paragraphs !== "indented" || prefs.marks) return Decoration.none;
      const { doc, selection } = this.view.state;
      // The front matter's last line, if the story has one.
      let matter = 0;
      if (doc.lines > 1 && doc.line(1).text.trim() === "---") {
        for (let number = 2; number <= Math.min(doc.lines, 400); number++) {
          const text = doc.line(number).text.trim();
          if (text === "---" || text === "...") {
            matter = number;
            break;
          }
        }
      }
      const prose = (number: number) => {
        if (number <= matter || number < 1 || number > doc.lines) return false;
        const text = doc.line(number).text.trim();
        return text !== "" && !NOT_PROSE.test(text);
      };
      const blank = (number: number) =>
        number >= 1 && number <= doc.lines && doc.line(number).text.trim() === "";
      const here = new Set(selection.ranges.map((range) => doc.lineAt(range.head).number));
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of this.view.visibleRanges) {
        let number = doc.lineAt(from).number;
        const last = doc.lineAt(to).number;
        for (; number <= last; number++) {
          if (!blank(number) || !prose(number - 1) || !prose(number + 1)) continue;
          const line = doc.line(number);
          if (!here.has(number)) builder.add(line.from, line.from, PARA_GAP);
          const next = doc.line(number + 1);
          builder.add(next.from, next.from, PARA_INDENT);
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// Style hints (View › Style hints): a word said again too soon, a sentence too long, on the stretch
// on screen, read again as it changes.

const styleLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(readonly view: EditorView) {
      this.decorations = this.build();
    }
    update(update: ViewUpdate) {
      const switched = update.transactions.some((tr) => tr.effects.length > 0);
      if (update.docChanged || update.viewportChanged || switched) this.decorations = this.build();
    }
    build(): DecorationSet {
      if (!prefs.styleHints) return Decoration.none;
      const { doc } = this.view.state;
      // Its own view's: drawn first while the page's editor is still being made.
      const body = frontMatterEnd(doc) ?? 0;
      const found: Array<ReturnType<Decoration["range"]>> = [];
      for (const { from, to } of this.view.visibleRanges) {
        // A little before what shows, so a word said just above the screen counts.
        const start = doc.lineAt(Math.max(body, from - 600)).from;
        const end = doc.lineAt(to).to;
        for (const hint of styleHints(doc.sliceString(start, end), start)) {
          if (hint.to <= from || hint.from >= to || hint.from < body) continue;
          found.push(
            Decoration.mark({
              class: hint.kind === "again" ? "style-again" : "style-long",
              attributes: { title: hint.message },
            }).range(hint.from, hint.to),
          );
        }
      }
      return Decoration.set(found, true);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** View › Words leaned on: the words the story uses most, each a click from finding it. */
function showOverused(): void {
  const body = view.state.doc.sliceString(frontMatterEnd() ?? 0);
  const words = overusedWords(body);
  showList(
    "Words leaned on",
    words.length
      ? "The words this story uses most, beyond the common ones, and words drafts often lean on. Find one to see each place it comes."
      : "No word stands out: none is used much more than the rest.",
    words.map((word) => ({
      title: word.word,
      detail: `${word.count} times, ${word.perThousand.toLocaleString()} in every 1,000 words${word.crutch ? "; a word drafts often lean on" : ""}`,
      actions: [
        {
          label: "Find",
          main: true,
          run: () => {
            openSearchPanel(view);
            view.dispatch({
              effects: setSearchQuery.of(
                new SearchQuery({ search: word.word, wholeWord: true, caseSensitive: false }),
              ),
            });
            findNext(view);
          },
        },
      ],
    })),
  );
}

/** Read only while another tab writes the story. */
const editable = new Compartment();
/** The line breaks the story is saved with: changed when the file is read again with others. */
const breaks = new Compartment();
let lockedOut = false;
/**
 * A tab that only reads: nothing typed, pasted or dropped changes the story, but the cursor still
 * goes where the keys take it (Ctrl+End to the last line, not the bottom of a blank page), and
 * words can be selected and copied.
 */
const editability = () => (lockedOut ? [EditorState.readOnly.of(true)] : []);

function editorState(source: string, cursor: number): EditorState {
  return EditorState.create({
    doc: source,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      breaks.of(lineBreaks(source)),
      editable.of(editability()),
      focusLines,
      // Where a scrap or words dragged in will land.
      dropCursor(),
      bookLines,
      styleLines,
      // The browser's spelling check, in the story's own language.
      // Coming back to the story (from the rail, a warning, the side) marks the place on the side.
      EditorView.domEventHandlers({
        focus: () => {
          requestAnimationFrame(markPlace);
        },
        // From a web page, Word or Google Docs: its paragraphs, headings and emphasis kept.
        paste: (event, editor) => pasteShaped(event, editor),
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
      searchCount,
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
          { key: "Mod-Shift-x", run: () => cutToScraps(), preventDefault: true },

          {
            key: "Mod-Alt-m",
            run: () => {
              insertComment();
              return true;
            },
            preventDefault: true,
          },
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
          // The side's places carried to the text as it is now (side-draw.ts).
          sinceShown = sinceShown?.compose(update.changes);
          sinceAsked = sinceAsked?.compose(update.changes);
          changed();
        }
        if (update.docChanged || update.selectionSet) cursorMoved();
        if (update.transactions.length) showUndoState(update.state);
        // A whole book pasted: its chapters, contents and notices offered to set out.
        if (
          update.transactions.some((tr) => tr.isUserEvent("input.paste")) &&
          update.changes.newLength - update.changes.length >= 20_000
        )
          setTimeout(() => offerShape(), 300);
        if (update.docChanged || update.selectionSet) showEmphasisState(update.state);
        if (update.heightChanged) tools.moved();
        if (update.heightChanged || update.geometryChanged) scrollbar.show();
        if (update.selectionSet && !update.docChanged) keepPlaceSoon();
        const raw = update.state.field(showMarksField);
        if (raw !== prefs.marks) {
          prefs.marks = raw;
          keepPrefs();
          showMarksMenu(raw);
        }
      }),
      EditorView.contentAttributes.of({ "aria-label": "Story" }),
    ],
  });
}

/** Where the front matter ends, which a paragraph never moves above. */
const frontMatterEnd = (doc: Text = view.state.doc): number | null => {
  // Found as the parser finds it (§4.4), from the lines alone: moving a paragraph in a long book
  // never reads the whole story again for it.
  if (
    doc.lines < 2 ||
    doc
      .line(1)
      .text.replace(/^\uFEFF/, "")
      .trimEnd() !== "---"
  )
    return null;
  let at = doc.line(1).to + 1;
  let first = true;
  for (const text of doc.iterLines(2)) {
    if (!first) at += 1;
    first = false;
    if (text.trimEnd() === "---") return at + text.length;
    at += text.length;
  }
  return null;
};

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
/** The story's own scrollbar, held to the pointer (scrollbar.ts); and the side's. */
const scrollbar = new StoryScrollbar($("#editor"), () => view.scrollDOM);
scrollbar.attach();
const sideScrollbar = new StoryScrollbar($("#side"), () => $("#side-sheet"));
sideScrollbar.attach();
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
  // A long book's passage is edited in its paragraph alone, never by reading the book again.
  scope: (at, until) =>
    view.state.doc.length >= LONG
      ? paragraphScope(view.state.doc.toString(), at, until)
      : undefined,
  notice: (message, action) => notice(message, false, action),
  announce: (message) => announce(message),
  directions: () =>
    view.state.doc.length >= LONG
      ? [
          ...new Set(
            [
              ...view.state.doc
                .toString()
                .matchAll(/@[\p{L}][\p{L}\p{N}_'’-]*\s*\(([^()\n]{1,60})\)|@\(([^()\n]{1,60})\)/gu),
            ].map((found) => (found[1] ?? found[2] ?? "").trim()),
          ),
        ].filter(Boolean)
      : [
          ...new Set(
            lines(current())
              .map((line) => line.direction ?? "")
              .filter(Boolean),
          ),
        ],
});

/** Everyone a passage can be given to: the narrator, the cast, and anyone else the story names. */
function speakers(): Speaker[] {
  // A long story's names and cast as last read: reading it again for a list would hold the page.
  const now = view.state.doc.length >= LONG ? story : current();
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
    if (prefs.bench) showBench();
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
  // A long story is read again in the worker, as after typing: never on the page for one edit.
  if (view.state.doc.length < LONG) refresh();
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
/** The line a notice about a place is about: it goes once the cursor goes elsewhere. */
let noticeLine = 0;
function notice(
  message: string,
  ofPlace = false,
  /** A button that does what the notice offers (`Find the chapters…`). */
  action?: { label: string; run: () => void },
): void {
  const box = $("#notice");
  noticeOfPlace = ofPlace;
  if (ofPlace) noticeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  box.textContent = message;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button notice-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      box.hidden = true;
      action.run();
    });
    box.append(button);
  }
  box.hidden = false;
  clearTimeout(noticeTimer);
  // Longer with something to do in it: time to read it and reach its button.
  noticeTimer = setTimeout(
    () => {
      box.hidden = true;
    },
    action ? 16_000 : 6000,
  );
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
  /** What is selected when it opens, rather than the cursor where the story starts. */
  selected?: { from: number; to: number },
): Promise<void> {
  const id = kept.id ?? newId();
  // A notice about the story put aside (its title, a place in it) is no longer about anything.
  if (noticeOfPlace) {
    noticeOfPlace = false;
    $("#notice").hidden = true;
  }
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
  // The side shows another story: drawn afresh, from its start.
  sideShows = "";
  benchRead = false;
  sinceShown = undefined;
  sinceAsked = undefined;
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
  view.dispatch({ effects: setSmartPunctuation.of(prefs.smart) });
  view.scrollDOM.scrollTop = 0;
  if (selected)
    view.dispatch({
      selection: EditorSelection.range(selected.from, selected.to),
      scrollIntoView: true,
    });
  $("#welcome").hidden = true;
  document.body.removeAttribute("data-welcome");
  storyCommands(true);
  for (const behind of ["#editor", "#scene-rail", "#side", "#bench"]) $(behind).inert = false;
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
  castRead = undefined;
  colors = characterColors(story);
  showCast();
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
  if (prefs.bench) showBench();
}

// A long story is read in a worker (render-worker.ts): once each time typing pauses, for
// everything the page shows of it, so that the page never reads a long book again while it is
// written. Only the page's explicit acts (an edit, the outline) read it on the page.
const reader = new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });
let asked = 0;
const replies = new Map<number, (reply: RenderReply) => void>();
const pending = new Map<number, RenderAsk>();
/** The worker failed once: long stories are read on the page from then on, more slowly. */
let workerFailed = false;
function readOnPage(ask: RenderAsk, why: string): void {
  if (!workerFailed) {
    workerFailed = true;
    notice(
      `This long story is read on the page now, which may be slower (its reader failed: ${why}).`,
    );
  }
  void import("./story-read").then(({ readFor }) => {
    replies.get(ask.id)?.(readFor(ask));
    replies.delete(ask.id);
    pending.delete(ask.id);
  });
}
reader.addEventListener(
  "message",
  ({ data: reply }: MessageEvent<RenderReply | { id: number; error: string }>) => {
    const ask = pending.get(reply.id);
    if ("error" in reply) {
      if (ask) readOnPage(ask, reply.error);
      return;
    }
    replies.get(reply.id)?.(reply);
    replies.delete(reply.id);
    pending.delete(reply.id);
  },
);
// A worker that can't start, or a message it can't take: everything waiting is read on the page.
const workerBroke = (why: string) => {
  for (const ask of [...pending.values()]) readOnPage(ask, why);
};
reader.addEventListener("error", (event) => workerBroke(event.message || "it stopped"));
reader.addEventListener("messageerror", () => workerBroke("a message it couldn't read"));
function readInWorker(text: string): Promise<RenderReply> {
  const id = ++asked;
  const tab = prefs.side && (prefs.tab === "script" || prefs.tab === "book") ? prefs.tab : "none";
  const ask: RenderAsk = { id, text, tab };
  return new Promise((resolve) => {
    replies.set(id, resolve);
    if (workerFailed) {
      readOnPage(ask, "");
      return;
    }
    pending.set(id, ask);
    reader.postMessage(ask);
  });
}

/** What the worker last read of a long story, and the text it read (the editor's own). */
let read: { doc: Text; reply: RenderReply } | undefined;
/** Whether the workbench has been drawn from this story's first reading in the worker. */
let benchRead = false;
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
  castRead = reply.cast.cast;
  showCast();
  rail.show(numbered(reply.scenes, sceneNumbers(view.state)));
  showCounts(reply);
  showWarningCount();
  // The preview, and the workbench's lists of what the story holds, once the text is still: a
  // workbench drawn before a long story was read (a second tab, a reload) shows it then.
  if (prefs.side || prefs.bench)
    whenStill(() => {
      if (!readNow()) return;
      if (prefs.side) showSide(read?.reply.html || undefined);
      // The Scenes tab from the worker's reading, as the rail; the other tabs once, when they
      // were drawn before the story was first read (a second tab, a reload).
      if (prefs.bench && (prefs.benchTab === "scenes" || !benchRead)) showBench();
      benchRead = true;
    });
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
function snapshot(why: string, content = text(), pinned = false): Promise<boolean> {
  versionAt = Date.now();
  return keepVersion({
    doc: file.id,
    at: Date.now(),
    text: content,
    why,
    ...(pinned ? { pinned: true } : {}),
    // Counted once, now: Earlier versions then lists a long book's versions without counting.
    words: proseWords(content),
  });
}

/** The words of versions kept before their count was, counted once each. */
const versionWords = new Map<number, number>();
function wordsOfVersion(version: Version): number | undefined {
  if (version.words !== undefined) return version.words;
  return version.key === undefined ? undefined : versionWords.get(version.key);
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

/** A new story no one has written in: nothing in it to keep, or to ask about. */
const untouched = () => !file.handle && file.saved === "" && sameText(text(), NEW_STORY);

async function keep(): Promise<void> {
  clearTimeout(keepTimer);
  // A new story still as it began is kept nowhere (it would be a draft with changes not saved, and
  // the story opened on the next visit); one typed in and taken back lets its draft go.
  if (untouched()) {
    keptAt = Date.now();
    void forgetDraft(file.id);
    file.kept = true;
    showDraftState();
    return;
  }
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
  // A story never saved to a file, in a browser that may clear what pages keep: said, once. A
  // story with its file is safe there, whatever the browser keeps.
  const unprotected = protectedDrafts === false && !file.handle && file.saved === "";
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

/** The story's words as last counted, and the day its goal was last said to be reached. */
const counted = { story: "", words: 0, reached: "" };

function showCounts({ words, said, voices, heard }: Counts): void {
  // As the rail shows them: chapters, and the scenes in them (headings under a chapter, breaks).
  const parts = rail.parts;
  const plural = (n: number, one: string, many = `${one}s`) =>
    `${n.toLocaleString()} ${n === 1 ? one : many}`;
  // The words written today in this story, kept through a reload, and the day's goal, if any.
  const now = Date.now();
  const since = writtenToday(localStorage, file.id, words, now);
  Object.assign(counted, { story: file.id, words });
  const signed = `${since > 0 ? "+" : since < 0 ? "−" : ""}${Math.abs(since).toLocaleString()}`;
  const goal = prefs.goal > 0 ? ` of ${prefs.goal.toLocaleString()}` : "";
  const today = `${file.id}:${dayOf(now)}`;
  if (prefs.goal > 0 && since >= prefs.goal && counted.reached !== today) {
    counted.reached = today;
    notice(`${wordsSaid(prefs.goal)} written today: the goal is reached.`);
  }
  const bar = $("#goal-bar");
  bar.hidden = prefs.goal <= 0;
  $("#goal-fill").style.width =
    `${Math.max(0, Math.min(1, since / Math.max(1, prefs.goal))) * 100}%`;
  showSprint();
  const counts = [
    `${plural(words, "word")}${since || goal ? ` (${signed}${goal} today)` : ""}`,
    plural(said, "line said", "lines said"),
    plural(voices, "voice"),
    // Chapters and scenes each by their name; none yet, nothing said of them.
    ...(parts.chapters > 0 ? [plural(parts.chapters, "chapter")] : []),
    ...(parts.scenes > 0 ? [plural(parts.scenes, "scene")] : []),
    // How long it takes to hear: what is read aloud, and its pauses, not what is printed.
    ...(heard > 0 ? [timeToHear(heard)] : []),
  ].join(" · ");
  $("#counts-text").textContent = counts;
  // All of it, where a narrow window cuts it short, and what a click does.
  $("#counts").title = `${counts}\nA goal for the day, and sprints`;
}

// Scraps: passages set aside from the story, kept in this browser by the story, and in a file
// beside it (owl.scraps.md) when saved there.

// Scraps changed in another tab (the one that writes the story, or another story's): the Scraps
// tab here shows them as they are now, never a list another tab has since changed.
window.addEventListener("storage", (event) => {
  if (event.key !== "vxd-writer-scraps" && event.key !== "vxd-writer-scraps-saved") return;
  if (prefs.bench && prefs.benchTab === "scraps") showBench();
});

/** Words set aside: a scrap, with the chapter they came from. */
function setAside(text: string): Scrap | undefined {
  const story = current();
  const scrap: Scrap = {
    id: newScrapId(),
    text: text.replace(/^\s*\n|\s+$/g, ""),
    note: "",
    at: Date.now(),
    from: chapterAt(story, view.state.selection.main.from).name,
  };
  const scraps = scrapsOf(localStorage, file.id);
  scraps.unshift(scrap);
  if (!keepScraps(localStorage, file.id, scraps, file.name)) {
    notice(
      "This browser is short of room: the scrap couldn’t be kept, so the words stay in the story.",
    );
    return undefined;
  }
  return scrap;
}

/**
 * Words taken out of a line, and the space left beside them: a sentence cut from between two
 * others leaves one space, not two, and one cut from a line's end leaves none behind it.
 */
function cutRange(from: number, to: number): { from: number; to: number } {
  const doc = view.state.doc;
  const before = doc.sliceString(Math.max(0, from - 1), from);
  const after = doc.sliceString(to, Math.min(doc.length, to + 1));
  if (/[ \t]/.test(after) && (before === "" || /[ \t\n]/.test(before))) return { from, to: to + 1 };
  if (after === "" || after === "\n") {
    const line = doc.lineAt(from);
    const spaces = /[ \t]*$/.exec(doc.sliceString(line.from, from))?.[0].length ?? 0;
    return { from: from - spaces, to };
  }
  return { from, to };
}

/** Edit › Cut to Scraps: the words selected set aside, and taken out of the story. */
function cutToScraps(): boolean {
  if (lockedOut) return true;
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  if (!text.trim()) {
    notice("Select the words to set aside first.");
    return true;
  }
  // Kept first: words that can't be kept stay in the story.
  if (!setAside(text)) return true;
  view.dispatch({ changes: cutRange(from, to), userEvent: "delete.cut" });
  selectBench("scraps");
  notice(`Set aside in Scraps. ${keys("Mod+Z")} puts the words back; the scrap stays.`);
  view.focus();
  return true;
}

/** Scraps change only where the story is written: another tab's are read here, never written. */
function scrapsReadOnly(): boolean {
  if (!lockedOut) return false;
  notice("This story is being written in another tab: its scraps change there.");
  showBench();
  return true;
}

const scrapsHost: ScrapsHost = {
  scraps: () => scrapsOf(localStorage, file.id),
  readOnly: () => lockedOut,
  discard: (scrap) => keepDeleted(localStorage, file.id, scrap),
  deleted: () => deletedScraps(localStorage, file.id),
  restore: (id, at = 0) => {
    if (scrapsReadOnly()) return;
    const scrap = findDeleted(localStorage, file.id, id);
    if (!scrap) return;
    const scraps = scrapsOf(localStorage, file.id).filter((each) => each.id !== scrap.id);
    scraps.splice(Math.min(at, scraps.length), 0, scrap);
    // Kept among the scraps first; only then let go of among the deleted ones.
    if (!keepScraps(localStorage, file.id, scraps, file.name)) {
      notice(
        "This browser is short of room: the scrap couldn’t be brought back. It is still under Deleted scraps.",
      );
      showBench();
      return;
    }
    forgetDeleted(localStorage, file.id, id);
    announce("Scrap brought back.");
    showBench();
  },
  keep: (scraps) => {
    if (scrapsReadOnly()) return;
    if (!keepScraps(localStorage, file.id, scraps, file.name))
      notice("This browser is short of room: the scraps couldn’t be kept.");
    showBench();
  },
  dropped: (text, copy) => {
    if (scrapsReadOnly()) return;
    // Kept first: words that can't be kept stay in the story.
    if (!setAside(text)) {
      showBench();
      return;
    }
    // Moved here from the story: taken out of it, as the selection it was dragged from.
    const { from, to } = view.state.selection.main;
    if (!copy && !lockedOut && view.state.sliceDoc(from, to) === text)
      view.dispatch({ changes: cutRange(from, to), userEvent: "delete.cut" });
    notice(
      copy
        ? "Copied to Scraps."
        : `Set aside in Scraps. ${keys("Mod+Z")} puts the words back; the scrap stays.`,
    );
    showBench();
  },
  insert: (scrap) => {
    if (lockedOut) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: scrap.text },
      selection: EditorSelection.cursor(from + scrap.text.length),
      scrollIntoView: true,
      userEvent: "input.paste",
    });
    view.focus();
  },
  open: () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt";
    input.addEventListener("change", () => {
      const chosen = input.files?.[0];
      if (!chosen) return;
      void chosen.text().then((text) => {
        const found = readScrapsFile(text);
        if (!found.length) {
          notice(`${chosen.name} holds no scraps.`);
          return;
        }
        if (scrapsReadOnly()) return;
        const { scraps, added } = mergeScraps(scrapsOf(localStorage, file.id), found);
        keepScraps(localStorage, file.id, scraps, file.name);
        // Read from the file just opened: as it is there.
        if (added === found.length) markScrapsSaved(localStorage, file.id, scraps);
        showBench();
        notice(
          added
            ? `${added} ${added === 1 ? "scrap" : "scraps"} added from ${chosen.name}.`
            : `Every scrap in ${chosen.name} is here already.`,
        );
      });
    });
    input.click();
  },
  save: () => void scrapsFiles.save(true),
  fileName: () => scrapsFileName(file.name),
  standing: () => scrapsStanding(localStorage, file.id, scrapsOf(localStorage, file.id)),
  notice: (message, action) => notice(message, false, action),
  announce,
};

/** The scraps' files beside their stories. */
const scrapsFiles = new ScrapsFiles({
  story: () => ({
    id: file.id,
    name: file.name,
    title: current().meta.title ?? file.name.replace(/\.[^.]+$/, ""),
  }),
  notice: (message, action) => notice(message, false, action),
  ask,
  download: (text, name) => download(text, name),
  redraw: () => {
    if (prefs.bench && prefs.benchTab === "scraps") showBench();
  },
  show: () => selectBench("scraps"),
});

// The goal for the day and sprints: from the word count in the status bar, or View › Writing goal.

/** When a key was last pressed: a sprint's end waits for a pause in the writing. */
let lastTyped = 0;
document.addEventListener("keydown", () => {
  lastTyped = Date.now();
});
/** Whether the sprint turned Focus on, to turn it off again at its end. */
let sprintFocused = false;
let sprintTimer: ReturnType<typeof setInterval> | undefined;

/** The sprint in the status bar: its time left and its words, or nothing. */
function showSprint(): void {
  const sprint = sprintNow(localStorage);
  const state = $<HTMLButtonElement>("#sprint-state");
  if (!sprint) {
    state.hidden = true;
    return;
  }
  const left = sprint.startedAt + sprint.minutes * 60_000 - Date.now();
  const words = sprint.story === counted.story ? counted.words - sprint.startWords : 0;
  state.hidden = false;
  state.textContent = `Sprint ${clock(left / 1000)} · ${words.toLocaleString()} ${Math.abs(words) === 1 ? "word" : "words"}`;
  state.title = "The sprint: its time left, and the words written in it";
  if ($<HTMLDialogElement>("#goal-panel").open) {
    $("#sprint-now").textContent =
      `${clock(left / 1000)} left, and ${wordsSaid(Math.max(0, words))} written in it.`;
  }
}

/** Every second while a sprint runs: its time, and its end once a pause in the writing comes. */
function tickSprint(): void {
  const sprint = sprintNow(localStorage);
  if (!sprint) {
    clearInterval(sprintTimer);
    sprintTimer = undefined;
    showSprint();
    return;
  }
  const over = Date.now() >= sprint.startedAt + sprint.minutes * 60_000;
  // Over, but never in the middle of a sentence: once the keys have rested a moment.
  if (over && Date.now() - lastTyped > 1500) finishSprint(true);
  else showSprint();
}

function runSprintTimer(): void {
  if (!sprintTimer) sprintTimer = setInterval(tickSprint, 1000);
  tickSprint();
}

function finishSprint(ranItsTime: boolean): void {
  const sprint = sprintNow(localStorage);
  const words =
    sprint && sprint.story === counted.story ? counted.words : (sprint?.startWords ?? 0);
  const done = endSprint(localStorage, words, Date.now());
  clearInterval(sprintTimer);
  sprintTimer = undefined;
  showSprint();
  if (sprintFocused) {
    sprintFocused = false;
    focusMode(false);
  }
  if (!done) return;
  if (ranItsTime && prefs.sprintChime) chime();
  notice(
    ranItsTime
      ? `Sprint over: ${wordsSaid(Math.max(0, done.words))} in ${done.minutes} minutes.`
      : `Sprint stopped: ${wordsSaid(Math.max(0, done.words))} in ${done.minutes} ${done.minutes === 1 ? "minute" : "minutes"}.`,
  );
  if ($<HTMLDialogElement>("#goal-panel").open) showGoalPanel();
}

/** Two soft notes, quieter than a notification. */
function chime(): void {
  try {
    const audio = new AudioContext();
    for (const [index, pitch] of [660, 880].entries()) {
      const tone = audio.createOscillator();
      const loud = audio.createGain();
      const at = audio.currentTime + index * 0.22;
      tone.frequency.value = pitch;
      loud.gain.setValueAtTime(0.0001, at);
      loud.gain.exponentialRampToValueAtTime(0.08, at + 0.02);
      loud.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
      tone.connect(loud).connect(audio.destination);
      tone.start(at);
      tone.stop(at + 1);
    }
    setTimeout(() => void audio.close(), 1600);
  } catch {
    // No sound here: the notice says it.
  }
}

const dayName = (day: string) => {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const at = new Date(year, month - 1, date);
  return day === dayOf(Date.now())
    ? "Today"
    : at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

/** The panel: today's words and the goal, a sprint to start or the one running, and the logs. */
function showGoalPanel(): void {
  const dialog = $<HTMLDialogElement>("#goal-panel");
  const today = writtenToday(localStorage, file.id, counted.words, Date.now());
  $("#goal-today").textContent =
    prefs.goal > 0
      ? `${wordsSaid(Math.max(0, today))} written today in this story, of ${prefs.goal.toLocaleString()}.`
      : `${wordsSaid(Math.max(0, today))} written today in this story. A goal for each day:`;
  for (const pick of dialog.querySelectorAll<HTMLButtonElement>("[data-goal]"))
    pick.setAttribute("aria-pressed", String(Number(pick.dataset.goal) === prefs.goal));
  const own = $<HTMLInputElement>("#goal-own");
  const listed = [0, 250, 500, 1000, 1667, 2000].includes(prefs.goal);
  own.value = listed ? "" : String(prefs.goal);
  for (const pick of dialog.querySelectorAll<HTMLButtonElement>("[data-minutes]"))
    pick.setAttribute("aria-pressed", String(Number(pick.dataset.minutes) === prefs.sprintMinutes));
  $<HTMLInputElement>("#sprint-own").value = [15, 25, 45, 60].includes(prefs.sprintMinutes)
    ? ""
    : String(prefs.sprintMinutes);
  $<HTMLInputElement>("#sprint-focus").checked = prefs.sprintFocus;
  $<HTMLInputElement>("#sprint-chime").checked = prefs.sprintChime;
  const running = Boolean(sprintNow(localStorage));
  $("#sprint-start").hidden = running;
  $("#sprint-running").hidden = !running;
  const days = daysWritten(localStorage).slice(0, 7);
  $("#goal-days").replaceChildren(
    ...(days.length ? days : [{ day: dayOf(Date.now()), words: 0 }]).map(({ day, words }) => {
      const item = document.createElement("li");
      item.textContent = `${dayName(day)}: ${wordsSaid(Math.max(0, words))}`;
      return item;
    }),
  );
  const sprints = sprintsDone(localStorage).slice(0, 5);
  const log = $("#sprint-log");
  if (sprints.length)
    log.replaceChildren(
      ...sprints.map((done) => {
        const item = document.createElement("li");
        const at = new Date(done.at).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
        item.textContent = `${dayName(done.day)}, ${at}: ${wordsSaid(Math.max(0, done.words))} in ${done.minutes} min`;
        if (done.title) item.title = done.title;
        return item;
      }),
    );
  else {
    const none = document.createElement("li");
    none.className = "none";
    none.textContent = "None yet.";
    log.replaceChildren(none);
  }
  if (!dialog.open) dialog.showModal();
  showSprint();
}

{
  const dialog = $<HTMLDialogElement>("#goal-panel");
  const setGoal = (goal: number) => {
    prefs.goal = goal > 0 ? Math.round(goal) : 0;
    counted.reached = "";
    keepPrefs();
    refresh();
    showGoalPanel();
  };
  for (const pick of dialog.querySelectorAll<HTMLButtonElement>("[data-goal]"))
    pick.addEventListener("click", () => setGoal(Number(pick.dataset.goal)));
  $<HTMLInputElement>("#goal-own").addEventListener("change", (event) => {
    const wanted = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(wanted) && wanted > 0) setGoal(wanted);
  });
  const setMinutes = (minutes: number) => {
    prefs.sprintMinutes = Math.min(240, Math.max(1, Math.round(minutes)));
    keepPrefs();
    showGoalPanel();
  };
  for (const pick of dialog.querySelectorAll<HTMLButtonElement>("[data-minutes]"))
    pick.addEventListener("click", () => setMinutes(Number(pick.dataset.minutes)));
  $<HTMLInputElement>("#sprint-own").addEventListener("change", (event) => {
    const wanted = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(wanted) && wanted > 0) setMinutes(wanted);
  });
  $<HTMLInputElement>("#sprint-focus").addEventListener("change", (event) => {
    prefs.sprintFocus = (event.target as HTMLInputElement).checked;
    keepPrefs();
  });
  $<HTMLInputElement>("#sprint-chime").addEventListener("change", (event) => {
    prefs.sprintChime = (event.target as HTMLInputElement).checked;
    keepPrefs();
  });
  $("#sprint-go").addEventListener("click", () => {
    if (storyVersion !== version) refresh();
    startSprint(localStorage, {
      startedAt: Date.now(),
      minutes: prefs.sprintMinutes,
      story: file.id,
      title: current().meta.title ?? file.name,
      startWords: counted.words,
    });
    dialog.close();
    if (prefs.sprintFocus && !prefs.focus) {
      sprintFocused = true;
      focusMode(true);
    }
    runSprintTimer();
    notice(`Sprint started: ${prefs.sprintMinutes} minutes. The status bar keeps the time.`);
    view.focus();
  });
  $("#sprint-stop").addEventListener("click", () => {
    dialog.close();
    finishSprint(false);
    view.focus();
  });
  $("#counts").addEventListener("click", showGoalPanel);
  $("#sprint-state").addEventListener("click", showGoalPanel);
  // A sprint started before the page was loaded again goes on, or ends if its time ran out.
  if (sprintNow(localStorage)) runSprintTimer();
}

function cursorMoved(): void {
  const { head, from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  // A notice about a place, gone once the cursor is a few lines from it (a jump to a chapter).
  if (noticeOfPlace && Math.abs(line.number - noticeLine) > 3) {
    noticeOfPlace = false;
    $("#notice").hidden = true;
  }
  // A selection says how many words it holds, and how long they take to hear: its words, not its
  // marks (names, directions, sounds, notes and instructions), read without reading the story.
  const chosen = from === to ? "" : spokenOf(view.state.sliceDoc(from, to));
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

/** When the browser is next idle (or soon, where it can't say). */
const later = (run: () => void) =>
  "requestIdleCallback" in window
    ? window.requestIdleCallback(run, { timeout: 200 })
    : setTimeout(run, 16);

/**
 * The script or book on the side (side-draw.ts): drawn again at the reader's place. Its parts say
 * where they are in the text the drawing shown was made from; the changes since that text, and
 * since the text of a drawing under way, carry those places to the text now.
 */
const sideDrawing = new SideDrawing(
  $("#side-sheet"),
  () => {
    indexSheet();
    markPlace();
  },
  later,
);
let sinceShown: ChangeSet | undefined;
let sinceAsked: ChangeSet | undefined;
/** Which story's which tab the side shows: the same again is drawn again at the reader's place. */
let sideShows = "";

function drawSheet(html: string): void {
  const again = sideShows === `${file.id}:${prefs.tab}`;
  sideShows = `${file.id}:${prefs.tab}`;
  const toNew = again ? sinceShown : undefined;
  sinceAsked = ChangeSet.empty(view.state.doc.length);
  sideDrawing.draw(
    html,
    again,
    (from) => (toNew && from <= toNew.length ? toNew.mapPos(from, -1) : from),
    () => {
      sinceShown = sinceAsked;
    },
  );
}

/** The side, drawn again: the script or the book (`drawn`, when the worker drew it), cast or warnings. */
function showSide(drawn?: string): void {
  const sheet = $("#side-sheet");
  for (const tab of document.querySelectorAll<HTMLElement>("#side .side-tab")) {
    const selected = tab.dataset.tab === prefs.tab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  sheet.setAttribute("aria-labelledby", `tab-${prefs.tab}`);
  // A name being typed on the side isn't redrawn under the writer's fingers.
  if (sheet.contains(document.activeElement) && document.activeElement?.matches("input, textarea"))
    return;
  const long = view.state.doc.length >= LONG;
  // Any drawing in parts still going stops: a book drawn into a tab no longer shown is work for
  // nothing (and grew a page no one sees to thousands of parts).
  sideDrawing.stop();
  if (prefs.tab === "script" || prefs.tab === "book") {
    // A long story's comes from the worker: until it does, the page shows what it showed.
    if (drawn !== undefined) drawSheet(drawn);
    else if (!long)
      drawSheet(
        prefs.tab === "script"
          ? renderScript(current(), { positions: true })
          : renderBook(current(), { pages: true, positions: true }),
      );
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
  }
  indexSheet();
  markPlace();
}

/** The workbench, drawn again: the scenes, the cast, the scraps or the warnings. */
function showBench(): void {
  if (!prefs.bench) return;
  const sheet = $("#bench-sheet");
  for (const tab of document.querySelectorAll<HTMLElement>("#bench .side-tab")) {
    const selected = tab.dataset.bench === prefs.benchTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  sheet.setAttribute("aria-labelledby", `tab-${prefs.benchTab}`);
  // A name or a note being typed isn't redrawn under the writer's fingers.
  if (sheet.contains(document.activeElement) && document.activeElement?.matches("input, textarea"))
    return;
  if (prefs.benchTab === "cast") {
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
  } else if (prefs.benchTab === "scraps") {
    sheet.replaceChildren(scrapsPanel(scrapsHost));
  } else if (prefs.benchTab === "scenes") {
    sheet.replaceChildren(scenesList());
  } else if (prefs.benchTab === "comments") {
    sheet.replaceChildren(commentsList());
  } else {
    sheet.replaceChildren(warningList());
  }
}

/** The Scenes tab: each chapter and scene with its words, a click from going there. */
function scenesList(): HTMLElement {
  const list = document.createElement("div");
  list.className = "scenes-list";
  const top = document.createElement("div");
  top.className = "scenes-top";
  const board = document.createElement("button");
  board.type = "button";
  board.className = "button quiet";
  board.textContent = "Open the scene board…";
  board.addEventListener("click", () => void COMMANDS.board?.());
  top.append(board);
  list.append(top);
  const go = (at: number) => {
    view.dispatch({
      selection: EditorSelection.cursor(Math.min(at, view.state.doc.length)),
      effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 40 }),
    });
    toTheText();
  };
  const here = view.state.selection.main.head;
  type Group = {
    name: string;
    from: number;
    to: number;
    words: number;
    scenes: BoardScene[];
    state?: SceneState;
    about: string;
  };
  // A long story's, as the worker last read it when it read the text as it is now.
  const chapters = read && readNow() ? read.reply.board : boardOf(current());
  const columns = chapters.flatMap((chapter): Group[] =>
    // A story whose chapters hold no scenes: each chapter a head of its own, as the status line
    // counts them, never a scene under the book's title.
    chapter.chapters
      ? chapter.scenes.map((each) => ({
          name: each.name,
          from: each.from,
          to: each.to,
          words: each.words,
          scenes: [],
          ...(each.state ? { state: each.state } : {}),
          about: each.summary,
        }))
      : [{ ...chapter, about: "" }],
  );
  for (const chapter of columns) {
    const group = document.createElement("section");
    const head = document.createElement("button");
    head.type = "button";
    head.className = "scenes-chapter";
    head.innerHTML = `<span></span><span class="scenes-words"></span>`;
    (head.firstChild as HTMLElement).textContent = chapter.name;
    (head.lastChild as HTMLElement).textContent = wordsSaid(chapter.words);
    if (chapter.state) head.dataset.state = chapter.state;
    if (chapter.about) {
      const line = document.createElement("span");
      line.className = "scenes-line";
      line.textContent = chapter.about;
      head.append(line);
    }
    head.addEventListener("click", () => go(chapter.from));
    if (chapter.from <= here && here < chapter.to && !chapter.scenes.length)
      head.setAttribute("aria-current", "true");
    const scenes = document.createElement("ol");
    for (const scene of chapter.scenes) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scenes-scene";
      if (scene.state) button.dataset.state = scene.state;
      if (scene.from <= here && here < scene.to) button.setAttribute("aria-current", "true");
      const name = document.createElement("span");
      name.textContent = scene.name;
      const count = document.createElement("span");
      count.className = "scenes-words";
      count.textContent = wordsSaid(scene.words);
      button.append(name, count);
      if (scene.summary) {
        const line = document.createElement("span");
        line.className = "scenes-line";
        line.textContent = scene.summary;
        button.append(line);
      }
      button.addEventListener("click", () => go(scene.from));
      item.append(button);
      scenes.append(item);
    }
    group.append(head, scenes);
    list.append(group);
  }
  return list;
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
  // A long story's from the worker's reading of it (asked for again if the text has changed),
  // never by reading the book on the page.
  if (view.state.doc.length >= LONG) {
    const doc = view.state.doc;
    const found = readNow() && read ? Promise.resolve(read.reply) : readInWorker(doc.toString());
    void found.then((reply) => {
      if (view.state.doc !== doc) return;
      read = { doc, reply };
      showQuote(nextWanting(reply.wanting, view.state.selection.main.head));
    });
    return true;
  }
  if (storyVersion !== version) refresh();
  showQuote(nextNarratedQuote(current(), view.state.selection.main.head));
  return true;
}

/** A quote that wants a speaker, selected and said; or that none does. */
function showQuote(quote: Wanting | undefined): void {
  if (!quote) {
    notice("Every quote has its speaker: none is left for the narrator to read.");
    return;
  }
  view.dispatch({
    selection: EditorSelection.range(quote.from, quote.to),
    effects: EditorView.scrollIntoView(quote.from, { y: "center" }),
  });
  const line = view.state.doc.lineAt(quote.from).number;
  notice(
    quote.carried
      ? `Line ${line}: this quote carries on ${quote.carried.speaker}’s speech, but its tag names ${quote.carried.tag}. ${keys("Mod+K")} gives it to someone; ${keys("Mod+Shift+K")} goes to the next.`
      : `Line ${line}: the narrator reads this quote. ${keys("Mod+K")} gives it to someone; ${keys("Mod+Shift+K")} goes to the next.`,
    true,
  );
}

/**
 * F9: the story read aloud by the browser from the cursor to the end of its scene, each speaker
 * in a voice of their own, the cursor going with it; F9 or Escape again stops it.
 */
const hearing = new Hearing();
function hearFromHere(): boolean {
  if (hearing.on) {
    hearing.stop();
    showHearing(false);
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
    // Only voices that speak online: the words would leave the computer, so the writer says so.
    const voices = window.speechSynthesis.getVoices();
    if (voices.every(speaksOnline) && !prefs.onlineVoices) {
      const service = onlineService(voices);
      const answer = await ask(
        `This browser’s voices all speak online: to hear the story, its words go to ${service} to be spoken. Everything else stays on this computer. Use them?`,
        [
          { label: "Cancel", value: "cancel" },
          { label: `Use ${service}’s voices`, value: "online", main: true },
        ],
      );
      if (answer !== "online") return;
      prefs.onlineVoices = true;
      keepPrefs();
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
  showHearing(true);
  void hearing
    .read(
      rows,
      story.meta.language ?? navigator.language,
      story.meta.narrator,
      (row) => {
        const line = view.state.doc.line(Math.min(row.line, view.state.doc.lines));
        const at = Math.min(line.from + row.column - 1, line.to);
        view.dispatch({
          selection: EditorSelection.cursor(at),
          effects: EditorView.scrollIntoView(at, { y: "nearest" }),
        });
      },
      prefs.onlineVoices,
    )
    // Done, or stopped: pressed only if another reading took its place.
    .finally(() => showHearing(hearing.on));
  return true;
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && hearing.on) {
    hearing.stop();
    showHearing(false);
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
/** Where one passage ends and another begins between `from` and `to`, as the editor reads them. */
function passageEdges(state: EditorState, from: number, to: number): number[] {
  const edges: number[] = [];
  for (const mark of state.field(marksField)) {
    if (mark.kind !== "speech" || mark.to <= from || mark.from >= to) continue;
    edges.push(mark.from, mark.to);
  }
  return edges;
}
const italics = toggleEmphasis(false, insideMark, (message) => notice(message), passageEdges);
const bold = toggleEmphasis(true, insideMark, (message) => notice(message), passageEdges);

/**
 * The scene the cursor is in (from its heading or break to the next), or its chapter (from its
 * heading to the next), moved past the one before or after; one step to undo. A chapter's heading
 * is of the level the story divides at (`#`, or `##` under a `#` title), and a heading above the
 * chapters (the title, a part) stays where it is. A chapter with no scenes moves as its scene.
 */
function moveSectionHere(chapters: boolean, by: 1 | -1): boolean {
  if (lockedOut) return true;
  if (storyVersion !== version) refresh();
  const story = current();
  const all = railScenes(story, sceneNumbers(view.state));
  const starts = (which: (scene: RailScene) => boolean) =>
    all.filter(which).map((scene) => scene.from);
  const heads = starts((scene) => scene.chapter && !scene.title);
  const moveChapter = () =>
    moveSection(
      view.state,
      heads,
      by,
      starts((scene) => scene.title),
    );
  let asChapter = chapters;
  let moved = chapters
    ? moveChapter()
    : moveSection(
        view.state,
        starts((scene) => !scene.chapter),
        by,
        starts((scene) => scene.chapter),
      );
  // A chapter with no scenes in it is the scene the cursor is in: moved whole, past the chapter
  // beside it (a short story's `##` sections under its `#` title are its chapters).
  if (moved === "outside" && !chapters) {
    const head = view.state.selection.main.head;
    const from = heads.filter((at) => at <= head).at(-1);
    const to = all.find((scene) => scene.chapter && from !== undefined && scene.from > from)?.from;
    if (
      from !== undefined &&
      !all.some(
        (scene) =>
          !scene.chapter && scene.from > from && scene.from < (to ?? Number.POSITIVE_INFINITY),
      )
    ) {
      asChapter = true;
      moved = moveChapter();
    }
  }
  if (typeof moved === "string") {
    const level = chapterLevelIn(story);
    notice(
      moved === "outside"
        ? `Put the cursor in a ${chapters ? `chapter first: here one starts at a ${"#".repeat(level)} heading` : `scene first: here one starts at a ${"#".repeat(level + 1)} heading or a scene break`}.`
        : asChapter
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
  if (narrow.matches && prefs.bench) showBenchPanel(false);
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
  if (focus) document.querySelector<HTMLElement>(`#side .side-tab[data-tab="${tab}"]`)?.focus();
}

/** A workbench tab, the workbench shown for it. */
function selectBench(tab: BenchTab, focus = false): void {
  prefs.benchTab = tab;
  keepPrefs();
  if (!prefs.bench) showBenchPanel(true);
  else showBench();
  if (focus) document.querySelector<HTMLElement>(`#bench .side-tab[data-bench="${tab}"]`)?.focus();
}

const BENCH_TABS: readonly BenchTab[] = ["scenes", "cast", "scraps", "comments", "warnings"];
for (const tab of document.querySelectorAll<HTMLButtonElement>("#bench .side-tab")) {
  tab.addEventListener("click", () => selectBench(tab.dataset.bench as BenchTab));
  tab.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const all = BENCH_TABS;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      selectBench((event.key === "Home" ? all[0] : all.at(-1)) as BenchTab, true);
      return;
    }
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    selectBench(
      all[(all.indexOf(prefs.benchTab) + step + all.length) % all.length] as BenchTab,
      true,
    );
  });
}

const TABS: readonly Tab[] = ["script", "book"];
for (const tab of document.querySelectorAll<HTMLButtonElement>("#side .side-tab")) {
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
  selectBench("warnings", true);
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
  if (!prefs.side) return;
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
  if (!element) {
    // Before the story's first part (Ctrl+Home, the front matter): the side from its top too.
    if (view.hasFocus && low === 0) $("#side-sheet").scrollTop = 0;
    return;
  }
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

/** Below this, the preview and the workbench take turns: one shows at a time. */
const crowded = window.matchMedia("(max-width: 1199px)");

function showSidePanel(shown: boolean): void {
  prefs.side = shown;
  if (shown && crowded.matches && prefs.bench) setBench(false);
  keepPrefs();
  $("#workspace").toggleAttribute("data-side", shown);
  checkMenu("side", shown);
  showDrawnTip();
  if (shown) showSide();
  overlaid();
}

// F6 (Shift+F6 back), as in a desktop app: from the text to the workbench to the preview, those
// showing, and round to the text again.
document.addEventListener("keydown", (event) => {
  if (event.key !== "F6" || event.ctrlKey || event.metaKey || event.altKey || onWelcome()) return;
  if (document.querySelector("dialog[open]")) return;
  event.preventDefault();
  const regions: Array<{ in: Element; go: () => void }> = [
    { in: $(".manuscript"), go: () => view.focus() },
    ...(prefs.bench && !prefs.focus
      ? [
          {
            in: $("#bench"),
            go: () =>
              document
                .querySelector<HTMLElement>('#bench .side-tab[aria-selected="true"]')
                ?.focus(),
          },
        ]
      : []),
    ...(prefs.side && !prefs.focus
      ? [
          {
            in: $("#side"),
            go: () =>
              document.querySelector<HTMLElement>('#side .side-tab[aria-selected="true"]')?.focus(),
          },
        ]
      : []),
  ];
  const here = regions.findIndex((region) => region.in.contains(document.activeElement));
  const next = regions[(here + (event.shiftKey ? -1 : 1) + regions.length) % regions.length];
  next?.go();
});

// Ctrl+\ and Ctrl+Shift+\, wherever the keys are: the preview, and the workbench.
document.addEventListener("keydown", (event) => {
  if (event.code !== "Backslash" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (onWelcome()) return;
  event.preventDefault();
  if (leaveFocusFor(event.shiftKey ? "bench" : "side")) return;
  if (event.shiftKey) showBenchPanel(!prefs.bench);
  else showSidePanel(!prefs.side);
});
// A window grown crowded keeps one panel: the preview.
crowded.addEventListener("change", () => {
  if (crowded.matches && prefs.side && prefs.bench) {
    setBench(false);
    keepPrefs();
    overlaid();
  }
});

function setBench(shown: boolean): void {
  prefs.bench = shown;
  $("#workspace").toggleAttribute("data-bench", shown);
  checkMenu("bench", shown);
}

function showBenchPanel(shown: boolean): void {
  if (shown && crowded.matches && prefs.side) {
    prefs.side = false;
    $("#workspace").toggleAttribute("data-side", false);
    checkMenu("side", false);
  }
  setBench(shown);
  keepPrefs();
  if (shown) showBench();
  overlaid();
}

/** The preview's word about drawn marks, while marks are as written, until it is put away. */
function showDrawnTip(): void {
  $("#drawn-tip").hidden = !prefs.marks || prefs.drawnTipDone || !prefs.side;
}

/** The menu says how marks are shown, and the drawn-only choices wait while they are written. */
function showMarksMenu(raw: boolean): void {
  checkMenu("written", raw);
  checkMenu("drawn", !raw);
  for (const item of document.querySelectorAll("#drawn-only [role^=menuitem], #drawn-button"))
    item.setAttribute("aria-disabled", String(raw));
  $("#drawn-button").title = raw ? "Only when marks are drawn: View › Drawn" : "";
  $("#drawn-hint").hidden = !raw;
  showDrawnTip();
}

/**
 * On a narrow window the side lies over the manuscript: then it is what is read, and what is
 * behind it can't be reached by the keyboard or a screen reader until it is closed.
 */
const narrow = window.matchMedia("(max-width: 899px)");
function overlaid(): void {
  const over = narrow.matches && prefs.side;
  // The bar's two panel buttons say which panels show: none, in focus.
  $("#preview-toggle").setAttribute("aria-pressed", String(prefs.side && !prefs.focus));
  $("#bench-toggle").setAttribute("aria-pressed", String(prefs.bench && !prefs.focus));
  $("#preview-toggle").title = prefs.focus
    ? `Leave focus, and show the preview (${keys("Mod+\\")})`
    : `Preview: the script or the book (${keys("Mod+\\")})`;
  $("#bench-toggle").title = prefs.focus
    ? `Leave focus, and show the workbench (${keys("Mod+Shift+\\")})`
    : `Workbench: scenes, cast, scraps, comments, warnings (${keys("Mod+Shift+\\")})`;
  if (document.body.hasAttribute("data-welcome")) return;
  // The workbench lies over the manuscript from the left on a narrow window, as the side does
  // from the right.
  const benchOver = narrow.matches && prefs.bench;
  $(".manuscript").inert = over || benchOver;
  $("#scene-rail").inert = over || benchOver;
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

/** A panel asked for in focus: focus ends, and the panel shows, whether it was on or not. */
function leaveFocusFor(panel: "side" | "bench"): boolean {
  if (!prefs.focus) return false;
  focusMode(false);
  if (panel === "side") showSidePanel(true);
  else showBenchPanel(true);
  return true;
}

$("#focus-exit").title = `Leave focus (Esc, or ${keys("Mod+Shift+F")})`;
$("#focus-exit").addEventListener("click", () => {
  focusMode(false);
  view.focus();
});
// Escape leaves focus, once nothing else is using it: a menu, a dialog, a search, reading aloud.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !prefs.focus || event.defaultPrevented) return;
  if (hearing.on || document.querySelector("dialog[open]")) return;
  if ((event.target as HTMLElement | null)?.closest?.(".cm-panels, [role=menubar], [role=menu]"))
    return;
  focusMode(false);
});

$("#preview-toggle").addEventListener("click", () => {
  if (leaveFocusFor("side")) {
    view.focus();
    return;
  }
  const preview = !prefs.side;
  showSidePanel(preview);
  // Lying over the manuscript on a narrow window, it is what is read next.
  if (preview && narrow.matches)
    document.querySelector<HTMLElement>('#side .side-tab[aria-selected="true"]')?.focus();
  else view.focus();
});
$("#bench-toggle").addEventListener("click", () => {
  if (leaveFocusFor("bench")) {
    view.focus();
    return;
  }
  const shown = !prefs.bench;
  showBenchPanel(shown);
  if (shown && narrow.matches)
    document.querySelector<HTMLElement>('#bench .side-tab[aria-selected="true"]')?.focus();
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
  // A new story no one has written in yet, or an example as it came: nothing to save.
  if (untouched()) return true;
  if (
    !file.handle &&
    file.saved === "" &&
    examples.some((each) => each.name === file.name && sameText(text(), each.text))
  )
    return true;
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
  // An ebook some of whose chapters couldn't be read: never opened as if it were whole.
  if (opened.missing?.length) {
    const named = opened.missing.slice(0, 4).join(", ") + (opened.missing.length > 4 ? "…" : "");
    const answer = await ask(
      `${opened.missing.length} of this ebook’s ${opened.chapters ?? opened.missing.length} chapters couldn’t be read (${named}): the file may be damaged. Open the chapters that could be read, as a new story?`,
      [
        { label: "Cancel", value: "cancel" },
        { label: "Open what could be read", value: "open", main: true },
      ],
    );
    if (answer !== "open") return;
  }
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
  scrapsFiles.offerByName();
  if (!opened.imported) void snapshot("Opened", opened.text);
  if (opened.imported && opened.document)
    offerShape(
      `${opened.document === "docx" ? "That Word document" : "That ebook"} was opened as a new story, its headings, paragraphs, italics and bold kept as it marks them${opened.left?.length ? `; not brought in: ${opened.left.join(", ")}` : ""}. Ctrl+Shift+K finds the quotes to give their speakers, and Save writes it as VoxDown to a file of its own.`,
    );
  else if (/\.txt$/i.test(opened.name)) offerShape();
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
    field.closest("#side-sheet, #bench-sheet") &&
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
  keep: () => {
    // Scraps saved beside the story this visit are saved there again with it; those this browser
    // alone has are said.
    void scrapsFiles.save(false).then(() => scrapsFiles.remind());
    return keep();
  },
  snapshot: async (why, content) => {
    await snapshot(why, content);
  },
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
  `voxdown: ${SPEC_VERSION}`,
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
  // The title selected, so that what is typed first replaces it; Enter goes on to the page.
  // Selected as the story is put in the editor, before it has the keyboard: selected later, after
  // the draft is kept, it caught words already being typed.
  const title = NEW_STORY.indexOf("# Untitled") + 2;
  const opening = load(
    { name: "Untitled.vxd", text: NEW_STORY },
    { saved: "" },
    { from: title, to: title + "Untitled".length },
  );
  // About the title: gone once the title changes, or the cursor or the story goes elsewhere.
  notice("Type the story’s title, then Enter to write beneath it.", true);
  await opening;
}

/** A paste from a web page, Word or Google Docs, its paragraphs, headings and emphasis kept. */
function pasteShaped(event: ClipboardEvent, editor: EditorView): boolean {
  if (lockedOut || editor.state.readOnly) return false;
  const html = event.clipboardData?.getData("text/html");
  if (!html) return pastePlainOverAll(event, editor);
  let { from, to } = editor.state.selection.main;
  // The front matter selected with the story (Ctrl+A): the front matter kept, the story replaced.
  // Inside the front matter alone, the words alone.
  const front = current().frontMatter?.range.to ?? 0;
  if (from < front) {
    if (to <= front) return false;
    from = Math.min(front + 1, to);
  }
  const plain = event.clipboardData?.getData("text/plain") ?? "";
  const pasted = pastedStory(html, plain);
  if (pasted === undefined) return pastePlainOverAll(event, editor);
  const { text } = pasted;
  // A heading's words selected (a new story's title, as it opens): what is pasted takes the
  // heading's whole line where it brings headings or paragraphs of its own, never `# # The Book`.
  const line = editor.state.doc.lineAt(from);
  const sign = /^#{1,6}[ \t]+/.exec(line.text)?.[0].length ?? 0;
  if (
    sign &&
    from >= line.from + sign &&
    to === line.to &&
    (text.includes("\n") || /^#/.test(text))
  )
    from = line.from;
  event.preventDefault();
  // Under the front matter, a blank line between them.
  const insert = from === front + 1 && front > 0 ? `\n${text}` : text;
  editor.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length),
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  // Signs written as text (`\@`, `\[`, `\{`): the page's own, or VoxDown the writer meant as
  // marks. The other way, one click away.
  if (pasted.escaped && plain)
    notice("Pasted as a page's text: its @, [ and { are words, not marks.", false, {
      label: "Paste as VoxDown",
      run: () => {
        if (editor.state.sliceDoc(from, from + insert.length) !== insert) return;
        // The page's headings, paragraphs and emphasis kept; its signs marks.
        const marks = insert.slice(0, insert.length - text.length) + pasted.marks;
        editor.dispatch({
          changes: { from, to: from + insert.length, insert: marks },
          selection: EditorSelection.cursor(from + marks.length),
          userEvent: "input.paste",
        });
        editor.focus();
      },
    });
  return true;
}

/**
 * Text alone pasted over the front matter and the story (Ctrl+A): the front matter kept, the story
 * replaced, as a page's paste does; unless what is pasted brings a front matter of its own.
 */
function pastePlainOverAll(event: ClipboardEvent, editor: EditorView): boolean {
  const plain = event.clipboardData?.getData("text/plain") ?? "";
  const front = current().frontMatter?.range.to ?? 0;
  const { from, to } = editor.state.selection.main;
  if (!plain || front === 0 || from >= front || to <= front) return false;
  if (/^\uFEFF?---[ \t]*\r?\n/.test(plain)) return false;
  event.preventDefault();
  const insert = `\n${plain}`;
  editor.dispatch({
    changes: { from: front + 1, to, insert },
    selection: EditorSelection.cursor(front + 1 + insert.length),
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  return true;
}

/** What the story's text holds of a book's shape, said in a few words; "" for nothing. */
function shapeSaid(shape: Shape): string {
  const said = [
    shape.chapters.length >= 2 ? `${shape.chapters.length.toLocaleString()} chapters` : "",
    shape.contents.length ? "a list of contents" : "",
    shape.notices.length ? "Project Gutenberg's notices" : "",
    shape.lines.length ? `${shape.lines.length} lines set out as a play` : "",
  ].filter(Boolean);
  return said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : (said[0] ?? "");
}

/** After a book comes in (pasted, a text file, an ebook): what can be set out, offered. */
function offerShape(before = ""): void {
  if (lockedOut) {
    if (before) notice(before);
    return;
  }
  const said = shapeSaid(findShape(current()));
  if (!said) {
    if (before) notice(before);
    return;
  }
  notice(`${before ? `${before} ` : ""}It reads as a book: ${said}.`, false, {
    label: "Find the chapters…",
    run: showShape,
  });
}

/** Edit › Find the chapters…: what the story's text holds of a book's shape, each a choice. */
function showShape(): void {
  if (lockedOut) return;
  if (storyVersion !== version) refresh();
  const story = current();
  const shape = findShape(story);
  const dialog = $<HTMLDialogElement>("#shape");
  const choices = $("#shape-choices");
  const sample = (texts: string[]) =>
    texts.length > 3 ? `${texts.slice(0, 3).join(" · ")} · …` : texts.join(" · ");
  const speakers = [...new Set(shape.lines.map((line) => line.handle))];
  const offered: Array<{
    key: keyof Parameters<typeof shapeStory>[2];
    label: string;
    detail: string;
  }> = [
    ...(shape.chapters.length
      ? [
          {
            key: "chapters" as const,
            label: `Make ${shape.chapters.length.toLocaleString()} chapter titles headings`,
            detail: sample(shape.chapters.map((chapter) => chapter.text)),
          },
        ]
      : []),
    ...(shape.contents.length
      ? [
          {
            key: "contents" as const,
            label: `Keep the list of contents (${shape.contents.length} lines) in the book only, not read aloud`,
            detail: "Each line printed, as {book only}: the audiobook goes straight to the story.",
          },
        ]
      : []),
    ...(shape.notices.length
      ? [
          {
            key: "notices" as const,
            label: "Take out Project Gutenberg's notices, at the start and the end",
            detail: "Its licence and its header, which aren't the book's, nor to be read aloud.",
          },
        ]
      : []),
    ...(shape.title || shape.author
      ? [
          {
            key: "details" as const,
            label: `Make ${[shape.title ? `“${shape.title}” the title` : "", shape.author ? `${shape.author} the author` : ""].filter(Boolean).join(" and ")}`,
            detail:
              shape.titlePage.length > 1
                ? "From its title page, made one heading at the top, the chapters under it."
                : shape.titlePage.length
                  ? "From its first line, made the heading at the top, the chapters under it."
                  : shape.heading
                    ? "From the heading at its top."
                    : "From Project Gutenberg's header.",
          },
        ]
      : []),
    ...(shape.lines.length
      ? [
          {
            key: "lines" as const,
            label: `Give ${shape.lines.length} lines set out as a play to their ${speakers.length} speakers`,
            detail: `${(shape.lines[0] as Shape["lines"][number]).name}. … → @${(shape.lines[0] as Shape["lines"][number]).handle} …; the new ones join the cast: ${sample(speakers)}`,
          },
        ]
      : []),
  ];
  choices.replaceChildren(
    ...offered.map((offer) => {
      const label = document.createElement("label");
      label.className = "shape-choice";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = true;
      box.name = offer.key;
      const text = document.createElement("span");
      text.textContent = offer.label;
      const small = document.createElement("small");
      small.textContent = offer.detail;
      label.append(box, text, small);
      return label;
    }),
  );
  if (!offered.length) {
    const none = document.createElement("p");
    none.textContent =
      "Nothing here to set out: no chapter titles alone on their lines, no list of contents, no Project Gutenberg notices, no lines set out as a play.";
    choices.append(none);
  }
  $<HTMLButtonElement>("#shape-make").hidden = !offered.length;
  dialog.onclose = () => {
    if (dialog.returnValue !== "make") return view.focus();
    const chosen = Object.fromEntries(
      [...choices.querySelectorAll<HTMLInputElement>("input")].map((box) => [
        box.name,
        box.checked,
      ]),
    );
    const before = view.state.doc.toString();
    const made = shapeStory(story, shape, chosen);
    if (apply(diffChanges(before, made), "Nothing chosen to change.")) {
      notice("Set out as a book: Ctrl+Z takes it all back.");
      if (prefs.side) showSide();
      if (prefs.bench) showBench();
    }
    view.focus();
  };
  dialog.returnValue = "";
  dialog.showModal();
}

/** Tidies the story as `format` does, changing only what it changes, as one step to undo. */
function tidy(curly: boolean): void {
  if (lockedOut) return;
  const before = view.state.doc.toString();
  const after = format(before, curly ? { quotes: "curly", dashes: true } : {});
  if (after === before) {
    notice("Already tidy: nothing to change.");
    return;
  }
  void snapshot("Before tidying");
  const lines = diffLines(before, after);
  const added = lines.filter((line) => line.kind === "new").length;
  const gone = lines.filter((line) => line.kind === "gone").length;
  // Lines changed are a line gone and one in its place; the rest were taken out (blank lines).
  const changedLines = Math.min(added, gone);
  const takenOut = gone - changedLines;
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
    `Tidied: ${changedLines.toLocaleString()} ${changedLines === 1 ? "line" : "lines"} changed${takenOut ? `, ${takenOut.toLocaleString()} taken out` : ""}. Undo (${keys("Mod+Z")}) takes it back; Earlier versions has it as it was.`,
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
function insertAtCursor(
  text: string,
  select?: string,
  /** Changes made with it, as one step (a version declared in the front matter). */
  also: ReadonlyArray<{ from: number; to: number; insert: string }> = [],
): void {
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
          mark.kind === "comment" ||
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
  const changes = view.state.changes([...also, { from, to, insert }]);
  const start = changes.mapPos(from, -1);
  view.dispatch({
    changes,
    selection:
      at >= 0
        ? EditorSelection.range(start + at, start + at + (select?.length ?? 0))
        : EditorSelection.cursor(start + insert.length),
    scrollIntoView: true,
    userEvent: "input.insert",
  });
  view.focus();
}

/**
 * Insert › A comment for yourself: `<!-- … -->` at the cursor, its words selected to write over;
 * or, with words selected, those words commented out. A story that declares an older version
 * declares 1.3, which reads comments (§10.1, §16).
 */
function insertComment(): void {
  if (lockedOut) return;
  const { from, to } = view.state.selection.main;
  // The story's details hold no comment: the front matter is YAML, where `#` starts one.
  const body = frontMatterEnd() ?? 0;
  if (from < body) {
    notice(
      "The story’s details at the top can’t hold a comment: there, a line starting with # is one.",
    );
    return;
  }
  const source = view.state.doc.toString();
  // In a comment already: its words put back in the text.
  const back = commentBack(source, from, to);
  if (back) {
    view.dispatch({
      changes: back,
      selection: EditorSelection.range(back.from, back.from + back.insert.length),
      scrollIntoView: true,
      userEvent: "input",
    });
    notice(
      [
        "Put back in the text: read aloud and printed again.",
        ...speakersChanged(source, back, groupsAround(back.from, back.to)).map(
          (each) =>
            `“${each.words}” is ${speakerName(each.now)}’s now, not ${speakerName(each.was)}’s.`,
        ),
        `${keys("Mod+Z")} comments it out again.`,
      ].join(" "),
    );
    view.focus();
    return;
  }
  const bump = declareVersion(current(), "1.3");
  const also = bump ? [bump] : [];
  if (from === to || view.state.sliceDoc(from, to).trim() === "") {
    insertAtCursor("<!-- comment -->", "comment", also);
    return;
  }
  const out = commentOut(source, from, to);
  if (!out) {
    notice("Those words are already commented out.");
    return;
  }
  // Words taken out can give what is left to someone else: said, never left to be found.
  const moved = speakersChanged(source, out, groupsAround(out.from, out.to));
  const changes = view.state.changes([...also, { from: out.from, to: out.to, insert: out.insert }]);
  view.dispatch({
    changes,
    selection: EditorSelection.cursor(changes.mapPos(out.to, 1)),
    scrollIntoView: true,
    userEvent: "input.insert",
  });
  notice(
    [
      `Commented out${out.kept ? `, with the ${out.kept === 1 ? "comment" : `${out.kept} comments`} already there inside it` : ""}: kept in the text, never read aloud or printed.`,
      ...moved.map(
        (each) =>
          `“${each.words}” is ${speakerName(each.now)}’s now, not ${speakerName(each.was)}’s.`,
      ),
      `${keys("Mod+Z")} puts it back, as does ${keys("Mod+Alt+M")} in the comment.`,
    ].join(" "),
  );
  view.focus();
}

/** The groups a change at `from`–`to` is in, from the first's opening line to its closing one. */
function groupsAround(from: number, to: number): { from: number; to: number } | undefined {
  const source = view.state.doc;
  let span: { from: number; to: number } | undefined;
  for (const group of current().groups) {
    const end = group.closeRange?.to ?? source.length;
    if (group.range.from <= from && to <= end)
      span = {
        from: Math.min(span?.from ?? group.range.from, group.range.from),
        to: Math.max(span?.to ?? end, end),
      };
  }
  return span;
}

/** A speaker as the writer knows them: the narrator by that word, a character by their name. */
function speakerName(handle: string): string {
  const story = current();
  const known = castMemberNamed(story, handle) ?? handle;
  if (known === story.meta.narrator || handle === "Narrator") return "the narrator";
  return story.cast.find((member) => member.handle === known)?.name ?? handle;
}

/** The workbench's Comments, as the story has them now. */
function commentsList(): HTMLElement {
  return commentsPanel({
    story: current(),
    lineAt: (at) => view.state.doc.lineAt(Math.min(at, view.state.doc.length)).number,
    here: view.state.selection.main.head,
    keys,
    goTo: (from, to) => {
      view.dispatch({
        selection: EditorSelection.cursor(to),
        effects: EditorView.scrollIntoView(from, { y: "center" }),
      });
      toTheText();
    },
    putBack: (from) => {
      if (lockedOut) return;
      view.dispatch({ selection: EditorSelection.cursor(from + 1) });
      insertComment();
    },
    remove: (from, to) => {
      if (lockedOut) return;
      // The space before it goes with it, so the words around it meet as before.
      const start = view.state.sliceDoc(from - 1, from) === " " ? from - 1 : from;
      view.dispatch({ changes: { from: start, to }, userEvent: "delete" });
      notice(`Comment deleted. ${keys("Mod+Z")} brings it back.`);
    },
  });
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

/** Export › A manuscript to submit: the writer's name and contact, then the Word document. */
function showManuscript(): void {
  const dialog = $<HTMLDialogElement>("#manuscript");
  const story = current();
  const kept = (() => {
    try {
      return JSON.parse(localStorage.getItem("vxd-writer-contact") ?? "{}") as {
        contact?: string;
        surname?: string;
      };
    } catch {
      return {};
    }
  })();
  const contact = $<HTMLTextAreaElement>("#manuscript-contact");
  const byline = $<HTMLInputElement>("#manuscript-byline");
  const surname = $<HTMLInputElement>("#manuscript-surname");
  contact.value = kept.contact ?? "";
  byline.value = story.meta.author ?? kept.contact?.split("\n")[0]?.trim() ?? "";
  const lastWord = (name: string) => name.trim().split(/\s+/).at(-1) ?? "";
  surname.value = kept.surname ?? lastWord(contact.value.split("\n")[0] ?? "") ?? "";
  // The surname follows the name until the writer gives one.
  contact.oninput = () => {
    if (!kept.surname) surname.value = lastWord(contact.value.split("\n")[0] ?? "");
  };
  $("#manuscript-go").onclick = () => {
    try {
      localStorage.setItem(
        "vxd-writer-contact",
        JSON.stringify({ contact: contact.value, surname: surname.value }),
      );
    } catch {
      // Kept for this visit only.
    }
    dialog.close();
    void exportManuscript({
      contact: contact.value,
      byline: byline.value.trim() || lastWord(contact.value.split("\n")[0] ?? ""),
      surname: surname.value.trim(),
    });
  };
  dialog.showModal();
  contact.focus();
}

async function exportManuscript(who: {
  contact: string;
  byline: string;
  surname: string;
}): Promise<void> {
  const story = current();
  const level = chapterLevelIn(story);
  // A chapter's or a scene's heading the book never prints (hidden, or for the audio) still
  // starts one: a break, where the manuscript has one (a short story's sections are set apart
  // that way, never each on a page of its own).
  let source = story.source;
  for (const block of [...story.blocks].reverse())
    if (
      block.kind === "heading" &&
      block.level >= level &&
      (block.visibility === "hidden" || block.visibility === "audio")
    )
      source = `${source.slice(0, block.range.from)}* * *${source.slice(block.range.to)}`;
  const printed = source === story.source ? story : parse(source);
  const body = new DOMParser().parseFromString(
    renderBook(printed, { header: false }),
    "text/html",
  ).body;
  const paragraphs = paragraphsOf(body);
  const { manuscriptDocx } = await import("./manuscript");
  const title = story.meta.title ?? baseName();
  download(
    manuscriptDocx(paragraphs, {
      ...who,
      chapterLevel: level,
      title,
      words: countsOf(story).words,
      ...(story.meta.language ? { language: story.meta.language } : {}),
    }),
    `${baseName()} (manuscript).docx`,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  notice("The manuscript is in your downloads.");
}

/** The book as a Word document or an ebook: its headings, paragraphs and emphasis. */
async function exportDocument(kind: "docx" | "epub"): Promise<void> {
  const story = current();
  // A Word document is for an editor: the writer's comments go in it as Word's own.
  const html = renderBook(story, kind === "docx" ? { comments: true } : {});
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const paragraphs = paragraphsOf(body);
  const { title = baseName(), subtitle, author, language } = story.meta;
  const details = {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(author ? { author } : {}),
    ...(language ? { language } : {}),
  };
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
  /** Something to do above the list (Earlier versions: keep this one under a name). */
  top?: HTMLElement,
): HTMLElement[] {
  const dialog = $<HTMLDialogElement>("#list-dialog");
  $("#list-title").textContent = title;
  $("#list-note").textContent = note;
  $("#list-top").replaceChildren(...(top ? [top] : []));
  // Each row's line about it, to say more once it is known.
  const details: HTMLElement[] = [];
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
      details.push(detail);
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
  return details;
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

async function showVersions(again = false): Promise<void> {
  const versions = await versionsOf(file.id);
  // The story as it is now, kept under a name of the writer's: never thinned out.
  const keep = document.createElement("div");
  keep.className = "keep-version";
  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "Before the narration's revisions";
  name.setAttribute("aria-label", "A name for the version kept now");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button";
  button.textContent = "Keep this version";
  // Said where the name was given, and kept there until it is kept.
  const failed = document.createElement("p");
  failed.className = "keep-failed";
  failed.setAttribute("role", "alert");
  failed.hidden = true;
  const named = async () => {
    const called = name.value.trim();
    if (!called) return name.focus();
    // The same words under the same name: one row is enough.
    const now = text();
    if (versions.some((kept) => kept.pinned && kept.why === called && sameText(kept.text, now))) {
      failed.textContent = `The story as it is now is kept as “${called}” already.`;
      failed.hidden = false;
      name.focus();
      return;
    }
    button.disabled = true;
    const stored = await snapshot(called, text(), true);
    button.disabled = false;
    if (!stored) {
      // The name stays to try again; nothing is said to be kept that wasn't.
      failed.textContent = `“${called}” wasn't kept: the browser wouldn't store it (it may be short of space, or in a private window). Save the story as a file to keep it as it is now.`;
      failed.hidden = false;
      name.focus();
      return;
    }
    announce(`Kept as “${called}”`);
    void showVersions(true);
  };
  button.addEventListener("click", () => void named());
  name.addEventListener("keydown", (event) => {
    // Not the list's own form: Enter keeps it, the dialog stays.
    if (event.key !== "Enter") return;
    event.preventDefault();
    void named();
  });
  keep.append(name, button, failed);
  // The story now, read once: each version is compared with it.
  const now = text();
  const detailOf = (kept: Version) =>
    [
      kept.pinned ? when(kept.at) : "",
      wordsOfVersion(kept) === undefined ? "" : wordsSaid(wordsOfVersion(kept) ?? 0),
      kept.pinned ? "kept under its name" : "",
      sameText(kept.text, now) ? "the same as now" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const details = showList(
    `Earlier versions of ${file.name}`,
    versions.length
      ? "Kept when the story was opened, each time it was saved, every ten minutes of writing and before tidying, and those kept under a name, which are never let go. Going back to one is a change like any other: Undo takes it back."
      : "None yet: a version is kept when the story is opened or saved, and every ten minutes of writing. Keep one now under a name of your own.",
    versions
      .map((kept) => ({
        // A name in full, its date below it: a long name cut its date off.
        title: kept.pinned ? `“${kept.why}”` : `${when(kept.at)} · ${kept.why}`,
        detail: detailOf(kept),
        actions: sameText(kept.text, now)
          ? []
          : [
              { label: "Compare", run: () => compare(kept) },
              { label: "Go back to it", main: true, run: () => goBack(kept) },
            ],
      }))
      .map((row, index) => {
        const kept = versions[index] as Version;
        // One the writer named goes only when they say so.
        if (!kept.pinned || kept.key === undefined) return row;
        const key = kept.key;
        return {
          ...row,
          actions: [
            ...row.actions,
            {
              label: "Let go…",
              run: async () => {
                const answer = await ask(
                  `Let go of the version kept as “${kept.why}”? It is kept nowhere else.`,
                  [
                    { label: "Cancel", value: "cancel", main: true },
                    { label: "Let it go", value: "forget" },
                  ],
                );
                if (answer === "forget") await forgetVersion(key);
                void showVersions();
              },
            },
          ],
        };
      }),
    keep,
  );
  // Kept under a name just now, or none kept yet: the name's field, for the next.
  if (again || versions.length === 0) name.focus();
  // Versions kept before their words were counted: counted one at a time once the list shows,
  // so a long book's list opens at once (counting them all first held the page half a second).
  const uncounted = versions.flatMap((kept, index) =>
    wordsOfVersion(kept) === undefined && kept.key !== undefined ? [index] : [],
  );
  const countNext = () => {
    const index = uncounted.shift();
    const kept = index === undefined ? undefined : versions[index];
    const detail = index === undefined ? undefined : details[index];
    if (!kept || kept.key === undefined || !detail?.isConnected) return;
    versionWords.set(kept.key, proseWords(kept.text));
    detail.textContent = detailOf(kept);
    setTimeout(countNext);
  };
  setTimeout(countNext);
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

/** Focus's word on how to leave it, shown as it starts, as a browser's full screen says. */
let focusHintTimer: ReturnType<typeof setTimeout> | undefined;

function focusMode(on: boolean): void {
  const starting = on && !prefs.focus;
  prefs.focus = on;
  keepPrefs();
  checkMenu("focus", on);
  document.body.toggleAttribute("data-focus", on);
  // The panels are away while it lasts: the bar's buttons say so, and bring one back by leaving.
  $("#focus-exit").hidden = !on;
  checkMenu("side", prefs.side && !on);
  checkMenu("bench", prefs.bench && !on);
  overlaid();
  const hint = $("#focus-hint");
  clearTimeout(focusHintTimer);
  if (starting && !onWelcome()) {
    hint.textContent = `Focus: only the words. Press Esc or ${keys("Mod+Shift+F")} to leave.`;
    hint.hidden = false;
    hint.classList.remove("leaving");
    focusHintTimer = setTimeout(() => {
      hint.classList.add("leaving");
      focusHintTimer = setTimeout(() => {
        hint.hidden = true;
      }, 600);
    }, 3200);
  } else if (!on) hint.hidden = true;
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
  // A long book's scenes as the worker read them, when it read the text as it is now: never read
  // again on the page to open the list.
  const scenes =
    read && readNow()
      ? numbered(read.reply.scenes, sceneNumbers(view.state))
      : railScenes(current(), sceneNumbers(view.state));
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
  ["Mod+Shift+V", "Paste the text alone: VoxDown as written, a page without its formatting"],
  ["F9", "Hear it read aloud, to the end of the scene"],
  ["Mod+K", "Who says this passage, or the words selected"],
  ["Mod+Shift+K", "The next quote with no speaker"],
  ["Mod+J", "How it’s said: this passage, or the words selected"],
  ["Mod+Alt+M", "A comment for yourself, or the words selected commented out"],
  ["Mod+Shift+X", "Cut the words selected to Scraps, to bring back later"],
  ["Mod+\\", "The preview: the script or the book"],
  ["Mod+Shift+\\", "The workbench: scenes, cast, scraps, comments and warnings"],
  ["F6", "From the text to the workbench to the preview, and back (Shift+F6)"],
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
  shape: () => showShape(),
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
  goal: showGoalPanel,
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
  "insert-comment": insertComment,
  "export-manuscript": showManuscript,
  overused: showOverused,
  board: () =>
    openBoard({
      story: () => current(),
      announce,
      change: (changes, said) => {
        if (lockedOut) return;
        view.dispatch({ changes, userEvent: "input" });
        announce(said);
      },
      goTo: (at) => {
        view.dispatch({
          selection: EditorSelection.cursor(Math.min(at, view.state.doc.length)),
          effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 40 }),
        });
        view.focus();
      },
      readOnly: () => lockedOut,
    }),
  "cut-to-scraps": () => {
    cutToScraps();
  },
  comments: () => selectBench("comments", true),
  "insert-break": () => insertAfterParagraph("* * *"),
  "insert-chapter": () =>
    insertAfterParagraph(
      `${"#".repeat(newChapterLevel(current()))} A new chapter`,
      "A new chapter",
    ),
  "insert-scene": () =>
    insertAfterParagraph(`${"#".repeat(chapterLevelIn(current()) + 1)} A new scene`, "A new scene"),
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
  export: () => $<HTMLDialogElement>("#export").showModal(),
  about: showAbout,
  "ai-speakers": () => void openAi("speakers", aiContext),
  "ai-direct": () => void openDirect(aiContext),
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
  // With words selected, the passage they end in: a triple-click or a drag to the next line's
  // start leaves the cursor on the blank line after them.
  const { from, to } = view.state.selection.main;
  let head = view.state.selection.main.head;
  if (from !== to) {
    let last = to;
    while (last > from && /\s/.test(view.state.sliceDoc(last - 1, last))) last--;
    head = Math.max(from, last - 1);
    // A quote selected from its opening mark (Next quote): the passage it opens in, though it
    // may end on the next line (a quote over two lines was looked for in the line it ends on).
    if (/^[“"«»„‘「『]/u.test(view.state.sliceDoc(from, from + 1))) head = from + 1;
  }
  // A long book's from its paragraph alone, or as the worker last read it: reading the whole
  // book again here, just after a give, held the page a fifth of a second on a slow computer.
  if (view.state.doc.length >= LONG && storyVersion !== version) {
    const scope = paragraphScope(view.state.doc.toString(), head);
    if (scope) {
      const near = passageNear(scope.story, scope.at(head));
      return near ? scope.toDoc(near.range.from) : head;
    }
    if (readNow()) return passageIn(read?.reply.passages ?? [], head)?.from ?? head;
  }
  return passageNear(current(), head)?.range.from ?? head;
}

const SWITCHES = ["color", "names", "directions", "sounds", "vocal", "pages", "notes"] as const;

function viewCommand(name: string, on: boolean): void {
  if (name === "focus") {
    focusMode(on);
  } else if (name === "smart") {
    prefs.smart = on;
    keepPrefs();
    view.dispatch({ effects: setSmartPunctuation.of(on) });
  } else if (name === "toolbar") {
    prefs.toolbar = on;
    keepPrefs();
    $("#toolbar").hidden = !on;
  } else if (name === "hover-bar") {
    prefs.hoverBar = on;
    keepPrefs();
    if (!on) tools.hide();
  } else if (name === "style") {
    prefs.styleHints = on;
    keepPrefs();
    view.dispatch({ effects: redrawn.of(null) });
    if (on)
      notice(
        "Style hints: a word said again too soon is underlined, and a sentence long enough to lose a listener is shaded. Rest the pointer on one to see why.",
      );
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
  } else if (name === "marks" || name === "written" || name === "drawn") {
    const raw = name === "drawn" ? !on : on;
    view.dispatch({ effects: setShowMarks.of(raw) });
    showMarksMenu(raw);
  } else if (name === "bench") {
    if (!leaveFocusFor("bench")) showBenchPanel(on);
  } else if (name === "side") {
    if (!leaveFocusFor("side")) showSidePanel(on);
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
    } else if (command.startsWith("example:")) {
      const example = examples[Number(command.slice(8))];
      if (example) void openExample(example);
    } else void COMMANDS[command]?.();
    backToText(".menus");
  },
  () => view.focus(),
);

toolbar(
  $("#toolbar"),
  (command) => {
    void COMMANDS[command]?.();
    backToText(".toolbar");
  },
  () => view.focus(),
);

/** Back to the text after a command from `from`, unless it opened a dialog or a picker of its own. */
function backToText(from: string): void {
  requestAnimationFrame(() => {
    const at = document.activeElement;
    const left = !at || at === document.body || Boolean(at.closest(from));
    if (left && !document.querySelector("dialog[open]") && !lockedOut) view.focus();
  });
}

/** Undo and Redo in the toolbar, dimmed when there is nothing to undo or redo. */
function showUndoState(state: EditorState): void {
  for (const [command, depth] of [
    ["undo", undoDepth(state)],
    ["redo", redoDepth(state)],
  ] as const)
    $(`#toolbar [data-command="${command}"]`).setAttribute("aria-disabled", String(depth === 0));
}

/** The toolbar's Italics and Bold, pressed when the cursor is in words in italics or bold. */
function showEmphasisState(state: EditorState): void {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const at = head - line.from;
  const inside =
    /[*_]/.test(line.text) && head > emphasisFrom(state)
      ? emphasisIn(line.text).filter((found) => found.from < at && at < found.to)
      : [];
  for (const [command, strong] of [
    ["italic", false],
    ["bold", true],
  ] as const)
    $(`#toolbar [data-command="${command}"]`).setAttribute(
      "aria-pressed",
      String(inside.some((found) => found.strong === strong)),
    );
}

/** The toolbar's Hear, pressed while the story is read aloud. */
function showHearing(on: boolean): void {
  $('#toolbar [data-command="hear"]').setAttribute("aria-pressed", String(on));
}

// Undo and Redo from a field on the side that hasn't been changed (a name just renamed in the
// cast): the story's, as anywhere else.
$("#bench").addEventListener("keydown", (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement) || field.value !== field.defaultValue) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  event.preventDefault();
  (key === "y" || event.shiftKey ? redo : undo)(view);
  view.focus();
});

// Export: each choice closes the dialog and does what the menu used to, then the keyboard is
// back in the story (not on the File menu the dialog was opened from).
for (const button of document.querySelectorAll<HTMLElement>("#export [data-command]")) {
  button.addEventListener("click", () => {
    $<HTMLDialogElement>("#export").close();
    void COMMANDS[button.dataset.command ?? ""]?.();
    backToText(".menus");
  });
}

for (const button of document.querySelectorAll<HTMLElement>(
  "#save-button, .welcome [data-command]",
)) {
  button.addEventListener("click", () => void COMMANDS[button.dataset.command ?? ""]?.());
}

$("#scene-rail").addEventListener("rail-names", (event) =>
  checkMenu("rail-names", (event as CustomEvent<boolean>).detail),
);

// Ctrl+S, Ctrl+Shift+S, Ctrl+O and Ctrl+F, wherever the focus is.
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
    // Find, from the side, the toolbar or the menus too: the story's own, not the browser's. In
    // the editor it is the editor's; in a dialog, the dialog's.
    if (
      key === "f" &&
      !event.shiftKey &&
      !view.dom.contains(document.activeElement) &&
      !document.querySelector("dialog[open]") &&
      !onWelcome()
    ) {
      event.preventDefault();
      event.stopPropagation();
      openSearchPanel(view);
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
  try {
    await openStory(await openedFile(dropped, kept));
  } catch (error) {
    await tell(`That file couldn't be opened: ${(error as Error).message}`);
    return;
  }
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
$("#bench-close").addEventListener("click", () => {
  showBenchPanel(false);
  view.focus();
});
$("#drawn-tip-yes").addEventListener("click", () => {
  prefs.drawnTipDone = true;
  viewCommand("drawn", true);
  view.focus();
});
$("#drawn-tip-no").addEventListener("click", () => {
  prefs.drawnTipDone = true;
  keepPrefs();
  showDrawnTip();
});

// The welcome, for a first visit: open a file, start one, or begin from an example.

/** What can be done on the welcome, with no story open: the rest waits for one. */
const ON_WELCOME = new Set(["new", "open", "recover", "shortcuts"]);
const onWelcome = () => document.body.hasAttribute("data-welcome");

/** The commands that need a story: unavailable while the welcome shows, and available after. */
function storyCommands(available: boolean): void {
  for (const item of document.querySelectorAll<HTMLElement>(".menus [data-command]")) {
    const command = item.dataset.command ?? "";
    if (ON_WELCOME.has(command) || command.startsWith("recent:") || command.startsWith("example:"))
      continue;
    if (available) item.removeAttribute("aria-disabled");
    else item.setAttribute("aria-disabled", "true");
  }
  $<HTMLButtonElement>("#save-button").disabled = !available;
}

function showWelcome(): void {
  $("#welcome").hidden = false;
  document.body.setAttribute("data-welcome", "");
  storyCommands(false);
  for (const behind of ["#editor", "#scene-rail", "#side", "#bench"]) $(behind).inert = true;
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
      button.addEventListener("click", () => void openExample(example));
      item.append(button);
      return item;
    }),
  );
}

/**
 * An example, as a new story not yet saved: from the welcome, and from File › Open an example
 * at any time after (the welcome shows only while the browser keeps no story).
 */
async function openExample(example: (typeof examples)[number]): Promise<void> {
  if (!(await mayLeave())) return;
  await load({ name: example.name, text: example.text }, { saved: "" });
  view.focus();
}

/** File › Open an example: the stories the welcome offers, each by its title. */
function showExamples(): void {
  $("#examples-list").replaceChildren(
    ...examples.map((example, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.dataset.command = `example:${index}`;
      item.textContent = example.title;
      if (example.byline) item.title = example.byline;
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
  style.setProperty("--page-leading", String(prefs.leading));
  if (prefs.sideWidth) style.setProperty("--side-width", `minmax(18rem, ${prefs.sideWidth}%)`);
  else style.removeProperty("--side-width");
  if (prefs.benchWidth) style.setProperty("--bench-width", `minmax(14rem, ${prefs.benchWidth}%)`);
  else style.removeProperty("--bench-width");
  $("#bench-resize").setAttribute("aria-valuenow", String(prefs.benchWidth || 22));
  $("#side-resize").setAttribute("aria-valuenow", String(prefs.sideWidth || 34));
  // Paragraphs set in or not: the page's lines drawn again.
  view.dispatch({ effects: redrawn.of(null) });
  view.requestMeasure();
}

function showPageSettings(): void {
  const dialog = $<HTMLDialogElement>("#page-settings");
  const size = $<HTMLInputElement>("#page-size");
  const measure = $<HTMLInputElement>("#page-measure");
  const leading = $<HTMLInputElement>("#page-leading");
  const fonts = [...dialog.querySelectorAll<HTMLInputElement>('input[name="font"]')];
  const paragraphs = [...dialog.querySelectorAll<HTMLInputElement>('input[name="paragraphs"]')];
  const looks = $("#page-looks");
  if (!looks.childElementCount) {
    for (const look of LOOKS) {
      const label = document.createElement("label");
      label.className = "look";
      label.title = look.about;
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "look";
      input.value = look.id;
      const swatch = document.createElement("span");
      swatch.className = "look-swatch";
      swatch.setAttribute("aria-hidden", "true");
      swatch.style.background = look.swatch;
      swatch.style.color = SWATCH_INK[look.id];
      swatch.textContent = look.id === "auto" ? "" : "Aa";
      label.append(input, swatch, look.label);
      looks.append(label);
    }
  }
  const lookInputs = [...looks.querySelectorAll<HTMLInputElement>("input")];
  const show = () => {
    const look = savedLook();
    for (const input of lookInputs) input.checked = input.value === look;
    for (const font of fonts) font.checked = font.value === prefs.font;
    for (const kind of paragraphs) kind.checked = kind.value === prefs.paragraphs;
    size.value = String(prefs.size);
    measure.value = String(prefs.measure);
    leading.value = String(prefs.leading);
    $("#page-size-shown").textContent = `${prefs.size} px`;
    $("#page-measure-shown").textContent = `about ${Math.round(prefs.measure * 1.6)} letters`;
    $("#page-leading-shown").textContent =
      prefs.leading >= 2.3 ? "double" : `${prefs.leading.toFixed(2).replace(/0$/, "")}`;
  };
  const change = () => {
    prefs.font = (fonts.find((font) => font.checked)?.value ?? "story") as Prefs["font"];
    prefs.paragraphs = (paragraphs.find((kind) => kind.checked)?.value ??
      "spaced") as Prefs["paragraphs"];
    prefs.size = Number(size.value);
    prefs.measure = Number(measure.value);
    prefs.leading = Number(leading.value);
    keepPrefs();
    // The edge between the workbench and the manuscript, as the side's.
    {
      const edge = $("#bench-resize");
      const set = (percent: number) => {
        prefs.benchWidth = Math.round(Math.min(40, Math.max(14, percent)));
        keepPrefs();
        applyPage();
      };
      edge.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        edge.setPointerCapture(event.pointerId);
        edge.toggleAttribute("data-dragging", true);
        const work = $("#workspace").getBoundingClientRect();
        const rail = $("#scene-rail").getBoundingClientRect();
        const move = (moved: PointerEvent) =>
          set(((moved.clientX - rail.right) / work.width) * 100);
        const done = () => {
          edge.removeAttribute("data-dragging");
          edge.removeEventListener("pointermove", move);
        };
        edge.addEventListener("pointermove", move);
        edge.addEventListener("pointerup", done, { once: true });
        edge.addEventListener("pointercancel", done, { once: true });
      });
      edge.addEventListener("keydown", (event) => {
        const now = prefs.benchWidth || 22;
        const to =
          event.key === "ArrowRight"
            ? now + 2
            : event.key === "ArrowLeft"
              ? now - 2
              : event.key === "Home"
                ? 14
                : event.key === "End"
                  ? 40
                  : null;
        if (to === null) return;
        event.preventDefault();
        set(to);
      });
      edge.addEventListener("dblclick", () => {
        prefs.benchWidth = 0;
        keepPrefs();
        applyPage();
      });
    }
    applyPage();
    show();
  };
  for (const input of [size, measure, leading, ...fonts, ...paragraphs]) input.oninput = change;
  for (const input of lookInputs)
    input.onchange = () => {
      chooseLook(input.value as Look);
      showLook();
      show();
    };
  $("#page-reset").onclick = () => {
    Object.assign(prefs, {
      font: "story",
      size: 17,
      measure: 52,
      leading: 1.65,
      paragraphs: "spaced",
    });
    keepPrefs();
    applyPage();
    show();
  };
  show();
  dialog.showModal();
}

/** The look's name on the bar's button, which opens Page and text. */
function showLook(): void {
  const button = $<HTMLButtonElement>("#theme");
  const look = savedLook();
  button.textContent = lookLabel(look);
  button.title = `Look: ${lookLabel(look)}. Change it, and the page and text, here.`;
  button.setAttribute("aria-label", `Look: ${lookLabel(look)}`);
  button.hidden = false;
}
$("#theme").addEventListener("click", showPageSettings);
showLook();

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
  for (const name of [...SWITCHES, "autosave", "focus", "typewriter"] as const)
    checkMenu(name, prefs[name]);
  showMarksMenu(prefs.marks);
  checkMenu("hover-bar", prefs.hoverBar);
  checkMenu("toolbar", prefs.toolbar);
  checkMenu("smart", prefs.smart);
  checkMenu("style", prefs.styleHints);
  view.dispatch({ effects: setSmartPunctuation.of(prefs.smart) });
  $("#toolbar").hidden = !prefs.toolbar;
  showUndoState(view.state);
  showEmphasisState(view.state);
  focusMode(prefs.focus);
  // Where the browser can't keep files, there's no file to save to automatically.
  $("#autosave-item").hidden = !keepsFiles;
  // On a crowded window the preview, shown last, is the one kept.
  if (prefs.bench && !(crowded.matches && prefs.side)) showBenchPanel(true);
  showSidePanel(prefs.side);
  checkMenu("rail-names", rail.names);
  void showRecent();
  showExamples();
  // Sent here to open an example (the front page's "Open this scene in the Writer"): opened, the
  // address put back as it was.
  const asked = /^#example=([\w-]+)$/.exec(location.hash)?.[1];
  const example = asked ? examples.find((each) => each.name === `${asked}.vxd`) : undefined;
  if (asked) window.history.replaceState(null, "", location.href.split("#")[0]);
  // This tab's own story after a reload; in a new tab, the one written last.
  const mine = tabStory();
  const draft = (mine ? await draftById(mine) : undefined) ?? (await loadDraft());
  if (!draft) {
    if (example) {
      await load({ name: example.name, text: example.text }, { saved: "" });
      view.focus();
      return;
    }
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
  // The story written last is there first, to save or keep before the example takes its place.
  if (example && lock.owner) await openExample(example);
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

/** The build the page is, from vite.config.ts; none in tests. */
declare const __WRITER_BUILD__: { commit: string; date: string } | undefined;

/** Help › About: what the Writer is, which build, and where to learn more. */
function showAbout(): void {
  const build = typeof __WRITER_BUILD__ === "undefined" ? undefined : __WRITER_BUILD__;
  $("#about-version").textContent = [
    build ? `Built ${build.date}${build.commit ? ` (${build.commit})` : ""}` : "",
    `VoxDown format ${SPEC_VERSION}`,
  ]
    .filter(Boolean)
    .join(" · ");
  $<HTMLDialogElement>("#about").showModal();
}

/** What the AI dialog needs of the Writer. */
const aiContext: AiContext = {
  storyId: () => file.id,
  text: () => view.state.doc.toString(),
  apply: (changes) => apply(changes, "Nothing to give."),
  notice: (message, action) => notice(message, false, action),
  goToLine: (number) => {
    const line = view.state.doc.line(Math.max(1, Math.min(number, view.state.doc.lines)));
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  },
  name: () => file.name,
  story: () => current(),
  selection: () => ({ from: view.state.selection.main.from, to: view.state.selection.main.to }),
};

// Opened by `vxd connect`: the key to the helper on this computer, kept, and taken out of the address.
{
  const pairing = pairingIn(location.hash);
  if (pairing) {
    keepPairing(pairing);
    window.history.replaceState(null, "", location.href.split("#")[0]);
    // Once the page has settled, unless something else is being said by then.
    setTimeout(() => {
      if ($("#notice").hidden)
        notice(
          "Connected to this computer: Edit › Name the speakers with AI…, and File › Make an audiobook…",
        );
    }, 1200);
  }
}

// Every dialog closes by Escape and its × (a question's as Cancel), and, where that loses nothing,
// a click outside it: a question waits for its answer; Story details and Page settings keep what
// is being typed; naming the speakers isn't stopped by a click beside it.
for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog")) addCloseButton(dialog);
for (const id of [
  "shortcuts",
  "outline",
  "list-dialog",
  "compare",
  "export",
  "about",
  "shape",
  "board",
  "goal-panel",
])
  closeOnClickOutside($<HTMLDialogElement>(`#${id}`));
closeOnClickOutside($<HTMLDialogElement>("#ai"), () => !$<HTMLButtonElement>("#ai-go").disabled);

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
