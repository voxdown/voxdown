/**
 * A Standard MIDI File from Composer's timeline, the order the player plays: repeats, endings and
 * D.C./D.S. jumps included, per-pass dynamics in the velocities. Type 1: a tempo track, then a
 * track per voice (and one for the chord accompaniment), each on its own channel.
 */
import type { InstrumentId } from "./instruments";
import type { Timeline } from "./timeline";

/** Ticks per quarter note. */
export const PPQ = 480;

/** The General MIDI program nearest each of Composer's instruments. */
const PROGRAM: Record<InstrumentId, number> = {
  piano: 0,
  fiddle: 40,
  flute: 73,
  strings: 48,
  guitar: 24,
};

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0) & 0x7f);
function variable(value: number): number[] {
  let rest = Math.max(0, Math.round(value));
  const bytes = [rest & 0x7f];
  rest >>= 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}
const u32 = (value: number) => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];
function chunk(type: string, data: number[]): number[] {
  return [...ascii(type), ...u32(data.length), ...data];
}
/** A track from absolute-tick events; at the same tick, notes end before others start. */
function track(events: { tick: number; order: number; bytes: number[] }[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let last = 0;
  for (const event of sorted) {
    data.push(...variable(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  data.push(0, 0xff, 0x2f, 0);
  return chunk("MTrk", data);
}
const text = (type: number, value: string) => {
  const bytes = new TextEncoder().encode(value);
  return [0xff, type, ...variable(bytes.length), ...bytes];
};

export function writeMidi(
  timeline: Timeline,
  options: { title?: string; tempoFactor?: number; instrument?: InstrumentId } = {},
): Uint8Array {
  const factor = options.tempoFactor ?? 1;
  const beat = timeline.beat > 0 ? timeline.beat : 0.25;
  // The timeline counts whole notes at the tune's tempo, given in beats of `beat` a minute.
  const quarters = Math.max(1, timeline.bpm * factor * beat * 4);
  const tempo = Math.round(60_000_000 / quarters);
  const ticks = (whole: number) => Math.round(whole * 4 * PPQ);
  const meter: number[] = [];
  if (timeline.bar > 0) {
    // The bar as a time signature: in beats of the tune's beat where they divide it evenly.
    // A dotted beat (6/8, 9/8, 12/8) counts the eighths it holds.
    const whole = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
    const dotted = !whole(1 / beat) && whole(3 / beat);
    const den = dotted ? Math.round(3 / beat) : Math.round(1 / beat);
    const num = Math.round(timeline.bar * den);
    if (num > 0 && num < 256 && [1, 2, 4, 8, 16, 32].includes(den))
      meter.push(0, 0xff, 0x58, 4, num, Math.log2(den), 24, 8);
  }
  const conductor = track([
    { tick: 0, order: 0, bytes: text(0x03, options.title ?? "Composer") },
    ...(meter.length ? [{ tick: 0, order: 1, bytes: meter.slice(1) }] : []),
    {
      tick: 0,
      order: 2,
      bytes: [0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255],
    },
  ]);
  const program = PROGRAM[options.instrument ?? "piano"] ?? 0;
  const tracks: number[][] = [];
  timeline.tracks.forEach((info, index) => {
    const notes = timeline.notes.filter((note) => note.track === index);
    if (!notes.length) return;
    // Channel 10 is for drums; skip it.
    const channel = (tracks.length < 9 ? tracks.length : tracks.length + 1) % 16;
    const events: { tick: number; order: number; bytes: number[] }[] = [
      { tick: 0, order: 0, bytes: text(0x03, info.name) },
      { tick: 0, order: 1, bytes: [0xc0 | channel, info.chords ? 0 : program] },
    ];
    for (const note of notes) {
      const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
      const velocity = Math.max(1, Math.min(127, Math.round(note.velocity)));
      const held =
        note.articulation === "staccato" ? 0.5 : note.articulation === "legato" ? 1 : 0.95;
      const start = ticks(note.time);
      const end = Math.max(start + 1, ticks(note.time + note.duration * held));
      events.push({ tick: start, order: 3, bytes: [0x90 | channel, pitch, velocity] });
      events.push({ tick: end, order: 2, bytes: [0x80 | channel, pitch, 0] });
    }
    tracks.push(track(events));
  });
  const header = chunk("MThd", [0, 1, ...[0, tracks.length + 1], (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array([...header, ...conductor, ...tracks.flat()]);
}
