/**
 * VoxDown: a plain-text format for stories read aloud. The spec is spec/SPEC.md in the repository.
 * This package has no dependencies and runs in browsers and Node alike.
 */

/** The version of the spec this package follows (spec/SPEC.md §16). */
export const SPEC_VERSION = "1.0";

export { parse } from "./parse";
export { bookText, spokenScript } from "./readings";
export { tokens } from "./tokens";
export type { SyntaxToken, TokenKind } from "./tokens";
export { write, changesFrom } from "./write";
export {
  type TextChange,
  applyChanges,
  insertLine,
  insertSound,
  isName,
  renameCharacter,
  setDirection,
  setFullName,
  setMeta,
  setSpeaker,
} from "./edit";
export { type FormatOptions, format } from "./format";
export {
  type LinesOptions,
  type ScriptLine,
  type ScriptLineKind,
  lines,
  linesToCsv,
  textByCharacter,
} from "./lines";
export { type FountainOptions, fromFountain } from "./fountain";
export { PALETTE, characterColors } from "./colors";
export { characterReference } from "./entities";
export type {
  Block,
  Break,
  CastMember,
  DirectionMark,
  FrontMatter,
  Group,
  Heading,
  Image,
  Instruction,
  Item,
  Line,
  Mark,
  Meta,
  Note,
  Paragraph,
  Range,
  Sound,
  Speech,
  Story,
  Visibility,
  Vocal,
  Warning,
  WarningCode,
} from "./model";
