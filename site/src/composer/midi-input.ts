/**
 * Play › MIDI keyboard…: a keyboard on Web MIDI (Chrome, Edge and Opera; never SysEx). Notes you
 * play can sound through Composer's instrument (audition) or be written at the caret (step
 * entry): a chord is the keys held together, written when the last is let go; the length is
 * picked in the panel (or keys 1–6 and . while it has focus); the sustain pedal (or a chosen key)
 * writes a rest; a bar line follows when the bar fills. Each step is one undo. Melody search can
 * listen in. Loaded the first time it is opened.
 */
import "./midi.css";
import { isolateHistory } from "@codemirror/commands";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { type Fraction, frac, lineKind, mul, parseKey, value } from "./abc";
import { barAt } from "./barcheck";
import { overwriteForward, repitchTo, replaceKeepingBars } from "./barwise";
import { dockPanel, undockPanel } from "./dock";
import { selectedNotes } from "./selected";
import {
  STEP_LENGTHS,
  type StepReading,
  pitchText,
  readingAt,
  stepInsert,
  stepText,
} from "./stepentry";
import { indexFile } from "./tunes";
import { tuneItems } from "./walk";

export type KeyboardContext = {
  view: EditorView;
  audition: (pitches: number[], velocity: number) => void;
  status: (message: string) => void;
};

type Mode = "off" | "audition" | "step";
const SAVED = "vxd-composer-midi";
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const nameOf = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

type Saved = {
  device?: string;
  mode?: Mode;
  length?: number;
  dotted?: boolean;
  rest?: number | "pedal";
};
const saved = (): Saved => {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? "{}") as Saved;
  } catch {
    return {};
  }
};
const save = (patch: Partial<Saved>) => {
  try {
    localStorage.setItem(SAVED, JSON.stringify({ ...saved(), ...patch }));
  } catch {
    /* This visit only. */
  }
};

let context: KeyboardContext | null = null;
let access: MIDIAccess | null = null;
let input: MIDIInput | null = null;
let panel: HTMLElement | null = null;
let mode: Mode = saved().mode ?? "audition";
let lengthIndex = saved().length ?? 2;
let dotted = saved().dotted ?? false;
let restKey: number | "pedal" = saved().rest ?? "pedal";
let learning = false;
let pedalDown = false;
const held = new Set<number>();
const chord = new Set<number>();
const listeners = new Set<(pitches: number[]) => void>();

/* While step entry is on, a steady caret marks where the next note goes (the panel has the focus,
   so the editor's own caret is hidden), and a pill in the status bar says step entry is on. */
const setStepCaret = StateEffect.define<boolean>();
const stepCaretOn = StateField.define<boolean>({
  create: () => false,
  update(on, transaction) {
    for (const effect of transaction.effects) if (effect.is(setStepCaret)) return effect.value;
    return on;
  },
});
class StepCaret extends WidgetType {
  toDOM() {
    const mark = document.createElement("span");
    mark.className = "cm-step-caret";
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }
  override eq() {
    return true;
  }
}
const stepCaret = [
  stepCaretOn,
  EditorView.decorations.compute([stepCaretOn, "selection"], (state) =>
    state.field(stepCaretOn)
      ? Decoration.set([
          Decoration.widget({ widget: new StepCaret(), side: 1 }).range(state.selection.main.head),
        ])
      : Decoration.none,
  ),
];
let caretInstalled = false;
/** Shows or hides the step caret and the status bar's pill, as step entry is on or off. */
function showStepping() {
  const on = Boolean(panel && mode === "step");
  if (context) {
    const { view } = context;
    if (!caretInstalled && on) {
      view.dispatch({ effects: StateEffect.appendConfig.of(stepCaret) });
      caretInstalled = true;
    }
    if (caretInstalled && view.state.field(stepCaretOn, false) !== on)
      view.dispatch({ effects: setStepCaret.of(on) });
  }
  let pill = document.getElementById("step-pill");
  if (on && !pill) {
    pill = element("button", {
      id: "step-pill",
      type: "button",
      className: "step-pill",
      textContent: "Step entry",
      title: "Notes you play are written at the caret. Open the MIDI keyboard panel",
    });
    pill.addEventListener("click", () => panel?.focus());
    document.getElementById("explain")?.before(pill);
  } else if (!on) pill?.remove();
}

/** Whether this browser has Web MIDI. */
export const supported = () =>
  typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";

