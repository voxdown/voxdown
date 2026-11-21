import "./composer.css";
import { isolateHistory, redo, redoDepth, selectAll, undo, undoDepth } from "@codemirror/commands";
import { EditorSelection, type EditorState, Prec, type TransactionSpec } from "@codemirror/state";
import { EditorView, type KeyBinding, type ViewUpdate, runScopeHandlers } from "@codemirror/view";
import { frac, lineKind, parseKey } from "./abc";
import { barAt as barInText, checkBars, describeBar, tuneMeter } from "./barcheck";
import {
  type Change,
  type Range,
  barLine,
  decorate,
  decorationMark,
  duplicate,
  eventsIn,
  markSelection,
  newTuneTemplate,
  removeDots,
  scaleLengths,
  toggleSlur,
  toggleTies,
  transpose,
} from "./commands";
import { humanDate } from "./dates";
import { createDialog, lazyDialog } from "./dialog";
import {
  brokenGapsField,
  editorExtras,
  editorState,
  fileIndexField,
  loadEditorExtras,
  onFieldError,
  onIssueGutter,
  rememberGaps,
  setMarks,
} from "./editor";
import { EXAMPLES, NEW_TUNE } from "./examples";
import { describeKey, describeMeter, explainAt } from "./explain";
import { barIsFull, nearestOctave } from "./helpers";
import { INSTRUMENTS, type InstrumentId, isInstrument } from "./instruments";
import { LocalFiles, download } from "./local-file";
import { checkLyrics } from "./lyriccheck";
import {
  type MenuItem,
  isApple,
  mountMenus,
  popupMenu,
  shortcutAria,
  shortcutLabel,
} from "./menus";
import { applyPassDynamics, passMarks } from "./passes";
import { plainMessage } from "./plain";
import { Player } from "./player";
import { checkSlurs, plainWarnings } from "./problems";
import { roving } from "./roving";
import {
  type Attachment,
  type Breaks,
  type Placed,
  type Region,
  type ScoreIndex,
  type ScoreNote,
  type ScorePoint,
  attachments,
  authorBarsPerLine,
  caretNotesAt,
  dragRegion,
  drawPassDynamics,
  firstBarPickup,
  loadAbcjs,
  loadedAbcjs,
  loadedPlayOrder,
  measure,
  noteAtTime,
  noteUnder,
  notesAt,
  notesInRanges,
  prepareTune,
  reachAt,
  regionOfRanges,
  regionRanges,
  renderTune,
  scoreFormat,
  spanLoneNotes,
  spanRegion,
  tuneSource,
} from "./score";
import { isMidiFile, isScoreFile } from "./score-files";
import { type SourceFile, abcName, encodeText, newSource, readBytes, readText } from "./source";
import {
  claimDraft,
  deleteDraft,
  forgetFile,
  getDraft,
  hashBytes,
  keepDraft,
  listDrafts,
  newDraftId,
  recentFiles,
  rememberFile,
  sessionDraftId,
  setSessionDraftId,
} from "./storage";
import {
  type Timeline,
  barAt,
  buildTimeline,
  firstPlayOf,
  regionTimeline,
  soundingAt,
} from "./timeline";
import {
  type FileIndex,
  type Orphan,
  type TuneInfo,
  nextTuneNumber,
  tuneAt,
  tuneLabel,
} from "./tunes";
import { tuneItems } from "./walk";

/* biome-ignore lint/suspicious/noExplicitAny: abcjs objects. */
type Any = any;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const body = document.body;
const workspace = $("workspace");
const scoreScroll = $("score-scroll");
const scoreElement = $("score");
const stage = $("score-stage");
const bandsLayer = $("score-bands");
const transportElement = $("transport");
const nameInput = $<HTMLInputElement>("name");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const phone = window.matchMedia("(max-width: 760px)");
/** Tablets and phones: Voices opens from the Sound sheet, so the transport keeps its labels. */
const compactTransport = window.matchMedia("(max-width: 1100px)");
/** Touch screens get touch words, not keyboard shortcuts. */
const touch = window.matchMedia("(pointer: coarse)");

/* Preferences. */
type Prefs = {
  layout: "auto" | "beside" | "below";
  rail: boolean;
  /** Set once the writer opens or closes the rail; until then it follows the width. */
  railChosen?: boolean;
  hear: boolean;
  instrument: InstrumentId;
  volume: number;
  reverb: number;
  humanise: boolean;
  metronome: boolean;
  countIn: boolean;
  scoreShare: number;
  textShare: number;
  look: string;
  /** Whether Focus keeps the score beside the text. */
  focusScore: boolean;
  /** Typing helpers, off unless chosen in Edit › Typing helpers. */
  barOnSpace: boolean;
  autoOctave: boolean;
  /** Zoom per pane: the score 0.5–2, the text 0.8–1.6. */
  scoreZoom: number;
  editorZoom: number;
  /** Playback follows D.C., D.S., Fine and Coda (off: the music as written, for practice). */
  followJumps: boolean;
  /** On a phone, the status line's explanations folded away for room to edit. */
  explainHidden: boolean;
};
const PREFS_KEY = "vxd-composer-prefs";
const prefs: Prefs = (() => {
  const defaults: Prefs = {
    layout: "auto",
    rail: true,
    hear: true,
    instrument: "piano",
    volume: 0.8,
    reverb: 0.35,
    humanise: false,
    metronome: false,
    countIn: false,
    scoreShare: 52,
    textShare: 42,
    look: "auto",
    focusScore: true,
    barOnSpace: false,
    autoOctave: false,
    scoreZoom: 1,
    editorZoom: 1,
    followJumps: true,
    explainHidden: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    const merged = { ...defaults, ...saved } as Prefs;
    if (!isInstrument(merged.instrument)) merged.instrument = "piano";
    merged.look = localStorage.getItem("vxd-composer-look") ?? "auto";
    return merged;
  } catch {
    return defaults;
  }
})();
function savePrefs() {
  try {
    const { look: _look, ...rest } = prefs;
    localStorage.setItem(PREFS_KEY, JSON.stringify(rest));
  } catch {
    /* Private windows may refuse: preferences hold for this visit. */
  }
}

/* Notices: they sit above the transport, clear of the text and the score's title. Information
   fades after a few seconds or with the next edit; errors that need action stay until dismissed. */
const noticeElement = $("notice");
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let noticeTone: "info" | "success" | "error" = "info";
/** Until then, edits leave the current notice in place (a hint about the edit just made). */
let noticeHoldsUntil = 0;
function notice(
  message: string,
  tone: "info" | "success" | "error" = "info",
  options: { holdThroughEdits?: number } = {},
) {
  clearTimeout(noticeTimer);
  noticeHoldsUntil = message ? performance.now() + (options.holdThroughEdits ?? 0) : 0;
  if (!message) {
    if (noticeElement.hidden) return;
    noticeElement.classList.add("leaving");
    noticeTimer = setTimeout(
      () => {
        noticeElement.hidden = true;
        noticeElement.classList.remove("leaving");
        noticeElement.replaceChildren();
      },
      reducedMotion.matches ? 0 : 160,
    );
    return;
  }
  noticeElement.classList.remove("leaving");
  noticeElement.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "notice-close";
  close.textContent = "Dismiss";
  close.addEventListener("click", () => notice(""));
  noticeElement.append(text, close);
  noticeTone = tone;
  noticeElement.dataset.tone = tone;
  noticeElement.setAttribute("role", tone === "error" ? "alert" : "status");
  // Above the transport and footer, wherever they are.
  const app = $("app");
  noticeElement.style.bottom = `${app.clientHeight - transportElement.offsetTop + 10}px`;
  noticeElement.hidden = false;
  if (tone !== "error") noticeTimer = setTimeout(() => notice(""), 6000);
}
const noticeError = (message: string) => notice(message, "error");
/** The next edit clears information (errors stay). */
function noticeOnEdit() {
  if (performance.now() < noticeHoldsUntil) return;
  if (!noticeElement.hidden && noticeTone !== "error") notice("");
}

/* The document. */
let source: SourceFile = newSource("");
let draftId = newDraftId();
let savedText: string | null = null;
let started = false;
const local = new LocalFiles();
const player = new Player(document.baseURI);
player.instrument = prefs.instrument;
player.volume = prefs.volume;
player.reverb = prefs.reverb;
player.humanise = prefs.humanise;
player.metronome = prefs.metronome;
player.countIn = prefs.countIn;

/**
 * Said once in this browser, the first time Tab indents: how to leave the text by keyboard. It
 * shows after the indent is made, stays through typing for a few seconds, and only counts as said
 * once it has been on screen.
 */
let tabHintSaid = false;
function tabHint() {
  try {
    if (tabHintSaid || localStorage.getItem("vxd-composer-tab-hint")) return;
  } catch {
    if (tabHintSaid) return;
  }
  tabHintSaid = true;
  setTimeout(() => {
    notice("Tab indents in the text. To leave it by keyboard, press Escape, then Tab.", "info", {
      holdThroughEdits: 6000,
    });
    requestAnimationFrame(() => {
      if (noticeElement.hidden) return;
      try {
        localStorage.setItem("vxd-composer-tab-hint", "1");
      } catch {
        /* Without storage it is said once per visit. */
      }
    });
  }, 0);
}
/* Edit › Cut, Copy and Paste work on the text, and on a score region through its text ranges
   (several voices copy under their V: lines, as with the keys). */
const hasSelection = () => view.state.selection.ranges.some((range) => !range.empty);
function clipboard(kind: "cut" | "copy") {
  view.focus();
  // The editor's own copy and cut handlers run, so voices keep their V: lines.
  if (!document.execCommand(kind))
    notice(`Use ${shortcutLabel(kind === "cut" ? "Mod X" : "Mod C")} to ${kind} in this browser.`);
}
async function pasteText() {
  view.focus();
  try {
    const pasted = await navigator.clipboard.readText();
    view.dispatch(view.state.replaceSelection(pasted), {
      scrollIntoView: true,
      userEvent: "input.paste",
    });
  } catch {
    notice(
      `This browser lets the page paste only from the keyboard: use ${shortcutLabel("Mod V")}.`,
    );
  }
}

/*
 * Zoom, per pane: the score re-wraps to its width at the new size (keeping the reader's place),
 * the text grows or shrinks. Ctrl/⌘ + − 0 act on the pane with focus, or under the pointer;
 * elsewhere they are left to the browser's own page zoom.
 */
const ZOOMS = {
  score: [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2],
  editor: [0.8, 0.9, 1, 1.1, 1.2, 1.4, 1.6],
} as const;
type Pane = "score" | "editor";
let pointerPane: Pane | null = null;
let lastPane: Pane | null = null;
function paneOf(element: Element | null): Pane | null {
  if (!element) return null;
  if (element.closest("#score-panel")) return "score";
  if (element.closest("#writing")) return "editor";
  return null;
}
for (const [id, pane] of [
  ["score-panel", "score"],
  ["writing", "editor"],
] as const) {
  $(id).addEventListener("pointerenter", () => {
    pointerPane = pane;
  });
  $(id).addEventListener("pointerleave", () => {
    if (pointerPane === pane) pointerPane = null;
  });
  $(id).addEventListener("focusin", () => {
    lastPane = pane;
  });
}
/** The pane a zoom key means: the focused one, else the one under the pointer. */
function zoomPane(): Pane | null {
  return paneOf(document.activeElement) ?? pointerPane;
}
function applyEditorZoom() {
  $("editor").style.setProperty("--editor-zoom", String(prefs.editorZoom));
  view.requestMeasure();
}
/** Each pane's badge fades on its own clock, so switching panes never leaves one stuck. */
const zoomBadgeTimers = new Map<Pane, ReturnType<typeof setTimeout>>();
function setZoom(pane: Pane, value: number) {
  const steps = ZOOMS[pane];
  const level = Math.max(steps[0], Math.min(steps[steps.length - 1] as number, value));
  if (pane === "score") {
    if (level === prefs.scoreZoom) return showZoom(pane);
    prefs.scoreZoom = level;
    scheduleRender(0);
  } else {
    if (level === prefs.editorZoom) return showZoom(pane);
    prefs.editorZoom = level;
    applyEditorZoom();
  }
  savePrefs();
  showZoom(pane);
}
/** The next step in or out from the current level. */
function stepZoom(pane: Pane, direction: 1 | -1 | 0) {
  const steps = ZOOMS[pane] as readonly number[];
  const now = pane === "score" ? prefs.scoreZoom : prefs.editorZoom;
  if (direction === 0) return setZoom(pane, 1);
  const next =
    direction > 0
      ? steps.find((step) => step > now + 1e-6)
      : [...steps].reverse().find((step) => step < now - 1e-6);
  setZoom(pane, next ?? now);
}
/** The level, shown briefly in the pane. */
function showZoom(pane: Pane) {
  const badge = $(pane === "score" ? "score-zoom" : "editor-zoom");
  const level = pane === "score" ? prefs.scoreZoom : prefs.editorZoom;
  badge.textContent = `${pane === "score" ? "Score" : "Text"} ${Math.round(level * 100)}%`;
  badge.hidden = false;
  badge.classList.add("shown");
  clearTimeout(zoomBadgeTimers.get(pane));
  zoomBadgeTimers.set(
    pane,
    setTimeout(() => badge.classList.remove("shown"), 1100),
  );
}
// Ctrl/⌘ wheel and a pinch on the score zoom it.
{
  let wheel = 0;
  scoreScroll.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      wheel += event.deltaY;
      if (Math.abs(wheel) < 40) return;
      stepZoom("score", wheel < 0 ? 1 : -1);
      wheel = 0;
    },
    { passive: false },
  );
  const touches = new Map<number, { x: number; y: number }>();
  let pinchBase = 0;
  const distance = () => {
    const [a, b] = [...touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  scoreScroll.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) {
      // A second finger: a pinch, not a drag.
      drag = null;
      pinchBase = distance();
    }
  });
  scoreScroll.addEventListener("pointermove", (event) => {
    if (!touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size !== 2 || !pinchBase) return;
    const ratio = distance() / pinchBase;
    if (ratio > 1.18 || ratio < 0.85) {
      stepZoom("score", ratio > 1 ? 1 : -1);
      pinchBase = distance();
    }
  });
  const lift = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    if (touches.size < 2) pinchBase = 0;
  };
  scoreScroll.addEventListener("pointerup", lift);
  scoreScroll.addEventListener("pointercancel", lift);
}

/* Find melody (./melody-ui): typed, selected, or played on a MIDI keyboard. */
let melodyPanel: typeof import("./melody-ui") | null = null;
function findMelody(): boolean {
  const fromSelection = view.state.selection.ranges.some((range) => !range.empty);
  void import("./melody-ui").then((module) => {
    melodyPanel = module;
    return module.openMelody(
      {
        view,
        file: fileIndex,
        draftId: () => draftId,
        openDraft: (id, ranges) =>
          void recoverDraft(id).then(() =>
            view.dispatch({
              selection: EditorSelection.create(
                ranges.map((range) => EditorSelection.range(range.from, range.to)),
              ),
              scrollIntoView: true,
            }),
          ),
        keyboard: midiKeyboard,
        reveal: () => {
          const lit = scoreElement.querySelector(".is-selected");
          if (lit) keepInView(lit, true);
        },
      },
      fromSelection,
    );
  });
  return true;
}
/* Play › MIDI keyboard… (./midi-input): audition and step entry on Web MIDI. */
const keyboardContext = () => ({
  view,
  audition: (pitches: number[], velocity: number) => player.audition(pitches, velocity, 0.8),
  status: (message: string) => {
    $("explain").textContent = message;
  },
});
function openMidiKeyboard() {
  void import("./midi-input").then((module) => module.openKeyboard(keyboardContext()));
}
/** The MIDI keyboard, when there is one, for melody search to listen to. */
const midiKeyboard = () =>
  import("./midi-input").then((module) => module.keyboardForMelody(keyboardContext()));

/** Find and replace, loading it first if this is the first time. */
function openFind(): boolean {
  void loadEditorExtras(view).then((extras) => extras.openSearchPanel(view));
  return true;
}
const keys: KeyBinding[] = [
  { key: "Mod-f", run: openFind, preventDefault: true },
  { key: "Mod-Shift-m", run: findMelody, preventDefault: true },
  // F3 steps through melody matches while they are listed; else it is the search's.
  { key: "F3", run: () => melodyPanel?.stepMelody(1) ?? false },
  { key: "Shift-F3", run: () => melodyPanel?.stepMelody(-1) ?? false },
  {
    key: "Tab",
    run: () => {
      tabHint();
      return false;
    },
  },
  {
    key: "Mod-Enter",
    run: () => {
      void togglePlay();
      return true;
    },
    preventDefault: true,
  },
  {
    key: "Mod-Shift-Enter",
    run: () => {
      void playFromCaret();
      return true;
    },
    preventDefault: true,
  },
  {
    key: "Mod-Alt-Enter",
    run: () => {
      void playSelection(false);
      return true;
    },
    preventDefault: true,
  },
  {
    key: "Mod-Shift-l",
    run: () => {
      toggleLoop();
      return true;
    },
    preventDefault: true,
  },
  {
    key: "Mod-.",
    run: () => {
      stop();
      return true;
    },
    preventDefault: true,
  },
  { key: "Alt-ArrowUp", run: () => music("transpose-up") },
  { key: "Alt-ArrowDown", run: () => music("transpose-down") },
  { key: "Alt-Shift-ArrowUp", run: () => music("octave-up") },
  { key: "Alt-Shift-ArrowDown", run: () => music("octave-down") },
  { key: "Alt-[", run: () => music("halve") },
  { key: "Alt-]", run: () => music("double") },
  { key: "Alt-.", run: () => music("dot") },
  { key: "Alt-,", run: () => music("undot") },
  { key: "Alt-t", run: () => music("tie") },
  { key: "Alt-s", run: () => music("slur") },
  { key: "Alt-d", run: () => music("decoration") },
  {
    key: "Alt-n",
    run: () => {
      sayNote();
      return true;
    },
  },
  { key: "Alt-ArrowRight", run: () => moveByNote(1, false) },
  { key: "Alt-ArrowLeft", run: () => moveByNote(-1, false) },
  { key: "Alt-Shift-ArrowRight", run: () => moveByNote(1, true) },
  { key: "Alt-Shift-ArrowLeft", run: () => moveByNote(-1, true) },
  { key: "Mod-Shift-d", run: () => music("duplicate"), preventDefault: true },
  { key: "F8", run: () => stepProblem(1), preventDefault: true },
  { key: "Shift-F8", run: () => stepProblem(-1), preventDefault: true },
  {
    key: "Escape",
    run: (target) => {
      if (player.status === "playing") {
        stop();
        return true;
      }
      // Focus leaves first; an open completion or search keeps its own Escape.
      if (
        body.classList.contains("focus-mode") &&
        !editorExtras()?.completionStatus(target.state) &&
        !editorExtras()?.searchPanelOpen(target.state)
      ) {
        setFocusMode(false);
        return true;
      }
      return false;
    },
  },
];

const copyVoices = EditorView.domEventHandlers({
  copy(event, view) {
    const text = voicedCopy(view.state);
    if (!text || !event.clipboardData) return false;
    event.clipboardData.setData("text/plain", text.text);
    event.preventDefault();
    notice(`Copied ${text.voices} voices, each with its V: line.`, "success");
    return true;
  },
  cut(event, view) {
    const text = voicedCopy(view.state);
    if (!text || !event.clipboardData) return false;
    event.clipboardData.setData("text/plain", text.text);
    event.preventDefault();
    view.dispatch({
      changes: view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })),
      userEvent: "delete.cut",
    });
    notice(`Cut ${text.voices} voices, each copied with its V: line.`, "success");
    return true;
  },
});

/*
 * Typing ".", "~" or "(" over selected music marks the notes instead of replacing them, the way an
 * editor wraps a selection in brackets: staccato, roll, or a slur, and again to remove. Anything
 * that is not music (headers, lyrics, comments, free text, or a mix) is typed as usual, and so is
 * text being composed with an input method.
 */
const MARK_NAMES = {
  staccato: "Staccato",
  roll: "Roll",
  slur: "Slur",
  "dotted-short": "Dotted-then-short",
  "short-dotted": "Short-then-dotted",
} as const;
/** A status message kept while the selection it describes stays as it is. */
let statusNote: { message: string; selection: EditorSelection } | null = null;
function sayAboutSelection(message: string) {
  statusNote = { message, selection: view.state.selection };
  $("explain").textContent = message;
}
const typedMarks = Prec.highest(
  EditorView.inputHandler.of((target, _from, _to, typed) => {
    if (target.composing || target.compositionStarted) return false;
    return typeMark(target, typed);
  }),
);
/*
 * Typing helpers (Edit › Typing helpers, off by default). Each writes what was typed first, then
 * its change as a separate undo step, so undo goes back to exactly what was typed.
 */
