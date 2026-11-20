/**
 * Self-hosted instruments (see site/public/composer/sounds/LICENSE.md). Samples sit every third
 * semitone, so no note is shifted by more than a semitone and a half.
 */
export type InstrumentId = "piano" | "fiddle" | "flute" | "strings" | "guitar";
export type InstrumentDef = {
  id: InstrumentId;
  label: string;
  about: string;
  low: number;
  high: number;
  /** Held instruments loop their steady middle while a note lasts. */
  sustained: boolean;
  attack: number;
  release: number;
  level: number;
  /** Softer notes sound darker on struck and plucked strings. */
  brightness: boolean;
  bytes: number;
};

const grid = (low: number, high: number) => {
  const notes: number[] = [];
  for (let midi = low; midi <= high; midi++) if (midi % 3 === 0) notes.push(midi);
  return notes;
};

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef & { notes: number[] }> = {
  piano: {
    id: "piano",
    label: "Piano",
    about: "Salamander grand",
    low: 21,
    high: 108,
    sustained: false,
    attack: 0.002,
    release: 0.28,
    level: 0.9,
    brightness: true,
    bytes: 993_000,
    notes: grid(21, 108),
  },
  fiddle: {
    id: "fiddle",
    label: "Fiddle",
    about: "Solo violin",
    low: 54,
    high: 99,
    sustained: true,
    attack: 0.03,
    release: 0.18,
    level: 0.62,
    brightness: false,
    bytes: 392_000,
    notes: grid(54, 99),
  },
  flute: {
    id: "flute",
    label: "Flute",
    about: "Concert flute",
    low: 60,
    high: 96,
    sustained: true,
    attack: 0.04,
    release: 0.16,
    level: 0.7,
    brightness: false,
    bytes: 318_000,
    notes: grid(60, 96),
  },
  strings: {
    id: "strings",
    label: "Strings",
    about: "String ensemble",
    low: 36,
    high: 96,
    sustained: true,
    attack: 0.09,
    release: 0.35,
    level: 0.65,
    brightness: false,
    bytes: 514_000,
    notes: grid(36, 96),
  },
  guitar: {
    id: "guitar",
    label: "Guitar",
    about: "Nylon strings",
    low: 39,
    high: 84,
    sustained: false,
    attack: 0.002,
    release: 0.22,
    level: 0.95,
    brightness: true,
    bytes: 392_000,
    notes: grid(39, 84),
  },
};
export const INSTRUMENT_ORDER: InstrumentId[] = ["piano", "fiddle", "flute", "strings", "guitar"];

export function isInstrument(value: unknown): value is InstrumentId {
  return typeof value === "string" && value in INSTRUMENTS;
}

/** The nearest sample to a pitch, clamped to the instrument's range. */
export function nearestSample(def: { notes: number[] }, pitch: number): number {
  let best = def.notes[0] as number;
  for (const note of def.notes) if (Math.abs(note - pitch) < Math.abs(best - pitch)) best = note;
  return best;
}

export function sampleUrl(id: InstrumentId, midi: number, base: string): string {
  return new URL(`sounds/${id}/${midi}.mp3`, base).href;
}

/** Velocity to gain: a gentle curve, so p and ff differ clearly without blaring. */
export function velocityGain(velocity: number): number {
  const v = Math.max(1, Math.min(127, velocity)) / 127;
  return 0.08 + 0.92 * v ** 1.7;
}

/**
 * Finds a seamless loop in a held note's steady part: the loop end sits late in the sample, and
 * the start is the earlier upward zero crossing whose waveform best matches the end's.
 */
export function findLoop(
  data: Float32Array,
  sampleRate: number,
): { start: number; end: number } | null {
  const length = data.length;
  if (length < sampleRate * 0.8) return null;
  const crossing = (from: number, to: number, step: 1 | -1) => {
    for (let index = from; step > 0 ? index < to : index > to; index += step)
      if ((data[index - 1] as number) <= 0 && (data[index] as number) > 0) return index;
    return -1;
  };
  const end = crossing(Math.floor(length * 0.9), Math.floor(length * 0.75), -1);
  if (end < 0) return null;
  const window = 384;
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  const searchFrom = Math.floor(sampleRate * 0.35);
  const searchTo = Math.max(searchFrom + 1, end - Math.floor(sampleRate * 0.5));
  let checked = 0;
  for (let index = searchFrom; index < searchTo && checked < 600; index++) {
    if (!((data[index - 1] as number) <= 0 && (data[index] as number) > 0)) continue;
    checked += 1;
    let score = 0;
    for (let k = 1; k <= window; k++) {
      const a = data[end - k] as number;
      const b = data[index - k] as number;
      score += (a - b) * (a - b);
      if (score > bestScore) break;
    }
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  }
  if (best < 0) return null;
  return { start: best / sampleRate, end: end / sampleRate };
}