const element = (
  tag: string,
  props: Record<string, unknown> = {},
  ...children: (Node | string)[]
) => {
  const made = Object.assign(document.createElement(tag), props) as HTMLElement;
  made.append(...children);
  return made;
};
const $ = (selector: string) => panel?.querySelector<HTMLElement>(selector) ?? null;

function say(message: string) {
  const line = $(".midi-status");
  if (line) line.textContent = message;
  context?.status(message);
}

/** The panel's length: "Keep" keeps a selected note's own; at a caret, an eighth. */
const KEEP = -2;
function length(): Fraction {
  const base = (STEP_LENGTHS[lengthIndex] ?? STEP_LENGTHS[2])?.length ?? frac(1, 8);
  return dotted ? mul(base, frac(3, 2)) : base;
}

/**
 * A step over a selection (round 8, item 2), in one voice only: with Keep and one note selected,
 * the note re-pitched in place (its length and marks kept); else written forward from the
 * selection's first note as a paste of one note overwrites, and the next note selected, so the
 * next step goes over it. Null when the step goes in as at a caret.
 */
function stepOver(
  view: EditorView,
  pitches: number[] | "rest",
): { said: string } | { refused: string } | null {
  const text = view.state.doc.toString();
  const main = view.state.selection.main;
  if (main.empty) return null;
  const file = indexFile(text);
  // In one voice: not across voices, nor into a V: line or lyrics.
  let line = text.lastIndexOf("\n", main.from - 1) + 1;
  while (line < main.to) {
    const end = text.indexOf("\n", line) < 0 ? text.length : text.indexOf("\n", line);
    if (lineKind(text.slice(line, end), true) !== "music")
      return {
        refused:
          "Step entry writes in one voice: this selection reaches other lines. Select within one voice's music.",
      };
    line = end + 1;
  }
  const picked = selectedNotes(text, [main], file).filter((each) => each.whole);
  if (new Set(picked.map((each) => each.event.voice)).size > 1)
    return {
      refused:
        "Step entry writes in one voice: this selection crosses voices. Select within one voice.",
    };
  const reading = readingAt(text, file, main.from);
  if (!picked.length || !reading) return null;
  const sign = stepText(pitches, frac(1), reading).replace(/\d+$/, "");
  if (lengthIndex === KEEP && picked.length === 1) {
    const pitched = repitchTo(text, [main], sign, file);
    if (pitched) {
      view.dispatch({
        changes: pitched.changes,
        selection: { anchor: pitched.caret },
        annotations: isolateHistory.of("full"),
        userEvent: "input.midi",
        scrollIntoView: true,
      });
      return { said: `Re-pitched to ${sign}, its length and marks kept.` };
    }
  }
  // Keep over several notes: the first one's length.
  const first = picked[0] as (typeof picked)[number];
  const own = first.event.duration;
  const written = stepText(pitches, lengthIndex === KEEP ? own : length(), reading);
  const over = overwriteForward(text, file, main, written);
  if (!over) return null;
  if ("refused" in over) return over;
  const set = view.state.changes(over.changes);
  const after = set.apply(view.state.doc).toString();
  const head = (over.changes[0]?.from ?? main.from) + written.length;
  // The next note in the voice, selected: the next step goes over it.
  const next = selectedNotes(after, [{ from: head, to: after.length }], indexFile(after)).find(
    (each) => each.event.voice === first.event.voice && each.event.from >= head,
  );
  view.dispatch({
    changes: set,
    selection: next ? { anchor: next.span.from, head: next.span.to } : { anchor: head },
    annotations: isolateHistory.of("full"),
    userEvent: "input.midi",
    scrollIntoView: true,
  });
  const others = view.state.selection.ranges.filter((range) => range !== main && !range.empty);
  const rest = over.said.replace(
    /^Pasted over the selection from its first note( in V:\S+)?;? ?/,
    "",
  );
  return {
    said: `Wrote ${written} over the selection, from its first note${rest ? `; ${rest}` : "."}${others.length ? ` The other ${others.length === 1 ? "place" : "places"} selected ${others.length === 1 ? "was" : "were"} left as ${others.length === 1 ? "it was" : "they were"}.` : ""}`,
  };
}

/**
 * Writes a step at the caret: one undo, a space where beams should break, a bar line when full.
 * Over a selection it replaces the selected notes of the main range (its bar lines kept), in that
 * one voice, and says so; other selected places are left as they are. A bar it overfills is said.
 */
