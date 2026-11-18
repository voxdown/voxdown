/** Exact-substring scene moves. This module has no editor, storage or DOM dependency. */
import { type FountainDocument, type FountainElement, parseFountain } from "./fountain";
import { readSource } from "./source";

export interface SceneCard {
  /** Zero-based order in this exact source revision; not a persistent identity. */
  index: number;
  line: number;
  heading: string;
  number?: string;
  synopsis: string;
  /** Exact source content range, excluding the blank separator after this scene. */
  from: number;
  to: number;
  /** Nearest preceding section marker. Cross-section moves are deliberately refused. */
  section?: { line: number; title: string };
}

export interface SceneMovePlan {
  /** One atomic replacement, or an empty list for an already-satisfied move. */
  changes: { from: number; to: number; insert: string }[];
  candidate: string;
  /** Original source indexes in their resulting order. */
  order: number[];
  moved: { fromIndex: number; toIndex: number; heading: string };
  warnings: string[];
}

function lowerBound<T extends { from: number }>(items: readonly T[], position: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((items[middle]?.from ?? Number.POSITIVE_INFINITY) < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function cardsOf(document: FountainDocument, source: string): SceneCard[] {
  const cards: SceneCard[] = [];
  let section: SceneCard["section"];
  let active: SceneCard | undefined;
  let synopsis: string[] = [];
  const close = () => {
    if (active) active.synopsis = synopsis.join("\n");
    active = undefined;
    synopsis = [];
  };
  for (const element of document.elements) {
    if (element.kind === "section") {
      close();
      section = { line: element.line, title: element.text };
    } else if (element.kind === "scene") {
      close();
      active = {
        index: cards.length,
        line: element.line,
        heading: element.text,
        ...(element.sceneNumber ? { number: element.sceneNumber } : {}),
        synopsis: "",
        from: element.from,
        to: element.to,
        ...(section ? { section: { ...section } } : {}),
      };
      cards.push(active);
    } else if (active && element.kind !== "blank") {
      // Two-space dialogue-continuation lines are dialogue, so stay in the body.
      active.to = element.to;
      if (element.kind === "synopsis") synopsis.push(element.text);
    }
  }
  close();
  // An impossible range is safer to reject than to silently omit source bytes.
  if (cards.some((card) => card.from < 0 || card.to < card.from || card.to > source.length))
    throw new Error("Could not determine safe scene boundaries in this screenplay.");
  return cards;
}

/** Heading-through-content ownership: notes and synopses after a heading belong
 * to that scene until the next heading or section. Front matter stays fixed.
 * Standalone notes before a later heading therefore belong to the preceding scene.
 */
export function listSceneCards(source: string): SceneCard[] {
  readSource(source);
  const bom = source.startsWith("\uFEFF") ? 1 : 0;
  const body = source.slice(bom);
  return cardsOf(parseFountain(body), body).map((card) => ({
    ...card,
    from: card.from + bom,
    to: card.to + bom,
  }));
}

function sameElement(before: FountainElement, after: FountainElement | undefined): boolean {
  return Boolean(
    after &&
      before.kind === after.kind &&
      before.text === after.text &&
      before.dual === after.dual &&
      before.level === after.level &&
      before.sceneNumber === after.sceneNumber,
  );
}

/** Plan against the current exact source immediately before applying. Indexes
 * from an earlier source revision must never be reused without confirmation.
 * Blank separators, title/front matter, BOM, section headings and trailing bytes
 * remain in fixed slots; scene bodies move as exact unchanged substrings.
 */
export function planSceneMove(
  source: string,
  sceneIndex: number,
  targetIndex: number,
  placement: "before" | "after",
): SceneMovePlan {
  readSource(source);
  const bom = source.startsWith("\uFEFF") ? 1 : 0;
  const body = source.slice(bom);
  const document = parseFountain(body);
  if (document.warnings.length)
    throw new Error("Close incomplete private notes or omitted passages before moving scenes.");
  const cards = cardsOf(document, body);
  if (
    !Number.isInteger(sceneIndex) ||
    !Number.isInteger(targetIndex) ||
    !cards[sceneIndex] ||
    !cards[targetIndex] ||
    (placement !== "before" && placement !== "after")
  )
    throw new Error("Choose two scenes from the current screenplay and a before/after position.");
  const moving = cards[sceneIndex] as SceneCard;
  const target = cards[targetIndex] as SceneCard;
  if (moving.section?.line !== target.section?.line)
    throw new Error(
      "These scenes are separated by a section heading. Move scenes within the same section, or edit section boundaries explicitly in the screenplay first.",
    );
  const order = cards.map((card) => card.index);
  if (sceneIndex !== targetIndex) {
    order.splice(sceneIndex, 1);
    const targetPosition = order.indexOf(targetIndex);
    order.splice(targetPosition + (placement === "after" ? 1 : 0), 0, sceneIndex);
  }
  const toIndex = order.indexOf(sceneIndex);
  const plan: SceneMovePlan = {
    changes: [],
    candidate: source,
    order,
    moved: { fromIndex: sceneIndex, toIndex, heading: moving.heading },
    warnings: cards.some((card) => card.number)
      ? ["Existing explicit scene numbers are preserved. Moving scenes does not renumber them."]
      : [],
  };
  if (toIndex === sceneIndex) return plan;

  // Keep source provenance for every piece so private offsets and semantic line
  // roles can be checked after permutation without an expensive global diff.
  const pieces: { from: number; to: number; output: number }[] = [];
  let length = 0;
  const add = (from: number, to: number) => {
    if (from === to) return;
    pieces.push({ from, to, output: length });
    length += to - from;
  };
  add(0, cards[0]?.from ?? body.length);
  for (let index = 0; index < cards.length; index++) {
    const slot = cards[index] as SceneCard;
    const card = cards[order[index] as number] as SceneCard;
    add(card.from, card.to);
    add(slot.to, cards[index + 1]?.from ?? body.length);
  }
  const candidateBody = pieces.map((piece) => body.slice(piece.from, piece.to)).join("");
  if (candidateBody.length !== body.length)
    throw new Error("The scene move could not preserve the complete source. No changes applied.");
  const candidate = parseFountain(candidateBody);
  const expectedElements: FountainElement[] = [];
  const expectedOmissions: FountainDocument["omissions"] = [];
  for (const piece of pieces) {
    for (
      let index = lowerBound(document.elements, piece.from);
      index < document.elements.length;
      index++
    ) {
      const element = document.elements[index] as FountainElement;
      if (element.from >= piece.to) break;
      expectedElements.push(element);
    }
    for (
      let index = lowerBound(document.omissions, piece.from);
      index < document.omissions.length;
      index++
    ) {
      const omission = document.omissions[index];
      if (!omission || omission.from >= piece.to) break;
      if (omission.to > piece.to)
        throw new Error("A private passage crosses a scene boundary. Move it explicitly first.");
      expectedOmissions.push({
        kind: omission.kind,
        from: piece.output + omission.from - piece.from,
        to: piece.output + omission.to - piece.from,
      });
    }
  }
  // The parser includes an empty physical line after a terminal newline. It has
  // no source bytes and therefore does not belong to a nonempty piece above.
  const last = document.elements.at(-1);
  if (last?.from === body.length) expectedElements.push(last);
  if (
    expectedElements.length !== candidate.elements.length ||
    expectedElements.some((element, index) => !sameElement(element, candidate.elements[index]))
  )
    throw new Error(
      "Moving these scenes would change Fountain interpretation at a boundary. Add a blank line between scenes or make ambiguous character cues explicit, then try again.",
    );
  if (
    candidate.warnings.length ||
    expectedOmissions.length !== document.omissions.length ||
    expectedOmissions.length !== candidate.omissions.length ||
    expectedOmissions.some((before, index) => {
      const after = candidate.omissions[index];
      return (
        !after || before.kind !== after.kind || before.from !== after.from || before.to !== after.to
      );
    })
  )
    throw new Error("Moving these scenes would alter a private passage. No changes applied.");
  plan.candidate = source.slice(0, bom) + candidateBody;
  const first = cards[Math.min(sceneIndex, toIndex)] as SceneCard;
  const final = cards[Math.max(sceneIndex, toIndex)] as SceneCard;
  plan.changes = [
    {
      from: first.from + bom,
      to: final.to + bom,
      insert: candidateBody.slice(first.from, final.to),
    },
  ];
  return plan;
}
