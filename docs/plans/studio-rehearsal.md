# Self-paced rehearsal cue cards

Round 18 adds a read-only practice view for one role in a captured Fountain screenplay. It complements actor-sides PDFs and the character dialogue editor. It records no audio, requests no microphone, performs no speech recognition or synthesis, calls no server, and writes no storage. Revealing or navigating a card never changes the screenplay or undo history.

## Cue and cast semantics

`prepareRehearsal(source)` returns a frozen `RehearsalProject` with `roles`, `scenes` and `cards(role, optionalSceneId)`. Only complete public dialogue/lyric utterances with nonempty spoken text create cards. A cue followed only by a parenthetical, whitespace or private comments is not a spoken cue. Parentheticals and intentional blank dialogue lines remain inside a complete utterance. Fountain emphasis/escapes become literal rendered text, matching the existing interpretation; this is not byte-exact source display. No 2,000-character excerpt limit applies.

Role identity uses the existing character-insights rules: Unicode NFC, normalized whitespace, case-insensitive grouping, and trailing cue extensions such as `(V.O.)` or `(O.S.)` removed from cast identity. The full printable cue, including extensions, remains on its card. These are speaking-role identities, not title-page authors or contacts. Title fields never enter the rehearsal project.

Cards stay in source order within the selected role. Each explicit scene occurrence receives a numeric snapshot-local ID; repeated identical headings remain separate choices. Speeches before the first explicit scene form a labeled initial segment. Scene choices contain only occurrences with spoken cues. These IDs are not permanent production scene identifiers, and no source navigation/editing is performed from them.

Context is the nearest preceding public speech or action/direction block within the scene or structural section. It may be the selected role's previous speech. Adjacent action/direction lines form a context block; blank lines separate action blocks. Scene headings, sections, synopses and explicit page breaks reset contextual linking. Completed private comments are skipped; their words never enter a card or context.

Two consecutive complete speeches whose second cue is marked dual form a pair, including across blank lines and completed private comments. The first cue must not itself have a dual marker or already belong to another pair. Both cards explicitly identify dual dialogue and show the other complete speech as **simultaneous context**, not an earlier spoken cue. Action, scene and other structural boundaries prevent pairing. An unpaired dual marker remains labeled and follows source order. A dual chain pairs from the left; later unmatched markers remain unpaired.

## Privacy and snapshot boundary

Source is validated using the existing 500,000-character/20,000-line bounds. Unfinished private notes or boneyards block preparation. Unescaped nested private-comment openers also block preparation because Fountain comments do not nest, and a trailing passage after the first closing delimiter might otherwise appear public. Escaped delimiters retain ordinary literal-text semantics. Private comments, title metadata, outlines and synopses are not exposed in cards, choices or errors.

Returned data contains public text only, with frozen cards, context, scene and role records. The UI captures `source` and filename by value when opened, then discards the raw snapshot after preparation. Later editor changes do not change a running rehearsal. Closing clears the prepared project, visible text and progress; reopening prepares the current screenplay. This is a session view, not a recovery copy or export.

## UI contract

`mountRehearsal(host, {current: () => ({source, name})})` returns `open()` and `close()`.

- First open selects the first speaking role, all its scenes, and its first card, with the answer hidden.
- Hidden answers are absent from the DOM rather than placed in a visually hidden element. Reveal inserts the complete speech; Hide removes it again.
- Previous/Next, Restart, role changes, scene changes and filter changes reset the answer to hidden. Progress reports the card ordinal, total count, source line, scene and revealed/hidden state. It is navigation progress, not a correctness or memorization score.
- Role search chooses the first matching role. Scene search narrows the scene-choice list; the explicit **All scenes for this role** option continues to mean every cue for that role. Selecting a particular occurrence narrows the practice sequence. This distinction is stated beside the filters.
- Role and scene lists each show at most 100 matching entries (plus All scenes); text search reaches later entries. Labels are shortened to 120 UTF-16 characters, but selected card/context text is complete. The DOM contains one card, one context and at most one revealed speech, bounded by the input limit.
- Left/right arrows navigate only outside editable controls and selects. Modified or composing key events retain their normal behavior. Buttons work through native keyboard activation. Escape closes, including from a populated native search field. Close/Escape restores the opener and clears content. Queued close events cannot erase a newly reopened session.
- All screenplay text and filenames use text nodes. Context and answer regions are keyboard-focusable for independently scrollable presentation.

Root integration owns the command and styles: `.rehearsal-dialog`, `.rehearsal-filters`, `.rehearsal-card`, `.rehearsal-context`, `.rehearsal-answer`, `.rehearsal-navigation`. Long text must wrap; complete context/answer regions should scroll without clipping access. The host should provide a truthful filename and a synchronous current-source callback. There are no apply, download, persistence or network callbacks.

## Validation

Pure fixtures cover normalized cast grouping/extensions, complete and intentionally blank dialogue, preceding public context, duplicate scenes, private/title/outline exclusion, malformed/nested comments, escaped delimiters, both dual halves and unpaired chains, structural pairing boundaries, empty/parenthetical-only cues, complete long speeches, frozen data, source limits, BOM/mixed line endings, and 5,000 cues.

Isolated Chromium tests cover hidden-first behavior, reveal/reset/navigation, role/scene selection, immutable running snapshots, no local/session storage changes, keyboard/IME isolation, 100-option bounds with late-entry search, literal hostile text, malformed-comment errors, cancellation/focus, queued reopen and source callback failures. Physical mobile and assistive-technology acceptance require separate testing; this feature does not claim automated line accuracy or voice playback.

Mobile review refinement: Start rehearsing explicitly collapses setup and focuses the current
card. The role/scene controls remain available under Choose a role and scene; reopening them
does not change the current cue. Each fresh session opens setup again. A browser regression
covers this transition and keyboard navigation while focused on the card.