let lastOctave: { at: number; typed: string; written: string } | null = null;
function helperOnce(key: string, message: string) {
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    /* Without storage it may be said again next visit. */
  }
  notice(message, "info", { holdThroughEdits: 6000 });
}
const typingHelpers = Prec.highest(
  EditorView.inputHandler.of((target, from, to, typed) => {
    if (target.composing || target.compositionStarted) return false;
    const state = target.state;
    if (state.selection.ranges.length !== 1 || from !== to || !state.selection.main.empty)
      return false;
    const doc = state.doc.toString();
    const file = state.field(fileIndexField);
    // A field name typed at the start of a line ("C:") keeps the letter as it was typed.
    if (typed === ":" && lastOctave && lastOctave.at + lastOctave.written.length === from) {
      const line = state.doc.lineAt(lastOctave.at);
      if (line.from === lastOctave.at) {
        target.dispatch({
          changes: { from: lastOctave.at, to: from, insert: `${lastOctave.typed}:` },
          selection: { anchor: lastOctave.at + 2 },
          userEvent: "input.type",
        });
        lastOctave = null;
        return true;
      }
    }
    lastOctave = null;
    if (typed === " " && prefs.barOnSpace && barIsFull(doc, from, file)) {
      target.dispatch({
        changes: { from, insert: " " },
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
      target.dispatch({
        changes: { from: from + 1, insert: "| " },
        selection: { anchor: from + 3 },
        userEvent: "input.helper",
        annotations: isolateHistory.of("full"),
      });
      helperOnce(
        "vxd-composer-helper-bar",
        `The bar was full, so Space wrote a bar line. Undo (${shortcutLabel("Mod Z")}) takes it back; Edit › Typing helpers turns this off.`,
      );
      return true;
    }
    if (prefs.autoOctave && /^[A-Ga-g]$/.test(typed)) {
      const written = nearestOctave(doc, from, typed, file);
      if (!written || written === typed) return false;
      target.dispatch({
        changes: { from, insert: typed },
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
      target.dispatch({
        changes: { from, to: from + 1, insert: written },
        selection: { anchor: from + written.length },
        userEvent: "input.helper",
        annotations: isolateHistory.of("full"),
      });
      lastOctave = { at: from, typed, written };
      helperOnce(
        "vxd-composer-helper-octave",
        `${typed} became ${written}, the octave nearest the note before, whatever the case you type. Type ' or , after a note to move it an octave. Undo keeps what you typed; Edit › Typing helpers turns this off.`,
      );
      return true;
    }
    return false;
  }),
);
function setHelper(key: "barOnSpace" | "autoOctave", on: boolean) {
  prefs[key] = on;
  savePrefs();
  notice(
    `${key === "barOnSpace" ? "Bar line on Space when the bar is full" : "Automatic octave"}: ${on ? "on" : "off"}.`,
    "success",
  );
}

/** A mark typed over selected music, from the text or the score; false when it is just typing. */
function typeMark(target: EditorView, typed: string): boolean {
  const state = target.state;
  const ranges = state.selection.ranges.map((range) => ({ from: range.from, to: range.to }));
  const gaps = state.field(brokenGapsField);
  const result = markSelection(
    state.doc.toString(),
    ranges,
    typed,
    state.field(fileIndexField),
    (position) => gaps.find((entry) => entry.pos === position)?.gap,
  );
  if (!result) return false;
  const broken = result.mark === "dotted-short" || result.mark === "short-dotted";
  if (!result.changes.length) {
    // Music is never typed over with a mark: say why nothing changed instead.
    sayAboutSelection(
      result.reason ??
        (broken
          ? "Broken rhythm needs two notes side by side in a bar: select a pair or more."
          : `Nothing to mark here: select notes for the ${MARK_NAMES[result.mark].toLowerCase()}.`),
    );
    return true;
  }
  const changes = state.changes(result.changes);
  // Marks put at a range's edge join it, so the selection stays on the same notes, marks and all.
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) =>
      EditorSelection.range(changes.mapPos(range.from, -1), changes.mapPos(range.to, 1)),
    ),
    state.selection.mainIndex,
  );
  target.dispatch({
    changes,
    selection,
    userEvent: "input.mark",
    scrollIntoView: true,
    effects: rememberGaps.of(
      (result.gaps ?? []).map((entry) => ({ pos: changes.mapPos(entry.from, -1), gap: entry.gap })),
    ),
  });
  const count = broken
    ? `${result.count} ${result.count === 1 ? "pair" : "pairs"}`
    : `${result.count} ${result.count === 1 ? "note" : "notes"}`;
  const name = MARK_NAMES[result.mark];
  sayAboutSelection(
    result.removed
      ? `${name} removed from ${count}`
      : `${name} ${result.mark === "slur" ? "over" : "on"} ${count} · type ${typed} again to remove`,
  );
  return true;
}

const view = new EditorView({
  parent: $("editor"),
  state: makeState(""),
});
applyEditorZoom();
// Completion and Find join as soon as the text is used: its first focus, or a first key press.
{
  const load = () => void loadEditorExtras(view);
  view.contentDOM.addEventListener("focus", load, { once: true });
  document.addEventListener("keydown", load, { once: true });
}
function makeState(text: string): EditorState {
  return editorState(text, {
    onUpdate: safeUpdate,
    keys,
    extra: [
      copyVoices,
      typedMarks,
      typingHelpers,
      EditorView.exceptionSink.of((error) => recoverEditor(error)),
    ],
  });
}

function text(): string {
  return view.state.doc.toString();
}
function fileIndex(): FileIndex {
  return view.state.field(fileIndexField);
}
function caret(): number {
  return view.state.selection.main.head;
}
function ranges(): Range[] {
  return view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }));
}
function dirty(): boolean {
  return savedText === null
    ? text().length > 0 && text() !== source.normalized
    : text() !== savedText;
}

/** Copies several voices' spans each under its V: line, so they paste as voices. */
function voicedCopy(state: EditorState): { text: string; voices: number } | null {
  const selection = state.selection.ranges.filter((range) => !range.empty);
  if (selection.length < 2) return null;
  const doc = state.doc.toString();
  const voiceOf = (position: number) => {
    const before = doc.slice(0, position);
    const lines = [...before.matchAll(/^V:\s*(\S+)|\[V:\s*([^\]\s]+)/gm)];
    const last = lines[lines.length - 1];
    return last ? (last[1] ?? last[2] ?? "") : "";
  };
  const parts = selection.map((range) => ({
    voice: voiceOf(range.from),
    text: doc.slice(range.from, range.to),
  }));
  if (new Set(parts.map((part) => part.voice)).size < 2) return null;
  return {
    text: `${parts.map((part) => `V:${part.voice}\n${part.text}`).join("\n")}\n`,
    voices: parts.length,
  };
}

/* Replacing the document: each one gets its own draft and its own undo history. */
function load(
  next: SourceFile,
  name: string,
  options: { keepDraft?: boolean; caretAt?: number; text?: string } = {},
) {
  // The tune being replaced keeps its own draft, written now rather than after a delay.
  if (started && !options.keepDraft) flushDraft();
  player.stop();
  if (!options.keepDraft) {
    link = null;
    pendingLink = null;
  }
  source = next;
  const content = options.text ?? next.normalized;
  savedText = content === next.normalized ? content : null;
  if (!options.keepDraft) {
    draftId = newDraftId();
    setSessionDraftId(draftId);
    void claimDraft(draftId);
  }
  nameInput.value = name;
  nameFollowsTitle = false;
  view.setState(makeState(content));
  scoreIndex = null;
  timeline = null;
  renderedKey = "";
  tempoOverride = null;
  showStart(false);
  const at = options.caretAt ?? firstMusicPosition();
  view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  // A page arriving restores its draft without taking focus; opening something does.
  if (!phone.matches && !options.keepDraft) view.focus();
  updateAll(true);
  updateSavedState();
}

/** The start of the first line of music, past %%MIDI, V: and P: lines. */
function firstMusicPosition(): number {
  const tune = fileIndex().tunes[0];
  if (!tune) return view.state.doc.length;
  const doc = text();
  let at = tune.bodyFrom;
  for (const line of doc.slice(tune.bodyFrom, tune.to).split("\n")) {
    if (lineKind(line, true) === "music") return at;
    at += line.length + 1;
  }
  return Math.min(tune.bodyFrom, view.state.doc.length);
}

const rovers: { refresh: () => void }[] = [];
function showStart(show: boolean) {
  $("start").hidden = !show;
  started = !show;
  // Nothing to edit or play yet: the toolbar and transport rest instead of answering with notices.
  body.classList.toggle("starting", show);
  // The editor's monospaced font loads once there is something to edit.
  if (!show) body.classList.add("editing");
  for (const element of [document.querySelector(".documentbar"), $("transport")])
    element?.toggleAttribute("inert", show);
  // Under the start screen the text, the score and the tunes panel are out of reach: Tab can't
  // land in an editor no one can see, and screen readers skip them.
  for (const id of ["writing", "rail", "splitter", "score-panel"]) {
    const element = document.getElementById(id);
    element?.toggleAttribute("inert", show);
    if (show) element?.setAttribute("aria-hidden", "true");
    else element?.removeAttribute("aria-hidden");
  }
  for (const rover of rovers) rover.refresh();
  updateSavedState();
  if (show) void fillRecentStart();
}

/* The file this draft belongs to, kept across reloads: Save asks permission again and checks it
   was not changed elsewhere before writing. */
let link: { fileId: string; name: string; hash: string } | null = null;
let pendingLink: { handle: FileSystemFileHandle; name: string; hash: string } | null = null;
async function keepLink(bytes: Uint8Array) {
  const handle = local.current as unknown as FileSystemFileHandle | null;
  if (!handle) return;
  try {
    link = {
      fileId: await rememberFile(handle.name, handle),
      name: handle.name,
      hash: await hashBytes(bytes),
    };
    pendingLink = null;
    schedulePersist();
  } catch {
    /* Without storage the link lasts this visit. */
  }
}

/* Updates from the editor. */
let renderTimer: ReturnType<typeof setTimeout> | undefined;
let checkTimer: ReturnType<typeof setTimeout> | undefined;
let explainTimer: ReturnType<typeof setTimeout> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let lastTyped = 0;
/** Whether a new tune's file name still follows its title (see startNewTune). */
let nameFollowsTitle = false;
/** Where the last edit ended, in the current text (kept mapped through later edits). */
let lastEdit = -1;
let lastHeard = "";

/**
 * The safety net: the text on screen and the kept draft must never disagree silently. Our own
 * update work never throws into the editor; if the editor itself fails, the screen is redrawn from
 * the editor's document (what is saved), the draft is kept at once, and an error says so.
 */
function safeUpdate(update: ViewUpdate) {
  try {
    onUpdate(update);
  } catch (error) {
    console.warn("Composer: an update step failed.", error);
  }
}
let recovering = false;
function recoverEditor(error: unknown) {
  if (recovering) return;
  recovering = true;
  console.warn("Composer: the editor failed; showing and keeping its document.", error);
  setTimeout(() => {
    try {
      // Same state object: the document and undo history stay; the screen is redrawn from them.
      view.setState(view.state);
    } catch {
      /* Nothing more can be done here; the draft below is still kept. */
    }
    void persist();
    noticeError(
      "Something went wrong in the editor. The text shown is exactly what is kept now; check your last few keystrokes.",
    );
    recovering = false;
  }, 0);
}
onFieldError((error) => {
  console.warn("Composer: marks in the text were reset.", error);
});
window.addEventListener("error", (event) => {
  // An error from inside the editor's input handling can leave typed text unsaved: resync.
  if (/codemirror|changeset|out of range/i.test(`${event.message} ${event.error?.stack ?? ""}`))
    recoverEditor(event.error);
});

function onUpdate(update: ViewUpdate) {
  if (update.docChanged) {
    lastTyped = performance.now();
    let edited = -1;
    update.changes.iterChangedRanges((_fromA, _toA, _fromB, toB) => {
      edited = Math.max(edited, toB);
    });
    lastEdit = edited;
    followTitle();
    noticeOnEdit();
    if (started) schedulePersist();
    scheduleRender();
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => runChecks(), 750);
    updateRail();
    updateSavedState();
  }
  if (update.docChanged || update.selectionSet) {
    $<HTMLButtonElement>("undo").disabled = undoDepth(update.state) === 0;
    $<HTMLButtonElement>("redo").disabled = redoDepth(update.state) === 0;
    const line = update.state.doc.lineAt(caret());
    $("position").textContent = `Line ${line.number}, column ${caret() - line.from + 1}`;
    clearTimeout(explainTimer);
    explainTimer = setTimeout(() => explainCaret(update), 40);
    if (!update.docChanged && skippedBar) {
      const head = update.state.selection.main.head;
      if (head < skippedBar.from || head > skippedBar.to) {
        clearTimeout(checkTimer);
        checkTimer = setTimeout(() => runChecks(true), 0);
      }
    }
    if (!update.docChanged) {
      // Moving into another tune draws that tune.
      const tune = tuneAt(fileIndex(), caret());
      if (tune && scoreIndex && tune.from !== scoreIndex.tune.from) scheduleRender(0);
      linkFromText();
      updateRail();
    }
  }
}

function explainCaret(update: ViewUpdate) {
  const position = caret();
  const explanation = view.state.selection.main.empty
    ? explainAt(text(), fileIndex(), position)
    : null;
  const status = $("explain");
  status.replaceChildren();
  // What a typed mark just did stays said while its selection does.
  if (statusNote?.selection.eq(view.state.selection)) {
    status.textContent = statusNote.message;
    return;
  }
  statusNote = null;
  if (!view.state.selection.main.empty) {
    // Counted from the text itself, so it is right even before the score is redrawn.
    const count = eventsIn(text(), ranges(), fileIndex()).filter(
      (event) => !event.rest && event.to > event.from,
    ).length;
    const where = selectionWhere();
    if (count === 0) {
      // Header or lyric text: no music to play, so no play hint.
      const characters = view.state.selection.ranges.reduce(
        (sum, range) => sum + range.to - range.from,
        0,
      );
      status.textContent = `${characters} ${characters === 1 ? "character" : "characters"} selected`;
      return;
    }
    status.textContent = `${count} ${count === 1 ? "note" : "notes"} selected${where} · ${touch.matches ? "Tap More › Play selection to hear it" : `${shortcutLabel("Mod Alt Enter")} plays it`}`;
    return;
  }
  // Music a blank line left outside its tune says so wherever the caret is in it.
  const orphan = fileIndex().orphans.find((each) => position >= each.from && position <= each.to);
  if (orphan) {
    status.textContent = orphanMessage(orphan);
    return;
  }
  if (!explanation) {
    status.textContent = barStatus(position) ?? "Ready";
    return;
  }
  if (explanation.token) {
    const token = document.createElement("strong");
    token.textContent = explanation.token;
    status.append(token, ` — ${explanation.text}`);
  } else status.textContent = explanation.text;
  // Hear as you write: a note sounds when the caret lands on it or it is typed.
  const userMoved =
    update.transactions.some(
      (transaction) =>
        transaction.isUserEvent("input") ||
        transaction.isUserEvent("select") ||
        transaction.isUserEvent("delete"),
    ) || update.selectionSet;
  if (
    prefs.hear &&
    explanation.midi?.length &&
    userMoved &&
    view.hasFocus &&
    player.status !== "playing"
  ) {
    const key = `${position}:${explanation.token}:${explanation.midi.join(",")}`;
    if (key !== lastHeard) {
      lastHeard = key;
      player.audition(explanation.midi);
    }
  } else if (!explanation.midi) lastHeard = "";
}

/** "Bar 4 · 6 of 6 eighths" for a caret in music that is on no note (a line end, after a bar line). */
function barStatus(position: number): string | null {
  const index = fileIndex();
  const tune = tuneAt(index, position);
  if (!tune || position < tune.bodyFrom) return null;
  const line = view.state.doc.lineAt(position);
  if (lineKind(line.text, true) !== "music") return null;
  const info = barInText(tuneItems(text(), tune, index), position);
  return info ? describeBar(info) : null;
}

/* Rendering the score. */
let scoreIndex: ScoreIndex | null = null;
let timeline: Timeline | null = null;
let renderGeneration = 0;
let renderedKey = "";
let rendering = false;
let geometry: ReturnType<typeof measure> | null = null;
let renderCost = 0;
let breaks: Breaks | null = null;

function scheduleRender(delay?: number) {
  clearTimeout(renderTimer);
  const tune = tuneAt(fileIndex(), caret());
  const size = tune ? tune.to - tune.from : 0;
  // Longer tunes wait for a pause in typing; short ones redraw almost at once.
  const wait = delay ?? Math.min(650, 90 + size / 30 + renderCost * 1.5);
  renderTimer = setTimeout(() => void render(), wait);
}

function scoreWidth(): number {
  const styles = getComputedStyle(scoreScroll);
  return (
    scoreScroll.clientWidth -
    Number.parseFloat(styles.paddingLeft) -
    Number.parseFloat(styles.paddingRight)
  );
}

async function render(force = false) {
  const index = fileIndex();
  const tune = tuneAt(index, caret());
  const generation = ++renderGeneration;
  if (!tune) {
    scoreIndex = null;
    timeline = null;
    scoreElement.replaceChildren();
    bandsLayer.replaceChildren();
    $("score-empty").hidden = false;
    $("score-no-notes").hidden = true;
    $("score-summary").textContent = "No tune yet";
    player.setTimeline(null);
    drawTimeline();
    return;
  }
  $("score-empty").hidden = true;
  const doc = text();
  const width = scoreWidth();
  if (width < 50) return;
  const key = `${width}|${prefs.scoreZoom}|${tune.from}|${doc.slice(tune.from, tune.to)}|${index.header ? doc.slice(index.header.from, index.header.to) : ""}`;
  if (!force && key === renderedKey) return;
  if (rendering) {
    scheduleRender(60);
    return;
  }
  rendering = true;
  const started = performance.now();
  try {
    await document.fonts?.ready;
    // Read the reader's place while the layout is still clean (reading later forces a reflow).
    const anchor = topSystem();
    const sameTune = scoreIndex?.tune.from === tune.from;
    const result = await renderTune(
      stage,
      { text: doc, file: index, tune, width, compact: phone.matches, zoom: prefs.scoreZoom },
      workspace.dataset.layout === "below",
      sameTune ? breaks : null,
      () => authorBarsPerLine(doc, tuneItems(doc, tune, index)),
    );
    if (generation !== renderGeneration && !force) return;
    breaks = result.breaks;
    renderCost = performance.now() - started;
    // The new score goes in on the next task, so drawing and placing are two short tasks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (generation !== renderGeneration && !force) {
      stage.replaceChildren();
      return;
    }
    performance.mark("composer:swap");
    const fragment = document.createDocumentFragment();
    fragment.append(...stage.childNodes);
    scoreElement.style.minHeight = `${scoreElement.offsetHeight}px`;
    scoreElement.replaceChildren(fragment);
    scoreElement.style.minHeight = "";
    stage.replaceChildren();
    restoreSystem(anchor);
    performance.measure("composer:swap", "composer:swap");
    renderedKey = key;
    scoreIndex = result;
    // A tune with its header and no notes yet (after New tune): a quiet hint under the title.
    $("score-no-notes").hidden = result.notes.length > 0;
    geometry = null;
    attached = null;
    scoreCursor = null;
    $("score-cursor").hidden = true;
    // The lit notes and the place marker belong to the drawing just replaced: paint them again.
    litPlaying = [];
    playingKey = "~redrawn";
    updateSummary();
    // Timing and audio are built in a separate task, so the draw stays short.
    setTimeout(() => {
      if (scoreIndex !== result) return;
      buildPlayback(result);
      linkFromText();
      runChecks();
      refreshPlace();
    }, 0);
  } catch (error) {
    console.warn("Composer could not draw this tune.", error);
  } finally {
    rendering = false;
  }
}

/** Each system's top, in the score's scrolling coordinates, keyed by abcjs line number. */
function systemTops(): Map<number, number> {
  const tops = new Map<number, number>();
  const origin =
    scoreElement.getBoundingClientRect().top -
    scoreScroll.getBoundingClientRect().top +
    scoreScroll.scrollTop;
  const scoreTop = scoreElement.getBoundingClientRect().top;
  for (const mark of scoreElement.querySelectorAll<SVGGraphicsElement>(".abcjs-staff")) {
    const line = Number(/abcjs-l(\d+)/.exec(mark.getAttribute("class") ?? "")?.[1] ?? -1);
    if (line < 0) continue;
    const y = mark.getBoundingClientRect().top - scoreTop + origin;
    tops.set(line, Math.min(tops.get(line) ?? Number.POSITIVE_INFINITY, y));
  }
  return tops;
}
function topSystem(): { line: number; offset: number } | null {
  const top = scoreScroll.scrollTop;
  if (top < 4) return null;
  let best: { line: number; offset: number } | null = null;
  for (const [line, y] of systemTops())
    if (y >= top - 40 && (!best || line < best.line)) best = { line, offset: y - top };
  return best;
}
function restoreSystem(anchor: { line: number; offset: number } | null) {
  if (!anchor) return;
  // Only the anchored system is measured.
  const marks = scoreElement.querySelectorAll<SVGGraphicsElement>(
    `.abcjs-staff.abcjs-l${anchor.line}`,
  );
  if (!marks.length) return;
  const scoreTop = scoreElement.getBoundingClientRect().top;
  const origin = scoreTop - scoreScroll.getBoundingClientRect().top + scoreScroll.scrollTop;
  const y =
    Math.min(...[...marks].map((mark) => mark.getBoundingClientRect().top)) - scoreTop + origin;
  scoreScroll.scrollTop = Math.max(0, y - anchor.offset);
}

