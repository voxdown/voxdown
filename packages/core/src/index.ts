/**
 * VoxDown: a plain-text format for stories read aloud. The spec is spec/SPEC.md in the repository.
 * This package has no dependencies and runs in browsers and Node alike.
 */

export { SPEC_VERSION } from "./version";

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
  setAbout,
  setDirection,
  setFullName,
  setMeta,
  setSpeaker,
} from "./edit";
export {
  type Gift,
  type Given,
  type Quote,
  castMemberNamed,
  giveQuotes,
  quotesOf,
  taggedName,
} from "./attribution";
export { type FormatOptions, curlQuotes, format, quotationMarks } from "./format";
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
