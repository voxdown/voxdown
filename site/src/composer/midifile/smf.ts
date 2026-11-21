/**
 * A Standard MIDI File reader: formats 0 and 1 (format 2's tracks are read one after another),
 * running status, the meta events that matter for notation (tempo, time and key signatures,
 * track names, lyrics), and everything else counted so the import report can say what was left
 * out. SysEx is skipped. Sizes are limited like the zip reader's: files over 16 MB are refused and
 * the number of events is capped, so a hostile file can't hold the page.
 */

import { maxOf } from "../extent";

export class MidiFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MidiFileError";
  }
}

export const FILE_LIMIT = 16 * 1024 * 1024;
export const EVENT_LIMIT = 2_000_000;

export type SmfNote = {
  tick: number;
  end: number;
  pitch: number;
  velocity: number;
  channel: number;
};
export type SmfTrack = {
  name: string;
  notes: SmfNote[];
  /** Program changes, by channel, in order. */
  programs: { tick: number; channel: number; program: number }[];
  lyrics: { tick: number; text: string }[];
};
export type Smf = {
  format: number;
  /** Ticks per quarter note. */
  division: number;
  tracks: SmfTrack[];
  tempos: { tick: number; perQuarter: number }[];
  meters: { tick: number; num: number; den: number }[];
  keys: { tick: number; fifths: number; minor: boolean }[];
  /** Where a file cut short stops: the tick its last track reached, and tracks never begun. */
  truncated?: { tick: number; tracks: number };
  /** What was read and left out, counted. */
  counts: {
    controllers: number;
    pedals: number;
    pitchBends: number;
    aftertouch: number;
    programs: number;
    sysex: number;
    /** Notes still sounding when their track ended. */
    unclosed: number;
    /** Notes with no length (an off on the same tick). */
    empty: number;
    markers: number;
  };
};

const utf8 = new TextDecoder("utf-8", { fatal: true });
const latin1 = new TextDecoder("windows-1252");
/** Meta text: UTF-8 when it is, else Latin-1 (what most older files use). */
function textOf(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

/** Whether bytes start like a MIDI file (or a RIFF-wrapped one). */
export function looksLikeMidi(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 14 &&
    (ascii(bytes, 0) === "MThd" || (ascii(bytes, 0) === "RIFF" && ascii(bytes, 8) === "RMID"))
  );
}