function updateSummary() {
  const index = scoreIndex;
  if (!index) return;
  const tune = index.tune;
  const parts = [tuneLabel(tune)];
  if (tune.key) parts.push(describeKey(parseKey(tune.key)).split(",")[0] as string);
  if (tune.meter) parts.push(tune.meter);
  const pickup = timeline ? timeline.pickup > 1e-6 : false;
  const bars = index.measures - (pickup ? 1 : 0);
  parts.push(`${bars} ${bars === 1 ? "bar" : "bars"}${pickup ? " and a pickup" : ""}`);
  // Music below a blank line is not drawn: say so where the bars are counted.
  const left = fileIndex().orphans.filter((orphan) => orphan.tune?.from === tune.from).length;
  if (left) parts.push("music below a blank line left out");
  if (index.voices.length > 1) parts.push(`${index.voices.length} voices`);
  // Each part stays whole when a phone wraps the line ("2 voices", never "2 voi…").
  $("score-summary").replaceChildren(
    ...parts.flatMap((part, at) => {
      const span = document.createElement("span");
      span.textContent = part;
      return at ? [" · ", span] : [span];
    }),
  );
  scoreScroll.setAttribute(
    "aria-label",
    `Score of ${parts.join(", ")}. ← and → move by note, ↑ and ↓ change voice, Home and End go along the line, Shift extends, Space plays, Enter goes to the text. ${isApple ? "⌘" : "Ctrl"} with the arrows moves a cursor without changing the selection, and ${shortcutLabel("Mod Space")} puts the note at the cursor in or out of it.`,
  );
}

/* Playback data. */
let tempoOverride: number | null = null;
let tempoTune = -1;
function buildPlayback(index: ScoreIndex) {
  const visual = index.visual;
  if (!visual) return;
  let audio: Any;
  try {
    audio = visual.setUpAudio({});
  } catch (error) {
    console.warn("Composer could not prepare playback.", error);
    return;
  }
  const byStart = new Map<number, ScoreNote>();
  for (const note of index.notes) if (!byStart.has(note.start)) byStart.set(note.start, note);
  const doc = text();
  const lookup = (start: number) => {
    let at = start;
    while (at < doc.length && /\s/.test(doc[at] as string)) at += 1;
    return byStart.get(at) ?? byStart.get(start);
  };
  // The bar and beat from the meter at the first note, as the bar check reads it: one source
  // for what a full first bar is (a subtitle line once made abcjs's own a pickup).
  const meter = tuneMeter(doc, index.tune, fileIndex());
  const barLength = meter.bar ?? (visual.getBarLength?.() || 1);
  const meta = {
    bpm: audio.tempo || visual.getBpm?.() || 120,
    beat: meter.bar ? meter.beat : visual.getBeatLength?.() || 0.25,
    bar: barLength,
    // A first bar shorter than the meter is a pickup; an overfull one is just a long bar.
    pickup: firstBarPickup(index, barLength),
    voices: index.voices.map((voice) => voice.name),
  };
  // A tempo set by hand belongs to the tune it was set for.
  if (index.tune.from !== tempoTune) {
    tempoTune = index.tune.from;
    tempoOverride = null;
  }
  // Times in the description are whole notes at the starting tempo.
  timeline = buildTimeline(audio, meta, index.toDocument, lookup);
  // abcjs plays repeats and endings; D.C., D.S., Fine and Coda are followed here.
  const order = loadedPlayOrder;
  if (order && prefs.followJumps) {
    const structure = order.structureOf(visual);
    if (order.hasJumps(structure))
      timeline = order.followOrder(timeline, structure, order.playOrder(structure));
  }
  // Dynamics written for a pass ("^2nd time p") are applied on that pass.
  const marks = passMarks(text(), index.tune, fileIndex());
  timeline = applyPassDynamics(timeline, marks.rules, marks.written);
  player.setTimeline(timeline);
  player.hint = [...new Set(timeline.notes.map((note) => note.pitch))];
  if (player.loopingRegion && loopRegion) {
    const next = regionTimelineFor(loopRegion);
    if (next) player.setRegion(next);
  }
  applyTempo();
  updateVoices();
  drawTimeline();
  updateSummary();
}

function setFollowJumps(on: boolean) {
  prefs.followJumps = on;
  savePrefs();
  if (player.status === "playing") stop();
  if (scoreIndex) buildPlayback(scoreIndex);
  $("explain").textContent = on
    ? "Playback follows D.C., D.S., Fine and Coda."
    : "Playback plays the music as written, without D.C. and D.S. jumps: for practising sections.";
}

function regionTimelineFor(region: Region): Timeline | null {
  if (!timeline || !scoreIndex) return null;
  const all = region.voices.length >= scoreIndex.voices.length;
  return regionTimeline(timeline, region, all);
}

/* Linking: text → score. */
let litCaret: Element[] = [];
let litSelection: Element[] = [];
let lastCaretKey = "";

let attached: Attachment[] | null = null;
/** Beams, ties and slurs take a colour only when every note they join has it. */
function paintAttached(notes: ScoreNote[], className: string): Element[] {
  if (!scoreIndex || !notes.length) return [];
  attached ??= attachments(scoreIndex, scoreElement);
  const set = new Set(notes);
  const painted: Element[] = [];
  for (const attachment of attached)
    if (attachment.notes.every((note) => set.has(note))) {
      attachment.element.classList.add(className);
      painted.push(attachment.element);
    }
  return painted;
}

function linkFromText() {
  const index = scoreIndex;
  if (!index) return;
  const selection = view.state.selection;
  for (const element of litCaret) element.classList.remove("is-caret");
  for (const element of litSelection) element.classList.remove("is-selected");
  litCaret = [];
  litSelection = [];
  const nonEmpty = ranges().filter((range) => range.to > range.from);
  let caretNotes: ScoreNote[] = [];
  if (nonEmpty.length) {
    const selected = notesInRanges(index, nonEmpty);
    for (const note of selected)
      for (const element of note.elements) element.classList.add("is-selected");
    litSelection = [
      ...selected.flatMap((note) => note.elements),
      ...paintAttached(selected, "is-selected"),
    ];
    drawBands(selected);
  } else {
    caretNotes = caretNotesAt(index, selection.main.head);
    for (const note of caretNotes)
      for (const element of note.elements) element.classList.add("is-caret");
    litCaret = caretNotes.flatMap((note) => note.elements);
    drawBands([]);
  }
  view.dispatch({
    effects: setMarks.of({ caret: caretNotes.map((note) => ({ from: note.start, to: note.end })) }),
  });
  const key = caretNotes.map((note) => note.start).join(",");
  if (key && key !== lastCaretKey && player.status !== "playing") {
    const target = caretNotes[0]?.elements[0];
    if (target) keepInView(target, false);
  }
  lastCaretKey = key;
}

/** Scrolls the score only when the element is out of view. */
function keepInView(element: Element, smooth: boolean) {
  const box = element.getBoundingClientRect();
  const frame = scoreScroll.getBoundingClientRect();
  const margin = 24;
  // A panel docked over the score (on a phone) shortens what can be seen of it.
  const dock = document.getElementById("dock");
  const dockTop =
    dock && !dock.hidden && getComputedStyle(dock).position === "fixed"
      ? dock.getBoundingClientRect().top
      : frame.bottom;
  const bottom = Math.min(frame.bottom, dockTop);
  if (box.top >= frame.top + margin && box.bottom <= bottom - margin) return;
  const target = scoreScroll.scrollTop + (box.top - frame.top) - (bottom - frame.top) * 0.3;
  following.programmatic = performance.now();
  scoreScroll.scrollTo({
    top: Math.max(0, target),
    behavior: smooth && !reducedMotion.matches ? "smooth" : "auto",
  });
}

function staffGeometry() {
  if (!scoreIndex) return null;
  geometry ??= measure(scoreIndex, scoreElement);
  return geometry;
}

/** Soft bands behind a selection, one per system and staff. */
function drawBands(selected: ScoreNote[], issueNotes: ScoreNote[] = currentIssueNotes) {
  bandsLayer.replaceChildren();
  const geo = staffGeometry();
  if (!geo) return;
  const offsetTop = scoreElement.offsetTop;
  const offsetLeft = scoreElement.offsetLeft;
  const add = (notes: ScoreNote[], className: string) => {
    if (!scoreIndex) return;
    const chosen = new Set(notes);
    const boxOf = new Map(geo.notes.map((box) => [box.note, box]));
    // Runs of selected notes, voice by voice and system by system: a note left out ends a run,
    // so a selection in several places shows as several bands.
    type Run = {
      line: number;
      staff: number;
      left: number;
      right: number;
      open: boolean;
      close: boolean;
    };
    const runs: Run[] = [];
    for (const voiceNotes of scoreIndex.byVoice) {
      let run: Run | null = null;
      voiceNotes.forEach((note, at) => {
        const box = boxOf.get(note);
        if (!chosen.has(note) || !box) {
          run = null;
          return;
        }
        const previous = voiceNotes[at - 1];
        const next = voiceNotes[at + 1];
        if (!run || run.line !== note.line) {
          run = {
            line: note.line,
            staff: note.staff,
            left: box.head,
            right: box.right,
            // A run carried on from the system above has no edge at its start.
            open: !(previous && chosen.has(previous) && previous.line !== note.line),
            close: true,
          };
          runs.push(run);
        }
        run.left = Math.min(run.left, box.head);
        run.right = Math.max(run.right, box.right);
        run.close = !(next && chosen.has(next) && next.line !== note.line);
      });
    }
    // Runs that overlap in time on one system share one span across its staves.
    const spans = new Map<number, { left: number; right: number }[]>();
    for (const run of [...runs].sort((a, b) => a.left - b.left)) {
      const list = spans.get(run.line) ?? [];
      const last = list[list.length - 1];
      if (last && run.left <= last.right + 4) last.right = Math.max(last.right, run.right);
      else list.push({ left: run.left, right: run.right });
      spans.set(run.line, list);
    }
    const drawn = new Set<string>();
    for (const run of runs) {
      const span = (spans.get(run.line) ?? []).find(
        (each) => run.left >= each.left - 0.5 && run.right <= each.right + 0.5,
      ) ?? { left: run.left, right: run.right };
      const key = `${run.line}:${run.staff}:${span.left}`;
      const edges = runs.filter(
        (other) =>
          other.line === run.line &&
          other.staff === run.staff &&
          other.left >= span.left - 0.5 &&
          other.right <= span.right + 0.5,
      );
      if (drawn.has(key)) continue;
      drawn.add(key);
      const staff = geo.staves.find((box) => box.line === run.line && box.staff === run.staff);
      const top = staff ? staff.top - 10 : 0;
      const bottom = staff ? staff.bottom + 10 : 0;
      const band = document.createElement("div");
      const open = edges.some((each) => each.open);
      const close = edges.some((each) => each.close);
      band.className = `score-band ${className}${open ? " edge-start" : ""}${close ? " edge-end" : ""}`;
      band.style.left = `${offsetLeft + span.left - 6}px`;
      band.style.width = `${span.right - span.left + 12}px`;
      band.style.top = `${offsetTop + top}px`;
      band.style.height = `${Math.max(20, bottom - top)}px`;
      bandsLayer.append(band);
    }
  };
  add(issueNotes, "bar-issue");
  if (selected.length) add(selected, "selection");
}

/* Checks: abcjs warnings and the bar check, shown quietly at their place. */
type Problem = {
  from: number;
  to: number;
  message: string;
  severity: "warning" | "error";
  kind: "bar" | "parse" | "lyrics" | "orphan";
  /** One click that puts it right, offered in the problems list. */
  fix?: { label: string; from: number; to: number; insert: string };
  /** abcjs's own words, shown under ours when they add something. */
  detail?: string;
  /** "bar 3 — has 7 eighths, 6 expected", for the list. */
  label?: string;
};
let problems: Problem[] = [];
let currentIssueNotes: ScoreNote[] = [];
const TYPING_WINDOW = 2500;
/** The bar left out because it was being typed, so it can be checked as soon as that ends. */
let skippedBar: { from: number; to: number } | null = null;
let recheckTimer: ReturnType<typeof setTimeout> | undefined;

function runChecks(caretLeft = false) {
  const index = fileIndex();
  const doc = text();
  const list: Problem[] = [];
  const position = caret();
  const recentlyTyped = !caretLeft && performance.now() - lastTyped < TYPING_WINDOW;
  skippedBar = null;
  for (const tune of index.tunes) {
    for (const issue of checkBars(doc, tune, index)) {
      // Not while the bar is still being typed; it is checked once typing pauses or the caret leaves.
      // Only the bar being typed: the caret is in it and the last edit was in it.
      if (
        recentlyTyped &&
        position >= issue.from &&
        position <= issue.to &&
        lastEdit >= issue.from &&
        lastEdit <= issue.to
      ) {
        skippedBar = { from: issue.from, to: issue.to };
        continue;
      }
      list.push({
        from: issue.from,
        to: issue.to,
        message: issue.message,
        severity: "warning",
        kind: "bar",
        label: `${issue.bar === 0 ? "pickup" : `bar ${issue.bar}`} — ${issue.detail}`,
      });
    }
  }
  for (const orphan of index.orphans) {
    const name = orphanName(orphan);
    const lines = orphan.blank
      ? doc.slice(orphan.blank.from, orphan.blank.to).split("\n").length - 1
      : 0;
    list.push({
      from: orphan.from,
      to: orphan.to,
      message: orphanMessage(orphan),
      severity: "warning",
      kind: "orphan",
      label: orphan.tune
        ? `music after a blank line, left out of ${name}`
        : "music before the first X: line",
      ...(orphan.blank
        ? {
            fix: {
              label: lines > 1 ? "Remove the empty lines" : "Remove the empty line",
              from: orphan.blank.from,
              to: orphan.blank.to,
              insert: "",
            },
          }
        : {}),
    });
  }
  for (const tune of index.tunes)
    for (const issue of checkLyrics(doc, tune))
      list.push({
        from: issue.from,
        to: issue.to,
        message: issue.message,
        severity: "warning",
        kind: "lyrics",
        label: `lyrics — ${issue.extra} ${issue.extra === 1 ? "syllable has" : "syllables have"} no notes`,
      });
  if (scoreIndex)
    for (const warning of plainWarnings(scoreIndex.warnings, doc))
      list.push({
        ...warning,
        to: Math.max(warning.to, warning.from + 1),
        severity: "error",
        kind: "parse",
      });
  for (const tune of index.tunes)
    for (const slur of checkSlurs(doc, tune, index))
      list.push({ ...slur, severity: "warning", kind: "parse" });
  list.sort((a, b) => a.from - b.from);
  problems = list;
  clearTimeout(recheckTimer);
  if (skippedBar)
    recheckTimer = setTimeout(
      () => runChecks(),
      Math.max(50, lastTyped + TYPING_WINDOW - performance.now() + 50),
    );
  view.dispatch({ effects: setMarks.of({ issues: list }) });
  const button = $<HTMLButtonElement>("problems");
  button.hidden = list.length === 0;
  button.textContent = problemsLabel(list);
  currentIssueNotes = scoreIndex
    ? notesInRanges(
        scoreIndex,
        list.filter((problem) => problem.kind === "bar"),
      )
    : [];
  linkFromText();
}

/** "X:1 “Air”": the tune a blank line ended. */
function orphanName(orphan: Orphan): string {
  return orphan.tune
    ? `X:${orphan.tune.number}${orphan.tune.title ? ` “${orphan.tune.title}”` : ""}`
    : "";
}
function orphanMessage(orphan: Orphan): string {
  return orphan.tune
    ? `A blank line ends the tune: the music below isn't part of ${orphanName(orphan)}.`
    : "This music comes before the first X: line, so it isn't part of any tune.";
}

/** "1 bar to check", "2 problems", "1 bar to check · 1 problem". */
function problemsLabel(list: Problem[]): string {
  const bars = list.filter((problem) => problem.kind === "bar").length;
  const lyrics = list.filter((problem) => problem.kind === "lyrics").length;
  const others = list.length - bars - lyrics;
  const parts: string[] = [];
  if (bars) parts.push(`${bars} ${bars === 1 ? "bar" : "bars"} to check`);
  if (lyrics) parts.push(`${lyrics} ${lyrics === 1 ? "lyrics line" : "lyrics lines"} to check`);
  if (others) parts.push(`${others} ${others === 1 ? "problem" : "problems"}`);
  return parts.join(" · ");
}

/* Score → text: click, drag, Shift+click, keyboard. */
type Drag = {
  anchor: ScorePoint;
  allVoices: boolean;
  moved: boolean;
  pointer: number;
  x: number;
  y: number;
  /** Ctrl/⌘ held: the selection before the press, which the drag adds to. */
  base?: Range[];
};
let drag: Drag | null = null;

/* A selection in several places: Ctrl/⌘ click toggles a note, Ctrl/⌘ drag adds a region. */
/** Phones have no Ctrl or ⌘: "Select more" (in More) makes every tap and drag add instead. */
let selectMore = false;
const addsToSelection = (event: MouseEvent | KeyboardEvent) =>
  (isApple ? event.metaKey : event.ctrlKey) || (selectMore && event instanceof MouseEvent);
function setSelectMore(on: boolean) {
  selectMore = on;
  scoreScroll.classList.toggle("select-more", on);
  notice(
    on
      ? "Select more: tap notes to add them or take them out, or drag to add a passage. Turn it off in More."
      : "Select more is off: a tap selects one note again.",
    "info",
  );
}
/** Ranges sorted and joined where they overlap or touch (only spaces between them). */
function mergeRanges(list: Range[]): Range[] {
  const doc = text();
  const out: Range[] = [];
  for (const range of [...list]
    .filter((each) => each.to > each.from)
    .sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && (range.from <= last.to || /^[ \t]*$/.test(doc.slice(last.to, range.from))))
      last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}
function selectRanges(list: Range[], fallback: number) {
  const merged = mergeRanges(list);
  view.dispatch({
    selection: merged.length
      ? EditorSelection.create(merged.map((range) => EditorSelection.range(range.from, range.to)))
      : { anchor: fallback },
    scrollIntoView: true,
    userEvent: "select.score",
  });
}
/** A note in or out of the selection: out of a range splits it around the note. */
function toggleNote(note: ScoreNote) {
  const current = ranges().filter((range) => range.to > range.from);
  const holder = current.find((range) => note.start >= range.from && note.end <= range.to);
  if (!holder) {
    selectRanges([...current, { from: note.start, to: note.end }], note.start);
    return;
  }
  const doc = text();
  const keep = (start: number, end: number) => {
    let from = start;
    let to = end;
    while (to > from && /\s/.test(doc[to - 1] as string)) to -= 1;
    while (from < to && /\s/.test(doc[from] as string)) from += 1;
    return to > from && eventsIn(doc, [{ from, to }], fileIndex()).length ? [{ from, to }] : [];
  };
  selectRanges(
    [
      ...current.filter((range) => range !== holder),
      ...keep(holder.from, note.start),
      ...keep(note.end, holder.to),
    ],
    note.start,
  );
}

/** Bar lines' x on each system, in the score's coordinates (measured with the geometry). */
let barCache: { for: unknown; bars: Map<number, number[]> } | null = null;
function barLines(): Map<number, number[]> {
  const geo = staffGeometry();
  if (barCache && barCache.for === geo) return barCache.bars;
  const bars = measureBarLines();
  barCache = { for: geo, bars };
  return bars;
}
function measureBarLines(): Map<number, number[]> {
  const origin = scoreElement.getBoundingClientRect();
  const byLine = new Map<number, number[]>();
  for (const element of scoreElement.querySelectorAll(".abcjs-bar")) {
    const line = Number(/abcjs-l(\d+)/.exec(element.getAttribute("class") ?? "")?.[1] ?? -1);
    const rect = element.getBoundingClientRect();
    if (line < 0 || !rect.height) continue;
    const list = byLine.get(line) ?? [];
    const x = Math.round(rect.left + rect.width / 2 - origin.left);
    if (!list.some((each) => Math.abs(each - x) < 2)) list.push(x);
    byLine.set(line, list);
  }
  return byLine;
}

/** Every drawn note's head position, for reading the pointer in musical time. */
function placedNotes(): Placed[] {
  const geo = staffGeometry();
  if (!geo) return [];
  return spanLoneNotes(
    geo.notes.map((box) => ({
      note: box.note,
      line: box.note.line,
      staff: box.note.staff,
      x: box.head,
    })),
    barLines(),
  );
}

/**
 * Where the pointer is in the music: the staff under it, the note of a voice on that staff whose
 * head it has reached (a voice already being dragged is kept), and how far it reached in time.
 */
function hitPoint(clientX: number, clientY: number, preferVoice?: number): ScorePoint | null {
  const geo = staffGeometry();
  if (!geo) return null;
  const origin = scoreElement.getBoundingClientRect();
  const x = clientX - origin.left;
  const y = clientY - origin.top;
  let staff = geo.staves.find((box) => y >= box.top - 28 && y <= box.bottom + 28);
  if (!staff) {
    let best = Number.POSITIVE_INFINITY;
    for (const box of geo.staves) {
      const distance = Math.min(Math.abs(y - box.top), Math.abs(y - box.bottom));
      if (distance < best && distance < 60) {
        best = distance;
        staff = box;
      }
    }
  }
  if (!staff) return null;
  const placed = placedNotes();
  const onStaff = placed.filter((each) => each.line === staff.line && each.staff === staff.staff);
  if (!onStaff.length) return null;
  let voice = preferVoice;
  if (voice === undefined || !onStaff.some((each) => each.note.voice === voice)) {
    // Several voices on one staff: the one whose notes are nearest the pointer vertically.
    let nearest = Number.POSITIVE_INFINITY;
    for (const box of geo.notes) {
      if (box.note.line !== staff.line || box.note.staff !== staff.staff) continue;
      const distance = Math.abs(y - (box.top + box.bottom) / 2) + Math.abs(x - box.head) / 4;
      if (distance < nearest) {
        nearest = distance;
        voice = box.note.voice;
      }
    }
  }
  const note = noteUnder(
    onStaff.filter((each) => each.note.voice === voice),
    staff.line,
    x,
    barLines().get(staff.line) ?? [],
  );
  if (!note) return null;
  return { note, line: staff.line, staff: staff.staff, x, reach: reachAt(placed, staff.line, x) };
}

