# Audiobook Markup

*Working name. Draft 0.1.*

A plain-text format for stories read aloud. A file is a Markdown story with light marks in it: who says each line, how they say it, the sounds a listener hears, where the pages turn, and notes for the performer. Take the marks out and you have the printed story.

```
@Mother (brisk and kind) ‘Now run along, and don’t get into mischief. I am going out.’

{page}

Peter gave himself up for lost, and shed big tears; @Peter [small sobs] but his sobs were overheard by some friendly sparrows, who flew to him in great excitement, and implored him to exert himself. [sparrows chattering]
```

- [SPEC.md](SPEC.md) is the format, with a worked example for every rule.
- [examples/peter-rabbit.md](examples/peter-rabbit.md) is Beatrix Potter's *The Tale of Peter Rabbit* (1902, public domain), marked up in full.

## Status

| Stage | What | State |
| --- | --- | --- |
| 1 | Spec draft and examples | Draft 0.1 |
| 2 | Parser and lossless writer (TypeScript), passing every spec example | Parser passes every example; writer not started |
| 3 | Renderer: a book view and a performance view, styled with CSS variables | Not started |
| 4 | Editor: edit in the rendered text, with only the changed marks rewritten | Not started |
| 5 | Converters: to the plain text speech services take, and from Fountain | Not started |

## Ground rules

This package is being incubated inside another project and will move to its own repository. To keep that move a copy rather than a rewrite:

- It imports nothing from outside this folder, and has no workspace dependencies. `test/boundary.test.ts` enforces this.
- It keeps its own `tsconfig.json`, tests and configuration.
- The parser (`audiobook-markup`) has no runtime dependencies. The editor (`audiobook-markup/editor`) depends on CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `autocomplete`, `search`; MIT), the standard browser code editor, which it extends to draw marks as chips while keeping the text the only source. Any other dependency is named here with the reason for it.
- The spec talks about stories and characters only. Voices, engines, casting, takes, prices and mixing belong to the tools that use the format.
- Examples are written fresh or come from the public domain.
- Commits that touch this folder touch nothing else, and their messages make sense to someone who has never seen the host project.

## Development

```sh
pnpm --filter audiobook-markup test
pnpm --filter audiobook-markup typecheck
pnpm --filter audiobook-markup lint
```

The spec tests read the examples out of `SPEC.md`: `spec.test.ts` checks that every example is well formed, and `conformance.test.ts` checks that the parser produces its spoken script and book text.

## Licence

Not chosen yet. A common pairing is MIT for the code and CC BY 4.0 for the spec text.
