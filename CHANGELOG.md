# Changelog

Changes to the packages, newest first. Changes to the format itself are in [spec/CHANGELOG.md](spec/CHANGELOG.md). How versions work: [VERSIONING.md](VERSIONING.md).

## Unreleased

**voxdown**
- Every edit does exactly what it says, or returns no changes. Each one checks its result against everything a listener hears (every word and every sound a character makes, who says it and how), against the printed book, which never changes, and against the warnings, of which it adds none. Where its change would reach further (a mark's words run to the end of the line, a direction to the next speech, a quote over lines and paragraphs), it adds the marks that keep the rest as it was, then takes out any it no longer needs. A mark between two characters with no space between them goes without one, so the book reads the same: `„Guten Morgen“@(leise), sagte Anna.`
- `setSpeaker` gives a whole quote, to its closing mark, over sounds, page turns, notes, directions, lines and the paragraphs that carry it on (§5.7), with the sounds made inside it; it keeps the stretch's direction (`@Wanda (yawning) “…”`), and leaves a character's sounds with their owner (`@Fox [gasps] @Wanda “Oh!”`). Narration that holds a quote gives its first quote, found as the parser reads quotes and from the stretch's first character, with the mark directly before it (`The fox ran. @Fox “Wait!”`); the narrator's own words stay theirs, and an unmarked speech over several paragraphs goes whole. Anything else goes whole: a group character's words keep the quote inside them (`@Wanda They charge, shouting, @Wanda ‘PREPARE…’`), and a dialogue tag between two quotes can be given to their speaker (`@Baker said the baker. @Baker “Gently.”`). A sound for whoever is speaking keeps its owner by taking a name: `@Narrator [giggles]`. It no longer gives the rest of the line to the new speaker; words that open with `(` are escaped, so they don't become a direction; and a name that replaces `@()` keeps a space after it.
- `setDirection` sets a quote to its closing mark (over the paragraphs that carry it on), or to a direction of its own inside it, and narration to the end of its line; a paragraph that carries a speech on keeps its own direction just inside its opening mark (`“@()Will you…`), so it still carries the speech on. It no longer changes the stretches after it on its line that took their direction from the same mark: they keep theirs, with `@()` or `@(…)`.
- `renameCharacter` renames the narrator too (adding `narrator:`), refuses a name another character already has (`RangeError`), and checks that nothing else is heard differently.
- `insertSound` never puts a sound inside a mark, a direction, an instruction or a note, nor straight after a mark, where it would be the character's own; `insertLine` never puts a line in the front matter or a note, keeps the line endings around it, and before a paragraph makes the line a paragraph of its own, so a quote the paragraph carries on still does. Both throw a `RangeError` for an offset outside the text, and return no changes if the story would be heard differently.
- `write` makes several changes to the model at once, one after another, and keeps the author's own marks; `changesFrom` gives the same result as small changes. Each change is read back: one that can't be made as asked (a note holding `%%`, an empty sound, a speaker an edit can't give) throws a `RangeError` instead of being left out or doing something else. An instruction's value is escaped. Renaming a character through the cast takes about as long as `renameCharacter`.
- `isName` agrees with the parser on what a name is. `setMeta` and `setFullName` replace exactly the value as written, as the front matter reader reads it: a `#` inside quotes, a comment after the value, and every line of a block scalar. Both read their result back: `setMeta` writes at the indentation the front matter has, `setFullName` turns `cast: null` into a cast and refuses a cast written as a list.
- The front matter reader never fails: nesting past 32 levels is reported and skipped, and an escape that is no character (`"\UFFFFFFFF"`) is kept as written, with a warning. A `#` inside a quoted list item is no comment, a plain value goes on past an empty line, and a long quoted value over many lines reads in linear time.
- A name written in another Unicode form (`Zoë` with a combining mark) is no longer warned about as another spelling.
- `format` never changes who says what, word by word, and settles after one run: a file without front matter can't gain some, and stray carriage returns and byte order marks at a line's edge are tidied. It keeps group lines as written, and each line's own line ending. With curly quotes it leaves feet and inches (`6'2"`) and link addresses as written, and writes `rock ’n’ roll`. A line whose tidying or curly quotes would change who says what is left as it was, and the rest of the file is still formatted.
- The parser reads a line of thousands of unclosed brackets, parentheses or quotes in linear time: a bracket no longer searches the rest of its line for its closing one each time. Giving away a stretch on a line of a thousand quotes takes milliseconds, not seconds.
- `format` finds the lines it must leave as they are by where the words would be heard differently, so a book with a few of them formats in a second, not a minute.
- `changesFrom` lines the two texts up in linear time and memory, however many lines changed.

**@voxdown/render**
- A link's or image's address runs to its balancing parenthesis, as the parser reads it: `[the bat](…/Bat_(animal))`.
- Emphasis pairs as in Markdown: runs of signs, nested (`*very **quiet** indeed*`, `***Hello***`), and an underscore inside a word is a character. Emphasis, links and images are matched in linear time on long lines.

**The playground**
- The pages fill the window between the shelf and the line at its foot, and no longer cover that line; on a short window the page scrolls. The Sun in *The North Wind and the Sun* is read by a new voice.

**Tests**
- Fuzz tests (fast-check), 1,000 stories each by default, for the parser, writer, formatter, edits, inserts, book details, Fountain import, views and editor, on stories made at random from the format's own pieces. Each edit's promise is checked character by character, sounds and the printed book included, and how often an edit declines is counted and kept under a budget. The writer is given notes, instructions and sounds with delimiters in them. `FUZZ_RUNS`, `FUZZ_SEED` and `FUZZ_SHOW` set how many stories, which, and whether to print the declined ones.
- Real books (`corpus/`): a chapter of *Alice*, part of *A Scandal in Bohemia*, the Grimms' *Bremer Stadtmusikanten* in German, and a new CC0 story with CRLF line endings that has what they lack. Each is checked as heard and as printed against reviewed goldens, written back, formatted and edited on every stretch.
- Timing: 100,000 words within about ten times what a laptop takes, and lines built to be slow (thousands of `[`, `@(`, `{`, `'`) within two seconds.
- Prose made at random (`test/stories.ts`): narration, marked and unmarked dialogue, tags, directions, sounds, quotes in quotes, speeches over paragraphs, groups, a cast, CRLF. On it the edits may decline on one stretch in a hundred at most (none do), and formatting keeps every word heard as before. Front matter of every form the reader knows, set and read back; the book view against the book text; the writer's line-by-line changes.
- The real books are taken back to bare text, every mark before a quote removed, and marked up again with the edits, stretch by stretch: they must read as reviewed, line for line.
- Examples for every fix above, including each change review showed the tests would have missed.

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
