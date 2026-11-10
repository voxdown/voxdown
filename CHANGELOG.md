# Changelog

Changes to the packages, newest first. Changes to the format itself are in [spec/CHANGELOG.md](spec/CHANGELOG.md). How versions work: [VERSIONING.md](VERSIONING.md).

## Unreleased

**voxdown**
- Every edit does exactly what it says, or returns no changes. Each one checks its result against everything a listener hears: every word and every sound a character makes, who says it and how. Where its change would reach further (a mark's words run to the end of the line, a direction to the next speech, a quote over lines and paragraphs), it adds the marks that keep the rest as it was, then takes out any it no longer needs.
- `setSpeaker` gives a quote over several lines as one, keeps the stretch's direction (`@Wanda (yawning) “…”`), and leaves a character's sounds with their owner (`@Fox [gasps] @Wanda “Oh!”`). Narration that holds a quote gives the quote, with the mark directly before it: `The fox ran. @Fox “Wait!”`. It no longer gives the rest of the line to the new speaker; words that open with `(` are escaped, so they don't become a direction; and a name that replaces `@()` keeps a space after it.
- `setDirection` sets a quote over several lines as one, and no longer changes the stretches after it on its line that took their direction from the same mark: they keep theirs, with `@()` or `@(…)`.
- `renameCharacter` renames the narrator too (adding `narrator:`), refuses a name another character already has (`RangeError`), and checks that nothing else is heard differently.
- `insertSound` never puts a sound inside a mark, a direction, an instruction or a note, nor straight after a mark, where it would be the character's own; `insertLine` never puts a line in the front matter or a note, keeps the line endings around it, and before a paragraph makes the line a paragraph of its own, so a quote the paragraph carries on still does. Both throw a `RangeError` for an offset outside the text, and return no changes if the story would be heard differently.
- `write` makes several changes to the model at once, one after another, and keeps the author's own marks; `changesFrom` gives the same result as small changes.
- `isName` agrees with the parser on what a name is. `setMeta` and `setFullName` keep a comment after a value.
- `format` never changes who says what, and settles after one run: a file without front matter can't gain some, and stray carriage returns and byte order marks at a line's edge are tidied. It keeps group lines as written, and each line's own line ending. With curly quotes it leaves feet and inches (`6'2"`) and link addresses as written, and writes `rock ’n’ roll`.
- The parser reads a line of thousands of unclosed brackets, parentheses or quotes in linear time: a bracket no longer searches the rest of its line for its closing one each time.

**Tests**
- Fuzz tests (fast-check) for the parser, writer, formatter, edits, inserts, Fountain import, views and editor, on stories made at random from the format's own pieces. Each edit's promise is checked character by character, sounds included; how often an edit declines is counted and kept under 4%. `FUZZ_RUNS`, `FUZZ_SEED` and `FUZZ_SHOW` set how many stories, which, and whether to print the declined ones.
- Real books (`corpus/`): a chapter of *Alice*, part of *A Scandal in Bohemia*, the Grimms' *Bremer Stadtmusikanten* in German, and a new CC0 story with CRLF line endings that has what they lack. Each is checked as heard and as printed against reviewed goldens, written back, formatted and edited on every stretch.
- Timing: 100,000 words within about ten times what a laptop takes, and lines built to be slow (thousands of `[`, `@(`, `{`, `'`) within two seconds.
- Examples for every fix above.

**Spec**: three questions for after 1.0 that the books raised (§17): speaking together, a speech broken by a song, and quotes of the same kind inside a quote.

## The VS Code extension 1.0.0 and the playground (10 November 2026)

**VS Code extension**, on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=voxdown.voxdown)
- Highlighting, snippets, warnings as you type, a script preview, and the cheat sheet.

**The playground**
- The linked pages glide to their place instead of jumping, unless the system asks for less motion.
- A listening page: two stories read aloud with ElevenLabs voices, each line lit as it is heard, with what each voice was sent. `scripts/speak.mjs` records them from the stories themselves.
- Listen stands out: a play button in every page's masthead, a pencil note pointing at it on the front page, and Listen beside each recorded example, opening the listening page on that story.
- On phones, the masthead's links no longer break across lines.

## `@voxdown/render` 1.1.0 and the playground (9 November 2026)

**@voxdown/render**
- `positions`: each paragraph, heading, line, speech and mark says where it comes from in the source (`data-from`, `data-to`), to link a view to an editor.
- In the script view, a speaker's line and a direction's dashes each have their own lane under the words, as in the editor, instead of being drawn over each other.

**The playground**
- The icon in the masthead, and a switch for light, dark, or as the system is.
- A strip of marks above the editor: a click puts one in.
- The two pages are linked: a click on the script, the book or the lines moves the editor's cursor there, and the cursor marks its place on the right page.
- The examples show who wrote them, under each title, with a book or a script page beside it.
- Laptop and phone layouts that fit: the left page no longer slides under the right one, and stacked pages keep their buttons.

## `@voxdown/editor` 1.0.0 (9 November 2026)

- `scriptEditor`, the CodeMirror 6 editor that draws marks as chips, with its hooks documented.
- `<voxdown-editor>`, the same as a web component (`@voxdown/editor/element`).

## `@voxdown/render` 1.0.1 (9 November 2026)

- The stylesheet styles only what is inside a rendered view (`.vxd`). It used to reach the editor’s marks on the same page, which share its class names: with every mark shown raw, a direction was squeezed to one letter per line.
- In the script view, a line inside a group no longer repeats the group’s direction above its words. The group’s label already says it; a line’s own direction is still drawn.
- A character group’s label names its character by their full name, as their lines do, not by their handle. The lines inside it don’t name them again.

## Spec 1.0, `voxdown` 1.0.0, `@voxdown/render` 1.0.0, `@voxdown/cli` 1.0.0, and the playground (9 November 2026)

**voxdown**
- `parse`, `spokenScript`, `bookText` and `tokens`, passing every example in the spec.
- Warnings with stable codes (SPEC.md §12.3).
- `write`: a lossless writer. An unchanged story writes back byte for byte; fields changed on the model are written back as the edits below make them.
- Edits that follow SPEC.md §13: `setSpeaker`, `setDirection`, `renameCharacter`, `setFullName`, `setMeta`, `insertSound`, `insertLine`, and `applyChanges`.
- `format`: spacing, names in the cast’s spelling, and curly quotes when asked.
- `lines`, `linesToCsv` and `textByCharacter`: the spoken script as data.
- `fromFountain`: an import from Fountain screenplays.
- `characterColors` and `PALETTE`.

**@voxdown/render**
- `renderBook` and `renderScript`, `render` and `renderDocument`, and `stylesheet` (also as `@voxdown/render/voxdown.css`).

**@voxdown/cli**
- `vxd check`, `fmt`, `render`, `export`, `text` and `import`.

**The playground**
- The editor, the script, the book, the lines, CSV and each character’s sides, side by side, with the examples.
