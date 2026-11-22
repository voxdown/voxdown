# Scoped literal find and replace

This revision tool complements the editor's existing Ctrl/Command-F search. It prepares a preview of literal source replacements in one chosen scope: printable screenplay, current scene, dialogue, action, or the text selection captured when the dialog opens. It does not run a search on each keystroke.

## Integration

```ts
const replace = mountScopedReplace(document.body, {
  current: () => ({
    source: view.state.doc.toString(),
    id: draftId,
    position: view.state.selection.main.head,
    selection: { from: view.state.selection.main.from, to: view.state.selection.main.to },
  }),
  apply: (snapshot, plan) => {
    if (snapshot.id !== draftId || snapshot.source !== view.state.doc.toString()) return false;
    // Also refuse during recovery/replacement. Dispatch as one isolated history event.
    view.dispatch({ changes: plan.changes, annotations: isolateHistory.of("full") });
    return true;
  },
});
replace.open();
```

The dialog checks document identity and exact source before preview and application. It copies the opening selection rather than retaining mutable editor-selection references. Moving the caret does not change the approved search scope. Closing and reopening captures a new scene/selection. Every search control invalidates an existing preview. Cancel and Escape discard preview/search text; a delayed close event cannot clear a newly reopened dialog.

Styling hooks: `.studio-scoped-replace`, `.replace-preview`, and ordinary labeled input/select/checkbox controls. Preview contains at most 50 list rows with bounded, text-only snippets. The integration owns surrounding mobile layout and editor focus restoration after applying.

## Search and safety rules

- Search is literal, not a regular-expression UI. Regular-expression metacharacters and replacement dollar signs are ordinary text. Internal regex construction escapes all search syntax and uses Unicode matching to keep original offsets correct under case-insensitive search.
- Case matching defaults on. Whole words use Unicode letters, combining marks, numbers and underscores as word constituents. Apostrophes and hyphens are boundaries. Same-line private omissions do not split a visible word into separately replaceable whole words; physical newlines still separate words.
- Matching never crosses a physical source line or a private omission. Notes, boneyards, title fields, outline sections and synopses are always excluded, including within a selection. Preview context is taken only from the visible source segment, so excluded private text does not leak into snippets.
- Dialogue scope means parsed dialogue lines; it excludes lyrics, parentheticals and cues. Action scope means parsed action elements. Current scene begins at its heading and ends at the next heading or section boundary. Front matter or a new section before its first scene has no current-scene scope.
- An empty replacement is allowed. Queries are limited to 1,000 characters and replacements to 2,000 characters. Line breaks, NUL and unpaired Unicode surrogates are refused. Matches are nonoverlapping. More than 10,000 matches rejects the entire plan, including no-op matches; no partial replacement is silently prepared. Candidate size is checked before allocating expanded text.
- Every candidate is reparsed. Element kinds, dual-dialogue flags, section levels and scene numbers must remain unchanged. Unchanged lines retain their interpreted text. Every existing private omission must retain its kind, mapped bounds and exact source bytes; new omissions or malformed comments refuse the plan.
- Role-changing or structural rewrites belong in the main screenplay editor. Failed validation leaves the source intact. Apply must dispatch all changes atomically to support one-step undo.

## Evidence

42 engine cases cover every scope, private/title/outline exclusion, snippet privacy, case folding and supplementary Unicode offsets, whole-word boundaries, literal metacharacters, mixed newline/BOM preservation, structural/omission protection, invalid source/selection, bounds, total-versus-preview counts and atomic undo. Nine isolated Chromium dialog cases exercise on-demand preview, every control's invalidation, stale identity/source refusal, copied selection ranges, errors, bounded rows, callback failures, Escape/focus cleanup and queued close/reopen safety. Physical-device keyboard/IME and screen-reader acceptance remain separate release gates.
