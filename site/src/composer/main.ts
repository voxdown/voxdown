import "./composer.css";
import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { frac } from "./abc";
import { parseKey } from "./abc";
import { checkBars } from "./barcheck";
import {
  type Change,
  type Range,
  barLine,
  decorate,
  duplicate,
  newTuneTemplate,
  removeDots,
  scaleLengths,
  toggleSlur,
  toggleTies,
  transpose,
} from "./commands";
import { editorState, fileIndexField, setMarks } from "./editor";
import { EXAMPLES, NEW_TUNE } from "./examples";
import { describeKey, describeMeter, explainAt } from "./explain";
import { SHORTCUTS, cheatsheet, createDialog, shortcutTable } from "./help";
import { INSTRUMENTS, INSTRUMENT_ORDER, type InstrumentId, isInstrument } from "./instruments";
import { LocalFiles, download } from "./local-file";
import { type MenuItem, mountMenus, popupMenu } from "./menus";
import { offlineStatus, prepareOffline } from "./offline";
import { Player, encodeWav } from "./player";
import {
  type Region,
  type ScoreIndex,
  type ScoreNote,
  loadAbcjs,
  measure,
  notesAt,
  notesInRanges,
  regionOfRanges,
  regionRanges,
  renderTune,
  tuneSource,
} from "./score";
import { type SourceFile, abcName, encodeText, newSource, readBytes, readText } from "./source";
import {
  claimDraft,
  deleteDraft,
  forgetFile,
  getDraft,
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
import { type FileIndex, type TuneInfo, nextTuneNumber, tuneAt, tuneLabel } from "./tunes";

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

/* Preferences. */
type Prefs = {
  layout: "auto" | "beside" | "below";
  rail: boolean;
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

/* Notices. */
const noticeElement = $("notice");
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function notice(message: string, tone: "info" | "success" = "info") {
  clearTimeout(noticeTimer);
  noticeElement.replaceChildren();
  if (!message) {
    noticeElement.hidden = true;
    return;
  }
  const text = document.createElement("span");
  text.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "notice-close";
  close.textContent = "Dismiss";
  close.addEventListener("click", () => notice(""));
  noticeElement.append(text, close);
  noticeElement.dataset.tone = tone;
  noticeElement.setAttribute("role", "status");
  noticeElement.hidden = false;
  if (tone === "success") noticeTimer = setTimeout(() => notice(""), 4500);
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

const keys: KeyBinding[] = [
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
  {
    key: "Escape",
    run: () => {
      if (player.status !== "playing") return false;
      stop();
      return true;
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

const view = new EditorView({
  parent: $("editor"),
  state: makeState(""),
});
function makeState(text: string): EditorState {
  return editorState(text, { onUpdate, keys, extra: [copyVoices] });
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
  player.stop();
  source = next;
  const content = options.text ?? next.normalized;
  savedText = content === next.normalized ? content : null;
  if (!options.keepDraft) {
    draftId = newDraftId();
    setSessionDraftId(draftId);
    void claimDraft(draftId);
  }
  nameInput.value = name;
  view.setState(makeState(content));
  scoreIndex = null;
  timeline = null;
  renderedKey = "";
  tempoOverride = null;
  showStart(false);
  const at = options.caretAt ?? firstMusicPosition();
  view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  if (!phone.matches) view.focus();
  updateAll(true);
  updateSavedState();
}

function firstMusicPosition(): number {
  const tune = fileIndex().tunes[0];
  if (!tune) return view.state.doc.length;
  return Math.min(tune.bodyFrom, view.state.doc.length);
}

function showStart(show: boolean) {
  $("start").hidden = !show;
  started = !show;
  if (show) void fillRecentStart();
}

/* Updates from the editor. */
let renderTimer: ReturnType<typeof setTimeout> | undefined;
let checkTimer: ReturnType<typeof setTimeout> | undefined;
let explainTimer: ReturnType<typeof setTimeout> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let lastTyped = 0;
let lastHeard = "";

function onUpdate(update: ViewUpdate) {
  if (update.docChanged) {
    lastTyped = performance.now();
    if (started) schedulePersist();
    scheduleRender();
    clearTimeout(checkTimer);
    checkTimer = setTimeout(runChecks, 750);
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
  if (!view.state.selection.main.empty) {
    const count = scoreIndex
      ? notesInRanges(scoreIndex, ranges()).filter((note) => !note.rest).length
      : 0;
    const voices = view.state.selection.ranges.length;
    status.textContent = `${count} ${count === 1 ? "note" : "notes"} selected${voices > 1 ? ` in ${voices} voices` : ""} · Ctrl/⌘ Alt Enter plays it`;
    return;
  }
  if (!explanation) {
    status.textContent = "Ready";
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

/* Rendering the score. */
let scoreIndex: ScoreIndex | null = null;
let timeline: Timeline | null = null;
let renderGeneration = 0;
let renderedKey = "";
let rendering = false;
let geometry: ReturnType<typeof measure> | null = null;
let renderCost = 0;

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
    $("score-summary").textContent = "No tune yet";
    player.setTimeline(null);
    drawTimeline();
    return;
  }
  $("score-empty").hidden = true;
  const doc = text();
  const width = scoreWidth();
  if (width < 50) return;
  const key = `${width}|${tune.from}|${doc.slice(tune.from, tune.to)}|${index.header ? doc.slice(index.header.from, index.header.to) : ""}`;
  if (!force && key === renderedKey) return;
  if (rendering) {
    scheduleRender(60);
    return;
  }
  rendering = true;
  const started = performance.now();
  try {
    await document.fonts?.ready;
    const result = await renderTune(
      stage,
      { text: doc, file: index, tune, width },
      workspace.dataset.layout === "below",
    );
    if (generation !== renderGeneration && !force) return;
    renderCost = performance.now() - started;
    // Keep the reader's place: the system at the top stays at the top.
    const anchor = topSystem();
    const fragment = document.createDocumentFragment();
    fragment.append(...stage.childNodes);
    scoreElement.style.minHeight = `${scoreElement.offsetHeight}px`;
    scoreElement.replaceChildren(fragment);
    scoreElement.style.minHeight = "";
    stage.replaceChildren();
    restoreSystem(anchor);
    renderedKey = key;
    scoreIndex = result;
    geometry = null;
    updateSummary();
    // Timing and audio are built in a separate task, so the draw stays short.
    setTimeout(() => {
      if (scoreIndex !== result) return;
      buildPlayback(result);
      linkFromText();
      runChecks();
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
  const y = systemTops().get(anchor.line);
  if (y === undefined) return;
  scoreScroll.scrollTop = Math.max(0, y - anchor.offset);
}

function updateSummary() {
  const index = scoreIndex;
  if (!index) return;
  const tune = index.tune;
  const parts = [tuneLabel(tune)];
  if (tune.key) parts.push(describeKey(parseKey(tune.key)).split(",")[0] as string);
  if (tune.meter) parts.push(tune.meter);
  parts.push(`${index.measures} ${index.measures === 1 ? "bar" : "bars"}`);
  if (index.voices.length > 1) parts.push(`${index.voices.length} voices`);
  $("score-summary").textContent = parts.join(" · ");
  scoreScroll.setAttribute(
    "aria-label",
    `Score of ${parts.join(", ")}. Arrow keys move by note, Shift extends, Space plays, Enter goes to the text.`,
  );
}

/* Playback data. */
let tempoOverride: number | null = null;
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
  const meta = {
    bpm: audio.tempo || visual.getBpm?.() || 120,
    beat: visual.getBeatLength?.() || 0.25,
    bar: visual.getBarLength?.() || 1,
    pickup: visual.getPickupLength?.() || 0,
    voices: index.voices.map((voice) => voice.name),
  };
  // Times in the description are whole notes at the starting tempo.
  timeline = buildTimeline(audio, meta, index.toDocument, lookup);
  player.setTimeline(timeline);
  if (player.loopingRegion && loopRegion) {
    const next = regionTimelineFor(loopRegion);
    if (next) player.setRegion(next);
  }
  applyTempo();
  updateVoices();
  drawTimeline();
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
    litSelection = selected.flatMap((note) => note.elements);
    drawBands(selected);
  } else {
    caretNotes = notesAt(index, selection.main.head);
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
  if (box.top >= frame.top + margin && box.bottom <= frame.bottom - margin) return;
  const target = scoreScroll.scrollTop + (box.top - frame.top) - frame.height * 0.3;
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
    const groups = new Map<string, { left: number; right: number; line: number; staff: number }>();
    for (const box of geo.notes) {
      if (!notes.includes(box.note)) continue;
      const key = `${box.note.line}:${box.note.staff}`;
      const group = groups.get(key) ?? {
        left: box.left,
        right: box.right,
        line: box.note.line,
        staff: box.note.staff,
      };
      group.left = Math.min(group.left, box.left);
      group.right = Math.max(group.right, box.right);
      groups.set(key, group);
    }
    const ordered = [...groups.values()].sort((a, b) => a.line - b.line || a.staff - b.staff);
    const firstLine = ordered[0]?.line;
    const lastLine = ordered[ordered.length - 1]?.line;
    for (const group of ordered) {
      const staff = geo.staves.find((box) => box.line === group.line && box.staff === group.staff);
      const top = staff ? staff.top - 10 : 0;
      const bottom = staff ? staff.bottom + 10 : 0;
      const band = document.createElement("div");
      band.className = `score-band ${className}${group.line === firstLine ? " edge-start" : ""}${group.line === lastLine ? " edge-end" : ""}`;
      band.style.left = `${offsetLeft + group.left - 5}px`;
      band.style.width = `${group.right - group.left + 10}px`;
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
  kind: "bar" | "parse";
};
let problems: Problem[] = [];
let currentIssueNotes: ScoreNote[] = [];
function runChecks() {
  const index = fileIndex();
  const doc = text();
  const list: Problem[] = [];
  const position = caret();
  const recentlyTyped = performance.now() - lastTyped < 2500;
  for (const tune of index.tunes) {
    for (const issue of checkBars(doc, tune, index)) {
      // Not while the bar is still being typed.
      if (recentlyTyped && position >= issue.from && position <= issue.to + 1) continue;
      list.push({
        from: issue.from,
        to: issue.to,
        message: issue.message,
        severity: "warning",
        kind: "bar",
      });
    }
  }
  if (scoreIndex)
    for (const warning of scoreIndex.warnings)
      list.push({
        ...warning,
        to: Math.max(warning.to, warning.from + 1),
        severity: "error",
        kind: "parse",
      });
  problems = list;
  view.dispatch({ effects: setMarks.of({ issues: list }) });
  const button = $<HTMLButtonElement>("problems");
  button.hidden = list.length === 0;
  button.textContent = `${list.length} ${list.length === 1 ? "note to check" : "notes to check"}`;
  currentIssueNotes = scoreIndex
    ? notesInRanges(
        scoreIndex,
        list.filter((problem) => problem.kind === "bar"),
      )
    : [];
  linkFromText();
}

/* Score → text: click, drag, Shift+click, keyboard. */
type Drag = {
  anchor: ScoreNote;
  allVoices: boolean;
  moved: boolean;
  pointer: number;
  x: number;
  y: number;
};
let drag: Drag | null = null;

function hitNote(
  clientX: number,
  clientY: number,
): { note: ScoreNote; staff: number; line: number } | null {
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
  const candidates = geo.notes.filter(
    (box) => box.note.line === staff.line && box.note.staff === staff.staff,
  );
  if (!candidates.length) return null;
  let best = candidates[0] as (typeof candidates)[number];
  let distance = Number.POSITIVE_INFINITY;
  for (const box of candidates) {
    const d = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
    if (
      d < distance ||
      (d === distance &&
        Math.abs(y - (box.top + box.bottom) / 2) < Math.abs(y - (best.top + best.bottom) / 2))
    ) {
      distance = d;
      best = box;
    }
  }
  return { note: best.note, staff: staff.staff, line: staff.line };
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

function regionBetween(a: ScoreNote, b: ScoreNote, voices: number[]): Region {
  return {
    from: Math.min(a.time, b.time),
    to: Math.max(a.time + a.duration, b.time + b.duration),
    voices,
  };
}

scoreScroll.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !scoreIndex) return;
  const hit = hitNote(event.clientX, event.clientY);
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
  if (event.shiftKey && current) {
    const voices = event.altKey
      ? scoreIndex.voices.map((_, index) => index)
      : [...new Set([...current.voices, hit.note.voice])];
    selectRegion({
      from: Math.min(current.from, hit.note.time),
      to: Math.max(current.to, hit.note.time + hit.note.duration),
      voices,
    });
    return;
  }
  drag = {
    anchor: hit.note,
    allVoices: event.altKey,
    moved: false,
    pointer: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  };
  scoreScroll.setPointerCapture(event.pointerId);
  const voices = event.altKey ? scoreIndex.voices.map((_, index) => index) : [hit.note.voice];
  selectRegion(regionBetween(hit.note, hit.note, voices));
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
  const hit = hitNote(event.clientX, event.clientY);
  if (!hit) return;
  const sameStaff = hit.staff === drag.anchor.staff;
  const voices =
    drag.allVoices || !sameStaff
      ? scoreIndex.voices.map((_, index) => index)
      : drag.anchor.voice === hit.note.voice
        ? [drag.anchor.voice]
        : voicesOnStaff(hit.staff);
  selectRegion(regionBetween(drag.anchor, hit.note, voices));
  // Scroll while dragging near the edges.
  const frame = scoreScroll.getBoundingClientRect();
  if (event.clientY > frame.bottom - 30) scoreScroll.scrollTop += 12;
  else if (event.clientY < frame.top + 30) scoreScroll.scrollTop -= 12;
});
const endDrag = (event: PointerEvent) => {
  if (!drag || event.pointerId !== drag.pointer) return;
  scoreScroll.classList.remove("dragging");
  drag = null;
};
scoreScroll.addEventListener("pointerup", endDrag);
scoreScroll.addEventListener("pointercancel", endDrag);

scoreScroll.addEventListener("keydown", (event) => {
  if (!scoreIndex) return;
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    moveByNote(event.key === "ArrowRight" ? 1 : -1, event.shiftKey);
  } else if (event.key === " ") {
    event.preventDefault();
    togglePlay();
  } else if (event.key === "Enter") {
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
  const current = region ?? {
    from: caretNote.time,
    to: caretNote.time + caretNote.duration,
    voices: [caretNote.voice],
  };
  if (!region) {
    selectRegion(current);
    return true;
  }
  if (direction > 0) {
    const next = notes.find((note) => note.time >= current.to - eps);
    if (next) current.to = next.time + next.duration;
  } else {
    const previous = [...notes].reverse().find((note) => note.time < current.from - eps);
    if (previous) current.from = previous.time;
  }
  selectRegion(current);
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
    case "tie":
      return apply(toggleTies(doc, list, index), "Tie");
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
  const choices: [string, string][] = [
    [".", "Staccato"],
    ["accent", "Accent"],
    ["tenuto", "Tenuto"],
    ["fermata", "Fermata"],
    ["trill", "Trill"],
    ["~", "Roll"],
    ["mordent", "Mordent"],
    ["pp", "pp — very soft"],
    ["p", "p — soft"],
    ["mp", "mp"],
    ["mf", "mf"],
    ["f", "f — loud"],
    ["ff", "ff — very loud"],
    ["crescendo(", "Crescendo starts"],
    ["crescendo)", "Crescendo ends"],
    ["breath", "Breath mark"],
  ];
  popupMenu(
    anchor,
    choices.map(([name, label]) => ({
      label,
      shortcut: name.length === 1 ? name : `!${name}!`,
      run: () => {
        apply(decorate(text(), ranges(), name, fileIndex()), "Decoration");
        view.focus();
      },
    })),
  );
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

function selectionRegion(): Region | null {
  if (!scoreIndex) return null;
  const selected = ranges().filter((range) => range.to > range.from);
  if (selected.length) return regionOfRanges(scoreIndex, selected);
  // No selection: the bar at the caret, in every voice.
  const place = caretWritten();
  if (!place) return null;
  const bars = scoreIndex.bars
    .filter((bar) => bar.voice === place.note.voice)
    .map((bar) => bar.time);
  const from = Math.max(0, ...bars.filter((time) => time <= place.written + 1e-6));
  const after = bars.filter((time) => time > place.written + 1e-6);
  const to = after.length
    ? Math.min(...after)
    : Math.max(
        ...(scoreIndex.byVoice[place.note.voice] ?? []).map((note) => note.time + note.duration),
      );
  return { from, to, voices: scoreIndex.voices.map((_, index) => index) };
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
function toggleLoop() {
  setLoop(!loopOn);
  if (loopOn) startLoop();
}
function stop() {
  player.stop();
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
  $("tempo-unit").textContent = `${symbol}/min`;
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
    const { notes, index } = soundingAt(line, Math.max(0, position), scanIndex);
    scanIndex = index;
    const key = playing ? notes.map((note) => note.start).join(",") : "";
    if (key !== playingKey) {
      playingKey = key;
      for (const element of litPlaying) element.classList.remove("is-playing");
      litPlaying = [];
      const starts = new Set(notes.map((note) => note.start));
      const lit = scoreIndex.notes.filter((note) => starts.has(note.start));
      for (const note of lit)
        for (const element of note.elements) element.classList.add("is-playing");
      litPlaying = lit.flatMap((note) => note.elements);
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
  line.bars.forEach((time, index) => {
    const tick = document.createElement("div");
    const number = pickup ? index : index + 1;
    tick.className = `timeline-tick${number % step === 0 || index === 0 ? " major" : ""}`;
    tick.style.left = `${(time / length) * 100}%`;
    if ((number % (step * 2) === 0 || index === 0) && number > 0) {
      const label = document.createElement("span");
      label.textContent = String(number);
      tick.append(label);
    }
    ticks.append(tick);
  });
  for (const pass of line.passes) {
    const band = document.createElement("div");
    band.className = `timeline-pass${pass.repeat ? " repeat" : ""}`;
    band.style.left = `${(pass.from / length) * 100}%`;
    band.style.width = `${((pass.to - pass.from) / length) * 100}%`;
    band.title = pass.repeat ? "Repeat" : "";
    passes.append(band);
  }
  if (loopOn && loopRegion) {
    const from = firstPlayOf(line, loopRegion.from);
    const to = Math.max(from, firstPlayOf(line, loopRegion.to - 1e-6) + 0.001);
    loopBand.hidden = false;
    loopBand.style.left = `${(from / length) * 100}%`;
    loopBand.style.width = `${Math.max(0.6, ((to - from) / length) * 100)}%`;
  } else loopBand.hidden = true;
  slider.setAttribute("aria-valuemax", String(line.bars.length));
  updateHead(player.status === "stopped" ? 0 : player.position());
}

function updateHead(position: number) {
  const line = timeline;
  const head = $("timeline-head");
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
  const number = line.pickup > 1e-6 ? bar : bar + 1;
  const seconds = (at / ((line.bpm * player.tempoFactor * line.beat) / 60)) | 0;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  $("clock").textContent = `${player.loopingRegion ? "Loop · " : ""}Bar ${number} · ${clock}`;
  const slider = $("timeline");
  slider.setAttribute("aria-valuenow", String(bar));
  slider.setAttribute(
    "aria-valuetext",
    `Bar ${number} of ${line.pickup > 1e-6 ? line.bars.length - 1 : line.bars.length}, ${clock}`,
  );
}

function seekToClient(clientX: number) {
  const line = timeline;
  if (!line) return;
  const box = $("timeline").getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
  const time = ratio * line.length;
  const bar = barAt(line, time);
  if (loopOn) setLoop(false);
  player.seek(line.bars[bar] ?? 0);
  if (player.status !== "playing") updateHead(line.bars[bar] ?? 0);
}
$("timeline").addEventListener("pointerdown", (event) => {
  seekToClient(event.clientX);
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
      applyMutes();
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
      applyMutes();
    });
    row.append(name, mute, solo);
    panel.append(row);
  }
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Chords play the tune's chord symbols. Mute and solo apply at once, even while playing.";
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
    panel.style.left = `${Math.max(8, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, rect.top - panel.offsetHeight - 8)}px`;
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

function soundPopover(anchor: HTMLElement) {
  const panel = popover(anchor, "Sound");
  const choices = document.createElement("div");
  choices.className = "instrument-choices";
  choices.setAttribute("role", "radiogroup");
  choices.setAttribute("aria-label", "Instrument");
  for (const id of INSTRUMENT_ORDER) {
    const def = INSTRUMENTS[id];
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(player.instrument === id));
    const label = document.createElement("span");
    label.textContent = def.label;
    const small = document.createElement("small");
    small.textContent = player.ready(id)
      ? def.about
      : `${def.about} · ${Math.round(def.bytes / 1024)} KB`;
    button.append(label, small);
    button.addEventListener("click", async () => {
      prefs.instrument = id;
      savePrefs();
      for (const each of choices.querySelectorAll("button"))
        each.setAttribute("aria-checked", String(each === button));
      $("instrument-label").textContent = def.label;
      const wasPlaying = player.status === "playing";
      const position = player.position();
      if (wasPlaying) player.pause();
      await player.setInstrument(id);
      small.textContent = def.about;
      if (wasPlaying && !player.loopingRegion) void player.play({ from: position });
    });
    choices.append(button);
  }
  panel.append(choices);
  const slider = (label: string, value: number, onInput: (value: number) => void) => {
    const row = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.value = String(Math.round(value * 100));
    input.addEventListener("input", () => onInput(Number(input.value) / 100));
    row.append(name, input);
    panel.append(row);
  };
  slider("Volume", prefs.volume, (value) => {
    prefs.volume = value;
    player.setVolume(value);
    savePrefs();
  });
  slider("Room", prefs.reverb, (value) => {
    prefs.reverb = value;
    player.setReverb(value);
    savePrefs();
  });
  const check = (label: string, value: boolean, onChange: (value: boolean) => void) => {
    const row = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    input.addEventListener("change", () => onChange(input.checked));
    const name = document.createElement("span");
    name.textContent = label;
    row.append(input, name);
    panel.append(row);
  };
  check("Hear notes as you write", prefs.hear, (value) => {
    prefs.hear = value;
    savePrefs();
  });
  check("Humanise timing and touch", prefs.humanise, (value) => {
    prefs.humanise = value;
    player.humanise = value;
    savePrefs();
  });
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Instruments load the first time you choose them, then stay in this browser for offline use. Dynamics, accents, staccato and slurs in the score shape the playing.";
  panel.append(hint);
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
$("problems").addEventListener("click", openProblems);
$("announce").addEventListener("click", sayNote);

function sayNote() {
  const explanation = explainAt(text(), fileIndex(), caret());
  const message = explanation
    ? `${explanation.token} ${explanation.text}`
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
  if (prefs.layout === "auto") return window.innerWidth >= 1200 ? "beside" : "below";
  return prefs.layout;
}
function applyLayout() {
  const layout = resolvedLayout();
  workspace.dataset.layout = layout;
  body.dataset.layout = layout;
  // On a phone the rail is an overlay, closed until asked for.
  const railOpen = phone.matches ? phoneRail : prefs.rail;
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
    prefs.rail = !prefs.rail;
    savePrefs();
  }
  applyLayout();
  if (workspace.dataset.rail === "open" && phone.matches)
    $("tune-list").querySelector<HTMLElement>("button")?.focus();
}
$("rail-toggle").addEventListener("click", toggleRail);
phone.addEventListener("change", applyLayout);
function setFocusMode(on: boolean) {
  body.classList.toggle("focus-mode", on);
  $("focus-mode").setAttribute("aria-pressed", String(on));
}
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
  if (prefs.layout === "auto") applyLayout();
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
    : dirty()
      ? local.linked
        ? "Edited"
        : "Not saved to a file"
      : local.linked
        ? "Saved"
        : "";
  document.title = `${dirty() ? "• " : ""}${nameInput.value} — VoxDown Composer`;
}

async function openFile() {
  try {
    if (local.canOpen) {
      const picked = await local.pick();
      if (!picked) return;
      openBytes(picked.bytes, picked.name);
      local.connect(picked.handle, picked.bytes);
      void rememberFile(picked.name, picked.handle as unknown as FileSystemFileHandle).catch(
        () => {},
      );
      updateSavedState();
      return;
    }
  } catch {
    notice("That file could not be opened. Try again, or drop it onto the page.");
    return;
  }
  $<HTMLInputElement>("file").click();
}
function openBytes(bytes: Uint8Array, name: string) {
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
    notice(error instanceof Error ? error.message : "That file could not be opened.");
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
  if (!/\.(abc|txt)$/i.test(file.name) && file.type && !file.type.startsWith("text/")) {
    notice("Composer opens ABC text files (.abc or .txt).");
    return;
  }
  openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
});

async function save(saveAs = false) {
  const name = abcName(nameInput.value);
  let encoded: { bytes: Uint8Array<ArrayBuffer>; upgraded: boolean };
  try {
    encoded = encodeText(source, text());
  } catch (error) {
    notice(error instanceof Error ? error.message : "This text cannot be saved.");
    return;
  }
  if (local.canSave) {
    const result = await local.save(encoded.bytes, name, saveAs);
    if (result.status === "saved") {
      savedText = text();
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
      );
      return;
    }
    if (result.status === "error") {
      notice(result.message);
      return;
    }
  }
  download(encoded.bytes, name, "text/vnd.abc;charset=utf-8");
  savedText = text();
  updateSavedState();
  notice(`Downloaded ${name}.`, "success");
}
function downloadAbc() {
  const name = abcName(nameInput.value);
  try {
    download(encodeText(source, text()).bytes, name, "text/vnd.abc;charset=utf-8");
  } catch (error) {
    notice(error instanceof Error ? error.message : "This text cannot be saved.");
  }
}
$("save-primary").addEventListener("click", () => void save());
nameInput.addEventListener("change", () => {
  nameInput.value = abcName(nameInput.value);
  schedulePersist();
  updateSavedState();
});

async function exportMidi() {
  if (!scoreIndex) return notice("Draw a tune first: there is nothing to export yet.");
  const abcjs = await loadAbcjs();
  const { source: abc } = tuneSource({ text: text(), file: fileIndex(), tune: scoreIndex.tune });
  const files = (abcjs.synth as Any).getMidiFile(abc, {
    midiOutputType: "binary",
    bpm: Math.round(timeline ? timeline.bpm * player.tempoFactor : 120),
  }) as Uint8Array[];
  const bytes = files[0];
  if (!bytes) return notice("This tune could not be turned into MIDI.");
  download(
    bytes as BlobPart,
    `${abcName(tuneLabel(scoreIndex.tune)).replace(/\.abc$/, "")}.mid`,
    "audio/midi",
  );
}
async function exportWav() {
  if (!timeline || !scoreIndex) return notice("Draw a tune first: there is nothing to export yet.");
  notice(
    `Rendering ${tuneLabel(scoreIndex.tune)} with the ${INSTRUMENTS[player.instrument].label.toLowerCase()}…`,
    "success",
  );
  try {
    const buffer = await player.render(timeline);
    download(
      encodeWav(buffer),
      `${abcName(tuneLabel(scoreIndex.tune)).replace(/\.abc$/, "")}.wav`,
      "audio/wav",
    );
    notice("Audio exported as WAV.", "success");
  } catch {
    notice("The audio could not be rendered. Try again once the instrument has loaded.");
  }
}
async function printScore() {
  const abcjs = await loadAbcjs();
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
      add_classes: false,
      wrap: { minSpacing: 1.8, maxSpacing: 2.6, preferredMeasuresPerLine: 4 },
    } as Any);
  }
  window.print();
}

/* Recovery: this tab's draft, kept as you type. */
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
      small.textContent = `${draft.name} · ${new Date(draft.updated).toLocaleString()} · ${draft.characters.toLocaleString()} characters${draft.id === draftId ? " · open here" : ""}`;
      openButton.append(small);
      openButton.addEventListener("click", () => {
        recoverDialog.close();
        void recoverDraft(draft.id);
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", `Delete draft ${draft.title || draft.name}`);
      remove.disabled = draft.id === draftId;
      remove.addEventListener("click", async () => {
        await deleteDraft(draft.id);
        row.remove();
      });
      row.append(openButton, remove);
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
      meta.textContent = `${draft.name} · ${new Date(draft.updated).toLocaleDateString()}`;
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
            notice(`${file.name} could not be reopened. It may have moved; use Open.`);
          }
        },
      }))
    : [{ heading: "No recent files yet" }];
  items.push("-", { label: "Recover a draft…", run: () => void openRecover() });
  popupMenu(anchor, items);
}

