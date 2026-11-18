# Actor sides from a captured screenplay

`prepareActorSides(source)` in `site/src/studio/sides.ts` parses one immutable screenplay snapshot. It returns a searchable list of characters with speaking-cue and segment counts, a `hasScriptTitle` flag, and `build(character, paper, {includeScriptTitle})`.

A build returns the role, synthetic PDF title, included segment descriptions, layout and warnings. Selection uses the existing cast index's Unicode/case/extension identity. A scene qualifies only when that character has nonempty dialogue or lyrics; an empty cue or parenthetical alone does not select a scene. The complete selected scene retains other speakers, dialogue and action. Speech before the first scene is included as a clearly named “Before the first scene” segment, including in scripts without scene headings.

The engine creates an export-only parsed document from existing interpreted elements. It does not reconstruct editable Fountain or modify source. Private notes, omitted passages, outline sections, synopses and original title metadata are excluded. Inline private text was already removed by the authoritative parser. Malformed private comments anywhere block the operation.

The synthetic cover reads “[role] — actor sides” and discloses that these are complete scenes with other characters for context, repaginated rather than locked original screenplay pages. Every selected segment starts on a new page. The optional original script title is off by default; enabling it copies only the original Title value, never Author, Contact, Copyright or other metadata. Existing scene numbers remain as written. PDF generation reuses the regular screenplay layout and bundled-font PDF exporter, including unsupported-character errors.

## Dialog integration

`mountActorSides(host, {current, download})` in `sides-dialog.ts` returns `open()` and `close()`. `current()` supplies `{source, name, paper}`. `download(bytes, filename, mimeType)` uses the application's existing local download mechanism.

Opening captures an exact snapshot. Subsequent editor changes do not silently change a prepared packet; the dialog explains that users should close and reopen to include later edits. Character options and displayed segment previews are each capped at 100, with explicit total/count messages and search to reach later characters. The PDF contains every selected segment, not only the preview cap. All source-derived labels use text nodes.

Export dynamically imports the PDF module. Generation checks before and after its async work prevent a closed, canceled or superseded dialog from downloading a late result. Closing releases the captured project and restores focus. A native PDF computation already underway is not forcibly interrupted, but its result is discarded. Export failure leaves source unchanged and keeps the dialog available for retry.

Root integration owns command/menu placement and responsive styling for `.actor-sides-dialog` and `.actor-sides-scenes`.

## Verification

Ten pure/export tests cover complete-scene selection, contact/outline/private exclusion, opt-in original title, pre-scene speech, empty/non-speaking cues, Unicode/extensions/dual dialogue, comment-fragmented cues, malformed notes, immutable captured state, 1,000 selected scenes and a real passive embedded-font PDF with synthetic metadata.

Five isolated Chromium dialog tests cover snapshot export despite later edits, Escape cancellation while PDF is pending followed by reopen, bounded 100-item rendering without truncating export, hostile source labels rendered as text, recoverable export failure and malformed-source dismissal. The dialog test substitutes a controllable PDF promise for deterministic async races; the pure/export test separately exercises the real PDF implementation. Site TypeScript and scoped Biome checks pass.

These checks do not constitute physical iPhone, screen-reader or external PDF-reader acceptance.
