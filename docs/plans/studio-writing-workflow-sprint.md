# Studio writing workflow sprint

Goal: complete five connected writing exercises, keeping Fountain authoritative and
Writer's quiet workspace familiar. Changes remain local until publication is authorized.

## Design intent

Use the existing Writer-family tokens: white paper (#ffffff), grey desk (#e7eaee),
dark ink (#25282d), muted text (#667085), teal accent (#256166), pale border (#d4dae3).
Respect all six appearance presets rather than hardcoding these defaults. Keep the
existing Literata/Recursive interface and Courier Prime manuscript. The editable
sheet stays central; scene context belongs below the outline and page/zoom controls
belong in the status bar. No new dashboard, card grid, or competing toolbar.

## Milestones and exercises

1. **Writing flow:** write scene/action/two-role dialogue, add a paired parenthetical,
   use Enter/Tab/Shift+Enter, correct a guess, and undo. Existing source and private
   passages must not be silently reinterpreted.
2. **Manuscript navigation:** identify the current element, change writing zoom,
   jump to a printed page, and return to source without changing export geometry.
   Live source margins remain distinct from exact paginated preview.
3. **Connected revision:** move the caret between scenes, inspect/edit the current
   synopsis, navigate adjacent scenes, and undo a synopsis edit. An outdated panel
   must never write into another scene or document.
4. **Return to work:** reopen a recent browser draft and return to its caret/scroll
   position. Original recovery copies remain intact. Storage failure must be safe.
5. **Performance preparation:** select a role in the current scene, open rehearsal
   already scoped to it, return to the speech for revision, and prepare that role's
   actor sides. Private notes stay excluded from performance output.

## Acceptance

Exercise the integrated paths in a real browser and independently review them.
Run targeted source/privacy/undo tests, typecheck/lint, production build, accessibility,
file/offline checks and the existing typing performance budget. Fix findings before
calling the sprint complete. Do not assign a numerical best-in-class score without
user evidence; report the actual delivered behavior and remaining limitations.

## Delivered

- Screenplay keys now handle action/transition paragraphs, paired parentheticals,
  contextual Tab and Shift+Enter. Tab accepts an active completion. Pending
  autocomplete no longer changes Enter behavior during fast typing. These remain
  opt-in under Preferences; Help describes the exact behavior.
- The toolbar names the current parsed element. The status bar offers writing zoom
  and direct printed-page navigation; Edit → Go to page works at narrow widths.
  Page lookup is indexed once per layout, so caret movement does not scan pages.
- The scene inspector follows the caret, supports private synopsis edits with one
  undo step, adjacent-scene navigation and role selection. The scene list scrolls
  independently; the inspector collapses, and short screens retain a scrolling
  fallback. Inspector indexing reuses the worker's current parse.
- File → Recent drafts reads bounded metadata pages and opens a protected working
  copy only after preserving current work. Caret, selection and visible passage
  restore across reopening/reload. View state is bounded and contains no source;
  stale async operations and unavailable/corrupt storage fail safely.
- Current-scene role selection carries into scoped rehearsal or actor sides.
  Rehearsal can return to the original speech for editing or continue to the same
  role's actor sides. Snapshot source and draft identity guard those handoffs.

## Independent review and fixes

A separate Codex reviewer exercised physical keyboard input and the connected paths
in Chromium at desktop, 390px phone width and a short viewport. Findings fixed and
rechecked: inspector hidden below long scene lists, mobile sidebar visibility and
layout overrides, touch target size, and draft identity checks on rehearsal exits.
No unresolved blocking finding remained in that review. This is not a substitute
for physical iPhone or practicing-screenwriter evaluation, and no numeric quality
score is claimed.

Full regression testing additionally exposed pixel-only restoration moving a long
passage as CodeMirror refined offscreen height estimates. Restoration now records
a visible source anchor and its viewport offset, waits for current live margins,
and measures after the initial scroll target settles. New browser coverage checks
that the same passage returns to the same visible position, rather than requiring
an internal estimated scrollbar coordinate to remain identical.

Existing production checks now scope synopsis actions to the scene-board dialog,
so they cannot accidentally target the new inspector behind the modal. An existing
file-open regression test now waits for the new filename before checking its parse
warnings, rather than accepting the previous document's ready state.

## Deliberate boundaries

The editor remains source-based with live margins. Exact pagination stays in page
preview/export; a printed page beginning inside a long source paragraph navigates
to that paragraph's start. Recent drafts are browser recovery copies, not a promise
of persistent filesystem permission or automatic background disk saving. Rehearsal
is a local cue-card exercise, not generated audio or recording. Studio stays
experimental, and Writer remains the recommended VoxDown editor.

## Final validation

- `pnpm check`: lint, all workspace typechecks, **3,004 tests in 151 files**, and
  package builds passed.
- `pnpm site:build`: production build passed.
- `check-studio.mjs`: production workflows passed in Chromium, Firefox and WPE WebKit.
- `check-studio-accessibility.mjs`: **103 audited states**, zero axe violations;
  keyboard, focus, mobile targets, reduced motion and reflow checks passed.
- `check-studio-files.mjs`: exact bytes, external conflict, cancellation, quota,
  replacement race and unsupported-browser download fallback passed.
- `check-studio-offline.mjs`: root/subpath offline editing, adaptation/PDF, eviction,
  corrupt-font repair and cache update/fallback checks passed.
- `check-studio-performance.mjs`: unchanged budgets passed. Sustained typing p95
  **15.5 ms** keydown-to-next-frame; typing across worker updates p95 **13.9 ms**.
  Both exercises observed zero long tasks. CodeMirror rendered 62 lines in the
  large-document check; outline/character/note/snapshot rendering remained bounded.
  These are desktop Chromium measurements, not a physical-mobile benchmark.

All work remains local; no publication or push was performed.
