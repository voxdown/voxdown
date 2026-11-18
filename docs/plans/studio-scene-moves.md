# Exact-source scene rearrangement

`site/src/studio/scene-edits.ts` provides two pure functions:

- `listSceneCards(source)` returns source-ordered cards with zero-based `index`, one-based heading `line`, `heading`, optional explicit `number`, collected `synopsis`, exact content `from`/`to` offsets, and optional nearest preceding `section: {line, title}`.
- `planSceneMove(source, sceneIndex, targetIndex, "before" | "after")` returns an exact `candidate`, a single CodeMirror-compatible replacement in `changes`, resulting original-index `order`, a `moved` description, and `warnings`. Self moves and already-satisfied adjacent moves have no changes.

Offsets are UTF-16 positions in the exact input. The module has no editor, DOM, network or storage dependency. Invalid indexes, malformed private comments and unsafe moves throw descriptive errors before any source is changed.

## Ownership and boundaries

A scene owns the source from its heading through its subsequent content, stopping before the next scene or section heading. Notes, synopses, dialogue continuation lines, explicit page breaks and other content inside that range move with the scene. Blank separators after the final content line remain in their original slots.

This is a transparent source-order rule, not an inferred attachment system. A standalone note before a later scene heading belongs to the preceding scene; a note before the first scene belongs to fixed front matter. The UI must explain this before structural edits and let writers inspect the exact scene range. It must not promise that a note before a heading will automatically follow that heading.

Title/front matter, BOM, section markers, inter-scene blank separators and terminal bytes stay fixed. Scene bodies move as exact unchanged substrings. Keeping separators in fixed slots allows the common case of moving a final scene with no terminal newline without inserting or deleting bytes. Mixed newline spelling and significant two-space dialogue continuation lines remain intact.

Moves are allowed only within the same nearest preceding section marker. Repeated section titles still identify distinct boundaries, and nested section markers create new boundaries. Cross-section moves reject with guidance to edit section boundaries explicitly first. The engine does not move or silently reinterpret outline labels.

Existing explicit scene numbers stay verbatim. Plans warn that scenes are not renumbered.

## Safety checks

The planner checks existing source size/line limits and refuses incomplete notes or boneyards. It constructs a permutation of exact source pieces, retaining their original provenance. No piece is duplicated or dropped, and total source length is unchanged.

Candidate reparsing must preserve the expected reordered sequence of every physical line's element kind, rendered text, simultaneous-dialogue status, section level and scene number. Every private passage must retain its expected kind and exact mapped start/end offsets. A completed private passage crossing a scene boundary is refused rather than split. Context-sensitive Fountain whose meaning would change after movement is also refused, with guidance to add paragraph separation or make ambiguous character cues explicit.

## Integration contract

Indexes are revision-local positions, not stable IDs. Capture the exact source with the preview and reject a changed document, or generate a fresh plan against current source immediately before applying. A still-in-range old index is not proof it still identifies the intended scene.

Show the source ownership rule, destination and warnings. Apply the single change set in one transaction with full history isolation so Undo restores the entire move separately from preceding typing. After applying, recompute cards from the new source; `order` describes provenance only and should not become a persistent identity scheme. Keyboard movement should use the same planner as drag-and-drop.

## Verification

16 engine tests cover card boundaries, attached content, title/BOM/mixed newline fidelity, EOF movement, internal moves, significant whitespace, section boundaries, context-sensitive rejection, completed and malformed private boundaries, no-ops, invalid indexes, one-step editor undo, all 50 before/after combinations across five scenes with duplicate headings, and a 2,000-scene fixture. The four existing navigation tests also pass.

Card rendering, accessible movement controls, drag-and-drop, stale-preview rejection and browser interaction are UI integration work, not claimed by these pure-engine tests.
