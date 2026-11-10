# voxdown

The VoxDown parser and writer: read a story into a model, get what a listener hears and what a reader sees, write changes back without disturbing the author’s text, format, export, and import screenplays. No dependencies; ESM with types; browsers, Node 20+, Deno and Bun.

VoxDown is a plain-text format for stories read aloud: Markdown with marks for who speaks, how, sounds, page turns and notes. The format is in [SPEC.md](https://github.com/voxdown/voxdown/blob/main/spec/SPEC.md); every mark fits on the [cheat sheet](https://github.com/voxdown/voxdown/blob/main/spec/CHEATSHEET.md).

```sh
npm install voxdown
```

```js
import { parse, spokenScript, bookText } from "voxdown";

const story = parse("@Gerald (yawning) “I’ve only just got to sleep,” said the dragon.");
spokenScript(story); // "Gerald (yawning): I’ve only just got to sleep,\nNarrator: said the dragon."
bookText(story); // "“I’ve only just got to sleep,” said the dragon."
```

## Reading

**`parse(source: string): Story`** never fails: problems become `story.warnings`. The model keeps every node’s place in the source (`range`, UTF-16 offsets), so tools can highlight it or change it in place.

| Field | What |
| --- | --- |
| `meta` | `title`, `subtitle`, `author`, `language`, `version` (the file’s `voxdown:` key) and `narrator`. |
| `cast` | `{ handle, name, about?, data }` in front matter order. `handle` is the word after `@`. |
| `blocks` | Paragraphs (`lines`, each with `items`), headings and scene breaks, in order, each with its `visibility` and `groups`. |
| `groups` | Every `:::` group, with its `character`, `direction` and `visibility`. |
| `warnings` | `{ code, severity, message, range, line, column }`. The codes are stable (SPEC.md §12.3). |
| `frontMatter` | The raw YAML and its parsed `data`, or `null`. |

A line’s `items` are, in source order: `speech` (`speaker`, `direction`, `ownDirection`, `text`, `quoted`, `continued`, and the ranges of its words and quotes), `vocal` (a sound a character makes), `sound`, `instruction` (`name`, `value`), `note`, `image`, and the `mark`s and `direction`s that produced them. Every type is exported, and documented in [`src/model.ts`](src/model.ts).

## The two readings

- **`spokenScript(story)`**: everything heard, in order, one line each, written as in the spec’s examples (§12.1).
- **`bookText(story)`**: the printed story as Markdown, marks removed (§12.2).

## The spoken script as data

- **`lines(story, { speechOnly? })`**: one `ScriptLine` per thing heard: `kind` (`speech`, `vocal`, `sound`, `page`, `pause`, `instruction`, `note`, `image`), `speaker`, `direction`, `text`, `name` (an instruction’s), `heading` (a heading’s level), `scene` (from 1), `sceneTitle`, `page` (the page it is on), and its `line` and `column`. The shape multi-voice text-to-speech tools take.
- **`linesToCsv(rows)`**: `kind,speaker,direction,text,scene,page`, RFC 4180.
- **`textByCharacter(story)`**: a `Map` from each character to what they say, one line per speech, for a performer’s sides.

## Writing back

The text is the source of truth. Writing never reflows or restyles it (§13).

- **`write(story)`** gives back the source, byte for byte, with the changes you made on the model: a speech’s `speaker` or `ownDirection`, a sound’s or vocal sound’s `description`, a note’s `text`, an instruction’s `value`, a heading’s `level`, `meta.title`/`subtitle`/`author`/`language`, a cast member’s `name` or `handle`. Adding or removing items is done with the edits below. A change it can't make as asked, such as a note holding `%%`, throws a `RangeError`.
- **`changesFrom(story)`**: the same, as text changes.

Each edit returns the smallest list of `TextChange` (`{ from, to, insert }`) that makes it. Apply them with **`applyChanges(source, changes)`**, then parse again. An edit does exactly what it says: every other word is heard as before, by the same character and in the same way, and the printed book doesn't change. Where that can't be done, it returns no changes.

| Edit | What it does (SPEC.md §13) |
| --- | --- |
| `setSpeaker(story, speech, name)` | Gives a stretch, or the whole quote it is part of, to another character. Replaces the name in its mark, or adds one; a later quote that carried the speech on gets a mark too, so it keeps its speaker. |
| `setDirection(story, speech, direction \| null)` | Adds, replaces or removes a stretch’s own direction, where §13 says to write it: to the quote's end, or to a direction of its own inside it. |
| `renameCharacter(story, from, to)` | Renames a short name in the cast, the `narrator:` key and every mark. |
| `setFullName(story, handle, name)` | Sets a character’s full name in the cast, adding the cast or the character if needed. |
| `setMeta(story, key, value \| null)` | Sets or removes a front matter detail, such as `title`. |
| `insertSound(story, offset, description)` | A sound after the word at `offset`, never inside or straight after a mark. |
| `insertLine(story, offset, text)` | A page turn, pause or note on a line of its own, never in the front matter or a note. |

`isName(word)` says whether a word can follow `@`.

## Formatting

**`format(source, options?)`** tidies a file and never changes who says what (§13, rule 8): it trims and collapses spaces, makes runs of blank lines one, puts a blank line after the front matter and around headings and scene breaks, ends with one line break, and writes names as the cast spells them. Options: `names` and `spacing` (both on unless `false`), and `quotes: "curly"` with an optional `language` (`en`, `de`, `fr`; the front matter’s by default) to turn straight quotes into the language’s curly ones. A formatted file comes back unchanged.

## Importing

**`fromFountain(screenplay, { readSceneHeadings? })`** turns a [Fountain](https://fountain.io) screenplay into a VoxDown story: cues become marks, parentheticals directions, action narration, scene headings `{hidden}` headings (read aloud with `readSceneHeadings`), page breaks `{page}`, notes `%% %%`, and the cast is gathered from the cues.

## Also

- **`tokens(story)`**: syntax ranges for highlighting (`mark`, `name`, `direction`, `sound`, `vocal`, `instruction`, `note`, `group`, `heading`, `break`, `frontmatter`, `escape`, `quote`).
- **`characterColors(story, overrides?)`**: a color for each character, in cast order, from `PALETTE` unless the cast gives one (`color: "#2563eb"`).
- **`SPEC_VERSION`**: the spec version this package follows, `"1.0"`.

## License

MIT. The spec is under CC BY 4.0.