function enter(pitches: number[] | "rest") {
  if (!context) return;
  const { view } = context;
  const overSelection = stepOver(view, pitches);
  if (overSelection) {
    say("refused" in overSelection ? overSelection.refused : overSelection.said);
    return;
  }
  const text = view.state.doc.toString();
  const main = view.state.selection.main;
  const others = view.state.selection.ranges.filter((range) => range !== main && !range.empty);
  const at = main.empty ? main.head : main.from;
  // The selected notes go first; the step is worked out on what is left.
  const kept = main.empty ? null : replaceKeepingBars(text, [main], "");
  if (kept && "refused" in kept) {
    say(kept.refused);
    return;
  }
  const cleared = main.empty ? null : (kept ?? [{ from: main.from, to: main.to, insert: "" }]);
  const left = cleared ? applied(text, cleared) : text;
  const step = stepInsert(left, indexFile(left), at, pitches, length());
  if (!step) {
    say("Put the caret in a tune's music (after K:) to write there.");
    return;
  }
  const changes = cleared
    ? cleared.map((change, index) => (index ? change : { ...change, insert: step.insert }))
    : [{ from: at, to: at, insert: step.insert }];
  view.dispatch({
    changes,
    selection: { anchor: at + step.insert.length },
    annotations: isolateHistory.of("full"),
    userEvent: "input.midi",
    scrollIntoView: true,
  });
  const after = view.state.doc.toString();
  const file = indexFile(after);
  const tune = file.tunes.find((each) => at >= each.bodyFrom && at <= each.to);
  const bar = tune ? barAt(tuneItems(after, tune, file), at) : null;
  const over =
    bar?.expected && value(bar.filled) > value(bar.expected) + 1e-9
      ? ` Bar ${bar.bar} is now longer than the meter allows.`
      : "";
  const where = cleared
    ? ` in place of the selected notes${others.length ? `; the other ${others.length === 1 ? "place" : `${others.length} places`} selected ${others.length === 1 ? "was" : "were"} left as ${others.length === 1 ? "it was" : "they were"}` : ""}`
    : "";
  say(
    `Wrote ${step.written}${step.bars ? ` and ${step.bars === 1 ? "a bar line" : `${step.bars} bar lines`}` : ""}${where}.${over}`,
  );
}
/** Text with changes made (given in the text's own positions). */
function applied(text: string, changes: { from: number; to: number; insert: string }[]): string {
  let out = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from))
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return out;
}

function meter() {
  const meterLine = $(".midi-meter");
  if (meterLine)
    meterLine.textContent = held.size
      ? [...held]
          .sort((a, b) => a - b)
          .map(nameOf)
          .join(" ")
      : "—";
}

function onMessage(event: MIDIMessageEvent) {
  const data = event.data;
  if (!data || data.length < 2) return;
  const status = (data[0] as number) & 0xf0;
  const note = data[1] as number;
  const velocity = data[2] ?? 0;
  if (status === 0x90 && velocity > 0) {
    if (learning) {
      learning = false;
      restKey = note;
      save({ rest: note });
      showRest();
      say(`${nameOf(note)} now writes a rest.`);
      return;
    }
    if (note === restKey) {
      if (mode === "step") enter("rest");
      return;
    }
    held.add(note);
    chord.add(note);
    const level = $(".midi-level");
    if (level) level.style.width = `${Math.round((velocity / 127) * 100)}%`;
    if (mode !== "off") context?.audition([note], velocity);
    meter();
  } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
    held.delete(note);
    meter();
    if (!held.size && chord.size) {
      const pitches = [...chord];
      chord.clear();
      // While melody search listens, the notes go to it rather than into the text.
      for (const listen of listeners) listen(pitches);
      if (mode === "step" && !listeners.size) enter(pitches);
    }
  } else if (status === 0xb0 && note === 64) {
    const down = velocity >= 64;
    if (down && !pedalDown && restKey === "pedal" && mode === "step") enter("rest");
    pedalDown = down;
  }
}

function inputs(): MIDIInput[] {
  return access ? [...access.inputs.values()] : [];
}
function use(next: MIDIInput | null) {
  if (input) input.onmidimessage = null;
  input = next;
  held.clear();
  chord.clear();
  meter();
  if (input) {
    input.onmidimessage = onMessage;
    save({ device: input.name ?? "" });
  }
}
function refresh() {
  const select = $("#midi-device") as HTMLSelectElement | null;
  const list = inputs();
  if (select) {
    select.replaceChildren(
      ...list.map((each) =>
        element("option", {
          value: each.id,
          textContent: each.name || "MIDI input",
          selected: each === input,
        }),
      ),
    );
    select.disabled = !list.length;
  }
  if (input && !list.includes(input)) use(null);
  if (!input && list.length) {
    const wanted = saved().device;
    use(list.find((each) => each.name === wanted) ?? (list[0] as MIDIInput));
    if (select && input) select.value = (input as MIDIInput).id;
  }
  showState(
    list.length
      ? null
      : "No MIDI keyboard is connected. Plug one in: it shows here when it does, or Retry.",
  );
}

