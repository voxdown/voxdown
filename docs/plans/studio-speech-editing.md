# Focused speech editing

Studio can open one complete character speech in a focused Fountain textarea. The selected source includes dialogue, parentheticals, lyrics, and contiguous completed notes or boneyards. The dialog explicitly discloses that private text is visible because this is a source-editing view. It does not copy a rendered excerpt back into the screenplay.

## Integration

```ts
const speechEditor = mountSpeechEditor(document.body, {
  current: () => ({ source: view.state.doc.toString(), id: draftId }),
  apply: (snapshot, plan) => {
    if (snapshot.id !== draftId || snapshot.source !== view.state.doc.toString()) return false;
    // Also reject while recovering/replacing a document.
    view.dispatch({ changes: plan.changes, annotations: isolateHistory.of("full") });
    return true;
  },
});
speechEditor.open(cueLine); // One-based character-cue source line.
```

The integration supplies normalized editor text. Both dialog and integration must check the exact source and document ID at application time. Apply is synchronous: return false without mutating if the snapshot is stale. Dispatch all changes as one isolated history event for one-step undo. The dialog has `.studio-speech-editor` for application styling, a named textarea, native modal keyboard behavior and an accessible status paragraph. Closing discards its private working copy; a queued close event cannot clear a newly opened speech.

`selectSpeech(source, cueLine)` returns the exact selected body and original UTF-16 range. `planSpeechEdit(source, cueLine, replacement)` returns an atomic source change and candidate. Pure functions also preserve BOM and mixed line endings outside the replacement. The main editor's existing mixed-line-ending policy still applies when it serializes edits.

## Boundary and safety rules

- The cue, its extensions/dual marker and newline remain outside the editable range. The body ends at the first ordinary blank or non-speech element. Contiguous private passages before that boundary belong to the selected body; this includes a trailing note immediately after its speech.
- Existing malformed comments refuse focused editing. A completed omission crossing either selection boundary also refuses it. The user can repair such source directly in the screenplay.
- The candidate is parsed before Apply. Internal elements must remain dialogue, parenthetical, lyric or completed omissions. Structural directives and ordinary blank lines are refused with guidance to use a two-space intentional blank dialogue line.
- The cue and all outside element roles/text/positions are compared against the original, accounting for the replacement length. Outside omission kind, ranges and exact source bytes must remain unchanged. Internal private comments may be deliberately added, changed or removed; they may not extend outside the speech.
- A missing, empty or private-only speech is not edited here. Remove a speech or change screenplay structure in the main editor. Focused bodies and replacement text are limited to 50,000 UTF-16 characters; full-document limits still apply.
- Validation errors, cancellation and stale snapshots do not mutate source. Failed application leaves the proposed textarea text available and does not claim a successful save.

## Evidence

35 planner cases cover exact cue/body/source preservation, internal note changes, external omission preservation, EOF, BOM/mixed newlines, uppercase dialogue, two-space blank lines, structural injection refusal, malformed/cross-boundary comments, invalid selection, size/binary limits, no-op behavior and atomic undo. Nine isolated Chromium dialog cases exercise preview invalidation, stale source/ID guards, refused/failed application, Escape focus return/private-copy clearing, queued close/reopen safety and unavailable speech guidance. These do not replace real IME/dictation or screen-reader acceptance.
