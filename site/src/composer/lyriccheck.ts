/**
 * Lyrics that run past their notes: abcjs drops the extra syllables silently, so the writer is
 * told quietly ("3 syllables have no notes") at the w: line.
 */
import { lineKind, tokenizeMusic } from "./abc";
import type { TuneInfo } from "./tunes";

export type LyricIssue = { from: number; to: number; extra: number; message: string };

/**
 * How many notes a w: line uses, and how many of those carry a syllable, in abcjs's reading of
 * ABC 2.1: words and parts split by - each take a note; _ and * take one without a syllable; a
 * - that does not follow a syllable skips a note; ~ and \- stay inside a syllable. The positions
 * are the notes (counted from 0) that carry a syllable. Null when the line moves by bars (|).
 */
export function syllablePlaces(words: string): number[] | null {
  if (/(^|[^\\])\|/.test(words)) return null;
  const places: number[] = [];
  let note = 0;
  let inWord = false;
  for (let i = 0; i < words.length; i++) {
    const char = words[i] as string;
    if (char === "\\" && words[i + 1] === "-") {
      if (!inWord) places.push(note++);
      inWord = true;
      i++;
      continue;
    }
    if (/\s/.test(char)) {
      inWord = false;
      continue;
    }
    if (char === "-") {
      // After a syllable a hyphen only separates; anywhere else it skips a note.
      if (!inWord) note++;
      inWord = false;
      continue;
    }
    if (char === "_" || char === "*") {
      inWord = false;
      note++;
      continue;
    }
    if (!inWord) places.push(note++);
    inWord = true;
  }
  return places;
}

/** w: lines whose syllables go past the notes of the music lines they follow. */
export function checkLyrics(text: string, tune: TuneInfo): LyricIssue[] {
  const issues: LyricIssue[] = [];
  let notes = 0;
  let afterLyrics = false;
  let position = tune.bodyFrom;
  for (const line of text.slice(tune.bodyFrom, tune.to).split("\n")) {
    const from = position;
    position += line.length + 1;
    const kind = lineKind(line, true);
    // Another voice's music: its lyrics follow its own notes.
    if (/^\s*(V:|\[V:)/.test(line)) notes = 0;
    if (kind === "music") {
      if (afterLyrics) notes = 0;
      afterLyrics = false;
      let inGrace = false;
      for (const token of tokenizeMusic(line, from)) {
        if (token.kind === "grace-open") inGrace = true;
        else if (token.kind === "grace-close") inGrace = false;
        else if (inGrace) continue;
        else if (token.kind === "chord-open") notes += 1;
        else if (token.kind === "note" && !token.inChord) notes += 1;
      }
      continue;
    }
    if (kind !== "lyrics") continue;
    afterLyrics = true;
    const words = line.replace(/^w:\s*/, "").replace(/\s%.*$/, "");
    const places = syllablePlaces(words);
    if (!places || notes === 0) continue;
    const extra = places.filter((place) => place >= notes).length;
    if (extra > 0)
      issues.push({
        from,
        to: from + line.length,
        extra,
        message: `${extra} ${extra === 1 ? "syllable has" : "syllables have"} no notes: this w: line has more syllables than the ${notes} ${notes === 1 ? "note" : "notes"} above it.`,
      });
  }
  return issues;
}
