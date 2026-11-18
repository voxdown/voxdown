# Workbench result browsing

Round38 removes an access gap in Characters, Private notes and Source diagnostics: previously
only the first100 matches were rendered, so later entries required knowing search text that
would isolate them. Previous/Next100 controls now reach every result with at most100 rows
in the DOM. Counts show the current range. Each new page focuses its first result; character
paging focuses the character summary, not the global Rename action.

Filtering, changing view, reopening and receiving a new parsed document reset to the first
page. No source edits, persistence, exports or unbounded result rendering are introduced.
Character speeches retain their separate25-cue pagination. Search offsets are bounded to
nonnegative safe integers; nonfinite limits retain the existing safe100 default.

Two actual-app regressions verify205 private notes and103 characters, including final pages,
filter/reset behavior, result focus, narrow layout and byte-exact BOM/CRLF source download.
An independent reviewer traversed201 characters, notes and diagnostics at320px, verified the
last diagnostic's actual source line, and found no axe violations, overflow or JavaScript
errors. Native populated search inputs may consume Escape to clear their value; the explicit
Close button remains available and is used when a test intends to close that dialog.
