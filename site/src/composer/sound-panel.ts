/**
 * The Sound popover: the instrument (and what choosing one downloads), volume, room, hearing notes
 * as you write and humanised playing. Loaded the first time it is opened.
 */
import { INSTRUMENTS, INSTRUMENT_ORDER, type InstrumentId } from "./instruments";
import type { Player } from "./player";

export type SoundContext = {
  player: Player;
  prefs: {
    instrument: InstrumentId;
    volume: number;
    reverb: number;
    hear: boolean;
    humanise: boolean;
  };
  savePrefs: () => void;
  /** Names the chosen instrument on the transport. */
  setLabel: (label: string) => void;
  /** On a phone, Voices opens from here. */
  voices: { label: string; open: () => void } | null;
};

export function fillSound(panel: HTMLElement, context: SoundContext) {
  const { player, prefs, savePrefs } = context;
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
    small.textContent = def.about;
    // What choosing it downloads, on its own line, until it is kept here.
    const size = document.createElement("small");
    size.className = "instrument-size";
    size.textContent = player.ready(id) ? "" : `${Math.round(def.bytes / 1024)}\u00a0KB to load`;
    button.append(label, small, size);
    button.addEventListener("click", async () => {
      prefs.instrument = id;
      savePrefs();
      for (const each of choices.querySelectorAll("button"))
        each.setAttribute("aria-checked", String(each === button));
      context.setLabel(def.label);
      const wasPlaying = player.status === "playing";
      const position = player.position();
      if (wasPlaying) player.pause();
      await player.setInstrument(id);
      size.textContent = "";
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
  // On a phone, Voices has no room in the transport: it opens from here.
  if (context.voices) {
    const voices = document.createElement("button");
    voices.type = "button";
    voices.className = "sheet-link";
    voices.textContent = `Voices: mute and solo… ${context.voices.label}`.trim();
    voices.addEventListener("click", context.voices.open);
    panel.append(voices);
  }
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Instruments load the first time you choose them, then stay in this browser for offline use. Dynamics, accents, staccato and slurs in the score shape the playing.";
  panel.append(hint);
}

/** The Voices popover's rows: mute and solo for each voice, applied at once, even while playing. */
export function fillVoices(
  panel: HTMLElement,
  tracks: { name: string; chords?: boolean }[],
  context: { muted: Set<number>; soloed: Set<number>; update: () => void },
) {
  for (const [index, track] of tracks.entries()) {
    const row = document.createElement("div");
    row.className = "voice-row";
    const name = document.createElement("span");
    name.textContent = track.name;
    const mute = document.createElement("button");
    mute.type = "button";
    mute.textContent = "Mute";
    mute.setAttribute("aria-label", `Mute ${track.name}`);
    mute.setAttribute("aria-pressed", String(context.muted.has(index)));
    mute.addEventListener("click", () => {
      if (context.muted.has(index)) context.muted.delete(index);
      else context.muted.add(index);
      mute.setAttribute("aria-pressed", String(context.muted.has(index)));
      context.update();
    });
    const solo = document.createElement("button");
    solo.type = "button";
    solo.textContent = "Solo";
    solo.setAttribute("aria-label", `Solo ${track.name}`);
    solo.setAttribute("aria-pressed", String(context.soloed.has(index)));
    solo.addEventListener("click", () => {
      if (context.soloed.has(index)) context.soloed.delete(index);
      else context.soloed.add(index);
      solo.setAttribute("aria-pressed", String(context.soloed.has(index)));
      context.update();
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
