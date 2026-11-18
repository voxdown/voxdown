import type { FountainDocument } from "./fountain";

/** Fountain comments do not nest. Refuse public handoffs when an inner opener
 * makes the writer's intended private boundary ambiguous. Source stays intact.
 */
export function assertUnambiguousOmissions(source: string, document: FountainDocument): void {
  for (const omission of document.omissions) {
    const inner = source.slice(omission.from + 2, omission.to - 2);
    for (const match of inner.matchAll(/\[\[|\/\*/g)) {
      let slashes = 0;
      for (let at = match.index - 1; at >= 0 && inner[at] === "\\"; at--) slashes++;
      if (slashes % 2 === 0)
        throw new Error(
          "Nested private comment delimiters are ambiguous. Simplify the notes or omitted passages before preparing public output. Your Fountain source is unchanged.",
        );
    }
  }
}
