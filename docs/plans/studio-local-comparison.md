# Compare with a local Fountain file

Round 22 adds a read-only source comparison. Open **Compare with local Fountain file**, choose a local `.fountain` or `.txt` baseline, then explicitly choose **Compare source**. The current screenplay is captured by value when the dialog opens; later editor changes require reopening. No screenplay, storage entry or source file is modified. There is no upload, automatic export or patch accept/reject workflow.

This compares **source**, including private notes, omitted passages, title/contact fields and Fountain markup. The dialog discloses that before file selection. These passages are intentionally visible in the comparison, unlike public screenplay exports. All filenames, excerpts and word segments use literal DOM text; source-looking HTML never becomes markup.

## Scope and bounds

`mountCompareDialog(host, { current: () => ({ source, name }) })` exposes `open()` / `close()`. It reuses `compareSources` and its bounded Myers search. CRLF/CR/LF are normalized to LF for comparison. If normalized source matches, the UI distinguishes identical source text from line-ending-only differences. This is not a byte-equality or backup-integrity claim. A UTF-8 BOM is retained as part of source and can therefore create a first-line change.

Input decoding is strict UTF-8 with BOM preservation. File input is limited to 2 MB, then validated against Studio's 500,000-character / 20,000-line source bounds. Unexpected extensions, path/control characters in filenames, invalid UTF-8 and binary NUL content fail visibly. A new selection clears the old comparison immediately, so an error cannot leave mislabeled old results. Async reads use generation guards: older reads cannot overwrite newer selections, repopulate a closed/reopened dialog or steal keyboard focus.

The UI renders one changed range at a time, with removed baseline and added current-snapshot columns. Previous/Next and a searchable selector navigate every matching change. The selector renders at most 50 choices around the current position; filters search the complete changed source ranges. Each excerpt is bounded to 80 lines / 8,000 characters and explicitly reports truncation. Counts and source line ranges still refer to complete normalized sources. If the line-diff work budget is exhausted, no change counts/navigation/equality are claimed: only bounded source beginnings are shown with a clear fallback explanation.

`compareWords(before, after)` provides display-only chunk highlighting for small paired changes. Unicode letters/numbers/combining marks are grouped as words, whitespace as chunks, and punctuation/other symbols as chunks. A bounded longest-common-subsequence table compares at most 4,096 characters and 200 tokens on either side, with at most 40,000 cells. It returns exact source-preserving segments or `undefined` for a plain-text fallback. This is not semantic screenplay analysis; repeated words can have multiple equally valid alignments. The dialog never changes source based on the alignment.

## Interaction and integration

The host only supplies the current snapshot and a command that calls `open()`. No editor callbacks, file writes, download permissions or storage changes are needed. Close/Escape clear captured source, excerpts and plans, and restore opener focus. Arrow keys move through changes only while a source excerpt is focused; search/select controls retain their normal keyboard behavior. File reads and Compare do not move focus asynchronously.

CSS hooks: `.studio-file-comparison`, `.file-comparison-navigation`, `.file-comparison-columns`, `.comparison-word-added`, `.comparison-word-removed`. Source columns should stack at narrow widths; `pre` elements need wrapping/scroll bounds and word-highlight contrast that remains clear in both themes. Heading labels identify added/removed sides independently of color.

## Verification

`studio-word-comparison.test.ts` checks changed chunks, exact reconstruction, whitespace, literal markup/private delimiters, Unicode, empty sides, resource fallbacks, and 200 deterministic repeated-token fixtures. `studio-compare-dialog.test.ts` runs isolated Chromium to verify explicit comparison, disclosed private content, snapshot isolation, normalized equality versus line-ending differences/BOM changes, invalid files, late-read/close guards, unchanged editor/storage, bounded navigation/search, real arrow dispatch, inert markup and large-diff fallback. Physical-device behavior is not established by browser emulation.
