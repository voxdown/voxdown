# Expanded screenplay preview

Round 34 addresses the small page text in the tablet split view. At 768px, the editor and
preview each receive roughly half the workspace. Full size permits reading but requires
horizontal panning. Expand preview gives the existing page the workspace width without
changing the screenplay, pagination, PDF output or editor settings.

The page controls offer Expand preview above 700px. While expanded, the same button says
Return to writing. It and Escape restore the writing layout and focus the editor. Editor
selection is never dispatched or replaced, so the current caret and selection stay intact.
The controller temporarily makes the hidden writing and outline regions inert and restores
their previous inert values. Existing outline-open, no-preview, mobile-preview and focus
preferences are not rewritten or persisted. Escape respects composing input, an already
handled event, a locked workspace and open dialogs.

The mobile layout already gives preview the workspace width; its expand button is hidden.
Crossing into that breakpoint exits expansion without stealing focus. The existing mobile
Preview / reference or Back to writing control continues to choose the visible pane.
Switching to Text reference also restores split layout without stealing reference focus:
the controller observes its containing tabpanel so it cannot leave the return button hidden.

## Integration contract

Mount `mountPreviewSpace({app, preview, writing, outline, button}, () => view.focus())` once
after constructing the editor and mounting the reference tabs. Add `#expand-preview` in
`.page-controls` with `type=button`.
It is not a fullscreen browser API and needs no permission, storage or worker operation.

Before an action navigates to the source, changes Focus/preview/outline visibility or replaces
the current document, call `previewSpace.restore(false)`. This ensures Go to source can
choose its new caret without being overridden by a stale selection or focus restoration.
The controller refuses expansion while the workspace is inert, preview is hidden, writing
Focus is active, preview is disabled or the control is disabled. Expansion itself does not
parse, render or resize page coordinates; the existing container-based page text scales.

CSS integration should use `.preview-expanded` to set the workspace to one
`minmax(0, 1fr)` column and hide `.writing` and `#outline`, including the outline-open
overlay. Center `#page` at `width: 100%; max-width: var(--full-width, 816px)` within the
expanded preview. This temporary override must apply to `.full-size` too: tablet width fits
without panning, wide screens stop at the natural paper width, and the existing Full size
choice automatically resumes when returning to the split view. Page controls must wrap so
the new control cannot make the narrow split preview overflow.

Focused Chromium DOM tests cover temporary state restoration, exact text/selection, keyboard
return, dialogs and composing events, inert/hidden/Focus guards, responsive exit, reference
tab focus and listener cleanup. A geometry regression uses the actual Studio stylesheet.

Integrated live Chromium verification at 768px enlarged the page from 315.875px to 731px,
and its text from 6.19px to 14.33px, with no horizontal scrolling. At 1280px, the paper caps
at 816px and text at 16px. The expanded view had zero axe WCAG 2/2.1 A/AA violations.
The check retained an actual CodeMirror selection, restored outline-open and Full size,
kept reference-tab focus, exited on Go to source/Focus/mobile resize, and downloaded the
exact original BOM/mixed-newline/private-note source afterward. Reproduction:
`/tmp/voxdown-studio/preview-space-live.mjs` (local investigation artifact).
This is a view convenience, not a claim that physical tablet or iPhone rendering has been
certified.