function voicesOnStaff(staff: number): number[] {
  if (!scoreIndex) return [];
  return scoreIndex.voices
    .map((voice, index) => ({ voice, index }))
    .filter(({ voice }) => voice.staff === staff)
    .map(({ index }) => index);
}

function selectRegion(region: Region, focusText = false) {
  if (!scoreIndex) return;
  const list = regionRanges(scoreIndex, region, text());
  if (!list.length) return;
  view.dispatch({
    selection: EditorSelection.create(
      list.map((range) => EditorSelection.range(range.from, range.to)),
    ),
    scrollIntoView: true,
    userEvent: "select.score",
  });
  if (focusText) view.focus();
}

const allVoices = () => (scoreIndex ? scoreIndex.voices.map((_, index) => index) : []);

scoreScroll.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !scoreIndex) return;
  const hit = hitPoint(event.clientX, event.clientY);
  if (!hit) return;
  event.preventDefault();
  scoreScroll.focus({ preventScroll: true });
  const current =
    regionOfRanges(
      scoreIndex,
      ranges().filter((range) => range.to > range.from),
    ) ??
    regionOfRanges(
      scoreIndex,
      notesAt(scoreIndex, caret()).map((note) => ({ from: note.start, to: note.end })),
    );
  if (addsToSelection(event) && !event.shiftKey) {
    // Ctrl/⌘: a click toggles the note, a drag adds a region; decided when the pointer moves.
    drag = {
      anchor: hit,
      allVoices: event.altKey,
      moved: false,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      base: ranges().filter((range) => range.to > range.from),
    };
    scoreScroll.setPointerCapture(event.pointerId);
    return;
  }
  if (event.shiftKey && current) {
    // Shift click extends to the place clicked: back to its note's start, or on to what it reached.
    const voices = event.altKey ? allVoices() : [...new Set([...current.voices, hit.note.voice])];
    const from = Math.min(current.from, hit.note.time);
    const reach = Math.max(
      current.reach ?? current.from,
      hit.note.time < current.from ? current.from : hit.reach,
    );
    selectRegion(spanRegion(scoreIndex, from, reach, voices));
    return;
  }
  drag = {
    anchor: hit,
    allVoices: event.altKey,
    moved: false,
    pointer: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  };
  scoreScroll.setPointerCapture(event.pointerId);
  const voices = event.altKey ? allVoices() : [hit.note.voice];
  selectRegion(dragRegion(scoreIndex, hit, hit, voices));
  if (prefs.hear && !hit.note.rest && timeline) {
    const pitches = timeline.notes
      .filter((note) => note.start === hit.note.start)
      .map((note) => note.pitch);
    player.audition([...new Set(pitches)]);
  }
});
scoreScroll.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.pointer || !scoreIndex) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
  drag.moved = true;
  scoreScroll.classList.add("dragging");
  const hit = hitPoint(event.clientX, event.clientY, drag.anchor.note.voice);
  if (!hit) return;
  const sameStaff = hit.staff === drag.anchor.staff;
  const voices =
    drag.allVoices || !sameStaff
      ? allVoices()
      : drag.anchor.note.voice === hit.note.voice
        ? [drag.anchor.note.voice]
        : voicesOnStaff(hit.staff);
  const region = dragRegion(scoreIndex, drag.anchor, hit, voices);
  if (drag.base)
    selectRanges([...drag.base, ...regionRanges(scoreIndex, region, text())], hit.note.start);
  else selectRegion(region);
  // Scroll while dragging near the edges.
  const frame = scoreScroll.getBoundingClientRect();
  if (event.clientY > frame.bottom - 30) scoreScroll.scrollTop += 12;
  else if (event.clientY < frame.top + 30) scoreScroll.scrollTop -= 12;
});
const endDrag = (event: PointerEvent) => {
  if (!drag || event.pointerId !== drag.pointer) return;
  scoreScroll.classList.remove("dragging");
  // Ctrl/⌘ click without a drag: the note goes in or out of the selection.
  if (drag.base && !drag.moved && event.type === "pointerup") toggleNote(drag.anchor.note);
  drag = null;
};
scoreScroll.addEventListener("pointerup", endDrag);
scoreScroll.addEventListener("pointercancel", endDrag);

/**
 * " in 3 places" when the selected ranges cover separate stretches of time, " in 2 voices" when
 * one stretch spans several voices, else nothing.
 */
function selectionWhere(): string {
  const selected = ranges().filter((range) => range.to > range.from);
  if (selected.length < 2) return "";
  if (!scoreIndex) return ` in ${selected.length} places`;
  // Runs of selected notes in each voice, joined across voices where they overlap in time:
  // a count that depends on the notes chosen, not on how the text ranges happen to fall.
  const chosen = new Set(notesInRanges(scoreIndex, selected));
  const stretches: { from: number; to: number }[] = [];
  const voices = new Set<number>();
  for (const voiceNotes of scoreIndex.byVoice) {
    let run: { from: number; to: number } | null = null;
    for (const note of voiceNotes) {
      if (!chosen.has(note)) {
        run = null;
        continue;
      }
      voices.add(note.voice);
      if (!run) {
        run = { from: note.time, to: note.time + note.duration };
        stretches.push(run);
      } else run.to = Math.max(run.to, note.time + note.duration);
    }
  }
  stretches.sort((a, b) => a.from - b.from);
  let places = 0;
  let end = Number.NEGATIVE_INFINITY;
  for (const stretch of stretches) {
    if (stretch.from >= end - 1e-6) places += 1;
    end = Math.max(end, stretch.to);
  }
  if (places > 1) return ` in ${places} places`;
  return voices.size > 1 ? ` in ${voices.size} voices` : "";
}

/** Says what the score's keyboard moved to: the note, its bar and voice, or the selection. */
function announceScore() {
  const live = $("score-live");
  let message: string;
  const selected = ranges().filter((range) => range.to > range.from);
  if (selected.length && scoreIndex) {
    const notes = notesInRanges(scoreIndex, selected).filter((note) => !note.rest);
    const bars = [...new Set(notesInRanges(scoreIndex, selected).map((note) => note.measure + 1))];
    const span =
      bars.length > 1 ? `bars ${Math.min(...bars)} to ${Math.max(...bars)}` : `bar ${bars[0]}`;
    message = `${notes.length} ${notes.length === 1 ? "note" : "notes"} selected${selectionWhere()}, ${span}.`;
  } else {
    const explanation = explainAt(text(), fileIndex(), caret());
    message = explanation ? `${explanation.text}${placeOf(caret())}` : "No note here.";
  }
  live.textContent = message;
}

/** ↑/↓ in the score: the note sounding at the same time in the voice above or below. */
function moveByVoice(direction: 1 | -1): boolean {
  const index = scoreIndex;
  if (!index || index.voices.length < 2) return false;
  const note = notesAt(index, caret())[0] ?? index.notes.find((each) => each.start >= caret());
  if (!note) return false;
  const voice = note.voice + direction;
  if (voice < 0 || voice >= index.voices.length) return true;
  const target = noteAtTime(index, voice, note.time);
  if (target)
    view.dispatch({
      selection: { anchor: target.start },
      scrollIntoView: true,
      userEvent: "select.note",
    });
  return true;
}

/** Home/End in the score: the first or last note of the voice on this line of music. */
function moveToLineEnd(end: boolean): boolean {
  const index = scoreIndex;
  if (!index) return false;
  const note = notesAt(index, caret())[0] ?? index.notes.find((each) => each.start >= caret());
  if (!note) return false;
  const line = (index.byVoice[note.voice] ?? []).filter((each) => each.line === note.line);
  const target = end ? line[line.length - 1] : line[0];
  if (target)
    view.dispatch({
      selection: { anchor: target.start },
      scrollIntoView: true,
      userEvent: "select.note",
    });
  return true;
}

/*
 * The score cursor: with Ctrl/⌘ held, the arrows move it without changing the selection, and
 * Ctrl/⌘ Space puts the note under it in or out of the selection. Without Ctrl/⌘ it is the caret.
 */
let scoreCursor: ScoreNote | null = null;
function cursorNote(): ScoreNote | null {
  if (!scoreIndex) return null;
  if (scoreCursor && scoreIndex.notes.includes(scoreCursor)) return scoreCursor;
  return (
    notesAt(scoreIndex, caret())[0] ??
    scoreIndex.notes.find((note) => note.start >= caret()) ??
    null
  );
}
function showCursor(note: ScoreNote | null) {
  scoreCursor = note;
  const marker = $("score-cursor");
  const box = note ? staffGeometry()?.notes.find((each) => each.note === note) : null;
  if (!box) {
    marker.hidden = true;
    return;
  }
  marker.hidden = false;
  marker.style.left = `${scoreElement.offsetLeft + box.head - 5}px`;
  marker.style.top = `${scoreElement.offsetTop + box.top - 5}px`;
  marker.style.width = `${box.right - box.head + 10}px`;
  marker.style.height = `${box.bottom - box.top + 10}px`;
  if (note) {
    const explanation = explainAt(text(), fileIndex(), note.start);
    const inside = ranges().some(
      (range) => note.start >= range.from && note.end <= range.to && range.to > range.from,
    );
    $("score-live").textContent =
      `Cursor: ${explanation?.text ?? "note"}${placeOf(note.start)}${inside ? ", selected" : ""}.`;
  }
}
function moveCursor(key: string): boolean {
  const index = scoreIndex;
  const note = cursorNote();
  if (!index || !note) return false;
  let target: ScoreNote | undefined;
  if (key === "ArrowRight" || key === "ArrowLeft") {
    const voiceNotes = index.byVoice[note.voice] ?? [];
    target = voiceNotes[voiceNotes.indexOf(note) + (key === "ArrowRight" ? 1 : -1)];
  } else {
    const voice = note.voice + (key === "ArrowDown" ? 1 : -1);
    if (voice >= 0 && voice < index.voices.length) target = noteAtTime(index, voice, note.time);
  }
  showCursor(target ?? note);
  return true;
}

scoreScroll.addEventListener("keydown", (event) => {
  if (!scoreIndex) return;
  // . ~ ( < > mark the selected notes from the score too.
  if (
    [".", "~", "(", "<", ">"].includes(event.key) &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    typeMark(view, event.key)
  ) {
    event.preventDefault();
    return;
  }
  if (addsToSelection(event) && !event.altKey) {
    if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      moveCursor(event.key);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      const note = cursorNote();
      if (note) {
        toggleNote(note);
        showCursor(note);
        announceScore();
      }
      return;
    }
  }
  // Keys with Ctrl/⌘ or Alt (and F8) mean in the score what they mean in the text: play, loop,
  // stop, transpose, lengths, ties, undo and redo, Find… The text's own keymap runs them; keys
  // that would delete text are not passed on.
  const modified = event.altKey || event.ctrlKey || event.metaKey || /^F\d+$/.test(event.key);
  if (modified && !["Backspace", "Delete"].includes(event.key)) {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      ["c", "x"].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      clipboard(event.key.toLowerCase() === "x" ? "cut" : "copy");
      return;
    }
    if (runScopeHandlers(view, event, "editor")) {
      event.preventDefault();
      event.stopPropagation();
      announceScore();
      return;
    }
  }
  if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
    showCursor(null);
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    moveByNote(event.key === "ArrowRight" ? 1 : -1, event.shiftKey);
    announceScore();
  } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey) {
    if (moveByVoice(event.key === "ArrowDown" ? 1 : -1)) {
      event.preventDefault();
      announceScore();
    }
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    moveToLineEnd(event.key === "End");
    announceScore();
  } else if (event.key === " ") {
    event.preventDefault();
    togglePlay();
  } else if (event.key === "Enter" && !modified && !event.shiftKey) {
    // A bare Enter goes to the text; with modifiers it was handled above.
    event.preventDefault();
    view.focus();
  } else if (event.key === "Escape") {
    view.dispatch({ selection: { anchor: view.state.selection.main.head } });
  }
});

/** Alt ←/→ moves by note; with Shift, extends the selection by a note, in the score's time. */
function moveByNote(direction: 1 | -1, extend: boolean): boolean {
  const index = scoreIndex;
  if (!index) return false;
  const eps = 1e-6;
  const selected = ranges().filter((range) => range.to > range.from);
  const region = selected.length ? regionOfRanges(index, selected) : null;
  const caretNote =
    notesAt(index, caret())[0] ??
    index.notes.find((note) => note.start >= caret()) ??
    index.notes[index.notes.length - 1];
  if (!caretNote) return false;
  const voice = region
    ? region.voices.includes(caretNote.voice)
      ? caretNote.voice
      : (region.voices[0] as number)
    : caretNote.voice;
  const notes = index.byVoice[voice] ?? [];
  if (!extend) {
    const position = notes.indexOf(caretNote);
    const next =
      notes[Math.max(0, Math.min(notes.length - 1, (position < 0 ? 0 : position) + direction))];
    if (next) {
      view.dispatch({
        selection: { anchor: next.start },
        scrollIntoView: true,
        userEvent: "select.note",
      });
      if (prefs.hear && timeline && !next.rest)
        player.audition([
          ...new Set(
            timeline.notes.filter((note) => note.start === next.start).map((note) => note.pitch),
          ),
        ]);
    }
    return true;
  }
  if (!region) {
    selectRegion(spanRegion(index, caretNote.time, caretNote.time, [caretNote.voice]));
    return true;
  }
  let { from } = region;
  let reach = region.reach ?? region.from;
  if (direction > 0) {
    const next = notes.find((note) => note.time > reach + eps);
    if (next) reach = next.time;
  } else {
    const previous = [...notes].reverse().find((note) => note.time < from - eps);
    if (previous) from = previous.time;
  }
  selectRegion(spanRegion(index, from, reach, region.voices));
  return true;
}

/* Musical commands. */
function apply(changes: Change[], label: string): boolean {
  if (!changes.length) {
    notice(`${label}: nothing to change here. Put the caret on a note or select some music.`);
    return true;
  }
  const before = view.state.selection;
  const spec: TransactionSpec = { changes, userEvent: "input.music" };
  const transaction = view.state.update(spec);
  const mapped = EditorSelection.create(
    before.ranges.map((range) =>
      range.empty
        ? EditorSelection.cursor(transaction.changes.mapPos(range.head, 1))
        : EditorSelection.range(
            transaction.changes.mapPos(range.from, -1),
            transaction.changes.mapPos(range.to, 1),
          ),
    ),
    before.mainIndex,
  );
  view.dispatch(view.state.update({ ...spec, selection: mapped }));
  return true;
}

function music(command: string): boolean {
  const doc = text();
  const index = fileIndex();
  const list = ranges();
  switch (command) {
    case "transpose-up":
      return apply(transpose(doc, list, 1, index), "Transpose");
    case "transpose-down":
      return apply(transpose(doc, list, -1, index), "Transpose");
    case "octave-up":
      return apply(transpose(doc, list, 12, index), "Octave");
    case "octave-down":
      return apply(transpose(doc, list, -12, index), "Octave");
    case "double":
      return apply(scaleLengths(doc, list, frac(2), index), "Double");
    case "halve":
      return apply(scaleLengths(doc, list, frac(1, 2), index), "Halve");
    case "dot":
      return apply(scaleLengths(doc, list, frac(3, 2), index), "Dot");
    case "undot":
      return apply(removeDots(doc, list, index), "Remove dot");
    case "tie": {
      const tie = toggleTies(doc, list, index);
      if (!tie.changes.length) {
        notice(tie.reason ?? "Nothing to tie here.");
        return true;
      }
      return apply(tie.changes, "Tie");
    }
    case "slur":
      return apply(toggleSlur(doc, list, index), "Slur");
    case "bar":
      return apply([barLine(doc, caret())], "Bar line");
    case "duplicate":
      return apply(duplicate(doc, list), "Duplicate");
    case "new-tune":
      newTune();
      return true;
    case "decoration":
      decorationMenu(
        document.querySelector<HTMLElement>('[data-command="decoration"]') ?? $("editor"),
      );
      return true;
  }
  return false;
}

function decorationMenu(anchor: HTMLElement) {
  void import("./decoration-groups").then(({ DECORATION_GROUPS: groups }) =>
    popupMenu(anchor, [
      ...groups.flatMap(([heading, choices]) => [
        { heading },
        ...choices.map(([name, label]) => ({
          label,
          shortcut: decorationMark(name),
          run: () => {
            apply(decorate(text(), ranges(), name, fileIndex()), "Decoration");
            view.focus();
          },
        })),
      ]),
      "-" as const,
      { label: "Dynamic for the 2nd time…", shortcut: '"^2nd time p"', run: insertPassDynamic },
    ]),
  );
}

/** Writes "^2nd time p" before the note at the caret, with the dynamic selected to change. */
function insertPassDynamic() {
  const [event] = eventsIn(text(), [{ from: caret(), to: caret() }], fileIndex());
  if (!event) {
    notice(
      "Put the caret on a note first: the dynamic goes on the note where the 2nd time changes.",
    );
    return;
  }
  const insert = '"^2nd time p"';
  view.dispatch({
    changes: { from: event.from, insert },
    selection: { anchor: event.from + insert.length - 2, head: event.from + insert.length - 1 },
    userEvent: "input.music",
  });
  view.focus();
  $("explain").textContent =
    "Type the dynamic for the 2nd time (pp, p, mp, mf, f, ff); playback follows it.";
}

function newTune() {
  const index = fileIndex();
  const number = nextTuneNumber(index);
  const doc = text();
  const lead =
    doc.length === 0 ? "" : doc.endsWith("\n\n") ? "" : doc.endsWith("\n") ? "\n" : "\n\n";
  const insert = `${lead}${newTuneTemplate(number)}`;
  view.dispatch({
    changes: { from: doc.length, insert },
    selection: { anchor: doc.length + insert.length },
    scrollIntoView: true,
    userEvent: "input.music",
  });
  view.focus();
}

/* Tune book: renumber, sort, line up bars, incipits, duplicate, new tune after (./book). */
const bookContext = () => ({
  view,
  file: fileIndex(),
  caret: caret(),
  name: nameInput.value,
  notice,
  explain: (message: string) => {
    $("explain").textContent = message;
  },
  newTune,
  openDraft: (draft: string, name: string) => {
    local.disconnect();
    load(newSource(draft), abcName(name));
    void persist();
  },
});
const bookItems = (tune?: TuneInfo): MenuItem[] => {
  const run = (command: import("./book").BookCommand) => () =>
    void import("./book").then((module) => module.runBook(command, bookContext(), tune));
  return [
    { label: "Duplicate tune", run: run("duplicate") },
    { label: "New tune after this one", run: run("new-after") },
    "-",
    { label: "Renumber X: 1…n", run: run("renumber") },
    { label: "Sort tunes…", run: run("sort") },
    { label: tune ? "Line up bars in this tune" : "Line up bars", run: run("line-up") },
    { label: "Incipits…", run: run("incipits") },
  ];
};

/* Playback. */
let loopRegion: Region | null = null;
let loopOn = false;

function caretWritten(): { note: ScoreNote; written: number } | null {
  if (!scoreIndex) return null;
  const note =
    notesAt(scoreIndex, caret())[0] ?? scoreIndex.notes.find((each) => each.start >= caret());
  return note ? { note, written: note.time } : null;
}

async function ensurePlayable(): Promise<boolean> {
  if (!timeline || !scoreIndex) {
    await render(true);
    if (scoreIndex && !timeline) buildPlayback(scoreIndex);
  }
  if (!timeline || !timeline.notes.length) {
    notice("There is nothing to play yet. Write a tune with an X: line, a K: line and some notes.");
    return false;
  }
  return true;
}

async function togglePlay() {
  if (player.status === "playing" || player.status === "loading") {
    player.pause();
    return;
  }
  if (!(await ensurePlayable())) return;
  if (loopOn) {
    startLoop();
    return;
  }
  following.on = true;
  await player.play({});
}

async function playFromCaret() {
  if (!(await ensurePlayable()) || !timeline) return;
  const place = caretWritten();
  following.on = true;
  if (loopOn) setLoop(false);
  await player.play({ from: place ? firstPlayOf(timeline, place.written) : 0 });
}

/** The bar around a written time, in every voice. */
function barRegion(voice: number, written: number): Region | null {
  if (!scoreIndex) return null;
  const bars = scoreIndex.bars.filter((bar) => bar.voice === voice).map((bar) => bar.time);
  const from = Math.max(0, ...bars.filter((time) => time <= written + 1e-6));
  const after = bars.filter((time) => time > written + 1e-6);
  const to = after.length
    ? Math.min(...after)
    : Math.max(...(scoreIndex.byVoice[voice] ?? []).map((note) => note.time + note.duration));
  return { from, to, voices: scoreIndex.voices.map((_, index) => index) };
}

