import type { TokenKind } from "voxdown";

/**
 * The TextMate scope for each kind of syntax token the core reports (`tokens()` in the core). The
 * grammar builds its scope names from these, and the tests check that every token the core finds
 * starts where the grammar gives it a scope beginning with this one and ending in `.voxdown`.
 */
export const TOKEN_SCOPES: Readonly<Record<TokenKind, string>> = {
  frontmatter: "meta.frontmatter",
  heading: "punctuation.definition.heading",
  break: "meta.separator",
  group: "keyword.control.group",
  mark: "punctuation.definition.tag",
  name: "entity.name.tag.character",
  direction: "entity.other.attribute-name.direction",
  sound: "entity.name.type.sound",
  vocal: "entity.name.type.vocal",
  instruction: "meta.instruction",
  note: "comment.block.note",
  escape: "constant.character.escape",
  quote: "punctuation.definition.string",
};

/** Whether a scope stack has a VoxDown scope that is `scope` or starts with `scope.`. */
export function hasScope(scopes: readonly string[], scope: string): boolean {
  return scopes.some(
    (name) =>
      name.endsWith(".voxdown") && (name === `${scope}.voxdown` || name.startsWith(`${scope}.`)),
  );
}
