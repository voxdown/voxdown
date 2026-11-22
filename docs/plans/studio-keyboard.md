# Optional screenplay keyboard assistance

Implemented in `site/src/studio/screenplay-keymap.ts`. Integration is deliberately opt-in: install `screenplayKeymap()` in a CodeMirror `Compartment`, and reconfigure to `[]` when the preference is disabled. No source migration or whitespace indentation is involved.

## Behavior

- At the end of a scene heading or dialogue line, Enter starts a separated paragraph. Existing following text is preserved; an empty paragraph is inserted before it when necessary.
- At the end of a nonempty character cue or parenthetical, Enter inserts one newline to continue dialogue. Natural uppercase cues with no following dialogue use ordinary Enter until Fountain can classify them.
- Action, empty lines, unfinished empty templates, titles, sections, transitions, lyrics, escapes, selections and mid-line editing retain normal editor behavior.
- Tab cycles only exact empty templates: blank, `@`, `INT. `, `!`, `>`, then blank. Shift-Tab reverses that order. A scene template outside a paragraph boundary is `.INT. `, so Fountain recognizes it correctly.
- Immediately after character/dialogue/parenthetical text, `()` is available after `@` in the cycle, with the caret between parentheses. Parentheticals are not offered outside dialogue context.
- Text with words, whitespace-only lines, indented templates and title separators are never cycled. Tab falls through to normal editor/browser handling there.
- Composition and active or pending completion menus retain their own key handling. Paste and ordinary input are never intercepted.
- Each assisted edit has an isolated undo step. The module does not apply to read-only documents or multiple selections.

## Privacy and performance

Eligible operations consult the authoritative parse for the current immutable CodeMirror document, sharing the existing worker-seeded cache. Unclosed comments or operations on private spans are refused. Template changes are reparsed and checked to preserve all omission boundaries. End-of-line paragraph insertion delegates to the existing protected paragraph command.

Cheap checks reject structural prefixes, mid-line edits and ordinary paragraph-boundary action before parsing. No parse runs on ordinary typing or paste. Assisted edits can still require a complete current-source parse if the worker cache has not caught up; this is an explicit safety tradeoff, rather than trusting stale comment boundaries.

## Verification

`pnpm exec vitest run site/test/studio-screenplay-keymap.test.ts`: 39 passing editor-state tests covering exact Fountain, caret placement, reverse cycling, undo isolation, preceding/following source, private notes and boneyards, malformed comments, title metadata, escapes, selection/multicursor/read-only fallbacks, paste fidelity and the composition guard.

The root integration should additionally exercise actual Enter/Tab dispatch, completion-menu precedence and preference persistence in the browser. Physical keyboard/IME acceptance remains a separate release gate.
