import {
  type Fraction,
  type Key,
  type MusicToken,
  type NoteToken,
  accidentalValue,
  defaultUnit,
  fieldOf,
  frac,
  lineKind,
  meterLength,
  mul,
  parseKey,
  parseLength,
  parseUnit,
  staffPlace,
  tokenizeMusic,
} from "./abc";
import type { FileIndex, TuneInfo } from "./tunes";

export type WalkState = {
  voice: string;
  key: Key;
  unit: Fraction;
  /** Whether L: was given; otherwise the unit follows the meter. */
  unitGiven: boolean;
  meter: string;
  /** Accidentals written earlier in this bar, by staff place ("F4"). */
  bar: Map<string, number>;
};

type VoiceState = Omit<WalkState, "voice" | "bar"> & { bar: Map<string, number> };

/** Visits each music token of a tune in order, with the key, unit, meter and voice in force. */
export function walkTune(
  text: string,
  tune: TuneInfo,
  file: FileIndex | null,
  visit: (token: MusicToken, state: WalkState) => void,
  onLine?: (from: number, to: number, kind: string, state: WalkState) => void,
): void {
  let meter = "";
  let unit: Fraction | null = null;
  let key = parseKey("C");
  const header = (from: number, to: number, stopAtK: boolean) => {
    for (const { line } of lines(text, from, to)) {
      const field = fieldOf(line);
      if (!field) continue;
      if (field.key === "M") meter = field.value.trim();
      if (field.key === "L") unit = parseUnit(field.value) ?? unit;
      if (field.key === "K") {
        key = parseKey(field.value);
        if (stopAtK) break;
      }
    }
  };
  if (file?.header) header(file.header.from, file.header.to, false);
  header(tune.from, tune.bodyFrom, true);
  const initial: VoiceState = {
    key,
    unit: unit ?? defaultUnit(meter),
    unitGiven: unit !== null,
    meter,
    bar: new Map(),
  };
  const voices = new Map<string, VoiceState>();
  const firstVoice = tune.voices[0]?.id ?? "1";
  let voice = firstVoice;
  const stateOf = (id: string): VoiceState => {
    let found = voices.get(id);
    if (!found) {
      found = { ...initial, bar: new Map() };
      voices.set(id, found);
    }
    return found;
  };
  let state: WalkState = { voice, ...stateOf(voice) };
  const sync = () => {
    const kept = stateOf(voice);
    kept.key = state.key;
    kept.unit = state.unit;
    kept.unitGiven = state.unitGiven;
    kept.meter = state.meter;
    kept.bar = state.bar;
  };
  const switchVoice = (id: string) => {
    sync();
    voice = id || firstVoice;
    state = { voice, ...stateOf(voice) };
  };
  const applyField = (name: string, fieldValue: string) => {
    if (name === "K") {
      // A K: line may only set a clef; keep the key then.
      if (/^\s*(clef|middle|transpose|octave|stafflines)\b/.test(fieldValue) || !fieldValue.trim())
        return;
      state.key = parseKey(fieldValue);
    } else if (name === "L") {
      const parsed = parseUnit(fieldValue);
      if (parsed) {
        state.unit = parsed;
        state.unitGiven = true;
      }
    } else if (name === "M") {
      state.meter = fieldValue.trim();
      if (!state.unitGiven) state.unit = defaultUnit(state.meter);
    } else if (name === "V") switchVoice(fieldValue.trim().split(/\s+/)[0] ?? "");
  };
  for (const { line, from } of lines(text, tune.bodyFrom, tune.to)) {
    const kind = lineKind(line, true);
    onLine?.(from, from + line.length, kind, state);
    if (kind === "field") {
      const field = fieldOf(line);
      if (field) applyField(field.key, field.value.replace(/\s%.*$/, ""));
      continue;
    }
    if (kind !== "music") continue;
    for (const token of tokenizeMusic(line, from)) {
      if (token.kind === "inline-field") {
        const match = /^\[([A-Za-z]):(.*)\]$/.exec(token.text);
        if (match) applyField(match[1] as string, match[2] as string);
      }
      visit(token, state);
      if (token.kind === "note" && token.accidental && !token.inGrace)
        state.bar.set(staffPlace(token.letter, token.octave), accidentalValue(token.accidental));
      if (token.kind === "bar") state.bar = new Map();
    }
  }
  sync();
}

export function* lines(
  text: string,
  from: number,
  to: number,
): Generator<{ line: string; from: number }> {
  let position = from;
  while (position < to) {
    let end = text.indexOf("\n", position);
    if (end < 0 || end > to) end = to;
    yield { line: text.slice(position, end), from: position };
    position = end + 1;
  }
}

