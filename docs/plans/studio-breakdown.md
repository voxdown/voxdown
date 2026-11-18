# Scene and cast breakdown

Round 25 adds a read-only planning and performer handoff report from one captured Fountain snapshot. It does not infer props, silent cast, shooting schedules, shot counts, scene duration or production requirements.

## Data contract

`prepareBreakdown(source)` returns immutable `rows` and `summary`. Each actual parsed scene heading is a separate occurrence, including empty scenes and repeated identical headings. Occurrence IDs are snapshot-local positions, not stable scene identifiers. Explicit scene numbers remain separate from those IDs. Source lines are one-based. Public content before the first heading gets its own row, pointing at the first public content line; title/outline/private-only preambles do not.

The shared source limits apply (500,000 normalized UTF-16 code units, 20,000 lines). Unfinished or nested ambiguous private delimiters prevent preparation. Private omissions, title/contact fields and outline are excluded. Returned objects retain no original source or private fields. Public headings and cue names use rendered Fountain text with emphasis markers removed.

Speaking roles are canonical Studio cast identities, preserving distinct names and normalizing equivalent cue case/extensions. A role appears only when its cue has actual nonempty dialogue or lyrics. A parenthetical-only cue is not a speaking role. Punctuation-only speech remains a speech block with zero word tokens. Unnamed cues still contribute real dialogue and speech-block counts without inventing a role. Uncued lyrics contribute dialogue words but do not invent a cue or role.

Dialogue words cover dialogue and lyrics. Action words cover action and centered action. Headings, character cues, parentheticals and transitions contribute neither count. The existing Unicode `countWords` tokenizer is used; unspaced languages are approximate. Dual counts represent explicit `^` marks on cues with real speech, not inferred simultaneous pairs or runtime.

`filterBreakdown(report, {query, role})` filters complete scene occurrences using case-insensitive NFC substring searches. Query matches public heading or explicit scene number; role matches a real speaking role. `summarizeBreakdown(rows)` counts all roles and words in those complete matching scenes. A role filter does not pretend the scene's other speakers disappeared.

## Dialog and CSV

`mountBreakdown(host, {current: () => ({source, name}), download(bytes, name, type)})` exposes `open()` / `close()`. Preparation happens only on open. Later editor edits do not change the captured report; close and reopen to refresh. There are no editor mutations, network requests, persistence or automatic downloads. Closing clears the snapshot report and restores opener focus. Populated search fields support Escape dismissal.

The dialog renders at most 50 rows per page and 10 role summaries per row. Heading, number, role and filename display lengths are bounded; text is assigned with `textContent`. Full values remain in the CSV. Both filters reset pagination and update explicit filtered/whole-snapshot totals. Empty results disable download. The results region is keyboard focusable for scrolling.

`breakdownCsv(rows)` exports all filtered rows, including rows outside the current page, as RFC4180 quoted fields with CRLF record separators. Columns include occurrence, heading, explicit number, source line, speaking roles, per-role speech/word/dual counts, and scene totals. Multiple roles within a cell use quoted newlines.

Source-controlled cells beginning with `=`, `+`, `-` or `@` after whitespace/control/Unicode format characters receive a leading apostrophe before CSV quoting. Quotes are doubled and commas/newlines remain within quoted fields. This is an intentional spreadsheet-safe handoff; the prefix may be visible in some importers. It is not a byte-exact source backup, and its download must never satisfy the editor's exact-source backup guard. An explicit CSV download can be retried if the browser download callback fails.

## Validation

24 pure tests and 5 isolated Chromium dialog tests cover actual repeated/empty scene occurrences, explicit numbering, public/private boundaries, canonical/unnamed/empty cues, Unicode and punctuation-only counts, whole-scene filtering, frozen snapshots, source bounds, formula prefixes including invisible controls, RFC4180 quoting, long full exported values, 123-row pagination/full-filter export, delayed editor edits, Escape focus restoration, download failure/retry and queued close/reopen events. Independent integrated review and mobile styling verification are separate from author tests. No native spreadsheet importer compatibility claim is made.
