/**
 * What an error says to the person using Composer. Composer's own errors are written as plain
 * sentences and are shown as they are; anything else (a browser or engine error, say "Maximum
 * call stack size exceeded") is never shown: it goes to the console, and a plain sentence stands
 * in for it.
 */
export class PlainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlainError";
  }
}

/** Errors whose messages are written for people. */
const PLAIN = new Set(["PlainError", "MidiFileError", "MusicXmlError", "ZipError"]);

export function plainMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && PLAIN.has(error.name) && error.message) return error.message;
  console.error(error);
  return fallback;
}
