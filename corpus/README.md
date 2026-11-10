# Real books, for testing

Chapters of public-domain stories, marked up with VoxDown by hand, for the tests: real prose has quotes inside quotes, apostrophes, dashes, songs and speeches that run over paragraphs, which made-up examples rarely do.

| File | What it is |
| --- | --- |
| `alice-mad-tea-party.vxd` | Lewis Carroll, *Alice’s Adventures in Wonderland* (1865), chapter VII: four speakers, songs, a quote in brackets, quotes inside quotes. |
| `scandal-in-bohemia-1.vxd` | Arthur Conan Doyle, “A Scandal in Bohemia” (1891), part I: told by Watson (`narrator: Watson`), long speeches, and a quick exchange with no attributions. |

Both texts are in the public domain and come from Project Gutenberg (#11 and #1661), without its header and footer. Each paragraph is joined onto one line, since VoxDown reads quotes line by line, and a mark is put before each character’s quotes, as an author would.

Each `*.spoken.txt` is what the parser reads aloud from its book, reviewed by hand. `pnpm --filter voxdown exec vitest run test/corpus.test.ts` checks them; `UPDATE_FIXTURES=1` writes them again, to review the changes in the diff.

What the books showed VoxDown 1.0 can’t yet say, now in SPEC.md §17: two characters speaking together (written here as the Hatter), a speech that runs over several paragraphs the novel way (it warns), and a quote of the same kind inside a quote (written here with `\“ \”`).