/** The panel's controls, or (denied, or no keyboard) only a message and Retry. */
function showState(message: string | null) {
  const body = $(".midi-body");
  const empty = $(".midi-empty");
  if (!body || !empty) return;
  body.hidden = message !== null;
  empty.hidden = message === null;
  const text = $(".midi-empty-text");
  if (text && message) text.textContent = message;
}

async function connect() {
  if (access) return true;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    showState(
      "Composer wasn't allowed to use MIDI devices. Allow it in the browser's site settings, then Retry.",
    );
    return false;
  }
  access.onstatechange = (event) => {
    const port = (event as MIDIConnectionEvent).port;
    if (port?.type === "input")
      say(
        `${port.name || "A MIDI keyboard"} ${port.state === "connected" ? "connected" : "disconnected"}.`,
      );
    refresh();
  };
  refresh();
  return true;
}

function showRest() {
  const label = $(".midi-rest-key");
  if (label) label.textContent = restKey === "pedal" ? "the sustain pedal" : nameOf(restKey);
}
function showLengths() {
  for (const [index, button] of [...(panel?.querySelectorAll(".midi-length") ?? [])].entries())
    button.setAttribute("aria-pressed", String(index === lengthIndex));
  $(".midi-dotted")?.setAttribute("aria-pressed", String(dotted));
  $(".midi-keep")?.setAttribute("aria-pressed", String(lengthIndex === KEEP));
}

function build() {
  const close = element("button", {
    type: "button",
    className: "midi-close",
    textContent: "Close",
  });
  const head = element(
    "div",
    { className: "midi-head" },
    element("h2", { textContent: "MIDI keyboard" }),
    close,
  );
  const status = element("p", { className: "midi-status" });
  status.setAttribute("role", "status");
  if (!supported()) {
    panel = element(
      "section",
      { id: "midi-panel", className: "midi-panel" },
      head,
      element("p", {
        className: "midi-unsupported",
        textContent:
          "MIDI keyboards need Chrome or Edge (or Opera). This browser has no Web MIDI; Safari has none, and Firefox only with an add-on.",
      }),
    );
  } else {
    const device = element("select", { id: "midi-device" }) as HTMLSelectElement;
    device.addEventListener("change", () =>
      use(inputs().find((each) => each.id === device.value) ?? null),
    );
    const modes = element(
      "fieldset",
      { className: "midi-modes" },
      element("legend", { textContent: "When you play" }),
    );
    for (const [value, label] of [
      ["off", "Nothing"],
      ["audition", "Hear it"],
      ["step", "Write it at the caret (step entry)"],
    ] as const) {
      const radio = element("input", {
        type: "radio",
        name: "midi-mode",
        value,
        checked: mode === value,
      }) as HTMLInputElement;
      radio.addEventListener("change", () => {
        mode = value;
        save({ mode });
        showStepping();
        say(
          mode === "step"
            ? "Step entry: play notes or chords; they are written at the caret."
            : mode === "audition"
              ? "You hear what you play."
              : "The keyboard is quiet.",
        );
      });
      modes.append(element("label", {}, radio, ` ${label}`));
    }
    const lengths = element("div", { className: "midi-lengths", role: "group" });
    lengths.setAttribute("aria-label", "Length (keys 1–6, . for dotted)");
    STEP_LENGTHS.forEach((step, index) => {
      const button = element("button", {
        type: "button",
        className: "midi-length",
        textContent: step.name,
        title: `Key ${step.key}`,
      });
      button.addEventListener("click", () => {
        lengthIndex = index;
        save({ length: index });
        showLengths();
      });
      lengths.append(button);
    });
    const dot = element("button", {
      type: "button",
      className: "midi-length midi-dotted",
      textContent: "Dotted",
      title: "Key .",
    });
    dot.addEventListener("click", () => {
      dotted = !dotted;
      save({ dotted });
      showLengths();
    });
    lengths.append(dot);
    const keep = element("button", {
      type: "button",
      className: "midi-keep",
      textContent: "Keep",
      title: "Key 0: over a selected note, its own length (the note re-pitched)",
    });
    keep.addEventListener("click", () => {
      lengthIndex = lengthIndex === KEEP ? 2 : KEEP;
      save({ length: lengthIndex });
      showLengths();
    });
    lengths.append(keep);
    const learn = element("button", { type: "button", textContent: "Use a key…" });
    learn.addEventListener("click", () => {
      learning = true;
      say("Press the key that should write a rest.");
    });
    const pedal = element("button", { type: "button", textContent: "Use the pedal" });
    pedal.addEventListener("click", () => {
      restKey = "pedal";
      save({ rest: "pedal" });
      showRest();
    });
    const retry = element("button", { type: "button", textContent: "Retry" });
    retry.addEventListener("click", () => void retryKeyboard());
    const empty = element(
      "div",
      { className: "midi-empty", hidden: true },
      element("p", { className: "midi-empty-text" }),
      retry,
    );
    const body = element(
      "div",
      { className: "midi-body" },
      element("label", { className: "midi-field" }, "Keyboard", device),
      element(
        "div",
        { className: "midi-meter-row" },
        element("span", { className: "midi-meter", textContent: "—" }),
        element(
          "span",
          { className: "midi-level-track" },
          element("span", { className: "midi-level" }),
        ),
      ),
      modes,
      element("p", { className: "midi-label", textContent: "Length (keys 1–6, . for dotted)" }),
      lengths,
      element(
        "p",
        { className: "midi-rest" },
        "A rest:",
        element("strong", { className: "midi-rest-key" }),
        learn,
        pedal,
      ),
      element("p", {
        className: "midi-note",
        textContent:
          "Step entry spells notes for the key, writes chords as [...] and a bar line when the bar fills, tying a note over it. Each note is one undo. Closing the panel goes back to Hear it.",
      }),
    );
    panel = element(
      "section",
      { id: "midi-panel", className: "midi-panel" },
      head,
      empty,
      body,
      status,
    );
    panel.addEventListener("keydown", (event) => {
      if ((event.target as HTMLElement).tagName === "SELECT") return;
      const found = STEP_LENGTHS.findIndex((step) => step.key === event.key);
      const index = event.key === "0" ? KEEP : found;
      if (found >= 0 || event.key === "0") {
        event.preventDefault();
        lengthIndex = index;
        save({ length: index });
        showLengths();
      } else if (event.key === ".") {
        event.preventDefault();
        dotted = !dotted;
        save({ dotted });
        showLengths();
      }
    });
  }
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "MIDI keyboard");
  panel.tabIndex = -1;
  close.addEventListener("click", closeKeyboard);
  dockPanel(panel, closeKeyboard);
  showLengths();
  showRest();
}