/** Reads a MIDI file. Throws a MidiFileError with a plain message when it can't. */
export function parseSmf(input: Uint8Array): Smf {
  if (input.length > FILE_LIMIT)
    throw new MidiFileError("This MIDI file is larger than 16 MB, too large to open here.");
  let bytes = input;
  // RIFF MIDI (.rmi): the SMF is the "data" chunk.
  if (ascii(bytes, 0) === "RIFF" && ascii(bytes, 8) === "RMID") {
    let at = 12;
    while (at + 8 <= bytes.length && ascii(bytes, at) !== "data")
      at += 8 + new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4).getUint32(0, true);
    if (at + 8 > bytes.length) throw new MidiFileError("This RIFF MIDI file has no MIDI data.");
    bytes = bytes.subarray(at + 8);
  }
  if (bytes.length < 14 || ascii(bytes, 0) !== "MThd")
    throw new MidiFileError("This is not a MIDI file: it doesn't start with a MIDI header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(4);
  if (headerLength < 6) throw new MidiFileError("This MIDI file's header is damaged.");
  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (format > 2)
    throw new MidiFileError(`This MIDI file is in format ${format}, which isn't one.`);
  if (division & 0x8000)
    throw new MidiFileError(
      "This MIDI file is timed in SMPTE frames rather than beats; Composer reads beat-timed files only.",
    );
  if (!division) throw new MidiFileError("This MIDI file's header gives no ticks per beat.");

  const smf: Smf = {
    format,
    division,
    tracks: [],
    tempos: [],
    meters: [],
    keys: [],
    counts: {
      controllers: 0,
      pedals: 0,
      pitchBends: 0,
      aftertouch: 0,
      programs: 0,
      sysex: 0,
      unclosed: 0,
      empty: 0,
      markers: 0,
    },
  };
  let events = 0;
  let at = 8 + headerLength;
  let offset = 0; // Format 2: each track follows the one before.
  while (at + 8 <= bytes.length && smf.tracks.length < trackCount) {
    const id = ascii(bytes, at);
    const length = view.getUint32(at + 4);
    const start = at + 8;
    at = start + length;
    if (id !== "MTrk") continue; // Unknown chunks are skipped, as the standard says.
    // A file cut short: its last track is read as far as it goes.
    const clipped = at > bytes.length;
    const end = Math.min(at, bytes.length);
    const track: SmfTrack = { name: "", notes: [], programs: [], lyrics: [] };
    const open = new Map<number, { tick: number; velocity: number }[]>();
    let position = start;
    let tick = format === 2 ? offset : 0;
    let status = 0;
    const variable = () => {
      let value = 0;
      for (let count = 0; count < 4; count++) {
        if (position >= end)
          throw new MidiFileError("This MIDI file is damaged: an event is cut short.");
        const byte = bytes[position++] as number;
        value = value * 128 + (byte & 0x7f);
        if (!(byte & 0x80)) return value;
      }
      throw new MidiFileError("This MIDI file is damaged: a length is too long.");
    };
    const data = () => {
      if (position >= end)
        throw new MidiFileError("This MIDI file is damaged: an event is cut short.");
      const byte = bytes[position++] as number;
      if (byte & 0x80)
        throw new MidiFileError("This MIDI file is damaged: a data byte is out of range.");
      return byte;
    };
    const close = (channel: number, pitch: number, when: number) => {
      const key = channel * 128 + pitch;
      const list = open.get(key);
      const first = list?.shift();
      if (!first) return;
      if (when <= first.tick) {
        smf.counts.empty += 1;
        return;
      }
      track.notes.push({ tick: first.tick, end: when, pitch, velocity: first.velocity, channel });
    };
    try {
      while (position < end) {
        if (++events > EVENT_LIMIT)
          throw new MidiFileError(
            `This MIDI file has more than ${EVENT_LIMIT.toLocaleString("en")} events, too many to open here.`,
          );
        tick += variable();
        let byte = bytes[position] as number;
        if (byte & 0x80) {
          position += 1;
        } else {
          // Running status: the data bytes of another message like the last.
          if (!status)
            throw new MidiFileError("This MIDI file is damaged: data with no status before it.");
          byte = status;
        }
        if (byte === 0xff) {
          const type = bytes[position++] as number;
          const size = variable();
          if (position + size > end)
            throw new MidiFileError("This MIDI file is damaged: an event runs past its track.");
          const body = bytes.subarray(position, position + size);
          position += size;
          if (type === 0x2f) break;
          if (type === 0x03 && !track.name) track.name = textOf(body).trim();
          else if (type === 0x05) track.lyrics.push({ tick, text: textOf(body) });
          else if (type === 0x51 && size >= 3)
            smf.tempos.push({
              tick,
              perQuarter:
                ((body[0] as number) << 16) | ((body[1] as number) << 8) | (body[2] as number),
            });
          else if (type === 0x58 && size >= 2)
            smf.meters.push({ tick, num: body[0] as number, den: 2 ** (body[1] as number) });
          else if (type === 0x59 && size >= 2)
            smf.keys.push({
              tick,
              fifths: ((body[0] as number) << 24) >> 24,
              minor: body[1] === 1,
            });
          else if (type === 0x06 || type === 0x07) smf.counts.markers += 1;
          continue;
        }
        if (byte === 0xf0 || byte === 0xf7) {
          const size = variable();
          position += size;
          if (position > end)
            throw new MidiFileError(
              "This MIDI file is damaged: a SysEx message runs past its track.",
            );
          smf.counts.sysex += 1;
          continue;
        }
        if (byte >= 0xf0)
          throw new MidiFileError(
            "This MIDI file is damaged: it has a system message files can't hold.",
          );
        status = byte;
        const kind = byte & 0xf0;
        const channel = byte & 0x0f;
        if (kind === 0x90 || kind === 0x80) {
          const pitch = data();
          const velocity = data();
          if (kind === 0x90 && velocity > 0) {
            const key = channel * 128 + pitch;
            const list = open.get(key) ?? [];
            list.push({ tick, velocity });
            open.set(key, list);
          } else close(channel, pitch, tick);
        } else if (kind === 0xa0) {
          data();
          data();
          smf.counts.aftertouch += 1;
        } else if (kind === 0xb0) {
          const controller = data();
          data();
          if (controller === 64) smf.counts.pedals += 1;
          else if (controller < 120) smf.counts.controllers += 1;
        } else if (kind === 0xc0) {
          track.programs.push({ tick, channel, program: data() });
          smf.counts.programs += 1;
        } else if (kind === 0xd0) {
          data();
          smf.counts.aftertouch += 1;
        } else {
          data();
          data();
          smf.counts.pitchBends += 1;
        }
      }
    } catch (error) {
      // An event cut off by the end of the file: keep what came before it.
      if (!clipped || !(error instanceof MidiFileError) || /too many/.test(error.message))
        throw error;
    }
    if (clipped) smf.truncated = { tick, tracks: trackCount - smf.tracks.length - 1 };
    // Notes still held when the track ends stop there.
    for (const [key, list] of open)
      for (const each of list) {
        smf.counts.unclosed += 1;
        if (tick > each.tick)
          track.notes.push({
            tick: each.tick,
            end: tick,
            pitch: key % 128,
            velocity: each.velocity,
            channel: Math.floor(key / 128),
          });
      }
    track.notes.sort((a, b) => a.tick - b.tick || b.pitch - a.pitch);
    offset = tick;
    smf.tracks.push(track);
  }
  if (!smf.tracks.length) throw new MidiFileError("This MIDI file has no tracks.");
  // Tracks the header promised but the file doesn't hold.
  if (smf.tracks.length < trackCount && !smf.truncated)
    smf.truncated = {
      tick: maxOf(
        smf.tracks.flatMap((track) => track.notes.map((note) => note.end)),
        0,
      ),
      tracks: trackCount - smf.tracks.length,
    };
  for (const list of [smf.tempos, smf.meters, smf.keys]) list.sort((a, b) => a.tick - b.tick);
  return smf;
}
