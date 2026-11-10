# VoxDown for VS Code

VoxDown is a plain-text format for stories read aloud: a Markdown story with light marks for who says each line, how they say it, the sounds a listener hears, where the pages turn, and notes for the performer. This extension makes `.vxd` files easy to write in VS Code.

```
## The cave
Then he heard a deep rumble. [deep rumbling, from inside a cave]
The dragon was snoring. @Gerald [snores]
::: whispering
Sir Percival crept inside.
{page}
:::
@Gerald (deep, polite and utterly unbothered) “Could you not?”
```

The extension is not on the Visual Studio Marketplace yet. To try it, build the `.vsix` file and install it yourself (see [Install](#install)).

## What it does

- **Colors every mark.** Character marks, with the `@` and the name colored apart; directions; sounds, and a character's own sounds; page turns, pauses and `{book only}`, told apart from a tool's own instructions such as `{recorder:take 3}`; notes, over as many lines as they run; groups; headings; scene breaks; front matter, as YAML; backslash escapes; emphasis and links. The quotes a character speaks on the line of their mark are colored as speech.
- **Shows warnings as you type.** The parser's warnings (an unclosed quote, a name that is not in the cast, a pause that isn't a length, and the rest in the spec's §12.3) appear in the editor and the Problems panel, with the warning's code.
- **Previews the story.** VoxDown: Open Script Preview shows the story beside the editor, as a script for reading aloud or as the printed book, and updates as you type.
- **Outlines the story.** Headings and scene breaks appear in the Outline view and the breadcrumbs.
- **Snippets** for the marks you type most (below).
- **Colors VoxDown inside Markdown**, in code blocks tagged `vxd` or `voxdown`.
- **Folds groups**, and Toggle Block Comment writes a note: `%% … %%`.

## Commands

| Command | What it does |
| --- | --- |
| VoxDown: Open Script Preview | Opens the preview beside the editor. The Script and Book buttons switch views. Also in the editor's title bar, and on `Ctrl+K V` (`Cmd+K V` on a Mac). |
| VoxDown: Show Cheat Sheet | Opens every mark on one page, in the Markdown preview. |

## Snippets

Press `Ctrl+Space` after a prefix, or use Insert Snippet.

| Prefix | Inserts |
| --- | --- |
| `@line` | A character's line: `@Name “…”` |
| `@dir` | A character's line with a direction: `@Name (how) “…”` |
| `@(` | A direction for the narration: `@(warmly)` |
| `:::` | A group with a direction |
| `:::@` | A group for one character |
| `[` or `sound` | A sound: `[wooden clatter]` |
| `@[` | A character's sound: `@Name [snores]` |
| `page` | A page turn: `{page}` |
| `pause` | A pause: `{pause 2s}` |
| `%%` or `note` | A note: `%% … %%` |
| `book` | `{book only}` |
| `audio` | `{audio only}` |
| `---` | Front matter with a cast |

## Install

The extension is built from this repository. With Node 20 or later and pnpm:

```sh
pnpm install
pnpm --filter voxdown-vscode package
code --install-extension packages/vscode/voxdown-1.0.0.vsix
```

To remove it, run `code --uninstall-extension voxdown.voxdown`.

## Colors for theme authors

The grammar's scope name is `text.voxdown`. Each kind of mark has a standard scope, so themes color it without changes, and every scope ends in `.voxdown`:

| Mark | Scope |
| --- | --- |
| `@` of a mark | `punctuation.definition.tag.voxdown` |
| A character's name | `entity.name.tag.character.voxdown` |
| A direction, `(yawning)` or on a group line | `entity.other.attribute-name.direction.voxdown` |
| A sound, `[clatter]` | `entity.name.type.sound.voxdown` |
| A character's sound, `@Gerald [snores]` | `entity.name.type.vocal.voxdown` |
| `{page}` | `keyword.control.page.voxdown`, inside `meta.instruction.page.voxdown` |
| `{pause 2s}` | `keyword.control.pause.voxdown`, the length `constant.numeric.length.voxdown` |
| `{book only}`, `{audio only}`, `{hidden}` | `storage.modifier.visibility.voxdown` |
| A tool's instruction, `{recorder:take 3}` | `entity.name.function.tool.voxdown` |
| Any other instruction | `keyword.other.instruction.voxdown` |
| A note, `%% … %%` | `comment.block.note.voxdown` |
| A group's colons, `:::` | `keyword.control.group.begin.voxdown`, `keyword.control.group.end.voxdown` |
| A heading | `markup.heading.voxdown`, the `#` signs `punctuation.definition.heading.voxdown` |
| A scene break | `meta.separator.voxdown` |
| Front matter | `meta.frontmatter.voxdown`, its YAML in `meta.embedded.block.frontmatter.voxdown` |
| A backslash escape | `constant.character.escape.voxdown` |
| A character's quoted speech | `string.quoted.double.speech.voxdown` (or `single`, or `other` for `「」`), its quotation marks `punctuation.definition.string.begin.voxdown` and `.end.voxdown` |
| Emphasis, links | `markup.italic.voxdown`, `markup.bold.voxdown`, `markup.underline.link.voxdown` |

The tests check these against the parser: for every example in the spec, every mark the parser finds is colored with its scope, and nothing else is.

## What the colors can't know

The colors come from a TextMate grammar, which reads a line at a time and can't look ahead. The warnings and the preview come from the parser, which reads the whole file, so they are always right. Where the two differ:

- A quote that carries a speech on into the next paragraph (§5.7) is colored as narration.
- A `%%` that is never closed is plain text to the parser, which warns about it. The grammar colors the rest of the file as a note until you close it.
- A file whose first line is `---` has front matter only if a second `---` line closes it. Until you type that line, the grammar colors the file as front matter.

## Development

The grammar is written in `src/grammar.ts`, so its patterns can share parts. After changing it, run `pnpm grammar` in this folder to write `syntaxes/*.json` again; a test fails if they differ. `pnpm test` runs the tests, which tokenize every example in `spec/conformance.json` and `examples/` with `vscode-textmate` and compare the result with the parser's tokens. The extension's own code is tested against a stand-in for the VS Code API (`test/vscode-stub.ts`); there is no test that starts VS Code itself.

The extension is MIT licensed. VoxDown's spec is in [spec/SPEC.md](../../spec/SPEC.md).