function selectionRegion(): Region | null {
  if (!scoreIndex) return null;
  const selected = ranges().filter((range) => range.to > range.from);
  if (selected.length) return regionOfRanges(scoreIndex, selected);
  // No selection: the bar at the caret, in every voice.
  const place = caretWritten();
  return place ? barRegion(place.note.voice, place.written) : null;
}

/** Where in the written music the tune is playing now. */
function playingWritten(): number | null {
  const line = player.timeline;
  if (!line || player.status !== "playing") return null;
  const position = player.position();
  if (player.loopingRegion) return line.offset + Math.max(0, position);
  let last: (typeof line.notes)[number] | undefined;
  for (const note of line.notes) {
    if (note.time > position) break;
    if (note.start !== undefined) last = note;
  }
  return last ? last.written + (position - last.time) : 0;
}

async function playSelection(loop: boolean) {
  if (!(await ensurePlayable())) return;
  const region = selectionRegion();
  if (!region) return;
  const regionLine = regionTimelineFor(region);
  if (!regionLine || !regionLine.notes.length) {
    notice("The selection has no notes to play.");
    return;
  }
  loopRegion = region;
  following.on = true;
  await player.play({ region: regionLine, loop });
}

function startLoop() {
  void playSelection(true);
}
function setLoop(on: boolean) {
  loopOn = on;
  $("loop").setAttribute("aria-pressed", String(on));
  if (!on) {
    loopRegion = null;
    if (player.loopingRegion && player.status === "playing") {
      // Carry on through the tune from where the loop was.
      const at = player.timeline?.offset ?? 0;
      void player.play({ from: timeline ? firstPlayOf(timeline, at + player.position()) : 0 });
    }
  }
  drawTimeline();
}
/**
 * Loop is a mode. Turned on while playing, it loops the selection, or the bar being played, and
 * carries on from where the music is; turned on while stopped, Play starts the loop.
 */
function toggleLoop() {
  setLoop(!loopOn);
  if (!loopOn || player.status !== "playing" || !scoreIndex) return;
  const written = playingWritten() ?? 0;
  const selected = ranges().filter((range) => range.to > range.from);
  const region = selected.length ? regionOfRanges(scoreIndex, selected) : barRegion(0, written);
  const line = region ? regionTimelineFor(region) : null;
  if (!region || !line || !line.notes.length) return;
  loopRegion = region;
  const from = written >= region.from && written < region.to ? written - region.from : 0;
  drawTimeline();
  void player.play({ region: line, loop: true, from });
}
function stop() {
  player.stop();
  refreshPlace();
}

function applyTempo() {
  if (!timeline) return;
  const natural = Math.round(timeline.bpm);
  const bpm = tempoOverride ?? natural;
  player.setTempoFactor(bpm / timeline.bpm);
  const input = $<HTMLInputElement>("tempo");
  if (document.activeElement !== input) input.value = String(bpm);
  const beat = timeline.beat;
  const symbol =
    Math.abs(beat - 0.375) < 1e-6
      ? "♩."
      : Math.abs(beat - 0.25) < 1e-6
        ? "♩"
        : Math.abs(beat - 0.5) < 1e-6
          ? "𝅗𝅥"
          : Math.abs(beat - 0.125) < 1e-6
            ? "♪"
            : "beat";
  $("tempo-unit").textContent = symbol === "beat" ? "Beat =" : `${symbol} =`;
  input.setAttribute(
    "aria-label",
    `Tempo: ${bpm} beats a minute${tempoOverride !== null && tempoOverride !== natural ? `; the tune says ${natural}` : ""}`,
  );
  input.title =
    tempoOverride !== null && tempoOverride !== natural
      ? `The tune's Q: says ${natural}. Clear to use it.`
      : "From the tune's Q: field";
}
function setTempo(bpm: number) {
  if (!Number.isFinite(bpm)) return;
  tempoOverride = Math.max(20, Math.min(400, Math.round(bpm)));
  applyTempo();
}

/* Follow along: light the notes being heard, in the score and the text. */
const following = { on: true, programmatic: 0 };
let litPlaying: Element[] = [];
let playingKey = "";
let frame = 0;
let scanIndex = 0;

function playbackFrame() {
  frame = 0;
  const line = player.timeline;
  const playing = player.status === "playing";
  if (line && scoreIndex) {
    const position = player.position();
    // Nothing is lit during a count-in.
    const { notes, index } =
      position < 0 ? { notes: [], index: scanIndex } : soundingAt(line, position, scanIndex);
    scanIndex = index;
    // Only playing lights notes; paused, the place is a hollow marker; stopped, nothing.
    const paused = player.status === "paused";
    const starts = notes.map((note) => note.start).join(",");
    const key = playing ? starts : paused ? `paused@${starts}@${position.toFixed(4)}` : "stopped";
    if (key !== playingKey) {
      playingKey = key;
      for (const element of litPlaying) element.classList.remove("is-playing");
      litPlaying = [];
      const heard = new Set(notes.map((note) => note.start));
      placeMarker(
        paused
          ? (scoreIndex.notes.find((note) => heard.has(note.start)) ?? nextNoteAt(line, position))
          : null,
      );
      const lit = playing ? scoreIndex.notes.filter((note) => heard.has(note.start)) : [];
      for (const note of lit)
        for (const element of note.elements) element.classList.add("is-playing");
      litPlaying = [...lit.flatMap((note) => note.elements), ...paintAttached(lit, "is-playing")];
      view.dispatch({
        effects: setMarks.of({
          playing: playing ? lit.map((note) => ({ from: note.start, to: note.end })) : [],
        }),
      });
      const first = lit[0];
      if (playing && first) {
        const element = first.elements[0];
        if (element) {
          if (following.on) keepInView(element, true);
          else {
            const box = element.getBoundingClientRect();
            const frameBox = scoreScroll.getBoundingClientRect();
            if (box.top >= frameBox.top && box.bottom <= frameBox.bottom) setFollowing(true);
          }
        }
        // The text follows too, unless the writer is busy typing.
        if (performance.now() - lastTyped > 2000 && !view.hasFocus) {
          const coords = view.coordsAtPos(first.start);
          const editorBox = view.scrollDOM.getBoundingClientRect();
          if (!coords || coords.top < editorBox.top || coords.bottom > editorBox.bottom)
            view.dispatch({ effects: EditorView.scrollIntoView(first.start, { y: "center" }) });
        }
      }
    }
    updateHead(position);
  }
  if (playing) frame = requestAnimationFrame(playbackFrame);
}

/** The note a paused position is at, or the next one to sound. */
function nextNoteAt(line: Timeline, position: number): ScoreNote | null {
  const next = line.notes.find((note) => note.start !== undefined && note.time >= position - 1e-9);
  return next && scoreIndex
    ? (scoreIndex.notes.find((note) => note.start === next.start) ?? null)
    : null;
}
/** The hollow place marker over a paused note's staff (the timeline's head, in the score). */
function placeMarker(note: ScoreNote | null) {
  const marker = $("score-place");
  const geo = note ? staffGeometry() : null;
  const box = geo?.notes.find((each) => each.note === note);
  const staff =
    box && geo?.staves.find((each) => each.line === box.note.line && each.staff === box.note.staff);
  if (!box || !staff) {
    marker.hidden = true;
    return;
  }
  marker.hidden = false;
  marker.style.left = `${scoreElement.offsetLeft + box.head - 5}px`;
  marker.style.top = `${scoreElement.offsetTop + staff.top - 8}px`;
  marker.style.height = `${staff.bottom - staff.top + 16}px`;
}
/** After a seek or Stop: repaint what is lit at once, whether or not the music is playing. */
function refreshPlace() {
  if (player.status !== "playing") playbackFrame();
}

function setFollowing(on: boolean) {
  following.on = on;
  $("follow").hidden = on || player.status !== "playing";
}
for (const type of ["wheel", "touchmove"] as const)
  scoreScroll.addEventListener(
    type,
    () => {
      if (player.status === "playing" && performance.now() - following.programmatic > 400)
        setFollowing(false);
    },
    { passive: true },
  );
scoreScroll.addEventListener("keydown", (event) => {
  if (
    ["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key) &&
    player.status === "playing"
  )
    setFollowing(false);
});
$("follow").addEventListener("click", () => {
  setFollowing(true);
  const element = litPlaying[0];
  if (element) keepInView(element, true);
});

player.onChange = () => {
  const status = player.status;
  transportElement.dataset.state = status;
  const play = $("play");
  play.setAttribute(
    "aria-label",
    status === "playing" ? "Pause" : status === "loading" ? "Loading sound…" : "Play",
  );
  if (status === "playing" && !frame) frame = requestAnimationFrame(playbackFrame);
  if (status !== "playing") {
    playbackFrame();
    $("follow").hidden = true;
  }
  drawTimeline();
};
player.onLoading = (message) => {
  $("sound-status").textContent = message;
};

/* The position bar. */
/** For each moment of playback: the written bar heard, and which time through it is. */
type Reading = { times: number[]; bars: number[]; passes: number[]; totals: Map<number, number> };
const readings = new WeakMap<Timeline, Reading>();
function readingOf(line: Timeline): Reading | null {
  if (!scoreIndex) return null;
  const known = readings.get(line);
  if (known) return known;
  const byStart = new Map(scoreIndex.notes.map((note) => [note.start, note]));
  const pickup = line.pickup > 1e-6;
  const reading: Reading = { times: [], bars: [], passes: [], totals: new Map() };
  let previous: { bar: number; written: number } | null = null;
  for (const note of line.notes) {
    if (note.start === undefined) continue;
    const scored = byStart.get(note.start);
    if (!scored) continue;
    const bar = pickup ? scored.measure : scored.measure + 1;
    const entering = !previous || previous.bar !== bar || note.written < previous.written - 1e-6;
    if (entering) reading.totals.set(bar, (reading.totals.get(bar) ?? 0) + 1);
    if (reading.times.length && reading.times[reading.times.length - 1] === note.time) continue;
    reading.times.push(note.time);
    reading.bars.push(bar);
    reading.passes.push(reading.totals.get(bar) ?? 1);
    previous = { bar, written: note.written };
  }
  readings.set(line, reading);
  return reading;
}
function writtenBarAt(
  line: Timeline,
  position: number,
): { bar: number; pass: number; repeated: boolean } | null {
  const reading = readingOf(line);
  if (!reading || !reading.times.length) return null;
  let low = 0;
  let high = reading.times.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((reading.times[middle] as number) <= position + 1e-9) low = middle;
    else high = middle - 1;
  }
  const bar = reading.bars[low] as number;
  return { bar, pass: reading.passes[low] as number, repeated: (reading.totals.get(bar) ?? 1) > 1 };
}
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

function drawTimeline() {
  const line = timeline;
  const ticks = $("timeline-ticks");
  const passes = $("timeline-passes");
  const slider = $("timeline");
  ticks.replaceChildren();
  passes.replaceChildren();
  const loopBand = $("timeline-loop");
  if (!line || line.length <= 0) {
    slider.setAttribute("aria-valuemax", "0");
    loopBand.hidden = true;
    updateHead(0);
    return;
  }
  const length = line.length;
  const pickup = line.pickup > 1e-6;
  const step =
    line.bars.length > 64 ? 8 : line.bars.length > 24 ? 4 : line.bars.length > 12 ? 2 : 1;
  // The bands: what is played again for a repeat ("2nd"), after a D.C. or D.S., and the coda.
  type Band = {
    from: number;
    to: number;
    tag: string;
    short: string;
    title: string;
    jump: boolean;
  };
  const bands: Band[] = [];
  const reading = readingOf(line);
  const returns = line.returns ?? [];
  const inReturn = (time: number) =>
    returns.some((each) => time >= each.from - 1e-9 && time < each.to - 1e-9);
  for (const each of returns)
    bands.push({
      from: each.from,
      to: each.to,
      tag: each.label,
      short: each.label === "Coda" ? "𝄌" : each.label,
      title: each.label === "Coda" ? "The coda" : `Played again after the ${each.label}`,
      jump: true,
    });
  if (reading)
    for (let at = 0; at < reading.times.length; at++) {
      const pass = reading.passes[at] ?? 1;
      if (pass < 2 || inReturn(reading.times[at] as number)) continue;
      let end = at;
      while (
        end + 1 < reading.times.length &&
        (reading.passes[end + 1] ?? 1) === pass &&
        !inReturn(reading.times[end + 1] as number)
      )
        end += 1;
      bands.push({
        from: reading.times[at] as number,
        to: reading.times[end + 1] ?? length,
        tag: ordinal(pass),
        short: ordinal(pass),
        title: `Bars ${reading.bars[at]}–${reading.bars[end]}, ${ordinal(pass)} time`,
        jump: false,
      });
      at = end;
    }
  const bandStart = (time: number) => bands.some((band) => Math.abs(band.from - time) < 1e-6);
  let previous: { bar: number; pass: number } | null = null;
  const last = line.bars.length - 1;
  line.bars.forEach((time, index) => {
    const tick = document.createElement("div");
    const played = index + 1;
    const written = writtenBarAt(line, time + 1e-6);
    // Where playback goes back for another time through, or jumps.
    const starts =
      bandStart(time) ||
      Boolean(
        written &&
          written.pass > 1 &&
          previous &&
          (previous.pass !== written.pass || previous.bar > written.bar),
      );
    previous = written;
    tick.className = `timeline-tick${played % step === 0 || index === 0 || index === last || starts ? " major" : ""}`;
    tick.style.left = `${(time / length) * 100}%`;
    tick.dataset.bar = String(index);
    // The first and the last bar are always named, and the first bar of every band; others by
    // the step on their first time through, measured to fit below.
    const bar = written?.bar ?? (pickup ? index : played);
    const labelled =
      index === 0 ||
      index === last ||
      starts ||
      (bar > 0 && bar % step === 0 && (written?.pass ?? 1) === 1);
    if (labelled) {
      const label = document.createElement("span");
      label.textContent = index === 0 && bar === 0 ? "Pickup" : String(bar);
      label.dataset.priority = index === 0 || index === last ? "0" : starts ? "1" : "2";
      if (starts) label.dataset.bandStart = "true";
      tick.append(label);
    }
    ticks.append(tick);
  });
  // Each band a little inside its stretch, so two bands side by side show a gap.
  for (const each of bands) {
    const band = document.createElement("div");
    band.className = "timeline-pass repeat";
    band.style.left = `calc(${(each.from / length) * 100}% + 1px)`;
    band.style.width = `max(2px, calc(${((each.to - each.from) / length) * 100}% - 2px))`;
    band.title = each.title;
    passes.append(band);
    const tag = document.createElement("span");
    tag.className = `timeline-pass-tag${each.jump ? " jump" : ""}`;
    tag.textContent = each.tag;
    tag.dataset.full = each.tag;
    tag.dataset.short = each.short;
    tag.dataset.priority = "1";
    tag.dataset.width = String(((each.to - each.from) / length) * 100);
    tag.style.left = `${((each.from + each.to) / 2 / length) * 100}%`;
    ticks.append(tag);
  }
  fitTimelineLabels();
  if (loopOn && loopRegion) {
    const from = firstPlayOf(line, loopRegion.from);
    const to = Math.max(from, firstPlayOf(line, loopRegion.to - 1e-6) + 0.001);
    loopBand.hidden = false;
    loopBand.style.left = `${(from / length) * 100}%`;
    loopBand.style.width = `${Math.max(0.6, ((to - from) / length) * 100)}%`;
  } else loopBand.hidden = true;
  slider.setAttribute("aria-valuemin", "1");
  slider.setAttribute("aria-valuemax", String(line.bars.length));
  updateHead(player.status === "stopped" ? 0 : player.position());
}

let lastBeat = Number.NaN;
/** The metronome button pulses on each beat it clicks, so the beat can be seen too. */
function pulseBeat(index: number, down: boolean) {
  if (index === lastBeat) return;
  lastBeat = index;
  const button = $("metronome");
  button.classList.remove("beat", "downbeat");
  void button.offsetWidth;
  button.classList.add("beat");
  if (down) button.classList.add("downbeat");
}

/**
 * Drops labels that would touch the one before: the first and last bar always stay, then the
 * pass tags, then bar numbers in order. Run again whenever the ruler's width changes.
 */
function fitTimelineLabels() {
  const ruler = $("timeline");
  const width = ruler.getBoundingClientRect().width;
  const labels = [
    ...ruler.querySelectorAll<HTMLElement>(".timeline-tick span, .timeline-pass-tag"),
  ];
  for (const label of labels) {
    label.hidden = false;
    label.style.translate = "";
  }
  if (width <= 0) return;
  // A label at the end (the final bar's) stays inside the ruler, clear of the clock beside it.
  const right = ruler.getBoundingClientRect().right;
  for (const label of labels) {
    const over = label.getBoundingClientRect().right - right;
    if (over > 0) label.style.translate = `${-Math.ceil(over)}px 0`;
  }
  const kept: DOMRect[] = [];
  const gap = 6;
  // D.C., D.S. and Coda chips always show: in short (𝄌) where their band is too narrow for the
  // word or another chip is in the way.
  for (const chip of labels.filter((label) => label.classList.contains("jump"))) {
    chip.textContent = chip.dataset.full ?? chip.textContent;
    const band = (Number(chip.dataset.width) / 100) * width;
    let box = chip.getBoundingClientRect();
    const clash = () =>
      kept.some((other) => box.left < other.right + 2 && other.left < box.right + 2);
    if (box.width > band - 4 || clash()) {
      chip.textContent = chip.dataset.short ?? chip.textContent;
      box = chip.getBoundingClientRect();
    }
    kept.push(box);
  }
  for (const priority of ["0", "1", "2"])
    for (const label of labels) {
      if (label.classList.contains("jump") || label.dataset.priority !== priority) continue;
      const box = label.getBoundingClientRect();
      const clash = kept.some(
        (other) => box.left < other.right + gap && other.left < box.right + gap,
      );
      if (clash) label.hidden = true;
      else kept.push(box);
    }
}
new ResizeObserver(() => fitTimelineLabels()).observe($("timeline"));

/** "Bar 5 · 2nd time · 0:40": a played bar as the clock names it, for the ruler's readout. */
function describePlayedBar(line: Timeline, index: number): string {
  const time = line.bars[index] ?? 0;
  const written = writtenBarAt(line, time + 1e-6);
  const number = written?.bar ?? (line.pickup > 1e-6 ? index : index + 1);
  const seconds = (time / ((line.bpm * player.tempoFactor * line.beat) / 60)) | 0;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const name = number === 0 ? "Pickup" : `Bar ${number}`;
  return `${name}${written?.repeated ? ` · ${ordinal(written.pass)} time` : ""} · ${clock}`;
}

function updateHead(position: number) {
  const line = timeline;
  const head = $("timeline-head");
  const count = player.counting();
  const clockElement = $("clock");
  if (count) {
    // Counting in: the beats of the bar, the current one lit; no bar or time yet.
    clockElement.replaceChildren("Count-in ");
    for (let beat = 0; beat < count.beats; beat++) {
      const mark = document.createElement("span");
      mark.className = `count${beat === count.beat ? " lit" : ""}`;
      mark.textContent = String(beat + 1);
      clockElement.append(mark, beat + 1 < count.beats ? " " : "");
    }
    clockElement.dataset.counting = "true";
    pulseBeat(count.beat - 100, count.beat === 0);
    return;
  }
  delete clockElement.dataset.counting;
  if (player.status === "playing" && prefs.metronome && player.timeline) {
    const beat = player.timeline.beat > 0 ? player.timeline.beat : 0.25;
    const bar = player.timeline.bar > 0 ? player.timeline.bar : beat * 4;
    const origin = player.timeline.pickup > 1e-6 ? player.timeline.pickup : 0;
    const index = Math.floor((position - origin) / beat + 1e-6);
    const inBar = (((index * beat) % bar) + bar) % bar;
    pulseBeat(index, inBar < 1e-6);
  }
  if (!line || line.length <= 0) {
    head.style.left = "0%";
    $("clock").textContent = "Bar 1 · 0:00";
    return;
  }
  let at = position;
  if (player.loopingRegion && player.timeline)
    at = firstPlayOf(line, player.timeline.offset) + position;
  at = Math.max(0, Math.min(at, line.length));
  head.style.left = `${(at / line.length) * 100}%`;
  const bar = barAt(line, at);
  const written = writtenBarAt(line, at);
  const number = written?.bar ?? (line.pickup > 1e-6 ? bar : bar + 1);
  // After a D.C. or D.S. jump the clock says so ("Bar 5 · D.S."), and in the coda "Coda".
  const returned = player.loopingRegion
    ? undefined
    : line.returns?.find((each) => at >= each.from - 1e-9 && at < each.to - 1e-9);
  const time = returned
    ? ` · ${returned.label}`
    : written?.repeated
      ? ` · ${ordinal(written.pass)} time`
      : "";
  const seconds = (at / ((line.bpm * player.tempoFactor * line.beat) / 60)) | 0;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const name = number === 0 ? "Pickup" : `Bar ${number}`;
  $("clock").textContent = `${player.loopingRegion ? "Loop · " : ""}${name}${time} · ${clock}`;
  const slider = $("timeline");
  // Value and maximum count bars as played; the text names the written bar.
  slider.setAttribute("aria-valuenow", String(bar + 1));
  slider.setAttribute(
    "aria-valuetext",
    `${name}${returned ? `, ${returned.label === "Coda" ? "in the coda" : `after the ${returned.label}`}` : written?.repeated ? `, ${ordinal(written.pass)} time` : ""}, played bar ${bar + 1} of ${line.bars.length}, ${clock}`,
  );
}

