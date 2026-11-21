/**
 * Names in words that the start of the editor needs before the caret explainer loads: what a
 * meter and a key are called. (What decorations are called is in ./decorations.)
 */
import type { Key } from "./abc";

export function describeMeter(meter: string): string {
  const text = meter.trim();
  if (text === "C") return "common time, four quarter notes a bar";
  if (text === "C|") return "cut time, two half notes a bar";
  if (/^none$/i.test(text)) return "free time, no bar length";
  const match = /^([0-9+]+)\/([0-9]+)/.exec(text);
  if (!match) return text;
  const top = (match[1] as string).split("+").reduce((sum, part) => sum + Number(part), 0);
  const bottom = Number(match[2]);
  const names: Record<number, [string, string]> = {
    1: ["whole note", "whole notes"],
    2: ["half note", "half notes"],
    4: ["quarter note", "quarter notes"],
    8: ["eighth note", "eighth notes"],
    16: ["sixteenth note", "sixteenth notes"],
  };
  const [one, many] = names[bottom] ?? [`1/${bottom} note`, `1/${bottom} notes`];
  const compound = top % 3 === 0 && top > 3 && bottom >= 8;
  const feel = compound ? `, ${top / 3} dotted beats` : "";
  return `${top} ${top === 1 ? one : many} a bar${feel}`;
}

export function describeKey(key: Key): string {
  const count = Math.abs(key.fifths);
  const signature =
    key.fifths === 0
      ? "no sharps or flats"
      : `${count} ${key.fifths > 0 ? (count === 1 ? "sharp" : "sharps") : count === 1 ? "flat" : "flats"}`;
  return key.tonic ? `${key.name}, ${signature}` : "no key signature";
}
