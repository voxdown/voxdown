# Success notice lifetime

Round 35 addresses a measured mobile Focus issue: the persistent Fountain-download success banner consumed 71px at 320px width after the writer resumed work. The change is limited to the lifetime of explicitly classified success feedback.

`createNoticePresenter(element)` in `site/src/studio/notice.ts` exposes:

- `show(message, lifetime = "important")`: present literal text, preserving the existing latest-message replacement model. Empty text explicitly clears the notice.
- `sourceEdited()`: synchronously clear only the currently displayed `"success"` notice. Attention messages remain until explicitly replaced or cleared.

The presenter retains a polite, atomic status region and never moves focus. It has no timer, queued clear, blur listener, or selection listener. A success message remains available until an actual accepted edit. An asynchronous completion arriving after an earlier edit remains visible until a subsequent edit. This does not prove announcement timing in VoiceOver/NVDA; that remains a manual check. An explicitly supplied newer notice can still replace the previous notice; this small change does not introduce a priority queue or infer severity from message wording.

## Main integration

Create one presenter for `#notice` before constructing the editor. Keep the existing `notice(message, lifetime = "important")` wrapper, forwarding to `show`. At the start of the `update.docChanged && !recovering` listener, call `sourceEdited()` synchronously. Do not call it from raw key/input events, selection updates, transaction filters, preference changes, or parsing callbacks. Rejected edits do not produce an accepted `docChanged`; their error must remain visible. Document replacement continues to clear/show its mixed-line-ending notice explicitly as it already does.

All current source-changing tool callbacks dispatch their edit before reporting its result. Preserve that order: the accepted edit clears older success feedback, then the tool's new result remains readable. Undo/redo are accepted source edits and clear an older success notice normally.

## Explicit classification

| Existing main message | Suggested lifetime |
| --- | --- |
| Fountain download started | success |
| PDF download started, explicitly describing its captured screenplay | success |
| Saved current revision to linked file | success |
| Saved an earlier revision; save newer edits again | important |
| Replaced matches; moved scene; updated synopsis; updated selected speech | success |
| Renamed character cues with no skipped cues | success |
| Rename result with skipped cues | important |
| Renamed scene locations, already reviewed in its preview | success |
| Numbered scene headings, with no skipped headings/warnings | success |
| Numbering result with skipped headings/warnings | important |
| Preferences could not persist; parse/worker/export/open/save failures; conflict/busy/cancelled save | important (default) |
| Source limit, malformed syntax, mixed line endings, rejected formatting/pairing and caret/page guidance | important (default) |

Library callbacks currently mix successful save/open/delete reports and errors through the same single-argument callback. Keep them important in this limited integration; do not classify by parsing strings. Backup and file-drop callbacks are errors and also remain important. Separate recovery/file status elements and parser diagnostics are outside the presenter and must not be cleared.

The seven presenter browser tests cover the success/error replacement sequence, tool-dispatch ordering, late asynchronous save completion, earlier-version warning, literal DOM text, polite status semantics, focus preservation, and explicit clearing. Four additional actual-app Chromium tests in `studio-notice-integration.test.ts` verify accepted typing clears download feedback, caret/preference changes do not, a 500,001-character rejected insertion preserves the original source and its error through a later accepted edit, a new rename success survives its own edit, and worker-failure/recovery controls remain visible in mobile Focus.