/* Help, shortcuts, appearance. */
const sheet = createDialog("cheatsheet", "ABC cheat sheet", true);
sheet.body.append(cheatsheet());
const shortcuts = createDialog("shortcuts", "Keyboard shortcuts");
shortcuts.body.append(shortcutTable(SHORTCUTS));
const about = createDialog("about", "About VoxDown Composer");
for (const line of [
  "Composer is a browser-only editor for ABC music notation. Your music stays on this device: there is no account, no server and no tracking, and nothing is sent anywhere.",
  "Scores are drawn by abcjs (MIT licence). The piano is the Salamander Grand Piano by Alexander Holm; fiddle, flute, strings and guitar come from the FluidR3 General MIDI SoundFont by Frank Wen. Both are Creative Commons Attribution 3.0 and served from this site.",
  "Composer is experimental. Keep your own copies of your files.",
]) {
  const paragraph = document.createElement("p");
  paragraph.textContent = line;
  about.body.append(paragraph);
}
$("cheatsheet-open").addEventListener("click", () => sheet.open());

const LOOKS = [
  {
    id: "auto",
    label: "Auto",
    tone: "Follows your device",
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

const offlineDialog = createDialog("offline-dialog", "Work offline");
{
  const intro = document.createElement("p");
  intro.textContent =
    "Composer can open without a connection once it is prepared. Your music is kept in this browser either way; save files to keep copies elsewhere.";
  const status = document.createElement("p");
  status.id = "offline-status";
  status.setAttribute("role", "status");
  const prepare = document.createElement("button");
  prepare.type = "button";
  prepare.className = "primary";
  prepare.textContent = "Prepare for offline use";
  const sounds = document.createElement("button");
  sounds.type = "button";
  sounds.textContent = "Keep every instrument offline (2.6 MB)";
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  actions.append(sounds, prepare);
  offlineDialog.body.append(intro, status, actions);
  const refresh = async () => {
    status.textContent = "Checking…";
    const state = await offlineStatus().catch(() => ({
      ready: false,
      message: "Offline status is unavailable.",
    }));
    status.textContent = state.message;
  };
  prepare.addEventListener("click", async () => {
    status.textContent = "Preparing…";
    const state = await prepareOffline().catch(() => ({
      ready: false,
      message: "Offline files could not be saved. Check your connection and storage, then retry.",
    }));
    status.textContent = state.message;
  });
  sounds.addEventListener("click", async () => {
    sounds.disabled = true;
    try {
      for (const id of INSTRUMENT_ORDER) await player.load(id);
      status.textContent = "Every instrument is kept in this browser.";
    } catch {
      status.textContent =
        "Some instruments could not be downloaded. Check your connection and retry.";
    } finally {
      sounds.disabled = false;
    }
  });
  offlineDialog.dialog.addEventListener("toggle", () => {
    if (offlineDialog.dialog.open) void refresh();
  });
}

const problemsDialog = createDialog("problems-dialog", "Notes to check");
function openProblems() {
  problemsDialog.body.replaceChildren();
  const intro = document.createElement("p");
  intro.textContent =
    "Bars whose length differs from the meter, and anything abcjs could not read. Choose one to go there.";
  const list = document.createElement("ul");
  list.className = "problem-list";
  for (const problem of problems) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const where = document.createElement("span");
    where.className = "where";
    where.textContent = `Line ${view.state.doc.lineAt(Math.min(problem.from, view.state.doc.length)).number}`;
    button.append(where, problem.message);
    button.addEventListener("click", () => {
      problemsDialog.close();
      view.dispatch({
        selection: { anchor: problem.from, head: Math.min(problem.to, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });
    item.append(button);
    list.append(item);
  }
  problemsDialog.body.append(intro, list);
  problemsDialog.open();
}

/* Menus. */
const menus = mountMenus(
  [...document.querySelectorAll<HTMLButtonElement>(".workspace-menus button")],
  {
    file: () => [
      { label: "New tune file", run: newFile, shortcut: "" },
      { label: "Open…", run: () => void openFile(), shortcut: "Mod O" },
      { label: "Recent…", run: () => void recentMenu($("file-menu")) },
      { label: "Recover a draft…", run: () => void openRecover() },
      "-",
      { label: "Save", run: () => void save(), shortcut: "Mod S" },
      { label: "Save as…", run: () => void save(true), shortcut: "Mod Shift S" },
      { label: "Download .abc", run: downloadAbc },
      "-",
      { label: "Export MIDI", run: () => void exportMidi(), enabled: () => Boolean(scoreIndex) },
      {
        label: "Export audio (WAV)",
        run: () => void exportWav(),
        enabled: () => Boolean(timeline),
      },
      { label: "Print or save as PDF…", run: () => void printScore(), shortcut: "Mod P" },
    ],
    edit: () => [
      { label: "Undo", run: () => undo(view), shortcut: "Mod Z" },
      { label: "Redo", run: () => redo(view), shortcut: "Mod Shift Z" },
      "-",
      { label: "Find and replace…", run: () => openSearchPanel(view), shortcut: "Mod F" },
      "-",
      { label: "Up a semitone", run: () => music("transpose-up"), shortcut: "Alt ↑" },
      { label: "Down a semitone", run: () => music("transpose-down"), shortcut: "Alt ↓" },
      { label: "Up an octave", run: () => music("octave-up"), shortcut: "Alt Shift ↑" },
      { label: "Down an octave", run: () => music("octave-down"), shortcut: "Alt Shift ↓" },
      "-",
      { label: "Double lengths", run: () => music("double"), shortcut: "Alt ]" },
      { label: "Halve lengths", run: () => music("halve"), shortcut: "Alt [" },
      { label: "Add a dot", run: () => music("dot"), shortcut: "Alt ." },
      { label: "Remove a dot", run: () => music("undot"), shortcut: "Alt ," },
      "-",
      { label: "Tie or untie", run: () => music("tie"), shortcut: "Alt T" },
      { label: "Slur or unslur", run: () => music("slur"), shortcut: "Alt S" },
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
        shortcut: "Mod \\",
      },
      {
        label: "Score below",
        run: () => setLayout("below"),
        checked: () => resolvedLayout() === "below",
      },
      { label: "Tunes panel", run: toggleRail, checked: () => workspace.dataset.rail === "open" },
      {
        label: "Focus",
        run: () => setFocusMode(!body.classList.contains("focus-mode")),
        checked: () => body.classList.contains("focus-mode"),
        shortcut: "Mod Shift F",
      },
      "-",
      { label: "Appearance…", run: () => looks.open() },
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
      { label: "Stop", run: stop, shortcut: "Mod ." },
      "-",
      {
        label: "Faster",
        run: () => setTempo(Number($<HTMLInputElement>("tempo").value) + 4),
        shortcut: "Mod Alt =",
      },
      {
        label: "Slower",
        run: () => setTempo(Number($<HTMLInputElement>("tempo").value) - 4),
        shortcut: "Mod Alt -",
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
        label: "Hear notes as you write",
        run: () => {
          prefs.hear = !prefs.hear;
          savePrefs();
        },
        checked: () => prefs.hear,
      },
      { label: "Sound…", run: () => soundPopover($("sound-button")) },
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
  },
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

function newFile() {
  local.disconnect();
  load(newSource(NEW_TUNE), "Untitled.abc", { caretAt: NEW_TUNE.length });
  notice("A new tune. Your previous draft is kept under File › Recover a draft.", "success");
}
function openExample(id: string) {
  const example = EXAMPLES.find((each) => each.id === id);
  if (!example) return;
  local.disconnect();
  load(newSource(example.text), example.file);
}

/* Global keys that work outside the editor too. */
document.addEventListener("keydown", (event) => {
  const mod = event.ctrlKey || event.metaKey;
  const inEditor = view.hasFocus;
  const inField =
    event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
  if (event.key === "F1") {
    event.preventDefault();
    sheet.open();
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
  checkTimer = setTimeout(runChecks, immediate ? 300 : 750);
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
$("start-new").addEventListener("click", () => {
  load(newSource(NEW_TUNE), "Untitled.abc", { caretAt: NEW_TUNE.length });
});
$("start-open").addEventListener("click", () => void openFile());

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
    region: player.loopingRegion,
    notes: scoreIndex?.notes.length ?? 0,
    timeline: timeline
      ? { length: timeline.length, notes: timeline.notes.length, tracks: timeline.tracks.length }
      : null,
  }),
  scoreIndex: () => scoreIndex,
  menus,
};
