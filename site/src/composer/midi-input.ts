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
import type { EditorView } from "@codemirror/view";
import { type Fraction, frac, mul, parseKey } from "./abc";
import { STEP_LENGTHS, type StepReading, pitchText, stepInsert } from "./stepentry";
import { indexFile } from "./tunes";

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

function length(): Fraction {
  const base = (STEP_LENGTHS[lengthIndex] ?? STEP_LENGTHS[2])?.length ?? frac(1, 8);
  return dotted ? mul(base, frac(3, 2)) : base;
}

/** Writes a step at the caret: one undo, a space where beams should break, a bar line when full. */
function enter(pitches: number[] | "rest") {
  if (!context) return;
  const { view } = context;
  const text = view.state.doc.toString();
  const at = view.state.selection.main.head;
  const step = stepInsert(text, indexFile(text), at, pitches, length());
  if (!step) {
    say("Put the caret in a tune's music (after K:) to write there.");
    return;
  }
  view.dispatch({
    changes: { from: at, insert: step.insert },
    selection: { anchor: at + step.insert.length },
    annotations: isolateHistory.of("full"),
    userEvent: "input.midi",
    scrollIntoView: true,
  });
  say(
    `Wrote ${step.written}${step.bars ? ` and ${step.bars === 1 ? "a bar line" : `${step.bars} bar lines`}` : ""}.`,
  );
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
}

async function connect() {
  if (access) return true;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    say(
      "Composer wasn't allowed to use MIDI devices. Allow it in the browser's site settings, then open this again.",
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
    panel = element(
      "section",
      { id: "midi-panel", className: "midi-panel" },
      head,
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
          "Step entry spells notes for the key, writes chords as [...] and a bar line when the bar fills. Each note is one undo.",
      }),
      status,
    );
    panel.addEventListener("keydown", (event) => {
      if ((event.target as HTMLElement).tagName === "SELECT") return;
      const index = STEP_LENGTHS.findIndex((step) => step.key === event.key);
      if (index >= 0) {
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
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeKeyboard();
    }
  });
  close.addEventListener("click", closeKeyboard);
  document.body.append(panel);
  showLengths();
  showRest();
}

export function closeKeyboard() {
  panel?.remove();
  panel = null;
  context?.view.focus();
}

/** Opens the panel (and the keyboard, the first time). */
export async function openKeyboard(given: KeyboardContext) {
  context = given;
  if (!panel) build();
  (panel as HTMLElement).focus();
  // Melody search may have connected already: the panel lists the keyboards and says which.
  if (supported() && (await connect())) {
    refresh();
    say(
      input
        ? `Listening to ${input.name || "the keyboard"}.`
        : "Plug in a MIDI keyboard: it shows here when it connects.",
    );
  }
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
