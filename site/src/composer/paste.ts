/**
 * Pasting a copy of several voices (each part under its `V:` line, as Composer copies them):
 * - over a selection with a range in each of the copy's voices, each range takes its own voice's
 *   part (matched by `V:` id, else in order);
 * - at a caret or over one range, the part of the voice there, if the copy has it; else the music
 *   without its `V:` lines;
 * - otherwise it is refused, saying why, rather than putting every voice into every range.
 */
import { voiceAt } from "./tunes";

export type Range = { from: number; to: number };
export { voiceAt };
export type VoicedPart = { voice: string; text: string };

/** The parts of a copy of several voices, or null when it isn't one. */
export function voicedParts(copy: string): VoicedPart[] | null {
  const lines = copy.replace(/\r\n?/g, "\n").split("\n");
  if (!/^V:\s*\S/.test(lines[0] ?? "")) return null;
  const parts: VoicedPart[] = [];
  for (const line of lines) {
    const voice = /^V:\s*(\S+)/.exec(line);
    if (voice) parts.push({ voice: voice[1] as string, text: "" });
    else {
      const part = parts[parts.length - 1] as VoicedPart;
      part.text = part.text ? `${part.text}\n${line}` : line;
    }
  }
  for (const part of parts) part.text = part.text.replace(/\n+$/, "");
  return parts.length > 1 ? parts : null;
}

export type PastePlan =
  | { changes: { from: number; to: number; insert: string }[]; message: string }
  | { refused: string };

/** What pasting a copy of several voices over these ranges does. */
export function pasteVoiced(text: string, ranges: Range[], parts: VoicedPart[]): PastePlan {
  const names = parts.map((part) => `V:${part.voice}`).join(" and ");
  if (ranges.length > 1) {
    const voices = ranges.map((range) => voiceAt(text, range.from));
    const byId = voices.map((voice) => parts.find((part) => part.voice === voice));
    const matched = byId.every(Boolean) && new Set(voices).size === ranges.length;
    const chosen = matched ? byId : ranges.length === parts.length ? parts : null;
    if (!chosen)
      return {
        refused: `The copy has ${parts.length} voices (${names}) and the selection ${ranges.length} places: select one stretch in each voice to paste into, or click where to paste one voice.`,
      };
    return {
      changes: ranges.map((range, at) => ({
        from: range.from,
        to: range.to,
        insert: (chosen[at] as VoicedPart).text,
      })),
      message: matched
        ? `Pasted each voice into its own place (${names}).`
        : `Pasted the copy's voices into the selected places in order (${names}).`,
    };
  }
  const range = ranges[0] as Range;
  const here = voiceAt(text, range.from);
  const own = parts.find((part) => part.voice === here);
  if (own)
    return {
      changes: [{ ...range, insert: own.text }],
      message: `Pasted V:${here}'s part of the copy here; the copy also has ${parts
        .filter((part) => part !== own)
        .map((part) => `V:${part.voice}`)
        .join(" and ")}.`,
    };
  return {
    changes: [{ ...range, insert: parts.map((part) => part.text).join("\n") }],
    message: `Pasted the copy's music without its V: lines: ${here ? `V:${here}` : "this voice"} isn't in it (${names}).`,
  };
}
