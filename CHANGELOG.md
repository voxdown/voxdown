# Changelog

Changes to the packages, newest first. Changes to the format itself are in [spec/CHANGELOG.md](spec/CHANGELOG.md). How versions work: [VERSIONING.md](VERSIONING.md).

## Spec 1.1, `voxdown` 1.1.0, `@voxdown/render` 1.2.0, `@voxdown/editor` 1.1.0, `@voxdown/cli` 1.0.1, the VS Code extension 1.1.0, and the playground (10 November 2026)

**Spec 1.1**: character references, scene breaks with spaces between their signs, and names whatever their apostrophe; what changed is in [spec/CHANGELOG.md](spec/CHANGELOG.md).

**voxdown**
- Follows spec 1.1: `SPEC_VERSION` is `"1.1"`, and `fromFountain` writes `voxdown: 1.1`.
- Every edit does exactly what it says, or returns no changes. Each one checks its result against everything a listener hears (every word and every sound a character makes, who says it and how, and whether it is heard at all or only printed), against the printed book, which never changes, and against the warnings, of which it adds none. Where its change would reach further (a mark's words run to the end of the line, a direction to the next speech, a quote over lines and paragraphs), it adds the marks that keep the rest as it was, then takes out any it no longer needs. A mark between two characters with no space between them goes without one, so the book reads the same: `„Guten Morgen“@(leise), sagte Anna.`
- `setSpeaker` gives a whole quote, to its closing mark, over sounds, page turns, notes, directions, lines and the paragraphs that carry it on (§5.7), with the sounds made inside it; it keeps the stretch's direction (`@Wanda (yawning) “…”`), and leaves a character's sounds with their owner (`@Fox [gasps] @Wanda “Oh!”`). Narration that holds a quote gives its first quote, found as the parser reads quotes and from the stretch's first character, with the mark directly before it (`The fox ran. @Fox “Wait!”`); the narrator's own words stay theirs, and an unmarked speech over several paragraphs goes whole, from whichever of its paragraphs is given, with the mark where it starts. Narration between a mark and the quote it gives (`@Gerald Gerald put on his spectacles. “I thought…”`, §5.4), or that runs on over a mark to its quote (`He turned. @Waiter (softly) He bowed low, “Bonjour.”`), is given by making the new speaker's mark start it and writing the old one before its quote: `@Zed Gerald put on his spectacles. @Gerald “I thought…”`; every stretch of every example in the spec now takes both edits but one glued to Japanese text. Anything else goes whole: a group character's words keep the quote inside them (`@Wanda They charge, shouting, @Wanda ‘PREPARE…’`), and a dialogue tag between two quotes can be given to their speaker (`@Baker said the baker. @Baker “Gently.”`). A sound for whoever is speaking keeps its owner by taking a name: `@Narrator [giggles]`, without a direction its group gives anyway. A group's direction given away goes into the new mark, the one way §13 rule 3 writes it: `@Zed (sighing)`. It no longer gives the rest of the line to the new speaker; words that open with `(` are escaped, so they don't become a direction; and a name that replaces `@()` keeps a space after it.
- `curlQuotes` makes a text's quotes curly as `format` does, and changes nothing else; `quotationMarks(language)` gives the marks it writes. Both run in time that grows with the text, with thousands of quotes whose edge is an apostrophe too.
- Scene breaks may have spaces between their signs, as in Markdown: `* * *` and `- - -` (§4.4). Names match whatever their apostrophe, as whatever their capitals: `@O’Brien` is the cast's `O'Brien` (§5.2), without a warning. A page after `{page iv}` is `v`, and one after `{page Map}` then `Map +1`, `Map +2`.
- `setSpeaker` and `setDirection` change nothing for a stretch with no words, which isn't heard.
- A note that runs over a line break no longer carries a mark's speaker or direction on to the next line: what a mark does ends with its line (§5.3, §10). A quote left open still carries on over it, and is warned about as at any line break.
- A front matter value read as text keeps the text it is written with, where YAML would read a number or `true`: `title: 1.10` is `1.10`, and a cast member `R2: 1.50` is named `1.50`.
- Images and links nested inside one another are read at any depth, in time that grows with the line: 50,000 images, each in the one around it, ran out of stack, and 8,000 took over a second.
- `insertSound` and `insertLine` check the sounds heard too: no other sound may come or go. A sound put in before an indented group line made the line text, and a sound written on it was heard.
- `setDirection` writes a direction with a backslash, `%` or a line break so it reads back as given.
- No `stray-quote` warning for a measurement: `12"`, like `12'`, is no quote (§5.5).
- `setDirection` sets a quote to its closing mark (over the paragraphs that carry it on), or to a direction of its own inside it, and narration to the end of its line; a paragraph that carries a speech on keeps its own direction just inside its opening mark (`“@()Will you…`, and `“@(soft)Two.”` for a speech nobody has marked), so it still carries the speech on. It no longer changes the stretches after it on its line that took their direction from the same mark: they keep theirs, with `@()` or `@(…)`. On the second line of a quote, it no longer writes the direction into the mark on the line before and takes it back with `@()`.
- `renameCharacter` renames the narrator too (adding `narrator:`, or rewriting it however it is written: quoted, escaped or a block scalar), spells a name anew in other capitals (`Mcgregor` to `McGregor`), refuses a name another character already has (`RangeError`), and checks that nothing else is heard differently.
- `insertSound` never puts a sound inside a mark, a direction, an instruction or a note, nor straight after a mark, where it would be the character's own, nor in `{book only}` or `{hidden}` text, where it would never be heard; `insertLine` never puts a line in the front matter or a note, keeps the line endings around it, and before a paragraph makes the line a paragraph of its own, so a quote the paragraph carries on still does. Both throw a `RangeError` for an offset outside the text, and return no changes if the story would be heard differently, or, for a line, if it would bring a new warning (an open note or quote, a stray `:::`), print differently, or hide or unprint the paragraph it joins (`{hidden}`, `{book only}`, `{audio only}`); a line is one line, and not empty.
- `write` makes several changes to the model at once, one after another, and keeps the author's own marks; `changesFrom` gives the same result as small changes. Each change is read back: one that can't be made as asked (a note holding `%%`, an empty sound, a speaker an edit can't give, a heading level outside 1 to 6) throws a `RangeError` instead of being left out or doing something else. An instruction's value is escaped. Renaming a character through the cast takes about as long as `renameCharacter`. Changes that undo each other, such as two stretches of one quote given to two characters, throw a `RangeError` rather than leave one of them unmade, and so does a change to a field it can't write (a vocal sound's speaker, a speech's text, an image, the narrator, a group or a block's visibility), or a book detail, full name or name that doesn't read back as asked. What the edits and the writer write into a story (a sound's description, a note, an instruction's value, a direction) keeps a `&` that would start a character reference as written. It reads each text once while it works, so a change to a 100,000-word story is written in about a third of the time, and keeps the readings of only the last few texts, so many changes to a long story no longer take memory without end (50 at 100,000 words once took 4.7 GB); a mark is checked for being spare only where another change wrote near it.
- `applyChanges` refuses a change outside the text, or one that ends before it starts.
- `insertSound` puts a sound after the first word a mark gives when the offset is at the mark, after the words before an empty line or a line ending, and after a link rather than inside its text.
- `isName` agrees with the parser on what a name is. `setMeta` and `setFullName` replace exactly the value as written, as the front matter reader reads it: a `#` inside quotes, a comment after the value, and every line of a block scalar. Both read their result back: `setMeta` writes at the indentation the front matter has, `setFullName` turns `cast: null` into a cast and refuses a cast written as a list. A value with a control character in it is written with escapes (`"One\rTwo"`), and `.inf` and `.nan` in quotes, so YAML tools read them as text. `setMeta` leaves a key whose value is a map or a list alone (it once wrote over the cast), and both give changes of just `from`, `to` and `insert`.
- A link's text runs to the bracket that balances it (`[a [fine] story](…)`), and an image's address is read without its title or angle brackets, as Markdown reads them; an address with a title is no reason to warn that a sound reads as a link. A link's address and title end where Markdown ends them, not at the parenthesis that balances the first: a title may hold a lone `(` (`[the chapter](book.html "Chapter (one")`), an address in `<…>` a `)`, and escapes count in both. A link opens at the `[` nearest its `]`, so a `[` left open before it is text: `[[the map](maps.png)` links `the map`. A link is read on one line (§8.3): one whose address runs onto the next line is warned about as such. An image may be a link's text: `[![A map](map.png)](map-large.png)` is one image, with a new `link`, shown and not heard, and nothing of the link is read aloud; an image beside words in a link's text is left out of what is heard, and a link in an image's description is its words.
- Character references (`&amp;`, `&quot;`, `&#8217;`, and every name the HTML Standard gives) are read and printed as their characters, as in Markdown, and are never marks; a name only JavaScript objects have, such as `&constructor;`, is text like any unknown name; `characterReference(text, at)` decodes one for tools that render text themselves.
- The front matter reader never fails: nesting past 32 levels is reported and skipped, and an escape that is no character (`"\UFFFFFFFF"`) is kept as written, with a warning. A `#` inside a quoted list item is no comment, a quote opens a list item only at its start (`[don't, can't]`), a backslash at a line's end in double quotes joins the lines, a plain value goes on past an empty line, a value may start on the line after its key (`narrator:` then `  Watson`), a comment ends a plain value (the line after it is reported, as YAML has it), and a long quoted value over many lines reads in linear time.
- A name written in another Unicode form (`Zoë` with a combining mark) is no longer warned about as another spelling.
- Parsing stays linear on books without links: round 7's check for a link searched on from every line to the end of the file.
- Each paragraph and heading keeps a link to the groups around it and lists them when `groups` is read: groups nested thousands deep once took memory that grew with the square of the depth (261 MB for 8,000), and now take a few megabytes. An empty block scalar with keep chomping (`|+`) keeps its line breaks, as YAML does, and a line of spaces in a block keeps those past the block's indentation.
- `format` never changes who says what, word by word, and settles after one run: a file without front matter can't gain some, and stray carriage returns and byte order marks at a line's edge are tidied. It keeps group lines as written, and each line's own line ending. With curly quotes it writes each language's own marks (Italian, Spanish, Russian, Danish, Polish, Japanese and Swiss ones among them, not just English, German and French), the apostrophes of words cut short (`’em`, `’Tis`, `’cause`, at a quote's edge too), opens a quote inside a quote only where it closes inside it, and leaves a `'` that starts a word and that nothing closes as written; it leaves feet and inches (`6'2"`, inside a quote too) and link addresses as written (and any spacing inside a link or image, such as an address in `<…>`), and writes `rock ’n’ roll` and `’90s`. A quote inside a quote curls with the language's own inner marks (`“‘Hello,’ he said,”`, `„Er sagte ‚nein‘“`, `«Il a dit “non”»`), opening after another quote's opening mark and before `*`, `_`, a digit or a dot as well as a letter. A line where the parser reads an apostrophe as a quote's edge keeps its straight marks. A line whose tidying or curly quotes would change who says what is left as it was, and the rest of the file is still formatted.
- The parser reads a line of thousands of unclosed brackets, parentheses or quotes in linear time: a bracket no longer searches the rest of its line for its closing one each time. Giving away a stretch on a line of a thousand quotes takes milliseconds, not seconds.
- `format` finds the lines it must leave as they are by where the words would be heard differently, so a book with a few of them formats in a second, not a minute. It makes the quotes of one very long line curly in time that grows with the line, not its square.
- `changesFrom` changes only the lines that differ: the two texts are lined up as cheaply as can be, in characters, so a line much like another far away is never lined up with it and everything between rewritten. Long texts are lined up first on the lines each has once, as patience diff does, and stay quick however their lines move (100,000 lines reversed, shuffled or all changed, each in under a fifth of a second).
- Edits read the story fewer times: about twice as fast at book length (`setSpeaker` on 100,000 words in about 130 ms), and `setMeta` reads only the front matter again. The formatter finds each change's paragraph by halves.
- What an edit, `write` or `format` reads again and again is kept only while it works: ten edits to a 100,000-word story once left about 500 MB behind them, and now leave a few.
- A line of 300,000 characters, or of 150,000 marks, sounds and notes, is read, formatted, edited and rendered without running out of stack, and brackets nested 150,000 deep in linear time. A link inside a link's text is the link, and the outer brackets text, as in Markdown.

- `fromFountain` writes a cue such as `BOB'S MOTHER` as Bob's Mother, not Bob'S Mother.

**@voxdown/render**
- A link's or image's address runs to its balancing parenthesis, as the parser reads it: `[the bat](…/Bat_(animal))`.
- Emphasis pairs as in Markdown: runs of signs, nested (`*very **quiet** indeed*`, `***Hello***`), and an underscore inside a word is a character. It runs over a paragraph's lines and across a direction, in both views. Emphasis, links and images are matched in linear time on long lines.
- A link's text runs to the bracket that balances it; a link's or image's title is its `title`, and angle brackets around an address are left out. A link inside a link's text is the link, as the parser reads it, and a very long line renders without running out of stack. A link's address and title end where Markdown and the parser end them, lone parentheses and escapes included, and a link opens at the `[` nearest its `]`.
- A character reference in a link's address or title, or an image's, is its character (no stray `\` before it), and emphasis next to one pairs as Markdown pairs it.
- The script view shows a stretch's words without the marks, directions and instructions inside it: narration that runs on over a mark to its quote once showed `@Waiter (softly)` as words.
- In the script view, emphasis around a quote (`@Ann *“Hello.”* said Ann.`) is drawn as in the book: pieces that follow each other in the source are read together, not as if a space came between them.
- An image that is a link's text is wrapped in its link in both views, an image's description is its text (`alt`), and character references show as their characters.
- Links and images nested inside one another are drawn sixteen deep, and those deeper as they are written, as Markdown renderers stop nesting: thousands deep ran out of stack, and took time with the square of their depth.
- The script view finds each speaker's full name and color by key: a cast of 8,000 renders in a tenth of the time, and `characterColors` grows with the cast, not its square.

**@voxdown/editor**
- Pasted text gets its curly quotes as the formatter gives them, checked against the parser: where they would make anyone say anything differently they stay straight, and front matter, link addresses and titles, instructions, sounds and notes keep their marks, as does a measurement (`6'2"`). A `"` typed after a dash closes the quote the line has open.
- Enter inside a quote splits it with the quote's own marks, in any language (`„Hallo.“` ⏎ `@Anna „…“`) and straight ones, for the speaker and direction the parser gives it; elsewhere it is Enter. In German it took a closing `“` for an opening one, and added a stray `”` and a new line's mark after the quote was over. Backspace joins a split back whatever its marks.
- A quote opened with a straight mark closes with one, typed or pasted, and a paragraph that carries on a speech opened straight starts with one (§5.7): a curly mark closed nothing, and the rest of the line was said. A quote opened with another language's marks (`“` in a German story) closes with its own, and a straight `"` the narration holds open closes straight. A paste is checked against the whole story as it will be, not just what was pasted.
- Typed quotes follow the same rules as pasted ones: as typed in the front matter (finished or still being written), a link's address, an instruction, a note, a mark or a group line; in the story's language otherwise (`„…“` in German, `«…»` in French).
- `<voxdown-editor>` keeps a story's CRLF line endings: its `value` comes back as it was set. The playground saves a story with the line endings it was opened with.

**@voxdown/cli**
- Reads with `voxdown` 1.1, and `vxd --version` names spec 1.1.
- `vxd check` lists any number of problems: a file with hundreds of thousands of them ran out of stack.

**VS Code extension**
- Reads with `voxdown` 1.1: its warnings and preview follow spec 1.1, and the new-story snippet declares it.
- A scene break with spaces between its signs (`* * *`) is highlighted as one, and ends the paragraph before it.
- A note that runs on past its line's end ends a character mark's colour before it, as the parser ends what the mark does.

**The playground**
- A new story declares spec 1.1.
- The pages fill the window between the shelf and the line at its foot, and no longer cover that line; on a short window the page scrolls. The Sun in *The North Wind and the Sun* is read by a new voice.
- The listening page's recordings are levelled as `scripts/speak.mjs` means them to be: every voice as loud as the others, sounds and page turns quieter behind them. Its measurement of each clip's loudness had always failed, so no clip was ever levelled.

**Tests**
- Fuzz tests (fast-check), 1,000 stories each by default, for the parser, writer, formatter, edits, inserts, book details, Fountain import, views and editor, on stories made at random from the format's own pieces. Each edit's promise is checked character by character, sounds and the printed book included, and how often an edit declines is counted and kept under a budget. The writer is given notes, instructions and sounds with delimiters in them. `FUZZ_RUNS`, `FUZZ_SEED` and `FUZZ_SHOW` set how many stories, which, and whether to print the declined ones.
- Real books (`corpus/`): a chapter of *Alice*, part of *A Scandal in Bohemia*, the Grimms' *Bremer Stadtmusikanten* in German, a new CC0 story with CRLF line endings that has what they lack, and another told in British single quotes, with the apostrophes that look like their closing mark. Each is checked as heard and as printed against reviewed goldens, written back, formatted and edited on every stretch.
- Timing: 100,000 words within about ten times what a laptop takes, and lines built to be slow (thousands of `[`, `@(`, `{`, `'`) within two seconds.
- Prose made at random (`test/stories.ts`): narration, marked and unmarked dialogue, tags, directions, sounds, quotes in quotes, speeches over paragraphs, groups, a cast, CRLF. On it the edits may decline on one stretch in a hundred at most (none do), and formatting keeps every word heard as before. Front matter of every form the reader knows, set and read back; the book view against the book text; the writer's line-by-line changes.
- The real books are taken back to bare text, every mark before a quote removed, and marked up again with the edits, stretch by stretch, in order and from the last paragraph back: they must read as reviewed, line for line.
- More properties on prose: curly quotes nest in English and German; every mark an edit writes is needed; the writer, given several changes at once, leaves no mark to spare; and giving away a quote, or a character's own words, must move every word of it.
- The writer is given stretches for three characters at once, and must make each exactly as asked, keep everything else, or throw only where two of them share a quote. Prose now has speeches over paragraphs that nobody has marked. Every mark an edit writes is checked on stories of tricky pieces too, and the edits' budgets there are tighter. The changes between two texts must be no bigger than the lines that differ. Memory left behind by edits is measured.
- A CommonMark reader (markdown-it, a test dependency of the views) as an oracle: on lines of Markdown made at random, the book view's emphasis, links and images are what it makes of them, and the parser hears the words it shows.
- The editor's marks give each character's words to the speaker the parser does, and after each keystroke are what it would draw for the new text from scratch.
- Each book, its curly marks made straight and curled again, gets them back (but the openings of a single-quoted speech over paragraphs, which straight marks can't write). Parsing, formatting and an edit at twice the size take about twice the time. Hand tests for Swedish `»…»`, German `‚…’`, Thai and an inner quote after a dash; inserted sounds must be heard; and the writer's property reads exactly what it wrote, character by character.
- An oracle that shares no rule with the edits: a quote's words are found in the text alone, from its opening mark to the closing mark §5.5 gives it, and giving the quote away must move exactly those. Every mark an edit writes is checked alone and in pairs, a direction written into a mark included. Every stretch of every spec example takes both edits. Lines that would hide or unprint a paragraph are put in at random; heard words carry whether they are heard at all; the script view's speakers are checked against the parser's; and the formatter's links and images, read as the parser reads them, never change.
- Fuzz runs in chunks, so the deep runs (`FUZZ_RUNS=20000`) finish cleanly, with timeouts that grow with them; the long corpus tests give the event loop a turn between their steps, so a loaded machine's test worker never loses its runner.
- The parse-time ratio test tries up to three times, so a loaded machine can't fail it, while a quadratic step still fails every try; the playground check waits for the script view to settle. Pasting each book, as written and made straight, keeps who says what. A speech over paragraphs passes over one of notes alone (§5.7). The editor's marks give the parser's speakers after every keystroke.
- The script view must show every word heard and no mark or direction as a word, on stories made at random, every book and every spec example. Typing is tested through the editor's input handlers. A group's labels are tested for their escaping. The last CC0 book has an epilogue after `* * *`, with narration around a mark and a quote in emphasis.
- Quotes are typed and pasted at random into stories made at random, straight-quoted ones included, and must never change who says what; the editor's own marks, after each edit, are checked against the parser's. Enter and Backspace are tested in English, German, French and straight quotes. Images and links nested tens of thousands deep are parsed, drawn and marked in good time.
- Prose made at random has Markdown with its dialogue (emphasis around and inside quotes, links in quotes and in narration), and the script view must emphasize and link the same words as the book view.
- Every fuzz generator makes character references, those only JavaScript objects have included, and sounds are put in with descriptions holding `&`, brackets and backslashes, and must read back as asked.
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
