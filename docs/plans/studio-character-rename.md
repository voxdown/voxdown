# Character cue rename

`site/src/studio/rename.ts` exports the pure function `planCharacterRename(source, oldName, newName)`.

The result contains:

- `changes`: source-ordered `{from, to, insert}` ranges addressing the exact input's UTF-16 offsets. They can be dispatched together as one CodeMirror change set.
- `preview`: one `{line, before, after}` entry per changed cue, with one-based source lines.
- `skipped`: matching cues left unchanged, with `private-comment` or `formatted-or-escaped-name` reasons.
- `targetAlreadyExists`: whether another cast member already has the destination identity. Applying the rename would merge those cast identities.
- `candidate`: the exact complete result, including the original newline spelling and BOM.

Invalid names, incomplete private passages, size-limit violations, and unsafe interpretation changes throw descriptive errors without changing source. Missing names and exact no-ops return empty changes. An empty change set with skipped entries does not mean the character was successfully renamed.

## Scope and safeguards

Identity comes from the existing cast index: rendered cue text, trailing performance extensions removed, whitespace collapsed, Unicode NFC normalization and case-insensitive matching. Only character cue names are edited. Dialogue, action mentions, scene headings, title metadata and private passages remain unchanged. Existing forced `@` markers, indentation, whitespace outside the name, multiple performance extensions and dual-dialogue markers are preserved exactly.

Destination names may use letters, combining marks, numbers, spaces, apostrophes, periods and hyphens, up to 200 UTF-16 characters. Leading/trailing whitespace, controls, bidirectional controls and Fountain syntax are refused. This is deliberately a plain-name feature, not a way to insert extensions or emphasis. Existing formatted or escaped names are reported as skipped; cues intersecting a private comment are also skipped, even when the comment lies in an extension rather than the name.

Natural uppercase cues must remain character cues after replacement. For example, replacing natural `MARA` with `Anna` or `INT. ROOM` is refused because it changes Fountain interpretation. The equivalent forced `@MARA` can safely become `@Anna`. The planner does not silently uppercase the requested spelling or insert new `@` markers.

The complete candidate is reparsed. Every line must retain its element kind and dual status; untouched lines must retain their rendered text; every changed cue must have the requested cast identity; and all private ranges must retain their kind, mapped boundaries and exact bytes. Source length/line limits are checked both before and after.

## UI integration contract

Show the preview, total changes, skipped-cue explanations, and any cast-identity collision before applying. Keep the captured source or editor revision alongside the preview. Revalidate against the current document immediately before applying, or require a fresh preview when the document changes. A stale preview must never authorize edits to a different revision or screenplay.

Apply all returned changes in a single transaction, with a full `isolateHistory` annotation so Undo restores the entire rename independently of preceding typing. Display strings as text, not HTML. The pure planner imports no DOM, storage, network or editor APIs.

## Verification

40 targeted tests cover exact cue spans, natural/forced names, multiple extensions, dual cues, Unicode and combining marks, BOM/mixed newline fidelity, private and formatted skips, unchanged dialogue/action references, malformed comments, syntax/control/bidi rejection, role preservation, cast collisions, source limits, a single atomic undo and 3,000 cue/private-passage mappings. The existing nine cast-insight tests also pass. Site TypeScript and scoped Biome checks pass.

These tests validate the planner. Confirmation, stale-preview rejection, keyboard focus and actual browser undo remain responsibilities of the UI integration and its independent review.
