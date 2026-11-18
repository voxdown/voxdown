# Corrupt PDF font recovery

Round 37 investigates realistic preview/PDF behavior after the transport deadline work.
Existing tests already cover long speeches and continuation cues, parentheticals across
pages, asymmetric dual dialogue, title overflow, private text exclusion, passive PDF
objects and unsupported glyph diagnostics. The concrete new defect was a poisoned font
cache after an HTTP 200 response whose bytes were not a usable font.

Before the fix, an actual browser export receiving an HTML maintenance response failed
with `Unknown font format`. A second export after restoring the healthy response did not
fetch again: the bad bytes remained cached. The damaged response could also be a truncated
TrueType file; some table errors appear only during glyph use or final PDF subsetting.

The PDF exporter now invalidates bytes rejected during font embedding, character-set
inspection, drawing or final save. The failure explains that the bundled font could not
be read, asks the writer to retry, and confirms that the screenplay is unchanged. No
partial PDF is downloaded. The next fetch uses `cache: reload` so it bypasses a cached
HTTP 200 error response as well as the application promise cache. Transport failure during
that refresh keeps the next attempt in refresh mode.

Invalidation compares the rejected byte-array identity with the current cache entry. Two
exports sharing the same damaged bytes may fail at different times; an older consumer
cannot remove a pending or successful newer retry. Successful font bytes remain cached.
An unsupported screenplay glyph keeps its existing actionable diagnostic and does not
invalidate a healthy font. There is no fallback font, source normalization or source edit.
The companion [offline font integrity work](studio-offline-font-integrity.md) makes the
service worker respect fresh font reads and verifies replacements before caching them.

Validation:

- Real-font PDF tests exercise HTTP 200 HTML, truncated headers/tables, and a damaged glyph
  table that passes initial embedding and character-set inspection. Every case retries to
  a readable PDF, then reuses the successful cache. Unsupported glyphs keep healthy bytes.
- The native HTTP/browser transport suite verifies cache reload against a cacheable font
  response and late invalidation while a new request is pending and after it has succeeded.
  Existing stalled-header/body, abort, same-origin and retry tests continue passing.
- 41 focused layout, font transport/recovery, security and actor-sides tests passed.
- A live Studio export produced the readable failure, then a real PDF after the repaired
  response, then reused the successful bytes. A Fountain download preserved the original
  BOM, mixed newlines and private note exactly. Local investigation scripts are
  `/tmp/voxdown-studio/font-corruption-before.mjs` and `font-corruption-after.mjs`.

The review also identified Unicode shaping limitations for a separate scoped decision:
the bundled font includes a zero-advance U+0326 combining mark, while fixed-column layout
counts code points, and the current PDF library does not apply all shaping offsets. A
browser fallback can display decomposed accents that the PDF font does not support.
This round does not silently normalize source or claim multiscript typography support.
