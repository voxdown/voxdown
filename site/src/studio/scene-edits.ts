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
  kind: "move";
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
    kind: "move",
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

export const MAX_SCENE_SYNOPSIS = 10_000;
export const MAX_SCENE_SYNOPSIS_LINES = 100;
export interface SceneSynopsisPlan {
  kind: "synopsis";
  sceneIndex: number;
  changes: { from: number; to: number; insert: string }[];
  candidate: string;
  preview: { line: number; before: string; after: string };
  warnings: string[];
}
export type SceneEditPlan = SceneMovePlan | SceneSynopsisPlan;

/** Edit one contiguous public synopsis block, or insert one immediately after the
 * scene heading. Private comment fragments and dispersed blocks require source
 * editing; no hidden text is reconstructed from rendered synopsis content.
 */
export function planSceneSynopsis(
  source: string,
  sceneIndex: number,
  value: string,
): SceneSynopsisPlan {
  readSource(source);
  const normalized = value.replace(/\r\n?/g, "\n");
  if (
    normalized.length > MAX_SCENE_SYNOPSIS ||
    normalized.split("\n").length > MAX_SCENE_SYNOPSIS_LINES
  )
    throw new Error(
      "Scene card synopses support up to 10,000 characters and 100 lines. Edit a longer synopsis directly in the screenplay.",
    );
  if (
    /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(normalized.replace(/[\n\t]/g, "")) ||
    /\[\[|\]\]|\/\*|\*\//u.test(normalized)
  )
    throw new Error(
      "Use synopsis text without control characters or private-comment delimiters. Keep private notes separate in the screenplay.",
    );
  const text = normalized
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error(
      "Close incomplete private notes or omitted passages before editing a scene synopsis.",
    );
  const originalCards = cardsOf(document, source);
  const scene = originalCards[sceneIndex];
  if (!Number.isInteger(sceneIndex) || !scene)
    throw new Error("Choose a scene from the current screenplay.");
  const heading = document.elements[scene.line - 1] as FountainElement;
  const synopsis = document.elements.filter(
    (element) =>
      element.kind === "synopsis" && element.from >= scene.from && element.to <= scene.to,
  );
  if (scene.synopsis.length > MAX_SCENE_SYNOPSIS || synopsis.length > MAX_SCENE_SYNOPSIS_LINES)
    throw new Error(
      "This synopsis is too long for scene cards. Edit it directly in the screenplay.",
    );
  const first = synopsis[0];
  const last = synopsis.at(-1);
  if (first && last && last.line - first.line + 1 !== synopsis.length)
    throw new Error(
      "This scene has separate synopsis blocks. Edit them directly in the screenplay so intervening words and private notes stay in place.",
    );
  if (
    synopsis.some((element) =>
      document.omissions.some((span) => span.from < element.to && span.to > element.from),
    )
  )
    throw new Error(
      "This synopsis contains a private comment. Edit it directly in the screenplay to preserve that private text.",
    );
  const original = synopsis.map((element) => element.text).join("\n");
  const plan: SceneSynopsisPlan = {
    kind: "synopsis",
    sceneIndex,
    changes: [],
    candidate: source,
    preview: { line: first?.line ?? heading.line, before: "", after: "" },
    warnings: [],
  };
  if (original === text && (text !== "" || synopsis.length === 0)) return plan;
  const newline =
    source.slice(heading.to, document.elements[heading.line]?.from ?? heading.to) ||
    /\r\n|\r|\n/.exec(source)?.[0] ||
    "\n";
  const replacement = text
    ? text
        .split("\n")
        .map((line) => `= ${line}`)
        .join(newline)
    : "";
  const from = first?.from ?? heading.to;
  // Removing the complete final line terminator avoids inventing a blank line
  // that could reclassify the following uppercase action as a character cue.
  const to = last
    ? !text
      ? (document.elements[last.line]?.from ?? last.to)
      : last.to
    : heading.to;
  const insert = first ? replacement : `${newline}${replacement}`;
  if (
    document.omissions.some(
      (span) =>
        (span.from < to && span.to > from) || (from === to && span.from <= from && span.to > from),
    )
  )
    throw new Error(
      "A private passage crosses this synopsis boundary. Edit the synopsis directly in the screenplay.",
    );
  const candidate = source.slice(0, from) + insert + source.slice(to);
  readSource(candidate);
  const after = parseFountain(candidate);
  const delta = insert.length - (to - from);
  const mapped = (position: number) => (position >= to ? position + delta : position);
  const removed = new Set(synopsis.map((element) => element.line));
  const byPosition = new Map(after.elements.map((element) => [element.from, element]));
  if (
    after.warnings.length ||
    document.elements.some(
      (element) =>
        !removed.has(element.line) && !sameElement(element, byPosition.get(mapped(element.from))),
    )
  )
    throw new Error(
      "This synopsis edit would change the interpretation of surrounding screenplay text. Edit it directly in the screenplay.",
    );
  if (
    document.omissions.length !== after.omissions.length ||
    document.omissions.some((span, index) => {
      const next = after.omissions[index];
      return (
        !next ||
        next.kind !== span.kind ||
        next.from !== mapped(span.from) ||
        next.to !== (span.to <= from ? span.to : mapped(span.to)) ||
        source.slice(span.from, span.to) !== candidate.slice(next.from, next.to)
      );
    })
  )
    throw new Error("This synopsis edit would alter a private passage. No changes applied.");
  const updated = cardsOf(after, candidate);
  if (updated.length !== originalCards.length || updated[sceneIndex]?.synopsis !== text)
    throw new Error("This text cannot be represented safely as the selected scene’s synopsis.");
  plan.changes = [{ from, to, insert }];
  plan.candidate = candidate;
  plan.preview = {
    line: first?.line ?? heading.line,
    before: source.slice(from, to),
    after: insert,
  };
  return plan;
}
