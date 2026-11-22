import { fountainRuns } from "./inline";
import { characterName } from "./insights";

/** Stable colours survive reordering scenes and character cue extensions. */
export function speakerHue(cue: string): number {
  const name = characterName(
    fountainRuns(cue)
      .map((run) => run.text)
      .join(""),
  ).toUpperCase();
  let hash = 0;
  for (const char of name) hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) | 0;
  return ((hash % 360) + 360) % 360;
}
