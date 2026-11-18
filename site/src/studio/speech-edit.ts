import { type FountainElement, parseFountain } from "./fountain";
import { readSource } from "./source";

export const MAX_SPEECH_LENGTH = 50_000;
const speechKinds = new Set(["dialogue", "parenthetical", "lyric"]);
const bodyKinds = new Set([...speechKinds, "note", "boneyard"]);
export interface SpeechSelection {
  cueLine: number;
  cue: string;
  from: number;
  to: number;
  source: string;
}
export interface SpeechEditPlan {
  changes: { from: number; to: number; insert: string }[];
  candidate: string;
  cueLine: number;
}

/** Exact source after one cue, up to the next blank/non-speech element. Contiguous
 * private passages belong to this speech; a passage crossing its boundary is refused. */
export function selectSpeech(source: string, cueLine: number): SpeechSelection {
  readSource(source);
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error("Close unfinished private notes or omitted passages before editing a speech.");
  const cue = document.elements[cueLine - 1];
  if (!Number.isInteger(cueLine) || !cue || cue.kind !== "character")
    throw new Error("Choose a character cue from the current screenplay.");
  const elements: FountainElement[] = [];
  for (let index = cueLine; index < document.elements.length; index++) {
    const element = document.elements[index];
    if (!element || !bodyKinds.has(element.kind)) break;
    elements.push(element);
  }
  const first = elements[0];
  const last = elements.at(-1);
  if (!first || !last || !elements.some((element) => speechKinds.has(element.kind)))
    throw new Error("Write dialogue beneath this cue before opening the speech editor.");
  if (last.to - first.from > MAX_SPEECH_LENGTH)
    throw new Error(
      "This speech exceeds the 50,000-character focused editing limit. Edit it in the screenplay.",
    );
  for (const omission of document.omissions) {
    if (
      omission.from < last.to &&
      omission.to > first.from &&
      (omission.from < first.from || omission.to > last.to)
    )
      throw new Error(
        "A private passage crosses this speech's boundary. Edit it in the screenplay first.",
      );
  }
  return {
    cueLine,
    cue: source.slice(cue.from, cue.to),
    from: first.from,
    to: last.to,
    source: source.slice(first.from, last.to),
  };
}
function sameElement(before: FountainElement, after: FountainElement | undefined, delta: number) {
  return Boolean(
    after &&
      before.from + delta === after.from &&
      before.to + delta === after.to &&
      before.kind === after.kind &&
      before.text === after.text &&
      before.dual === after.dual &&
      before.level === after.level &&
      before.sceneNumber === after.sceneNumber,
  );
}

/** One atomic editor change. The caller must compare document ID and exact source
 * with its preview snapshot immediately before dispatching the returned change. */
export function planSpeechEdit(
  source: string,
  cueLine: number,
  replacement: string,
): SpeechEditPlan {
  const selection = selectSpeech(source, cueLine);
  if (!replacement || replacement.length > MAX_SPEECH_LENGTH)
    throw new Error(
      "Keep a speech of 1–50,000 characters. Use the screenplay editor to remove a speech.",
    );
  const candidate = source.slice(0, selection.from) + replacement + source.slice(selection.to);
  readSource(candidate);
  const before = parseFountain(source);
  const after = parseFountain(candidate);
  const end = selection.from + replacement.length;
  const delta = replacement.length - (selection.to - selection.from);
  if (after.warnings.length)
    throw new Error(
      "Close every private note with ]] and omitted passage with */ before applying.",
    );
  const body = after.elements.filter(
    (element) => element.from >= selection.from && element.from <= end,
  );
  if (
    !body.length ||
    body.some((element) => !bodyKinds.has(element.kind) || element.to > end) ||
    !body.some((element) => speechKinds.has(element.kind))
  )
    throw new Error(
      "Keep dialogue, parentheticals and lyrics within this speech. An empty line ends a speech; use a line containing two spaces for an intentional blank dialogue line. Edit scene/action/character changes in the screenplay.",
    );
  const prefix = before.elements.filter((element) => element.from < selection.from);
  const suffix = before.elements.filter((element) => element.from > selection.to);
  const newPrefix = after.elements.filter((element) => element.from < selection.from);
  const newSuffix = after.elements.filter((element) => element.from > end);
  if (
    prefix.length !== newPrefix.length ||
    suffix.length !== newSuffix.length ||
    prefix.some((element, index) => !sameElement(element, newPrefix[index], 0)) ||
    suffix.some((element, index) => !sameElement(element, newSuffix[index], delta))
  )
    throw new Error(
      "This edit would change the cue or surrounding screenplay. Keep the speech within its existing boundaries.",
    );
  const outside = (omissions: typeof before.omissions, from: number, to: number) => {
    for (const omission of omissions)
      if (omission.from < to && omission.to > from && (omission.from < from || omission.to > to))
        throw new Error(
          "A private passage would cross the speech boundary. No changes were applied.",
        );
    return omissions.filter((omission) => omission.to <= from || omission.from >= to);
  };
  const oldOutside = outside(before.omissions, selection.from, selection.to);
  const newOutside = outside(after.omissions, selection.from, end);
  if (
    oldOutside.length !== newOutside.length ||
    oldOutside.some((omission, index) => {
      const next = newOutside[index];
      const shift = omission.from >= selection.to ? delta : 0;
      return (
        !next ||
        next.kind !== omission.kind ||
        next.from !== omission.from + shift ||
        next.to !== omission.to + shift ||
        source.slice(omission.from, omission.to) !== candidate.slice(next.from, next.to)
      );
    })
  )
    throw new Error(
      "This edit would change a private passage outside the speech. No changes were applied.",
    );
  return {
    cueLine,
    candidate,
    changes:
      replacement === selection.source
        ? []
        : [{ from: selection.from, to: selection.to, insert: replacement }],
  };
}