/** The played bar under a point on the ruler (snapped to bar starts). */
function barAtClient(clientX: number): number | null {
  const line = timeline;
  if (!line) return null;
  const box = $("timeline").getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
  return barAt(line, ratio * line.length);
}
function seekToClient(clientX: number) {
  const line = timeline;
  const bar = barAtClient(clientX);
  if (!line || bar === null) return;
  if (loopOn) setLoop(false);
  player.seek(line.bars[bar] ?? 0);
  if (player.status !== "playing") updateHead(line.bars[bar] ?? 0);
  refreshPlace();
}
/* The readout above the ruler: on hover it names the bar under the pointer; while scrubbing
   (larger on a phone, above the finger) it names the bar the music will start from. */
const timelineTip = $("timeline-tip");
function showTip(clientX: number) {
  const line = timeline;
  const bar = barAtClient(clientX);
  if (!line || bar === null) return;
  const ruler = $("timeline").getBoundingClientRect();
  const x = ((line.bars[bar] ?? 0) / line.length) * ruler.width;
  timelineTip.textContent = describePlayedBar(line, bar);
  timelineTip.hidden = false;
  const half = timelineTip.offsetWidth / 2;
  timelineTip.style.left = `${Math.max(half - 8, Math.min(ruler.width - half + 8, x))}px`;
}
let scrubbing = false;
$("timeline").addEventListener("pointerdown", (event) => {
  const ruler = event.currentTarget as HTMLElement;
  scrubbing = true;
  try {
    ruler.setPointerCapture(event.pointerId);
  } catch {
    /* A pointer the browser no longer tracks: the drag still follows while over the ruler. */
  }
  ruler.closest(".position")?.classList.add("scrubbing");
  seekToClient(event.clientX);
  showTip(event.clientX);
});
$("timeline").addEventListener("pointermove", (event) => {
  if (scrubbing) seekToClient(event.clientX);
  if (scrubbing || event.pointerType === "mouse") showTip(event.clientX);
});
const endScrub = () => {
  scrubbing = false;
  $("timeline").closest(".position")?.classList.remove("scrubbing");
  timelineTip.hidden = true;
};
$("timeline").addEventListener("pointerup", endScrub);
$("timeline").addEventListener("pointercancel", endScrub);
$("timeline").addEventListener("pointerleave", () => {
  if (!scrubbing) timelineTip.hidden = true;
});
$("timeline").addEventListener("keydown", (event) => {
  const line = timeline;
  if (!line) return;
  const current = barAt(line, player.position());
  let target = current;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") target = current + 1;
  else if (event.key === "ArrowLeft" || event.key === "ArrowDown") target = current - 1;
  else if (event.key === "Home") target = 0;
  else if (event.key === "End") target = line.bars.length - 1;
  else if (event.key === "PageDown") target = current + 4;
  else if (event.key === "PageUp") target = current - 4;
  else return;
  event.preventDefault();
  target = Math.max(0, Math.min(line.bars.length - 1, target));
  player.seek(line.bars[target] ?? 0);
  updateHead(line.bars[target] ?? 0);
  refreshPlace();
});

/* Voices: mute and solo. */
const muted = new Set<number>();
const soloed = new Set<number>();
function applyMutes() {
  const silent = new Set<number>();
  const tracks = timeline?.tracks ?? [];
  tracks.forEach((_, index) => {
    if (muted.has(index) || (soloed.size && !soloed.has(index))) silent.add(index);
  });
  player.setMuted(silent);
}
function updateVoices() {
  const tracks = timeline?.tracks ?? [];
  $("voices-button").hidden = tracks.length < 2;
  applyMutes();
  // The button says when some voices are silenced: a dot, and words for assistive technology.
  const button = $("voices-button");
  const label = soloed.size ? `${soloed.size} solo` : muted.size ? `${muted.size} muted` : "";
  button.dataset.state = soloed.size ? "solo" : muted.size ? "muted" : "";
  button.setAttribute("aria-label", label ? `Voices: ${label}` : "Voices");
  const text = button.querySelector(".transport-label");
  if (text) text.textContent = label ? `Voices · ${label}` : "Voices";
  // On a phone the voices live in the Sound sheet; its button carries the same mark.
  $("sound-button").dataset.state = button.dataset.state;
}
function voicesPopover(anchor: HTMLElement) {
  const tracks = timeline?.tracks ?? [];
  const panel = popover(anchor, "Voices");
  for (const [index, track] of tracks.entries()) {
    const row = document.createElement("div");
    row.className = "voice-row";
    const name = document.createElement("span");
    name.textContent = track.name;
    const mute = document.createElement("button");
    mute.type = "button";
    mute.textContent = "Mute";
    mute.setAttribute("aria-label", `Mute ${track.name}`);
    mute.setAttribute("aria-pressed", String(muted.has(index)));
    mute.addEventListener("click", () => {
      if (muted.has(index)) muted.delete(index);
      else muted.add(index);
      mute.setAttribute("aria-pressed", String(muted.has(index)));
      updateVoices();
    });
    const solo = document.createElement("button");
    solo.type = "button";
    solo.textContent = "Solo";
    solo.setAttribute("aria-label", `Solo ${track.name}`);
    solo.setAttribute("aria-pressed", String(soloed.has(index)));
    solo.addEventListener("click", () => {
      if (soloed.has(index)) soloed.delete(index);
      else soloed.add(index);
      solo.setAttribute("aria-pressed", String(soloed.has(index)));
      updateVoices();
    });
    row.append(name, mute, solo);
    panel.append(row);
  }
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = tracks.some((track) => track.chords)
    ? "Chords play the tune's chord symbols. Mute and solo apply at once, even while playing."
    : "Mute and solo apply at once, even while playing.";
  panel.append(hint);
}