/** Closes the panel. Step entry ends with it: the keyboard goes back to Hear it. */
export function closeKeyboard() {
  if (mode === "step") {
    mode = "audition";
    save({ mode });
    context?.status("Step entry is off: the keyboard plays aloud again.");
  }
  if (panel) undockPanel(panel);
  panel = null;
  showStepping();
  context?.view.focus();
}

/** Asks for MIDI again (after a refusal) or looks for keyboards again. */
async function retryKeyboard() {
  if (!access) {
    if (await connect()) reportListening();
  } else {
    refresh();
    reportListening();
  }
}
function reportListening() {
  if (input) say(`Listening to ${input.name || "the keyboard"}.`);
}

/** Opens the panel (and the keyboard, the first time). */
export async function openKeyboard(given: KeyboardContext) {
  context = given;
  if (!panel) build();
  (panel as HTMLElement).focus();
  // Melody search may have connected already: the panel lists the keyboards and says which.
  if (supported() && (await connect())) {
    refresh();
    reportListening();
  }
  showStepping();
}

let melodyReading: StepReading | null = null;
/** For melody search: the keyboard as it plays, when there is one. */
export async function keyboardForMelody(given: KeyboardContext) {
  context ??= given;
  if (!supported() || !(await connect()) || !input) return null;
  melodyReading = null;
  return {
    listen: (take: (pitches: number[]) => void) => {
      listeners.add(take);
      return () => listeners.delete(take);
    },
    // One bar's accidentals for the whole query (melody search reads it as one bar), so a
    // natural after a sharp is written as one.
    spell: (pitches: number[], key: string) => {
      if (!melodyReading || melodyReading.key.name !== parseKey(key).name)
        melodyReading = {
          key: parseKey(key),
          bar: new Map(),
          unit: frac(1, 8),
          meter: "",
          voice: "1",
          shift: 0,
        };
      return pitchText(Math.max(...pitches), melodyReading);
    },
    status: () => `listening to ${input?.name || "the keyboard"}.`,
  };
}
