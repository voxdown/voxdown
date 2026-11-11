/**
 * The story read aloud by the browser's own voices: from the cursor to the end of its scene, the
 * narrator in one voice and each character in another, pausing where the story pauses. For
 * hearing how a passage sounds while writing it; never a recording.
 */
import type { ScriptLine } from "voxdown";
import { plainText } from "./emphasis";

/** The voices to read with: the story's language first (its family, `en` for `en-GB`). */
export function voicesFor(
  speakers: readonly string[],
  voices: ReadonlyArray<Pick<SpeechSynthesisVoice, "lang" | "default" | "name">>,
  language: string,
  narrator: string,
): Map<string, number> {
  const family = language.toLowerCase().split("-")[0] ?? "";
  const indexed = voices.map((voice, index) => ({ voice, index }));
  const own = indexed.filter(({ voice }) => voice.lang.toLowerCase().split("-")[0] === family);
  const pool = own.length ? own : indexed;
  const chosen = new Map<string, number>();
  if (pool.length === 0) return chosen;
  // The narrator in the language's usual voice, each character in the next one along.
  const usual = pool.find(({ voice }) => voice.default) ?? (pool[0] as (typeof pool)[number]);
  const others = pool.filter((entry) => entry !== usual);
  let next = 0;
  for (const speaker of speakers) {
    if (speaker.toLowerCase() === narrator.toLowerCase() || others.length === 0)
      chosen.set(speaker, usual.index);
    else chosen.set(speaker, (others[next++ % others.length] as (typeof others)[number]).index);
  }
  return chosen;
}

/** A pause's length in seconds, as `{pause 2s}`, `{pause 500ms}` or `{pause}` write it. */
export function pauseSeconds(value: string): number {
  const found = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)?\s*$/.exec(value);
  if (!found) return 1;
  const amount = Number(found[1]);
  return found[2] === "ms" ? amount / 1000 : amount;
}

/** What is read: the lines from where the cursor is to the end of its scene. */
export function toHear(rows: readonly ScriptLine[], fromLine: number): ScriptLine[] {
  const first = rows.findIndex((row) => row.line >= fromLine);
  if (first < 0) return [];
  const scene = (rows[first] as ScriptLine).scene;
  return rows
    .slice(first)
    .filter((row) => row.scene === scene)
    .filter((row) => row.kind === "speech" || row.kind === "vocal" || row.kind === "pause");
}

export class Hearing {
  private stopped = true;

  get on(): boolean {
    return !this.stopped;
  }

  /** Reads the rows, calling `at` as each starts; resolves when done or stopped. */
  async read(
    rows: readonly ScriptLine[],
    language: string,
    narrator: string,
    at: (row: ScriptLine) => void,
  ): Promise<void> {
    const synth = window.speechSynthesis;
    this.stop();
    this.stopped = false;
    const voices = synth.getVoices();
    const speakers = [...new Set(rows.flatMap((row) => (row.speaker ? [row.speaker] : [])))];
    const chosen = voicesFor(speakers, voices, language, narrator);
    for (const row of rows) {
      if (this.stopped) return;
      at(row);
      if (row.kind === "pause") {
        await new Promise((done) => setTimeout(done, pauseSeconds(row.text) * 1000));
        continue;
      }
      const words = plainText(row.text).trim();
      if (!words) continue;
      const utterance = new SpeechSynthesisUtterance(row.kind === "vocal" ? `(${words})` : words);
      utterance.lang = language;
      const voice = voices[chosen.get(row.speaker ?? narrator) ?? -1];
      if (voice) utterance.voice = voice;
      await new Promise<void>((done) => {
        utterance.onend = () => done();
        utterance.onerror = () => done();
        synth.speak(utterance);
      });
    }
    this.stopped = true;
  }

  stop(): void {
    this.stopped = true;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }
}
