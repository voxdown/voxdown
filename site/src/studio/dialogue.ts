import type { FountainDocument } from "./fountain";
import { fountainRuns } from "./inline";
export type DialogueExcerpt = { line: number; scene: string; text: string; shortened: boolean };
/** Rendered text only: completed private comments never enter dialogue excerpts. */
export function dialogueExcerpts(document: FountainDocument): Map<number, DialogueExcerpt> {
  const result = new Map<number, DialogueExcerpt>();
  let scene = "Before the first scene";
  let active: DialogueExcerpt | undefined;
  for (const element of document.elements) {
    if (element.kind === "scene") scene = element.text;
    if (element.kind === "character") {
      active = { line: element.line, scene, text: "", shortened: false };
      result.set(element.line, active);
    } else if (active && ["dialogue", "parenthetical", "lyric"].includes(element.kind)) {
      const text = fountainRuns(element.text)
        .map((run) => run.text)
        .join("");
      const value = active.text + (active.text ? "\n" : "") + text;
      active.shortened ||= value.length > 2000;
      active.text = value.slice(0, 2000);
    } else if (element.kind !== "note" && element.kind !== "boneyard") active = undefined;
  }
  return result;
}
