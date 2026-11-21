/**
 * MIDI files in: read (./smf), written as notation (./convert), then turned into ABC by the
 * MusicXML importer. Loaded the first time a .mid is opened: never part of the first view.
 */
import { type ImportReport, importMusicXml } from "../musicxml/import";
import { DEFAULT_MIDI_OPTIONS, type MidiOptions, midiToMusicXml } from "./convert";
import { MidiFileError, parseSmf } from "./smf";

export { DEFAULT_MIDI_OPTIONS, GRID_NAMES, type Grid, type MidiOptions } from "./convert";
export { MidiFileError } from "./smf";
export { showMidiReport } from "./app";

export type MidiImport = {
  text: string;
  report: ImportReport;
  options: MidiOptions;
  hasDrums: boolean;
  /** The grid used, in words. */
  grid: string;
  voices: number;
};

/** Reads a .mid file into ABC text and a report. */
export async function readMidiFile(
  bytes: Uint8Array,
  name: string,
  options: MidiOptions = DEFAULT_MIDI_OPTIONS,
): Promise<MidiImport> {
  const smf = parseSmf(bytes);
  let converted: ReturnType<typeof midiToMusicXml>;
  try {
    converted = midiToMusicXml(smf, name.replace(/\.(midi?|kar|rmi)$/i, ""), options);
  } catch (error) {
    throw new MidiFileError(error instanceof Error ? error.message : String(error));
  }
  const result = await importMusicXml([converted.xml]);
  return {
    text: result.text,
    report: {
      ...result.report,
      title: converted.title,
      parts: converted.parts,
      bars: converted.bars,
      dropped: [...converted.dropped, ...result.report.dropped],
      notes: [...converted.notes, ...result.report.notes],
    },
    options,
    hasDrums: converted.hasDrums,
    grid: converted.plan.label,
    voices: converted.voices,
  };
}

/** "Imported 'Title' from MIDI: 3 parts, 5 voices, 64 bars, on a sixteenth grid." */
export function describeMidi(result: MidiImport): string {
  const { report } = result;
  const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
  return `Imported “${report.title}” from MIDI: ${plural(report.parts, "part")}, ${plural(result.voices, "voice")}, ${plural(report.bars, "bar")}; grid: ${result.grid}.`;
}