/* Popovers for the transport. */
let closePopover: (() => void) | null = null;
function popover(anchor: HTMLElement, title: string): HTMLElement {
  closePopover?.();
  const panel = document.createElement("div");
  panel.className = "composer-popover";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", title);
  const heading = document.createElement("h3");
  heading.textContent = title;
  panel.append(heading);
  document.body.append(panel);
  const place = () => {
    const rect = anchor.getBoundingClientRect();
    // From a mark in the editor's gutter it opens to the right; elsewhere it ends at the anchor.
    const left = anchor.closest(".abc-gutter") ? rect.right + 8 : rect.right - panel.offsetWidth;
    panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - panel.offsetWidth - 8))}px`;
    // Above the anchor when it fits, else below it: never over the thing it is about.
    const above = rect.top - panel.offsetHeight - 8;
    panel.style.top = `${above >= 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - panel.offsetHeight - 8)}px`;
  };
  requestAnimationFrame(place);
  const outside = (event: PointerEvent) => {
    if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
      anchor.focus();
    }
  };
  function close() {
    panel.remove();
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("keydown", key);
    anchor.setAttribute("aria-expanded", "false");
    closePopover = null;
  }
  setTimeout(() => {
    document.addEventListener("pointerdown", outside);
    panel.querySelector<HTMLElement>("button, input, select")?.focus();
    place();
  }, 0);
  document.addEventListener("keydown", key);
  anchor.setAttribute("aria-expanded", "true");
  closePopover = close;
  return panel;
}

/** The Sound popover (./sound-panel, loaded when first opened). */
function soundPopover(anchor: HTMLElement) {
  void import("./sound-panel").then((module) =>
    module.fillSound(popover(anchor, "Sound"), {
      player,
      prefs,
      savePrefs,
      setLabel: (label) => {
        $("instrument-label").textContent = label;
      },
      voices:
        compactTransport.matches && !$("voices-button").hidden
          ? {
              label:
                $("voices-button")
                  .getAttribute("aria-label")
                  ?.replace(/^Voices:?\s*/, "") ?? "",
              open: () => voicesPopover(anchor),
            }
          : null,
    }),
  );
}

/* Toolbar and transport wiring. */
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-command]"))
  button.addEventListener("click", () => {
    const command = button.dataset.command as string;
    if (command === "decoration") decorationMenu(button);
    else {
      music(command);
      if (!phone.matches) view.focus();
    }
  });
$("undo").addEventListener("click", () => {
  undo(view);
  view.focus();
});
$("redo").addEventListener("click", () => {
  redo(view);
  view.focus();
});
$("play").addEventListener("click", () => void togglePlay());
$("stop").addEventListener("click", stop);
$("from-caret").addEventListener("click", () => void playFromCaret());
$("loop").addEventListener("click", toggleLoop);
$("tempo-down").addEventListener("click", () =>
  setTempo(Number($<HTMLInputElement>("tempo").value) - 4),
);
$("tempo-up").addEventListener("click", () =>
  setTempo(Number($<HTMLInputElement>("tempo").value) + 4),
);
$("tempo").addEventListener("change", () => {
  const value = $<HTMLInputElement>("tempo").value.trim();
  if (!value) {
    tempoOverride = null;
    applyTempo();
  } else setTempo(Number(value));
});
const taps: number[] = [];
$("tap").addEventListener("click", () => {
  const now = performance.now();
  if (taps.length && now - (taps[taps.length - 1] as number) > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length > 6) taps.shift();
  if (taps.length >= 3) {
    const gaps = taps.slice(1).map((time, index) => time - (taps[index] as number));
    setTempo(60000 / (gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length));
  }
});
function setMetronome(on: boolean) {
  prefs.metronome = on;
  player.metronome = on;
  $("metronome").setAttribute("aria-pressed", String(on));
  savePrefs();
}
function setCountIn(on: boolean) {
  prefs.countIn = on;
  player.countIn = on;
  $("count-in").setAttribute("aria-pressed", String(on));
  savePrefs();
}
$("metronome").addEventListener("click", () => setMetronome(!prefs.metronome));
$("count-in").addEventListener("click", () => setCountIn(!prefs.countIn));
$("voices-button").addEventListener("click", (event) =>
  voicesPopover(event.currentTarget as HTMLElement),
);
$("sound-button").addEventListener("click", (event) =>
  soundPopover(event.currentTarget as HTMLElement),
);
$("problems").addEventListener("click", () => openProblems());
$("announce").addEventListener("click", sayNote);
// On a phone the status line is two lines; a tap opens it fully.
$("explain").addEventListener("click", () => $("explain").classList.toggle("open"));
/* On a phone the status line can fold away (remembered), giving the text its room back. */
function showExplain(hidden: boolean) {
  body.classList.toggle("explain-hidden", hidden);
  const toggle = $("explain-toggle");
  toggle.setAttribute("aria-expanded", String(!hidden));
  toggle.textContent = hidden ? "Show notes" : "Hide";
  toggle.title = hidden ? "Show the explanations under the transport" : "Hide the explanations";
}
showExplain(prefs.explainHidden);
$("explain-toggle").addEventListener("click", () => {
  prefs.explainHidden = !prefs.explainHidden;
  savePrefs();
  showExplain(prefs.explainHidden);
});

/** " Bar 3, voice First." for the note at a position, when the score knows it. */
function placeOf(position: number): string {
  if (!scoreIndex) return "";
  const note = notesAt(scoreIndex, position)[0];
  if (!note) return "";
  const voice =
    scoreIndex.voices.length > 1
      ? `, ${scoreIndex.voices[note.voice]?.name ?? `voice ${note.voice + 1}`}`
      : "";
  return ` Bar ${note.measure + 1}${voice}.`;
}

function sayNote() {
  const explanation = explainAt(text(), fileIndex(), caret());
  const message = explanation
    ? `${explanation.token ? `${explanation.token} — ` : ""}${explanation.text}${placeOf(caret())}`
    : "The caret is not on a note.";
  const live = $("score-live");
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = message;
  });
  $("explain").textContent = message;
}

/* Layout: score beside or below, rail, focus, phone switch, splitter. */
function resolvedLayout(): "beside" | "below" {
  // From tablet width up the score sits beside the text; the rail makes room below 1200 px.
  if (prefs.layout === "auto") return window.innerWidth >= 960 ? "beside" : "below";
  return prefs.layout;
}
function applyLayout() {
  const layout = resolvedLayout();
  workspace.dataset.layout = layout;
  body.dataset.layout = layout;
  // On a phone the rail is an overlay, closed until asked for.
  const railOpen = phone.matches
    ? phoneRail
    : prefs.railChosen
      ? prefs.rail
      : window.innerWidth >= 1200;
  workspace.dataset.rail = railOpen ? "open" : "closed";
  $("rail-toggle").setAttribute("aria-pressed", String(railOpen));
  $("layout-toggle").setAttribute(
    "aria-label",
    layout === "beside"
      ? "Score beside the text: move it below"
      : "Score below the text: move it beside",
  );
  workspace.style.setProperty("--score-share", `${prefs.scoreShare}%`);
  workspace.style.setProperty("--text-share", `${prefs.textShare}%`);
  $("splitter").setAttribute("aria-orientation", layout === "beside" ? "vertical" : "horizontal");
  $("splitter").setAttribute(
    "aria-valuenow",
    String(layout === "beside" ? prefs.scoreShare : prefs.textShare),
  );
}
function setLayout(layout: "beside" | "below") {
  prefs.layout = layout;
  savePrefs();
  applyLayout();
}
$("layout-toggle").addEventListener("click", () =>
  setLayout(resolvedLayout() === "beside" ? "below" : "beside"),
);
let phoneRail = false;
function toggleRail() {
  if (phone.matches) phoneRail = !phoneRail;
  else {
    prefs.rail = workspace.dataset.rail !== "open";
    prefs.railChosen = true;
    savePrefs();
  }
  applyLayout();
  if (workspace.dataset.rail === "open" && phone.matches)
    $("tune-list").querySelector<HTMLElement>("button")?.focus();
}
$("rail-toggle").addEventListener("click", toggleRail);
phone.addEventListener("change", applyLayout);
/* Focus: only the music. With the score, the chrome goes; without it, the text sits in a
   centred column. Escape or the quiet control at the top right leaves it. */
let focusIdle: ReturnType<typeof setTimeout> | undefined;
function setFocusMode(on: boolean) {
  body.classList.toggle("focus-mode", on);
  body.classList.toggle("focus-text", on && !prefs.focusScore);
  $("focus-mode").setAttribute("aria-pressed", String(on));
  $("focus-score").setAttribute("aria-pressed", String(prefs.focusScore));
  $("focus-controls").hidden = !on;
  if (on) wakeFocusControls();
  else $("focus-controls").classList.remove("awake");
  if (on && prefs.focusScore) scheduleRender(0);
}
function wakeFocusControls() {
  const controls = $("focus-controls");
  controls.classList.add("awake");
  clearTimeout(focusIdle);
  focusIdle = setTimeout(() => controls.classList.remove("awake"), 2200);
}
document.addEventListener("pointermove", () => {
  if (body.classList.contains("focus-mode")) wakeFocusControls();
});
$("focus-exit").addEventListener("click", () => {
  setFocusMode(false);
  view.focus();
});
$("focus-score").addEventListener("click", () => {
  prefs.focusScore = !prefs.focusScore;
  savePrefs();
  setFocusMode(true);
});
$("focus-mode").addEventListener("click", () =>
  setFocusMode(!body.classList.contains("focus-mode")),
);
function show(which: "text" | "score") {
  body.dataset.show = which;
  $("show-text").setAttribute("aria-pressed", String(which === "text"));
  $("show-score").setAttribute("aria-pressed", String(which === "score"));
  if (which === "score") scheduleRender(0);
}
$("show-text").addEventListener("click", () => show("text"));
$("show-score").addEventListener("click", () => show("score"));
body.dataset.show = "text";

const splitter = $("splitter");
splitter.addEventListener("pointerdown", (event) => {
  splitter.setPointerCapture(event.pointerId);
  const move = (moveEvent: PointerEvent) => {
    const box = workspace.getBoundingClientRect();
    if (resolvedLayout() === "beside") {
      const right = box.right - moveEvent.clientX;
      prefs.scoreShare = Math.round(Math.max(25, Math.min(75, (right / box.width) * 100)));
    } else {
      const top = moveEvent.clientY - box.top;
      prefs.textShare = Math.round(Math.max(15, Math.min(80, (top / box.height) * 100)));
    }
    applyLayout();
  };
  const up = () => {
    splitter.removeEventListener("pointermove", move);
    splitter.removeEventListener("pointerup", up);
    savePrefs();
  };
  splitter.addEventListener("pointermove", move);
  splitter.addEventListener("pointerup", up);
});
splitter.addEventListener("keydown", (event) => {
  const beside = resolvedLayout() === "beside";
  const step =
    event.key === "ArrowLeft" || event.key === "ArrowUp"
      ? -4
      : event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 4
        : 0;
  if (!step) return;
  event.preventDefault();
  if (beside) prefs.scoreShare = Math.max(25, Math.min(75, prefs.scoreShare - step));
  else prefs.textShare = Math.max(15, Math.min(80, prefs.textShare + step));
  savePrefs();
  applyLayout();
});

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let lastWidth = 0;
new ResizeObserver(() => {
  const width = Math.round(scoreScroll.clientWidth);
  if (Math.abs(width - lastWidth) < 2) return;
  lastWidth = width;
  geometry = null;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => void render(), 140);
}).observe(scoreScroll);
window.addEventListener("resize", () => {
  applyLayout();
});
scoreScroll.addEventListener(
  "scroll",
  () => {
    /* Geometry is in the score's own coordinates, so scrolling keeps it valid. */
  },
  { passive: true },
);

/* The rail: tunes, their voices and parts. */
function updateRail() {
  const index = fileIndex();
  const list = $("tune-list");
  $("tune-count").textContent = String(index.tunes.length);
  const current = tuneAt(index, caret());
  const position = caret();
  const signature = JSON.stringify([
    index.tunes.map((tune) => [
      tune.title,
      tune.key,
      tune.meter,
      tune.voices.map((voice) => voice.id + voice.name),
      tune.parts.map((part) => part.label),
    ]),
    current?.index,
    position,
  ]);
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;
  list.replaceChildren();
  for (const tune of index.tunes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tune-item";
    button.setAttribute("aria-current", String(tune === current || tune.from === current?.from));
    const title = document.createElement("span");
    title.className = "tune-title";
    title.textContent = tuneLabel(tune);
    const meta = document.createElement("span");
    meta.className = "tune-meta";
    meta.textContent = [
      tune.number ? `X:${tune.number}` : "",
      tune.key ? `K:${tune.key}` : "",
      tune.meter ? `M:${tune.meter}` : "",
      tune.rhythm,
    ]
      .filter(Boolean)
      .join(" · ");
    button.append(title, meta);
    button.addEventListener("click", () => goTo(Math.min(tune.bodyFrom, tune.to)));
    // Right-click, Shift F10 or the menu key: what can be done with this tune.
    button.setAttribute("aria-haspopup", "menu");
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      popupMenu(button, bookItems(tune));
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        popupMenu(button, bookItems(tune));
      }
    });
    list.append(button);
    if (
      (tune === current || tune.from === current?.from) &&
      (tune.voices.length > 1 || tune.parts.length)
    ) {
      const sub = document.createElement("div");
      sub.className = "tune-sub";
      const add = (label: string, at: number, active: boolean) => {
        const item = document.createElement("button");
        item.type = "button";
        item.textContent = label;
        item.setAttribute("aria-current", String(active));
        item.addEventListener("click", () => goTo(at));
        sub.append(item);
      };
      const bodyVoices = [
        ...text()
          .slice(tune.bodyFrom, tune.to)
          .matchAll(/^V:\s*(\S+)/gm),
      ].map((match) => ({ id: match[1] as string, at: tune.bodyFrom + (match.index ?? 0) }));
      const voiceNow = bodyVoices.filter((voice) => voice.at <= position).pop()?.id;
      for (const voice of tune.voices) {
        const first = bodyVoices.find((each) => each.id === voice.id);
        add(
          voice.name || `Voice ${voice.id}`,
          first ? text().indexOf("\n", first.at) + 1 || first.at : voice.from,
          voiceNow === voice.id,
        );
      }
      const partNow = tune.parts.filter((part) => part.from <= position).pop();
      for (const part of tune.parts) add(`Part ${part.label}`, part.from, part === partNow);
      list.append(sub);
    }
  }
}
function goTo(position: number) {
  view.dispatch({
    selection: { anchor: Math.min(position, view.state.doc.length) },
    effects: EditorView.scrollIntoView(position, { y: "start", yMargin: 40 }),
  });
  if (phone.matches) {
    phoneRail = false;
    show("text");
    applyLayout();
  } else view.focus();
}

/* Files. */
function updateSavedState() {
  const element = $("saved-state");
  element.textContent = !started
    ? ""
    : pendingLink && !local.linked
      ? `Saved to ${pendingLink.name} earlier · Save to reconnect`
      : dirty()
        ? local.linked
          ? "Edited"
          : "Not saved to a file"
        : local.linked
          ? "Saved"
          : "";
  document.title = `${dirty() ? "• " : ""}${nameInput.value} — VoxDown Composer`;
  // Narrow headers show a short mark instead of the words; the words stay as its title.
  const unsaved = element.textContent !== "" && element.textContent !== "Saved";
  element.dataset.short = unsaved ? "•" : "";
  element.title = element.textContent ?? "";
  // Save is filled only when there is something to save.
  $("save-primary").classList.toggle(
    "quiet",
    !(started && (dirty() || Boolean(pendingLink && !local.linked))),
  );
}

async function openFile() {
  try {
    if (local.canOpen) {
      const picked = await local.pick();
      if (!picked) return;
      // A MusicXML score or a MIDI file becomes a new ABC draft; it is never linked, so Save
      // writes ABC elsewhere.
      if (isMidiFile(picked.name, picked.bytes)) {
        importMidi(picked.bytes, picked.name);
        return;
      }
      if (isScoreFile(picked.name, picked.bytes)) {
        importScore(picked.bytes, picked.name);
        return;
      }
      openBytes(picked.bytes, picked.name);
      local.connect(picked.handle, picked.bytes);
      void keepLink(picked.bytes);
      updateSavedState();
      return;
    }
  } catch {
    noticeError("That file could not be opened. Try again, or drop it onto the page.");
    return;
  }
  $<HTMLInputElement>("file").click();
}
function openBytes(bytes: Uint8Array, name: string) {
  if (isMidiFile(name, bytes)) {
    importMidi(bytes, name);
    return;
  }
  if (isScoreFile(name, bytes)) {
    importScore(bytes, name);
    return;
  }
  try {
    const file = readBytes(bytes);
    local.disconnect();
    load(file, name);
    const index = fileIndex();
    notice(
      `Opened ${name}${index.tunes.length > 1 ? ` · ${index.tunes.length} tunes` : ""}${file.encoding === "windows-1252" ? " · read as Latin-1 and saved the same way" : ""}.`,
      "success",
    );
  } catch (error) {
    noticeError(plainMessage(error, "That file could not be opened."));
  }
}
$<HTMLInputElement>("file").addEventListener("change", async () => {
  const input = $<HTMLInputElement>("file");
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
document.addEventListener("drop", async (event) => {
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  event.preventDefault();
  if (
    !/\.(abc|txt|musicxml|xml|mxl|mid|midi|kar|rmi)$/i.test(file.name) &&
    file.type &&
    !file.type.startsWith("text/")
  ) {
    notice(
      "Composer opens ABC text (.abc, .txt), MusicXML (.musicxml, .xml, .mxl) and MIDI files (.mid, .midi).",
    );
    return;
  }
  openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
});

/* MusicXML and MIDI files (./importers, loaded on first use) open as new ABC drafts. */
let lastImportMs = 0;
const importContext = (): import("./importers").ImportContext => ({
  status: (message) => {
    $("explain").textContent = message;
  },
  open: (abc, title, replace) => {
    if (!replace) local.disconnect();
    load(newSource(abc), abcName(title), { keepDraft: replace });
    void persist();
  },
  noticeError,
  current: () => ({ text: text(), draft: draftId }),
  took: (ms) => {
    lastImportMs = ms;
  },
});
function importScore(bytes: Uint8Array, name: string) {
  void import("./importers").then((module) => module.importScore(importContext(), bytes, name));
}
function importMidi(bytes: Uint8Array, name: string) {
  void import("./importers").then((module) => module.importMidi(importContext(), bytes, name));
}

async function save(saveAs = false) {
  const name = abcName(nameInput.value);
  let encoded: { bytes: Uint8Array<ArrayBuffer>; upgraded: boolean };
  try {
    encoded = encodeText(source, text());
  } catch (error) {
    noticeError(plainMessage(error, "This text cannot be saved."));
    return;
  }
  if (local.canSave && !saveAs && !local.linked && pendingLink) {
    // After a reload: ask to write to the same file again, if nothing else changed it.
    const { handle, hash } = pendingLink;
    try {
      const permitted = handle as FileSystemFileHandle & {
        requestPermission?: (options: { mode: string }) => Promise<string>;
      };
      if (
        permitted.requestPermission &&
        (await permitted.requestPermission({ mode: "readwrite" })) !== "granted"
      )
        throw new Error("denied");
      const current = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if ((await hashBytes(current)) !== hash) {
        noticeError(
          `${handle.name} was changed elsewhere since Composer saved it. Use Save as to keep both, or Download.`,
        );
        return;
      }
      local.connect(handle as never, current);
    } catch {
      noticeError(
        `Composer could not reach ${pendingLink.name} again. Use Save as to choose where to save.`,
      );
      return;
    }
  }
  if (local.canSave) {
    const result = await local.save(encoded.bytes, name, saveAs);
    if (result.status === "saved") {
      void keepLink(encoded.bytes);
      savedText = text();
      nameFollowsTitle = false;
      nameInput.value = result.name;
      updateSavedState();
      notice(
        `Saved ${result.name}${encoded.upgraded ? " as UTF-8, because it now has characters Latin-1 cannot hold" : ""}.`,
        "success",
      );
      return;
    }
    if (result.status === "cancelled" || result.status === "busy") return;
    if (result.status === "conflict") {
      notice(
        `${result.name} was changed by another program since you opened it. Use Save as to keep both, or Download.`,
        "error",
      );
      return;
    }
    if (result.status === "error") {
      noticeError(result.message);
      return;
    }
  }
  download(encoded.bytes, name, "text/vnd.abc;charset=utf-8");
  nameFollowsTitle = false;
  savedText = text();
  updateSavedState();
  notice(`Downloaded ${name}.`, "success");
}
function downloadAbc() {
  const name = abcName(nameInput.value);
  try {
    download(encodeText(source, text()).bytes, name, "text/vnd.abc;charset=utf-8");
    nameFollowsTitle = false;
  } catch (error) {
    noticeError(plainMessage(error, "This text cannot be saved."));
  }
}
$("save-primary").addEventListener("click", () => void save());
nameInput.addEventListener("input", () => {
  nameFollowsTitle = false;
});
nameInput.addEventListener("change", () => {
  nameFollowsTitle = false;
  nameInput.value = abcName(nameInput.value);
  schedulePersist();
  updateSavedState();
});

/**
 * MusicXML out, from abcjs's parse of each tune (the parse the score is drawn from): the tune at
 * the caret as a .musicxml, or every tune as .musicxml files in one .zip.
 */
/** MusicXML out (./musicxml): this tune, or every tune in a .zip. */
const exportMusicXmlFiles = (all: boolean) =>
  import("./musicxml").then((musicxml) =>
    musicxml.exportMusicXmlFiles({
      all,
      text: text(),
      file: fileIndex(),
      tune: tuneAt(fileIndex(), caret()),
      name: nameInput.value,
      notice,
      noticeError,
    }),
  );

/** SVG, the HTML tune book, MIDI and WAV (./exports), with the score's colours for the look. */
const exportRun = (kind: import("./exports").ExportKind) => () => {
  let element: Element | null = $("score");
  const ink = getComputedStyle(element).color;
  let paper = "#ffffff";
  for (; element; element = element.parentElement) {
    const fill = getComputedStyle(element).backgroundColor;
    if (fill && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(fill)) {
      paper = fill;
      break;
    }
  }
  void import("./exports").then((module) =>
    module.openExport(kind, {
      text: text(),
      file: fileIndex(),
      tune: scoreIndex?.tune ?? tuneAt(fileIndex(), caret()),
      name: nameInput.value,
      timeline,
      followJumps: prefs.followJumps,
      tempoFactor: player.tempoFactor,
      instrument: player.instrument,
      look: { ink, paper },
      render: (line) => player.render(line),
      notice,
      noticeError,
    }),
  );
};
/** Every tune, drawn for paper with the screen's fonts. Synchronous, so the browser's own Print
 * (which gives no time to wait) can use it too. */
function fillPrint(abcjs: typeof import("abcjs")): boolean {
  const container = $("print-score");
  container.replaceChildren();
  const index = fileIndex();
  for (const tune of index.tunes) {
    const holder = document.createElement("div");
    holder.className = "print-tune";
    container.append(holder);
    const { source: abc } = tuneSource({ text: text(), file: index, tune });
    abcjs.renderAbc(holder, abc, {
      staffwidth: 680,
      paddingleft: 0,
      paddingright: 0,
      add_classes: true,
      format: scoreFormat(false),
      afterParsing: prepareTune,
      wrap: { minSpacing: 1.8, maxSpacing: 2.6, preferredMeasuresPerLine: 4 },
    } as Any);
    drawPassDynamics(holder);
    // Short tunes (an incipit, a two-line air) share a page; longer ones start a page each.
    if (Number(holder.querySelector("svg")?.getAttribute("height")) < 330)
      holder.classList.add("short");
  }
  return index.tunes.length > 0;
}
async function printScore() {
  fillPrint(await loadAbcjs());
  window.print();
}
window.addEventListener("beforeprint", () => {
  if (loadedAbcjs && !$("print-score").childElementCount) fillPrint(loadedAbcjs);
});
window.addEventListener("afterprint", () => $("print-score").replaceChildren());

/* Recovery: this tab's draft, kept as you type. */
function flushDraft() {
  clearTimeout(persistTimer);
  const { normalized: _normalized, ...meta } = source;
  if (!text()) return;
  void keepDraft({
    id: draftId,
    name: nameInput.value,
    text: text(),
    updated: Date.now(),
    source: meta,
    link: link ?? undefined,
  }).catch(() => {});
}
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void persist(), 700);
}
async function persist() {
  if (!started) return;
  const { normalized: _normalized, ...meta } = source;
  try {
    await keepDraft({
      id: draftId,
      name: nameInput.value,
      text: text(),
      updated: Date.now(),
      source: meta,
      link: link ?? undefined,
    });
    setSessionDraftId(draftId);
    $("recovery").textContent = "Draft kept in this browser";
  } catch {
    $("recovery").textContent = "Recovery unavailable — save or download your file";
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(persistTimer);
    void persist();
    if (player.status === "playing") {
      /* Keep playing: the clock runs in a worker. */
    }
  }
});

function draftSource(draft: { source: Omit<SourceFile, "normalized"> }): SourceFile {
  try {
    return readText(draft.source.original, draft.source.encoding);
  } catch {
    return newSource("");
  }
}

async function recoverDraft(id: string) {
  const draft = await getDraft(id);
  if (!draft) return notice("That draft is no longer in this browser.");
  local.disconnect();
  load(draftSource(draft), draft.name, { text: draft.text });
  notice(
    `Recovered “${draft.name}”. Edits are kept as a new draft; the original stays under Recover.`,
    "success",
  );
}

const recoverDialog = createDialog("recover-dialog", "Recover a draft");
async function openRecover() {
  recoverDialog.body.replaceChildren();
  const intro = document.createElement("p");
  intro.textContent =
    "Every tab keeps its own draft in this browser as you write. Open one to carry on; it opens as a new draft, so nothing is overwritten.";
  recoverDialog.body.append(intro);
  try {
    const drafts = await listDrafts(30);
    if (!drafts.length) {
      const empty = document.createElement("p");
      empty.textContent = "No drafts yet.";
      recoverDialog.body.append(empty);
    }
    for (const draft of drafts) {
      const row = document.createElement("div");
      row.className = "recent-row";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "open";
      openButton.textContent = draft.title || draft.name;
      const small = document.createElement("small");
      small.textContent = `${draft.name} · ${humanDate(draft.updated)} · ${draft.characters.toLocaleString()}\u00a0characters`;
      openButton.append(small);
      openButton.addEventListener("click", () => {
        recoverDialog.close();
        void recoverDraft(draft.id);
      });
      // The draft open in this tab says so instead of offering a Delete it cannot do.
      if (draft.id === draftId) {
        const here = document.createElement("span");
        here.className = "recent-here";
        here.textContent = "Open here";
        row.append(openButton, here);
      } else {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "recent-delete";
        remove.textContent = "Delete";
        remove.setAttribute("aria-label", `Delete draft ${draft.title || draft.name}`);
        remove.addEventListener("click", async () => {
          await deleteDraft(draft.id);
          row.remove();
        });
        row.append(openButton, remove);
      }
      recoverDialog.body.append(row);
    }
  } catch {
    const failed = document.createElement("p");
    failed.textContent = "Browser storage is unavailable here, so drafts cannot be listed.";
    recoverDialog.body.append(failed);
  }
  recoverDialog.open();
}

async function fillRecentStart() {
  try {
    const drafts = (await listDrafts(4)).filter((draft) => draft.characters > 0);
    const list = $("recent-list");
    list.replaceChildren();
    for (const draft of drafts) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "example";
      const title = document.createElement("strong");
      title.textContent = draft.title || draft.name;
      const meta = document.createElement("span");
      meta.textContent = `${draft.name} · ${humanDate(draft.updated)}`;
      button.append(title, meta);
      button.addEventListener("click", () => void recoverDraft(draft.id));
      list.append(button);
    }
    $("recent-start").hidden = drafts.length === 0;
  } catch {
    $("recent-start").hidden = true;
  }
}

async function recentMenu(anchor: HTMLElement) {
  const files = await recentFiles().catch(() => []);
  const items: MenuItem[] = files.length
    ? files.map((file) => ({
        label: file.name,
        run: async () => {
          try {
            const handle = file.handle as FileSystemFileHandle & {
              requestPermission?: (options: { mode: string }) => Promise<string>;
            };
            if (
              handle.requestPermission &&
              (await handle.requestPermission({ mode: "readwrite" })) !== "granted"
            )
              return;
            const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
            openBytes(bytes, file.name);
            local.connect(handle as never, bytes);
            void rememberFile(file.name, handle);
          } catch {
            await forgetFile(file.id);
            noticeError(`${file.name} could not be reopened. It may have moved; use Open.`);
          }
        },
      }))
    : [{ heading: "No recent files yet" }];
  items.push("-", { label: "Recover a draft…", run: () => void openRecover() });
  popupMenu(anchor, items);
}

/* Help, shortcuts, appearance. */
// The cheat sheet and the shortcut list load the first time they open.
const sheet = lazyDialog("cheatsheet", "ABC cheat sheet", true, async () =>
  (await import("./help")).cheatsheet(),
);
const shortcuts = lazyDialog("shortcuts", "Keyboard shortcuts", false, async () => {
  const help = await import("./help");
  return help.shortcutTable(help.SHORTCUTS);
});
const about = lazyDialog("about", "About VoxDown Composer", false, async () =>
  (await import("./help")).aboutContent(),
);
$("cheatsheet-open").addEventListener("click", () => sheet.open());

const LOOKS = [
  {
    id: "auto",
    label: "Auto",
    tone: "As your device",
    swatch: "linear-gradient(135deg, #ffffff 50%, #1b1d21 50%)",
    ink: "#25282d",
  },
  { id: "paper", label: "Paper", tone: "Light", swatch: "#ffffff", ink: "#25282d" },
  { id: "sepia", label: "Sepia", tone: "Light, warm", swatch: "#f7f0e1", ink: "#33291d" },
  { id: "night", label: "Night", tone: "Dark", swatch: "#1b1d21", ink: "#e4e5e3" },
  { id: "slate", label: "Slate", tone: "Dark, softer", swatch: "#262c35", ink: "#d9dee5" },
  {
    id: "contrast",
    label: "High contrast",
    tone: "Light, every mark darker",
    swatch: "#ffffff",
    ink: "#000000",
  },
];
function applyLook(look: string) {
  const root = document.documentElement;
  root.dataset.look = look;
  root.dataset.theme =
    look === "auto" ? "system" : look === "night" || look === "slate" ? "dark" : "light";
  const label = LOOKS.find((each) => each.id === look)?.label ?? "Auto";
  $("appearance").textContent = `◐ ${label}`;
  $("appearance").setAttribute("aria-label", `Appearance: ${label}`);
}
const looks = createDialog("looks", "Appearance");
{
  const intro = document.createElement("p");
  intro.textContent = "The paper and ink for the text and the score.";
  const group = document.createElement("fieldset");
  group.className = "look-choices";
  const legend = document.createElement("legend");
  legend.className = "sr-only";
  legend.textContent = "Look";
  group.append(legend);
  for (const look of LOOKS) {
    const label = document.createElement("label");
    label.className = "look-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "look";
    input.value = look.id;
    input.checked = prefs.look === look.id;
    input.addEventListener("change", () => {
      prefs.look = look.id;
      try {
        localStorage.setItem("vxd-composer-look", look.id);
      } catch {
        /* This visit only. */
      }
      applyLook(look.id);
    });
    const swatch = document.createElement("span");
    swatch.className = "look-swatch";
    swatch.style.background = look.swatch;
    swatch.style.color = look.ink;
    swatch.textContent = "♪";
    swatch.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = look.label;
    const tone = document.createElement("small");
    tone.textContent = look.tone;
    name.append(tone);
    label.append(input, swatch, name);
    group.append(label);
  }
  looks.body.append(intro, group);
}
$("appearance").addEventListener("click", () => looks.open());
applyLook(prefs.look);

const offlineDialog = lazyDialog("offline-dialog", "Work offline", false, async () =>
  (await import("./offline-dialog")).offlinePanel(player),
);

/** Problems as a list above the footer button; the editor stays usable beside it. */
function problemText(problem: Problem): string {
  const line = view.state.doc.lineAt(Math.min(problem.from, view.state.doc.length)).number;
  return problem.label ? `Line ${line}, ${problem.label}` : `Line ${line} — ${problem.message}`;
}
function goToProblem(problem: Problem, focusEditor = true) {
  view.dispatch({
    selection: { anchor: problem.from, head: Math.min(problem.to, view.state.doc.length) },
    scrollIntoView: true,
  });
  $("explain").textContent = problemText(problem);
  if (focusEditor) view.focus();
}
function openProblems(anchor: HTMLElement = $("problems"), only?: Problem[]) {
  const shown = only ?? problems;
  const bars = shown.filter((problem) => problem.kind === "bar").length;
  const lyrics = shown.filter((problem) => problem.kind === "lyrics").length;
  const title =
    bars === shown.length
      ? "Bars to check"
      : lyrics === shown.length
        ? "Lyrics to check"
        : bars
          ? "Bars and problems to check"
          : shown.length === 1
            ? "A problem to check"
            : "Problems to check";
  const panel = popover(anchor, title);
  panel.classList.add("problems-popover");
  const list = document.createElement("ul");
  list.className = "problem-list";
  for (const problem of shown) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    // From the gutter mark: the whole sentence; in the list, the short label with its line.
    button.textContent = only ? problem.message : problemText(problem);
    button.addEventListener("click", () => {
      closePopover?.();
      goToProblem(problem);
    });
    item.append(button);
    // abcjs's own words under ours, only when no reading of ours fits.
    if (problem.detail) {
      const detail = document.createElement("p");
      detail.className = "problem-detail";
      detail.textContent = problem.detail;
      item.append(detail);
    }
    if (problem.fix) {
      const { fix } = problem;
      const repair = document.createElement("button");
      repair.type = "button";
      repair.className = "problem-fix";
      repair.textContent = fix.label;
      repair.addEventListener("click", () => {
        closePopover?.();
        view.dispatch({
          changes: { from: fix.from, to: fix.to, insert: fix.insert },
          selection: { anchor: fix.from },
          scrollIntoView: true,
          userEvent: "input",
        });
        view.focus();
        runChecks(true);
      });
      item.append(repair);
    }
    list.append(item);
  }
  panel.append(list);
  if (!only) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "F8 goes to the next, Shift F8 to the previous.";
    panel.append(hint);
  }
}
// A problem's gutter mark opens that line's problems, with their fixes.
onIssueGutter((lineFrom, element) => {
  const doc = view.state.doc;
  const here = problems.filter(
    (problem) => doc.lineAt(Math.min(problem.from, doc.length)).from === lineFrom,
  );
  if (here.length) openProblems(element, here);
});
/** F8 / Shift F8: the next or previous problem after the caret, wrapping around. */
function stepProblem(direction: 1 | -1): boolean {
  if (!problems.length) {
    notice("Nothing to check: every bar fits its meter, every syllable has a note.", "success");
    return true;
  }
  const sorted = [...problems].sort((a, b) => a.from - b.from);
  const at = view.state.selection.main.from;
  const next =
    direction > 0
      ? (sorted.find((problem) => problem.from > at) ?? sorted[0])
      : ([...sorted].reverse().find((problem) => problem.from < at) ?? sorted[sorted.length - 1]);
  if (next) goToProblem(next);
  return true;
}

/* Menus. */
const menuDefinitions: Record<string, () => MenuItem[]> = {
  file: () => [
    { label: "New tune file", run: newFile, shortcut: "" },
    { label: "Open ABC, MusicXML or MIDI…", run: () => void openFile(), shortcut: "Mod O" },
    { label: "Recent…", run: () => void recentMenu($("file-menu")) },
    {
      label: "Examples",
      id: "examples",
      submenu: () =>
        EXAMPLES.map((example) => ({
          label: `${example.title} — ${example.blurb}`,
          id: `example-${example.id}`,
          run: () => openExample(example.id),
        })),
    },
    { label: "Recover a draft…", run: () => void openRecover() },
    "-",
    { label: "Save", run: () => void save(), shortcut: "Mod S" },
    { label: "Save as…", run: () => void save(true), shortcut: "Mod Shift S" },
    { label: "Download .abc", run: downloadAbc },
    "-",
    {
      label: "Export MusicXML",
      id: "export-musicxml",
      submenu: () => [
        {
          label: "This tune (.musicxml)…",
          run: () => void exportMusicXmlFiles(false),
          enabled: () => fileIndex().tunes.length > 0,
        },
        {
          label:
            fileIndex().tunes.length > 1
              ? `Every tune, ${fileIndex().tunes.length} files in one .zip…`
              : "Every tune in one .zip (this file has one tune)",
          run: () => void exportMusicXmlFiles(true),
          enabled: () => fileIndex().tunes.length > 1,
        },
      ],
    },
    {
      label: "Export",
      id: "export",
      submenu: () => {
        const some = () => fileIndex().tunes.length > 0;
        return [
          { label: "SVG of this tune…", run: exportRun("svg"), enabled: some },
          { label: "HTML tune book…", run: exportRun("html"), enabled: some },
          { label: "MIDI…", run: exportRun("midi"), enabled: some },
          { label: "Audio (WAV)…", run: exportRun("wav"), enabled: some },
        ];
      },
    },
    { label: "Print or save as PDF…", run: () => void printScore(), shortcut: "Mod P" },
  ],
  edit: () => [
    {
      label: "Undo",
      run: () => undo(view),
      shortcut: "Mod Z",
      enabled: () => undoDepth(view.state) > 0,
    },
    {
      label: "Redo",
      run: () => redo(view),
      shortcut: "Mod Shift Z",
      enabled: () => redoDepth(view.state) > 0,
    },
    "-",
    { label: "Cut", run: () => clipboard("cut"), shortcut: "Mod X", enabled: hasSelection },
    { label: "Copy", run: () => clipboard("copy"), shortcut: "Mod C", enabled: hasSelection },
    { label: "Paste", run: () => void pasteText(), shortcut: "Mod V" },
    {
      label: "Select all",
      run: () => {
        view.focus();
        selectAll(view);
      },
      shortcut: "Mod A",
    },
    "-",
    { label: "Find and replace…", run: openFind, shortcut: "Mod F" },
    {
      label: hasSelection() ? "Find this melody…" : "Find melody…",
      run: () => void findMelody(),
      shortcut: "Mod Shift M",
    },
    {
      label: "Typing helpers",
      submenu: () => [
        {
          label: "Bar line on Space when the bar is full",
          run: () => setHelper("barOnSpace", !prefs.barOnSpace),
          checked: () => prefs.barOnSpace,
        },
        {
          label: "Automatic octave",
          run: () => setHelper("autoOctave", !prefs.autoOctave),
          checked: () => prefs.autoOctave,
        },
      ],
    },
    { label: "Next bar or problem to check", run: () => stepProblem(1), shortcut: "F8" },
    {
      label: "Previous bar or problem to check",
      run: () => stepProblem(-1),
      shortcut: "Shift F8",
    },
    "-",
    {
      label: "Notes",
      id: "notes",
      submenu: () => [
        { label: "Up a semitone", run: () => music("transpose-up"), shortcut: "Alt ↑" },
        { label: "Down a semitone", run: () => music("transpose-down"), shortcut: "Alt ↓" },
        { label: "Up an octave", run: () => music("octave-up"), shortcut: "Alt Shift ↑" },
        { label: "Down an octave", run: () => music("octave-down"), shortcut: "Alt Shift ↓" },
        "-",
        { label: "Double lengths", run: () => music("double"), shortcut: "Alt BracketRight" },
        { label: "Halve lengths", run: () => music("halve"), shortcut: "Alt BracketLeft" },
        { label: "Add a dot", run: () => music("dot"), shortcut: "Alt Period" },
        { label: "Remove a dot", run: () => music("undot"), shortcut: "Alt Comma" },
        "-",
        { label: "Tie or untie", run: () => music("tie"), shortcut: "Alt T" },
        { label: "Slur or unslur", run: () => music("slur"), shortcut: "Alt S" },
      ],
    },
    {
      label: "Duplicate bar or selection",
      run: () => music("duplicate"),
      shortcut: "Mod Shift D",
    },
    {
      label: "Extend selection by a note",
      run: () => moveByNote(1, true),
      shortcut: "Alt Shift →",
    },
  ],
  insert: () => [
    { label: "New tune", run: newTune },
    { label: "Bar line", run: () => music("bar") },
    { label: "Decoration…", run: () => decorationMenu($("insert-menu")), shortcut: "Alt D" },
    { label: "Dynamic for the 2nd time…", run: insertPassDynamic },
    "-",
    { label: "Second voice", run: insertVoice },
    { label: "Lyrics line", run: insertLyrics },
    { label: "Chord symbol", run: () => insertAtCaret('""', 1) },
    { label: "Triplet", run: () => insertAtCaret("(3", 2) },
    { label: "Repeat", run: () => insertAtCaret("|:  :|", 3) },
  ],
  view: () => [
    {
      label: "Score beside",
      run: () => setLayout("beside"),
      checked: () => resolvedLayout() === "beside",
      shortcut: "Mod Backslash",
    },
    {
      label: "Score below",
      run: () => setLayout("below"),
      checked: () => resolvedLayout() === "below",
    },
    { label: "Tunes panel", run: toggleRail, checked: () => workspace.dataset.rail === "open" },
    "-",
    {
      label: "Zoom in",
      run: () => stepZoom(lastPane ?? "score", 1),
      shortcut: "Mod Equal",
    },
    {
      label: "Zoom out",
      run: () => stepZoom(lastPane ?? "score", -1),
      shortcut: "Mod Minus",
    },
    { label: "Actual size", run: () => stepZoom(lastPane ?? "score", 0), shortcut: "Mod 0" },
    {
      label: "Focus",
      run: () => setFocusMode(!body.classList.contains("focus-mode")),
      checked: () => body.classList.contains("focus-mode"),
      shortcut: "Mod Shift F",
    },
    {
      label: "Score in Focus",
      run: () => {
        prefs.focusScore = !prefs.focusScore;
        savePrefs();
        if (body.classList.contains("focus-mode")) setFocusMode(true);
      },
      checked: () => prefs.focusScore,
    },
    "-",
    { label: "Appearance…", run: () => looks.open() },
    { label: "Work offline…", run: () => offlineDialog.open() },
  ],
  play: () => [
    {
      label: player.status === "playing" ? "Pause" : "Play",
      run: () => void togglePlay(),
      shortcut: "Mod Enter",
    },
    {
      label: "Play from the caret",
      run: () => void playFromCaret(),
      shortcut: "Mod Shift Enter",
    },
    {
      label: "Play the selection",
      run: () => void playSelection(false),
      shortcut: "Mod Alt Enter",
    },
    {
      label: "Loop the selection or bar",
      run: toggleLoop,
      checked: () => loopOn,
      shortcut: "Mod Shift L",
    },
    { label: "Stop", run: stop, shortcut: "Mod Period" },
    "-",
    {
      label: "Faster",
      run: () => setTempo(Number($<HTMLInputElement>("tempo").value) + 4),
      shortcut: "Mod Alt Equal",
    },
    {
      label: "Slower",
      run: () => setTempo(Number($<HTMLInputElement>("tempo").value) - 4),
      shortcut: "Mod Alt Minus",
    },
    {
      label: "Tempo from the tune",
      run: () => {
        tempoOverride = null;
        applyTempo();
      },
      enabled: () => tempoOverride !== null,
    },
    "-",
    {
      label: "Metronome",
      run: () => setMetronome(!prefs.metronome),
      checked: () => prefs.metronome,
      shortcut: "Mod Alt M",
    },
    {
      label: "Count in one bar",
      run: () => setCountIn(!prefs.countIn),
      checked: () => prefs.countIn,
    },
    {
      label: "Follow D.C./D.S. jumps",
      run: () => setFollowJumps(!prefs.followJumps),
      checked: () => prefs.followJumps,
    },
    {
      label: "Hear notes as you write",
      run: () => {
        prefs.hear = !prefs.hear;
        savePrefs();
      },
      checked: () => prefs.hear,
    },
    { label: "Sound…", run: () => soundPopover($("sound-button")) },
    "-",
    { label: "MIDI keyboard…", run: openMidiKeyboard },
  ],
  help: () => [
    { label: "ABC cheat sheet", run: () => sheet.open(), shortcut: "F1" },
    { label: "Keyboard shortcuts", run: () => shortcuts.open() },
    { label: "Say the note at the caret", run: sayNote, shortcut: "Alt N" },
    "-",
    ...EXAMPLES.map((example) => ({
      label: `Example: ${example.title}`,
      run: () => openExample(example.id),
    })),
    "-",
    { label: "About VoxDown Composer", run: () => about.open() },
  ],
};
// Tune-book commands have a menu of their own (and each tune's menu in the rail).
menuDefinitions.tunes = () => [
  { label: "New tune at the end", run: newTune },
  ...bookItems(),
  "-",
  { label: "Tunes panel", run: toggleRail, checked: () => workspace.dataset.rail === "open" },
];
// A phone shows File, Edit and Tunes; Insert, View, Play and Help are under ⋯.
menuDefinitions.more = () =>
  (["insert", "view", "play", "help"] as const).map((name) => ({
    label: name[0]?.toUpperCase() + name.slice(1),
    id: `more-${name}`,
    submenu: () => menuDefinitions[name]?.() ?? [],
  }));
const menus = mountMenus(
  [...document.querySelectorAll<HTMLButtonElement>(".workspace-menus button")],
  menuDefinitions,
);

function insertAtCaret(insert: string, caretOffset: number) {
  const at = caret();
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + caretOffset },
    userEvent: "input",
  });
  view.focus();
}
function insertVoice() {
  const tune = tuneAt(fileIndex(), caret());
  if (!tune) return;
  const ids = tune.voices.map((voice) => voice.id);
  const next = String(ids.length ? Math.max(0, ...ids.map((id) => Number(id) || 0)) + 1 : 2);
  const insert = `${ids.length ? "" : "V:1\n"}`;
  const doc = text();
  const end = tune.to;
  const lead = doc.slice(0, end).endsWith("\n") ? "" : "\n";
  const addition = `${lead}V:${next} clef=bass\nz4 |\n`;
  const changes = [{ from: end, insert: addition }];
  if (insert) changes.unshift({ from: tune.bodyFrom, insert });
  view.dispatch({
    changes,
    selection: { anchor: end + addition.length - 2 + insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}
function insertLyrics() {
  const line = view.state.doc.lineAt(caret());
  const insert = "\nw: ";
  view.dispatch({
    changes: { from: line.to, insert },
    selection: { anchor: line.to + insert.length },
    userEvent: "input",
  });
  view.focus();
}

/**
 * A new tune's file name follows its first T: line ("Evening Song.abc") until the writer renames
 * it or saves it; "Untitled tune" keeps "Untitled.abc".
 */
function nameFromTitle(): string {
  const title = /^T:[ \t]*(.*?)\s*$/m.exec(text())?.[1] ?? "";
  return !title || title === "Untitled tune" ? "Untitled.abc" : abcName(title);
}
function followTitle() {
  if (!nameFollowsTitle) return;
  const name = nameFromTitle();
  if (nameInput.value !== name) {
    nameInput.value = name;
    updateSavedState();
  }
}
function startNewTune() {
  load(newSource(NEW_TUNE), "Untitled.abc", { caretAt: NEW_TUNE.length });
  nameFollowsTitle = true;
}
function newFile() {
  local.disconnect();
  startNewTune();
  notice("A new tune. Your previous draft is kept under File › Recover a draft.", "success");
}
function openExample(id: string) {
  const example = EXAMPLES.find((each) => each.id === id);
  if (!example) return;
  const hadWork = started && text().length > 0;
  local.disconnect();
  load(newSource(example.text), example.file);
  // A new draft of its own: the tune that was open keeps its draft and stays recoverable.
  void persist();
  if (hadWork)
    notice(
      `Opened “${example.title}” as a new draft. Your previous tune is kept under File › Recover a draft.`,
      "success",
    );
}

/* Global keys that work outside the editor too. */
document.addEventListener("keydown", (event) => {
  const mod = event.ctrlKey || event.metaKey;
  const inEditor = view.hasFocus;
  const inField =
    event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
  const quiet = !menus.isOpen() && !document.querySelector("dialog[open], .composer-popover");
  if (event.key === "Escape" && !noticeElement.hidden && quiet) notice("");
  else if (
    event.key === "Escape" &&
    quiet &&
    !event.defaultPrevented &&
    body.classList.contains("focus-mode")
  ) {
    event.preventDefault();
    setFocusMode(false);
  }
  if (event.key === "F1") {
    event.preventDefault();
    sheet.open();
  } else if (event.key === "F10" && !event.shiftKey && !mod && !event.altKey) {
    // F10 goes to the menu bar, as in desktop applications.
    event.preventDefault();
    $("file-menu").focus();
  } else if (event.key === "F8" && !inEditor) {
    event.preventDefault();
    stepProblem(event.shiftKey ? -1 : 1);
  } else if (mod && !event.altKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void save(event.shiftKey);
  } else if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    void openFile();
  } else if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "p") {
    event.preventDefault();
    void printScore();
  } else if (mod && event.key === "\\") {
    event.preventDefault();
    setLayout(resolvedLayout() === "beside" ? "below" : "beside");
  } else if (mod && event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    setFocusMode(!body.classList.contains("focus-mode"));
  } else if (
    mod &&
    !event.altKey &&
    zoomPane() &&
    (event.key === "=" ||
      event.key === "+" ||
      event.key === "-" ||
      event.key === "0" ||
      event.code === "Equal" ||
      event.code === "Minus" ||
      event.code === "Digit0")
  ) {
    // Only for the score or the text; elsewhere the browser zooms the page.
    event.preventDefault();
    const pane = zoomPane() as Pane;
    const out = event.key === "-" || event.code === "Minus";
    const reset = event.key === "0" || event.code === "Digit0";
    stepZoom(pane, reset ? 0 : out ? -1 : 1);
  } else if (
    mod &&
    event.altKey &&
    (event.key === "=" || event.key === "+" || event.code === "Equal")
  ) {
    event.preventDefault();
    setTempo(Number($<HTMLInputElement>("tempo").value) + 4);
  } else if (mod && event.altKey && (event.key === "-" || event.code === "Minus")) {
    event.preventDefault();
    setTempo(Number($<HTMLInputElement>("tempo").value) - 4);
  } else if (mod && event.altKey && event.code === "KeyM") {
    event.preventDefault();
    setMetronome(!prefs.metronome);
  } else if (!inEditor && !inField) {
    // The playback keys also work from the score, toolbar and transport.
    if (mod && event.key === "Enter") {
      event.preventDefault();
      if (event.altKey) void playSelection(false);
      else if (event.shiftKey) void playFromCaret();
      else void togglePlay();
    } else if (mod && event.shiftKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      toggleLoop();
    } else if (mod && event.key === ".") {
      event.preventDefault();
      stop();
    }
  }
});
// Warm the sound on the first sign of intent to listen or write.
const warm = () => {
  void player.warm().catch(() => {});
  document.removeEventListener("pointerdown", warm, true);
  document.removeEventListener("keydown", warm, true);
};
document.addEventListener("pointerdown", warm, true);
document.addEventListener("keydown", warm, true);

/* Start. */
function updateAll(immediate = false) {
  updateRail();
  scheduleRender(immediate ? 0 : undefined);
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => runChecks(), immediate ? 300 : 750);
}

function fillExamples() {
  const list = $("examples");
  for (const example of EXAMPLES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "example";
    const title = document.createElement("strong");
    title.textContent = example.title;
    const meta = document.createElement("span");
    meta.textContent = example.about;
    button.append(title, meta);
    button.addEventListener("click", () => openExample(example.id));
    list.append(button);
  }
}
$("start-new").addEventListener("click", startNewTune);
$("start-open").addEventListener("click", () => void openFile());

/* Keyboard paths: one Tab stop for the menu bar, the toolbar and the transport buttons. */
for (const title of document.querySelectorAll(".workspace-menus button"))
  title.setAttribute("role", "menuitem");
rovers.push(
  roving(document.querySelector(".workspace-menus") as HTMLElement, "button"),
  roving(document.querySelector(".documentbar .toolbar") as HTMLElement, "button"),
  roving(transportElement, ".transport-main button, .transport-side > button, .tempo button"),
);
$("skip-tune").addEventListener("click", (event) => {
  event.preventDefault();
  if (phone.matches) show("text");
  view.focus();
});
$("skip-score").addEventListener("click", (event) => {
  event.preventDefault();
  if (phone.matches) show("score");
  scoreScroll.focus();
});
$("rail-close").addEventListener("click", () => {
  if (workspace.dataset.rail === "open") toggleRail();
  $("rail-toggle").focus();
});
// Shortcuts named in titles are also given to assistive technology.
// Titles name shortcuts in this platform's words: ⌘⌥↩ on a Mac, Ctrl+Alt+Enter elsewhere.
for (const element of document.querySelectorAll<HTMLElement>("[title]")) {
  const match = /\(([^)]+)\)\s*$/.exec(element.title);
  if (!match) continue;
  const named = (match[1] as string).replace(/Ctrl\/⌘/g, "Mod");
  element.title = element.title.replace(/\(([^)]+)\)\s*$/, `(${shortcutLabel(named)})`);
  if (!element.hasAttribute("aria-keyshortcuts"))
    element.setAttribute("aria-keyshortcuts", shortcutAria(named));
}
// On a phone, the commands that do not fit the toolbar are one tap away.
$("more-tools").addEventListener("click", (event) =>
  popupMenu(event.currentTarget as HTMLElement, [
    { label: "Play the selection", run: () => void playSelection(false) },
    { label: "Select more", run: () => setSelectMore(!selectMore), checked: () => selectMore },
    "-",
    { label: "Halve lengths", run: () => music("halve") },
    { label: "Double lengths", run: () => music("double") },
    { label: "Add a dot", run: () => music("dot") },
    { label: "Remove a dot", run: () => music("undot") },
    { label: "Up an octave", run: () => music("octave-up") },
    { label: "Down an octave", run: () => music("octave-down") },
    "-",
    { label: "Bar line", run: () => music("bar") },
    { label: "Tie or untie", run: () => music("tie") },
    { label: "Slur or unslur", run: () => music("slur") },
    { label: "Decoration…", run: () => decorationMenu($("more-tools")) },
    { label: "New tune", run: newTune },
    "-",
    { label: "Focus", run: () => setFocusMode(!body.classList.contains("focus-mode")) },
    { label: "ABC cheat sheet", run: () => sheet.open() },
    { label: "Tunes panel", run: toggleRail },
  ]),
);

applyLayout();
setMetronome(prefs.metronome);
setCountIn(prefs.countIn);
$("instrument-label").textContent = INSTRUMENTS[prefs.instrument].label;
fillExamples();

async function start() {
  const id = sessionDraftId();
  if (id) {
    try {
      const mine = await claimDraft(id);
      const draft = mine ? await getDraft(id) : undefined;
      if (draft) {
        draftId = id;
        load(draftSource(draft), draft.name, { keepDraft: true, text: draft.text });
        if (draft.link) {
          link = draft.link;
          const saved = draft.link;
          void recentFiles()
            .then((files) => {
              const file = files.find((each) => each.id === saved.fileId);
              if (file) pendingLink = { handle: file.handle, name: saved.name, hash: saved.hash };
              updateSavedState();
            })
            .catch(() => {});
        }
        $("recovery").textContent = "Recovered this tab's draft";
        return;
      }
    } catch {
      /* Fall through to the start screen. */
    }
  }
  setSessionDraftId(null);
  draftId = newDraftId();
  showStart(true);
  $("recovery").textContent = "Drafts are kept in this browser as you write";
}
void start();

// For the browser checks: a narrow, read-only view of what is playing and drawn.
(window as unknown as { composer: unknown }).composer = {
  player,
  view,
  state: () => ({
    status: player.status,
    position: player.position(),
    lit: litPlaying.length,
    playingKey,
    scheduled: player.metrics.scheduled,
    metrics: { ...player.metrics },
    loop: loopOn,
    zoom: { score: prefs.scoreZoom, editor: prefs.editorZoom },
    region: player.loopingRegion,
    notes: scoreIndex?.notes.length ?? 0,
    importMs: lastImportMs,
    timeline: timeline
      ? { length: timeline.length, notes: timeline.notes.length, tracks: timeline.tracks.length }
      : null,
  }),
  scoreIndex: () => scoreIndex,
  /** What the player schedules: each note's time, MIDI pitch and track, for checks. */
  timelineNotes: () =>
    timeline?.notes.map((note) => ({ time: note.time, pitch: note.pitch, track: note.track })) ??
    [],
  breaks: () => breaks,
  /** Where a page point reads in the music: its note and how far it reached, for checks. */
  hit: (x: number, y: number) => {
    const found = hitPoint(x, y);
    return found && { time: found.note.time, start: found.note.start, reach: found.reach };
  },
  /** Note heads and bar lines in page coordinates, for checks that drag across bars. */
  geometry: () => {
    const geo = staffGeometry();
    if (!geo) return null;
    const origin = scoreElement.getBoundingClientRect();
    return {
      notes: geo.notes.map((box) => ({
        start: box.note.start,
        end: box.note.end,
        time: box.note.time,
        voice: box.note.voice,
        line: box.note.line,
        staff: box.note.staff,
        head: origin.left + box.head,
        y: origin.top + (box.top + box.bottom) / 2,
      })),
      staves: geo.staves.map((box) => ({
        line: box.line,
        staff: box.staff,
        top: origin.top + box.top,
        bottom: origin.top + box.bottom,
      })),
      bars: [...scoreElement.querySelectorAll(".abcjs-bar")].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          line: Number(/abcjs-l(\d+)/.exec(element.getAttribute("class") ?? "")?.[1] ?? -1),
          x: rect.left + rect.width / 2,
        };
      }),
    };
  },
  menus,
};
