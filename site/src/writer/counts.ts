/**
 * A story's counts for the status line: the words its book prints; the lines said and the voices
 * saying them; and how long it takes to hear, from what is read aloud (not what is printed) at a
 * storyteller's pace, its pauses added.
 */
import { type Story, bookText, lines } from "voxdown";
import { pauseSeconds } from "./hear";
import { wordCount } from "./words";

export type Counts = {
  words: number;
  said: number;
  voices: number;
  /** Seconds to hear it read aloud. */
  heard: number;
};

/** Words a minute, read aloud. */
export const PACE = 150;

export function countsOf(of: Story): Counts {
  const all = lines(of);
  const said = all.filter((line) => line.kind === "speech" || line.kind === "vocal");
  const spoken = said.reduce((sum, line) => sum + wordCount(line.text), 0);
  const pauses = all
    .filter((line) => line.kind === "pause")
    .reduce((sum, line) => sum + pauseSeconds(line.text), 0);
  return {
    words: wordCount(bookText(of)),
    said: said.length,
    voices: new Set(said.map((line) => line.speaker)).size,
    heard: (spoken / PACE) * 60 + pauses,
  };
}
