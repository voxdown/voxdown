# Conservative location directory and rename

`site/src/studio/locations.ts` provides:

- `locationDirectory(source)`: grouped `locations` with `{name, appearances}`, globally `excluded` headings with explicit reasons, and malformed-comment warnings. Appearances contain one-based source `line`, interpreted `heading`, exact prefix spelling, optional time and explicit scene number.
- `planLocationRename(source, oldName, newName)`: source-ordered atomic `changes`, exact before/after line `preview`, `excluded` headings, `targetAlreadyExists`, and exact `candidate` source. Invalid or unsafe operations throw without changing source.

Identity uses Unicode NFC normalization, case-insensitive matching and collapsed whitespace. Recognition is deliberately conservative: the parser must classify the line as a scene, and the heading must have an explicit INT, EXT, EST or I/E prefix (including INT./EXT. variants). Forced headings with a recognizable prefix are supported; an unqualified forced heading such as `.A STRANGE DREAM` is not assumed to name a place.

The last whitespace-delimited hyphen can separate a time suffix only when that suffix is a recognized time phrase, such as DAY, NIGHT, LATER or CONTINUOUS, optionally with a parenthetical qualifier. Thus `HOUSE - KITCHEN - DAY` identifies `HOUSE - KITCHEN`, while `HOUSE - WEST WING` is excluded rather than guessing that WEST WING is a time. Stacked recognized time phrases such as `HOUSE - DAY - CONTINUOUS` are also excluded. The recognized vocabulary is intentionally limited and can be expanded with explicit examples and tests.

Headings with inline private comments, formatting/escapes, unrecognized prefixes or ambiguous names/times are excluded with explanations. Exclusions are global: the tool cannot confidently determine whether they contain more appearances of the selected location. The UI explicitly tells the writer that such appearances might remain unchanged.

## Rename safety

Only literal location-name spans change. INT/EXT prefixes, forced markers, indentation, time suffixes, scene numbers, other spacing and unrelated text remain exact. Dialogue/action mentions are never searched or replaced. The destination may contain Unicode letters/numbers and ordinary punctuation, but not newlines, controls, bidirectional controls, Fountain markers or another INT/EXT prefix. Names are limited to 200 UTF-16 characters. A new name that makes a time boundary ambiguous is rejected after candidate recognition.

The candidate is reparsed and reindexed. All element roles, dual flags, scene numbers and unaffected rendered text must remain unchanged; every edited heading must still have the requested location identity; private ranges must preserve their kind, mapped boundaries and exact source bytes. Incomplete notes or boneyards block every rename. Original BOM and mixed newline spelling are preserved, and source/line limits are checked before and after.

## Dialog integration

`mountLocations(host, {current, apply, jump})` in `location-dialog.ts` returns `open()` and `close()`.

- `current()` returns `{source, id}` for the current screenplay.
- `apply(snapshot, plan): boolean` applies the complete plan in one CodeMirror transaction with full history isolation, returning whether it succeeded.
- `jump(snapshot, line): boolean` navigates to an appearance, returning whether it succeeded.

The dialog captures a source/id snapshot, bounds the directory, appearances, exclusions and exact rename previews to 50 displayed items each, and reports total counts. Search reaches later directory entries. Plans retain every change beyond the visual cap. All source content uses text nodes. A rename that merges an existing location requires an explicit checkbox acknowledgment. Editing the destination or changing the chosen location invalidates the previous preview.

The dialog checks both exact source and draft ID before preview, apply and jump. Host callbacks must repeat the authoritative current-revision check and isolate undo. A stale or rejected operation leaves source untouched and asks the writer to reopen the directory. There are no stable source IDs, server calls or source reconstruction.

Root integration owns command placement and styles for `.location-dialog`, `.location-directory`, `.location-appearances`, `.location-rename-preview` and `.location-exclusions`; long preview source should wrap and the lists should scroll.

## Verification

29 pure tests cover prefix/time variants, nested location labels, forced headings, Unicode normalization, exact spacing and scene numbers, private/formatted exclusions, unknown/stacked times, BOM/mixed newline preservation, collisions, unsafe controls/syntax, reinterpreted time boundaries, malformed notes, one-step editor undo and 3,000 headings/private passages.

Five isolated Chromium tests cover collision acknowledgment, stale source/draft rejection, destination-change invalidation, refused host application, 50-item DOM caps with complete plans, searchable late entries, source navigation, hostile text and Escape focus restoration. These do not claim physical mobile or screen-reader acceptance.
