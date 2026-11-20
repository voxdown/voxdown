import { type Fraction, add, frac, meterLength, value } from "./abc";
import type { FileIndex, TuneInfo } from "./tunes";
import { type Item, tuneItems } from "./walk";

export type BarIssue = {
  from: number;
  to: number;
  voice: string;
  kind: "long" | "short";
  message: string;
};

const PLAIN = /^\|$/;

/** Names of common unit lengths, singular and plural. */
function unitName(unit: Fraction): [string, string] {
  const names: Record<string, [string, string]> = {
    "1/1": ["whole note", "whole notes"],
    "1/2": ["half note", "half notes"],
    "1/4": ["quarter", "quarters"],
    "1/8": ["eighth", "eighths"],
    "1/16": ["sixteenth", "sixteenths"],
    "1/32": ["thirty-second", "thirty-seconds"],
  };
  return (
    names[`${unit.num}/${unit.den}`] ?? [
      `${unit.num}/${unit.den} note`,
      `${unit.num}/${unit.den} notes`,
    ]
  );
}

/** "7 eighths", "6½ eighths", "1 quarter". */
export function inUnits(duration: Fraction, unit: Fraction): string {
  const count = value(duration) / value(unit);
  const whole = Math.floor(count + 1e-9);
  const part = count - whole;
  const fractions: [number, string][] = [
    [0.5, "½"],
    [0.25, "¼"],
    [0.75, "¾"],
    [1 / 3, "⅓"],
    [2 / 3, "⅔"],
    [0.125, "⅛"],
    [0.375, "⅜"],
    [0.625, "⅝"],
    [0.875, "⅞"],
  ];
  const symbol = fractions.find(([amount]) => Math.abs(amount - part) < 1e-6)?.[1];
  const [one, many] = unitName(unit);
  if (part < 1e-6) return `${whole} ${whole === 1 ? one : many}`;
  if (symbol) return `${whole || ""}${symbol} ${count < 1 ? one : many}`;
  return `${Math.round(count * 100) / 100} ${many}`;
}

/**
 * Bars whose written length differs from the meter, per voice. Short bars are expected at a
 * pickup, beside repeats, endings and double bars, and at the end; long bars are always noted.
 */
export function checkBars(text: string, tune: TuneInfo, file: FileIndex | null): BarIssue[] {
  return checkItems(tuneItems(text, tune, file));
}

export function checkItems(items: Item[]): BarIssue[] {
  type Voice = {
    total: Fraction;
    from: number;
    first: boolean;
    previous: string;
    multi: boolean;
    meter: string;
    unit: Fraction;
    events: number;
  };
  const voices = new Map<string, Voice>();
  const issues: BarIssue[] = [];
  const close = (voiceId: string, voice: Voice, to: number, bar: string | null) => {
    const expected = meterLength(voice.meter);
    const special = bar === null || !PLAIN.test(bar) || !PLAIN.test(voice.previous);
    if (voice.events > 0 && expected && !voice.multi) {
      const difference = value(voice.total) - value(expected);
      if (difference > 1e-6) {
        issues.push({
          from: voice.from,
          to,
          voice: voiceId,
          kind: "long",
          message: `This bar has ${inUnits(voice.total, voice.unit)}; M:${voice.meter} holds ${inUnits(expected, voice.unit)}.`,
        });
      } else if (difference < -1e-6 && !voice.first && !special) {
        issues.push({
          from: voice.from,
          to,
          voice: voiceId,
          kind: "short",
          message: `This bar has ${inUnits(voice.total, voice.unit)}; M:${voice.meter} holds ${inUnits(expected, voice.unit)}.`,
        });
      }
    }
    if (voice.events > 0) voice.first = false;
    voice.total = frac(0);
    voice.events = 0;
    voice.multi = false;
    if (bar !== null) voice.previous = bar;
  };
  for (const item of items) {
    let voice = voices.get(item.voice);
    if (!voice) {
      voice = {
        total: frac(0),
        from: item.from,
        first: true,
        previous: "|",
        multi: false,
        meter: item.meter,
        unit: frac(1, 8),
        events: 0,
      };
      voices.set(item.voice, voice);
    }
    if (item.type === "event") {
      if (voice.events === 0) {
        voice.from = item.from;
        voice.meter = item.meter;
        voice.unit = item.unit;
      }
      voice.total = add(voice.total, item.duration);
      voice.events += 1;
      if (item.bars) voice.multi = true;
    } else {
      // A bar line that only starts a repeat or an ending closes nothing.
      if (voice.events === 0) {
        if (!PLAIN.test(item.text)) voice.previous = item.text;
        continue;
      }
      close(item.voice, voice, item.to, item.text);
    }
  }
  for (const [id, voice] of voices) {
    if (voice.events === 0) continue;
    const expected = meterLength(voice.meter);
    // The last, unfinished bar may be a pickup's complement; only an overfull one is noted.
    if (expected && !voice.multi && value(voice.total) - value(expected) > 1e-6) {
      const last = [...items].reverse().find((item) => item.voice === id);
      issues.push({
        from: voice.from,
        to: last?.to ?? voice.from,
        voice: id,
        kind: "long",
        message: `This bar has ${inUnits(voice.total, voice.unit)}; M:${voice.meter} holds ${inUnits(expected, voice.unit)}.`,
      });
    }
  }
  return issues.sort((a, b) => a.from - b.from);
}
