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

/** What reads aloud: the browser's speech synthesis, or a stand-in for a test. */
export type Voice = Pick<SpeechSynthesis, "getVoices" | "speak" | "cancel">;

/**
 * One reading at a time. Each has its own turn: stopping it, or starting another, ends it where it
 * is (in a pause or a line), and nothing of it is ever heard after.
 */
export class Hearing {
  private turn = 0;
  private reading = false;
  /** Ends the wait the reading is in: a pause, or a line being said. */
  private wake: (() => void) | undefined;

  constructor(private readonly voice: () => Voice | undefined = () => window.speechSynthesis) {}

  get on(): boolean {
    return this.reading;
  }

  /** Reads the rows, calling `at` as each starts; resolves when done or stopped. */
  async read(
    rows: readonly ScriptLine[],
    language: string,
    narrator: string,
    at: (row: ScriptLine) => void,
  ): Promise<void> {
    const synth = this.voice();
    if (!synth) return;
    this.stop();
    const mine = ++this.turn;
    const live = () => mine === this.turn;
    this.reading = true;
    // The browser loads its voices after the page: on the first reading, waited for a moment.
    let voices = synth.getVoices();
    const events = synth as Partial<Pick<SpeechSynthesis, "addEventListener">>;
    if (voices.length === 0 && events.addEventListener) {
      await new Promise<void>((done) => {
        const timer = setTimeout(done, 1500);
        events.addEventListener?.(
          "voiceschanged",
          () => {
            clearTimeout(timer);
            done();
          },
          { once: true },
        );
      });
      if (!live()) return;
      voices = synth.getVoices();
    }
    const speakers = [...new Set(rows.flatMap((row) => (row.speaker ? [row.speaker] : [])))];
    const chosen = voicesFor(speakers, voices, language, narrator);
    for (const row of rows) {
      if (!live()) return;
      at(row);
      if (row.kind === "pause") {
        await this.wait((done) => {
          const timer = setTimeout(done, pauseSeconds(row.text) * 1000);
          return () => clearTimeout(timer);
        });
        continue;
      }
      const words = plainText(row.text).trim();
      if (!words) continue;
      const utterance = new SpeechSynthesisUtterance(row.kind === "vocal" ? `(${words})` : words);
      utterance.lang = language;
      const voice = voices[chosen.get(row.speaker ?? narrator) ?? -1];
      if (voice) utterance.voice = voice;
      if (!live()) return;
      let failed = false;
      await this.wait((done) => {
        utterance.onend = () => done();
        utterance.onerror = (event) => {
          // Stopped on purpose is no failure; anything else ends the reading.
          const why = (event as SpeechSynthesisErrorEvent | undefined)?.error;
          failed = why !== "interrupted" && why !== "canceled";
          done();
        };
        synth.speak(utterance);
        return () => {};
      });
      if (failed && live()) {
        this.stop();
        return;
      }
    }
    if (live()) this.reading = false;
  }

  stop(): void {
    this.turn++;
    this.reading = false;
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
    this.voice()?.cancel();
  }

  /** Waits for `start`'s end, or for the reading to be stopped, whichever comes first. */
  private wait(start: (done: () => void) => () => void): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let undo = () => {};
      const done = () => {
        if (settled) return;
        settled = true;
        undo();
        if (this.wake === done) this.wake = undefined;
        resolve();
      };
      this.wake = done;
      undo = start(done);
    });
  }
}
