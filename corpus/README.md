# Real books, for testing

Chapters of public-domain stories, marked up with VoxDown by hand, for the tests: real prose has quotes inside quotes, apostrophes, dashes, songs and speeches that run over paragraphs, which made-up examples rarely do.

| File | What it is |
| --- | --- |
| `alice-mad-tea-party.vxd` | Lewis Carroll, *Alice’s Adventures in Wonderland* (1865), chapter VII: four speakers, songs, a quote in brackets, quotes inside quotes. |
| `scandal-in-bohemia-1.vxd` | Arthur Conan Doyle, “A Scandal in Bohemia” (1891), part I: told by Watson (`narrator: Watson`), long speeches, and a quick exchange with no attributions. |
| `bremer-stadtmusikanten.vxd` | The Brothers Grimm, “Die Bremer Stadtmusikanten”, in German: `»…«` quotes, `--` between speakers, apostrophes (`war's`), and the four animals' cries as their own sounds. |
| `the-keeper-and-the-gull.vxd` | A short story written for these tests and given to the public domain (CC0): what the books don't have, such as directions, `@()`, groups, sounds a character makes, a song over several lines, a speech over three paragraphs, straight quotes, `6"`, page turns and pauses, with CRLF line endings. |
| `the-last-lamp.vxd` | A second short story written for these tests and given to the public domain (CC0), told in British single quotes with double quotes inside them: apostrophes that look like closing marks (`’Tis`, `’em`, `’62`, the plural `Pruetts\’` escaped as §5.5 asks), a speech interrupted by narration, a speech over three paragraphs, dashes between speakers, and a note in straight single quotes. |

The first three texts are in the public domain and come from Project Gutenberg (#11, #1661 and #77905), without its header and footer. Each paragraph is joined onto one line, since VoxDown reads quotes line by line, and a mark is put before each character’s quotes, as an author would.

Each `*.spoken.txt` is what the parser reads aloud from its book, and each `*.book.txt` the book text it prints, reviewed by hand. `pnpm --filter voxdown exec vitest run test/corpus.test.ts` checks them; `UPDATE_FIXTURES=1` writes them again, to review the changes in the diff.

What the books showed VoxDown 1.0 can’t yet say, now in SPEC.md §17: two characters speaking together (written here as the Hatter), a speech broken by a song and going on after it with no opening mark (it warns), and a quote of the same kind inside a quote (written here with `\“ \”`).
