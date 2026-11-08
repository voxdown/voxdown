/**
 * Audiobook Markup (working name). The spec is SPEC.md beside this folder. This package must stay
 * independent of the app it grew up in: it imports nothing from outside its own folder.
 */
export const SPEC_VERSION = "0.1-draft";

export { parse } from "./parse";
export { bookText, spokenScript } from "./readings";
export { tokens } from "./tokens";
export type { SyntaxToken, TokenKind } from "./tokens";
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
