# Guided Fountain practice

Round 19 adds a separate, session-only learning dialog. It teaches six small concepts through editable text: a scene heading, action, a character and speech, a parenthetical, a completed private note, and optional dual dialogue. It does not inspect, edit, save or export the writer's real screenplay.

## Learning model

Each lesson provides a short instruction, a compact example and an editable scratchpad. The scratchpad starts with only the surrounding structure the exercise needs. The existing Fountain parser assesses the resulting structure, not exact wording. Writers can choose their own locations, names and sentences. A completed example also demonstrates a valid answer when the writer explicitly chooses Replace practice with example.

Feedback identifies the element or explains the next syntax step. It never auto-advances. Next becomes available after the lesson's structure is present; Back retains each lesson's work within the open session. Reset replaces only the current lesson with its starter. The dual-dialogue lesson is optional and offers an explicit skip to the closing screen. Completion offers Return to writing and, if the host supplies it, Open a sample screenplay. These callbacks run only after their own button click and after the practice dialog closes; the host retains responsibility for its existing safe sample-opening flow.

The interpretation preview shows up to 12 elements, with a maximum of 200 characters each, as literal text with element labels. It is not a page layout or export. Completed comments are absent from it. Unfinished or nested comments withhold the preview and show repair guidance, avoiding a misleading lesson that apparently private text is safe to share. The notes lesson explicitly explains that sharing a Fountain file also shares its notes. The dual lesson identifies the second cue and explains that the editor's Page preview supplies the actual two-column layout.

## Isolation and accessibility

`assessPractice(lesson, source)` and `PRACTICE_LESSONS` are pure data/assessment APIs. Input is bounded to 5,000 UTF-16 characters; over-limit programmatic input returns guidance without parsing. The dialog retains at most six such scratchpads in memory. It has no editor, storage, file, export, upload, fetch or service dependency.

`mountLearning(host, { returnToWriting?, openExample? })` exposes `open()` and `close()`. Close/Escape immediately clear all practice text, restore the opener's focus, and start a new lesson-one session on the next open. A queued close event cannot clear a reopened session. The UI clearly states that practice is cleared on close. No progress or practice text is persisted.

The dialog has a named heading, a labeled textarea with instructions and limits, native buttons, an example disclosure, explicit progress text, and polite status feedback. Feedback updates do not move focus or the caret. Composition input is assessed after compositionend, so incomplete IME text does not advance or change lessons. Native textarea keyboard behavior remains intact; there are no extra keyboard shortcuts to learn. The completion heading receives focus after the explicit Finish action.

Styling hooks for integration: `.studio-learning`, `.learning-input`, `.learning-example`, `.learning-preview` (a definition list), `.learning-feedback[data-state]`. Hidden lesson/completion sections must retain native `[hidden]` behavior. The host provides responsive wrapping and adequate touch targets.

## Validation

Pure tests check every example and starter, alternative words and Unicode names, structural false positives, parenthetical placement, completed/nonempty notes, nested/malformed comments, linked dual speeches, input/preview bounds and literal hostile markup. Browser tests cover live non-advancing feedback, Back/Reset preservation, private preview omission, IME, completion/optional skip, explicit callbacks, Escape/reopen, unchanged real-draft sentinels and unchanged storage.

This is an introduction, not a full Fountain course or a proficiency score. The existing contextual coach and syntax guide remain useful for details such as title pages, lyrics, outlines and export limitations.