/** A sounding (or silent) moment in one voice: a note, chord or rest, with its written length. */
export type MusicEvent = {
  type: "event";
  voice: string;
  from: number;
  to: number;
  /** In whole notes, after unit length, tuplets and broken rhythm. */
  duration: Fraction;
  rest: boolean;
  /** For Z/X: the number of whole bars it fills. */
  bars?: number | undefined;
  notes: NoteToken[];
  meter: string;
  unit: Fraction;
};
export type BarItem = {
  type: "bar";
  voice: string;
  from: number;
  to: number;
  text: string;
  meter: string;
};
export type Item = MusicEvent | BarItem;

function tupletOf(text: string, meter: string): { p: number; q: number; r: number } {
  const [pText, qText, rText] = text.slice(1).split(":");
  const p = Number(pText);
  const length = meterLength(meter);
  const compound = Boolean(length && /^\s*(6|9|12|15|18)\s*\//.test(meter));
  const defaults: Record<number, number> = { 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 };
  const q = Number(qText) || defaults[p] || (compound ? 3 : 2);
  const r = Number(rText) || p;
  return { p, q, r };
}

const BROKEN = [frac(1), frac(3, 2), frac(7, 4), frac(15, 8)];
const BROKEN_SHORT = [frac(1), frac(1, 2), frac(1, 4), frac(1, 8)];

/** Every note, chord, rest and bar line of a tune, voice by voice, in text order. */
export function tuneItems(text: string, tune: TuneInfo, file: FileIndex | null): Item[] {
  const items: Item[] = [];
  type Pending = {
    tuplet?: { multiplier: Fraction; left: number };
    broken?: Fraction | undefined;
    last?: MusicEvent;
  };
  const pending = new Map<string, Pending>();
  let chord: { from: number; notes: NoteToken[]; first?: Fraction } | null = null;
  let inGrace = false;
  const of = (voice: string): Pending => {
    let found = pending.get(voice);
    if (!found) {
      found = {};
      pending.set(voice, found);
    }
    return found;
  };
  const emit = (base: Omit<MusicEvent, "meter" | "unit">, state: WalkState) => {
    const event: MusicEvent = { ...base, meter: state.meter, unit: state.unit };
    const voice = of(state.voice);
    let duration = event.duration;
    if (voice.tuplet && voice.tuplet.left > 0 && !event.bars) {
      duration = mul(duration, voice.tuplet.multiplier);
      voice.tuplet.left -= 1;
    }
    if (voice.broken) {
      duration = mul(duration, voice.broken);
      voice.broken = undefined;
    }
    event.duration = duration;
    items.push(event);
    voice.last = event;
  };
  walkTune(text, tune, file, (token, state) => {
    if (token.kind === "grace-open") inGrace = true;
    else if (token.kind === "grace-close") inGrace = false;
    if (inGrace) return;
    const voice = of(state.voice);
    switch (token.kind) {
      case "chord-open":
        chord = { from: token.from, notes: [] };
        return;
      case "chord-close": {
        if (!chord) return;
        const outer = parseLength(token.length ?? "");
        const first = chord.first ?? frac(1);
        emit(
          {
            type: "event",
            voice: state.voice,
            from: chord.from,
            to: token.to,
            duration: mul(mul(first, outer), state.unit),
            rest: chord.notes.length === 0,
            notes: chord.notes,
          },
          state,
        );
        chord = null;
        return;
      }
      case "note":
        if (chord) {
          chord.notes.push(token);
          if (!chord.first) chord.first = parseLength(token.length);
          return;
        }
        emit(
          {
            type: "event",
            voice: state.voice,
            from: token.from,
            to: token.to,
            duration: mul(parseLength(token.length), state.unit),
            rest: false,
            notes: [token],
          },
          state,
        );
        return;
      case "rest": {
        if (chord) return;
        const multi = token.letter === "Z" || token.letter === "X";
        const bars = multi ? Number(token.length) || 1 : undefined;
        const length = meterLength(state.meter) ?? frac(1);
        emit(
          {
            type: "event",
            voice: state.voice,
            from: token.from,
            to: token.to,
            duration: multi
              ? mul(length, frac(bars ?? 1))
              : mul(parseLength(token.length), state.unit),
            rest: true,
            bars,
            notes: [],
          },
          state,
        );
        return;
      }
      case "tuplet": {
        const { p, q, r } = tupletOf(token.text, state.meter);
        if (p > 0) voice.tuplet = { multiplier: frac(q, p), left: r };
        return;
      }
      case "broken": {
        const count = Math.min(token.text.length, 3);
        const longFirst = token.text.startsWith(">");
        if (voice.last) {
          voice.last.duration = mul(
            voice.last.duration,
            (longFirst ? BROKEN : BROKEN_SHORT)[count] as Fraction,
          );
        }
        voice.broken = (longFirst ? BROKEN_SHORT : BROKEN)[count];
        return;
      }
      case "bar":
        items.push({
          type: "bar",
          voice: state.voice,
          from: token.from,
          to: token.to,
          text: token.text,
          meter: state.meter,
        });
        return;
    }
  });
  return items;
}
