/**
 * Opening a MusicXML score or a MIDI file: the converter loads on first use, reads the file into
 * ABC, and the result opens as a new draft (the file it came from is never written to), with a
 * report of what was brought in and what was left out. A MIDI report can import again at another
 * grid; while the draft is as that import left it, importing again replaces it rather than making
 * another. Loaded the first time a score or MIDI file is opened.
 */
import type { MidiOptions } from "./midifile";

export type ImportContext = {
  status: (text: string) => void;
  /** Opens ABC text as a draft: a new one, or in place of the current one. */
  open: (text: string, title: string, replace: boolean) => void;
  noticeError: (message: string) => void;
  /** The current text and draft. */
  current: () => { text: string; draft: string };
  /** How long a MIDI import took, for checks. */
  took: (ms: number) => void;
};

let importing = false;
let lastMidi: { text: string; draft: string } | null = null;
const painted = () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));

async function guarded(context: ImportContext, name: string, run: () => Promise<void>) {
  if (importing) return;
  importing = true;
  context.status(`Reading ${name}…`);
  try {
    await run();
  } catch (error) {
    context.status("Ready");
    context.noticeError(
      error instanceof Error && error.message
        ? `${name} could not be imported. ${error.message}`
        : `${name} could not be imported.`,
    );
  } finally {
    importing = false;
  }
}

/** A .musicxml, .xml or .mxl file. */
export function importScore(context: ImportContext, bytes: Uint8Array, name: string) {
  return guarded(context, name, async () => {
    const musicxml = await import("./musicxml");
    let shown = -1;
    const result = await musicxml.readScore(bytes, (done, total) => {
      const percent = total ? Math.round((done / total) * 100) : 0;
      if (percent !== shown) {
        shown = percent;
        context.status(`Importing ${name}: ${percent}%`);
      }
    });
    // The report first, painted, then the new draft behind it: a large score's drawing takes a
    // moment, and the report should not wait for it.
    const summary = musicxml.describeReport(result.report);
    context.status(summary);
    musicxml.showImportReport(result.report, name, summary);
    await painted();
    context.open(result.text, result.report.title, false);
  });
}

/** A .mid or .midi file, at the grid and with the drums asked for. */
export function importMidi(
  context: ImportContext,
  bytes: Uint8Array,
  name: string,
  options?: MidiOptions,
): Promise<void> {
  return guarded(context, name, async () => {
    const midi = await import("./midifile");
    const started = performance.now();
    const result = await midi.readMidiFile(bytes, name, options);
    context.took(Math.round(performance.now() - started));
    const summary = midi.describeMidi(result);
    context.status(summary);
    const now = context.current();
    const replace = Boolean(lastMidi && lastMidi.draft === now.draft && lastMidi.text === now.text);
    midi.showMidiReport(result, name, summary, (again) => importMidi(context, bytes, name, again));
    await painted();
    context.open(result.text, result.report.title, replace);
    lastMidi = context.current();
  });
}
