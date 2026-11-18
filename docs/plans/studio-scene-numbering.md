# Explicit Fountain scene numbering

Round 24 adds a deliberate preview/apply tool for ordinary Fountain `#N#` labels. It assigns numbers in existing source order; it does not move scenes, create hidden IDs, lock production numbering or promise automatic A/B scene insertion. Ordinary typing remains unchanged.

## Modes

**Number only unnumbered scenes** is the default. Every existing scene label remains verbatim, including zero padding, alphanumeric labels and labels on skipped headings. Its starting value defaults to one after the highest existing integer-only label. New positive integers skip any preserved numeric-equivalent labels: `#001#` reserves `1`. Alphanumeric labels such as `#12A#` remain unchanged and do not set the numeric default. Existing duplicate labels are disclosed, not silently repaired.

**Renumber all eligible scenes** defaults to 1 and replaces eligible scene labels in source order. The dialog requires an explicit acknowledgment before Apply. Labels on skipped headings remain reserved, so new numbers cannot collide with them. This may deliberately leave gaps. Both modes allow an explicit positive safe-integer start; allocation stops with an error rather than rounding or overflowing JavaScript's largest safe integer. Existing larger labels can remain untouched, but require the writer to choose an explicit start because automatic continuation is unavailable.

## Pure source contract

`sceneNumberingSummary(source)` returns scene/eligible/already-numbered counts, skipped heading reasons and `suggestedStart`. `planSceneNumbering(source, { mode, start? })` returns `{ mode, start, changes, candidate, preview, skipped, preserved, warnings }`.

The planner reads Studio-bounded source (500,000 characters / 20,000 lines), rejects malformed or ambiguous nested omissions, and edits only scene-heading label spans. New markers are inserted before trailing whitespace; an existing marker's digits/text are replaced without changing its surrounding hashes or spacing. BOM, indentation, newline spelling, private passages, title data, sections, synopses, action/dialogue and other source bytes remain intact. Headings containing private comments, formatting or escapes are skipped with line/reason reporting. A private passage spanning a heading boundary is also skipped.

The candidate is reparsed. Every physical line must preserve kind, visible source text, level and dual marker; only the intended scene-number property may change. Omission kinds, exact private bytes and mapped boundaries must remain intact. Changes are source ordered and nonoverlapping, suitable for one atomic editor transaction and one-step undo. The plan is valid only against the exact original source revision.

## Dialog and integration

`mountNumberingDialog(host, { current: () => ({source,id}), apply(snapshot, plan) })` exposes `open()` / `close()`. Opening captures source/id by value. Preview and Apply check that both still match. The host must retain its own authoritative guard and dispatch all changes with isolated history. A rejected apply leaves the source untouched and instructs the writer to reopen against current source.

Changing mode or start invalidates preview. Switching modes resets renumber acknowledgment. Closing clears snapshots and plans. A fresh open returns to the safe default mode. Apply stays disabled for invalid inputs, stale source, no-op plans or unacknowledged renumbering.

The preview renders at most 50 source changes and 50 skipped reasons, with total counts and explicit truncation disclosure. Individual heading excerpts are capped at 2,000 characters per side and marked when truncated; the complete source is used for the atomic changes. Private heading text is never copied into preview or skip reports. All preview content uses literal DOM text. No schema changes, source comments, hidden metadata, network or file writes are introduced.

CSS hooks: `.studio-scene-numbering` and `.scene-numbering-preview`. Labels/selects/number input need narrow-screen width constraints; source `pre` elements need wrapping and bounded overflow.

## Verification

`studio-scene-numbering.test.ts` covers default continuation, alphanumeric/zero-padded/duplicate labels, collision avoidance, explicit renumbering, skipped private/formatted/boundary headings, BOM/newlines/indentation, unrelated content preservation, no-op plans, invalid/large starts, malformed/private/size bounds, atomic undo and 3,000 scenes. `studio-numbering-dialog.test.ts` uses isolated Chromium for explicit preview/apply, acknowledgment, mode/input invalidation, snapshot/draft guards, private skip disclosure, preview caps, rejected apply and close/reopen cleanup. Native production-numbering compatibility and physical-device behavior are not claimed.
