# Independent UI/UX review: skills follow-up

Date: 2026-11-18. Independent Codex reviewer; implementation remained read-only. Applied the installed frontend-design and web-design-guidelines skills, including a fresh fetch of the [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Reviewed isolated Playwright sessions and opened their actual screenshots.

## Decision

**Final UI: 9.5/10. Final UX: 9.5/10 for the reviewed workspace and workflows.** No remaining material blocker was reproduced in this pass. These are bounded expert judgments about visual hierarchy and task usability, not scores derived from test totals or evidence of universal production readiness.

The fresh review initially scored **UI 9.2/10 and UX 8.8/10**, rather than preserving the previous 9.5 scores. Backward keyboard navigation exposed focused controls hidden behind sticky dialog titles; landscape layouts also devoted too much height to chrome. The earlier review had missed those cases. Fixes were accepted only after independent interaction and visual checks.

## Findings resolved

- `site/src/studio/dialog-layout.ts:20` — shared focus visibility now measures the actual wrapped header, observes dialog/header resizing and reveals focused controls at either edge. Initial top-only handling still failed when shrinking the viewport around a focused lower field; the revised implementation passes that case.
- `site/src/studio/shell.css:645` — compact short-height chrome preserves menus, Commands, filename and element selection while returning useful height to writing. Focus mode retains an explicit exit.
- `site/src/studio/shell.css:709` — short phone preview removes redundant document controls, hint and footer. The initial landscape integration left only a few pixels of page visible; the final version provides 118px of scrollable preview at 320×256 and 162px at 320×300, with 44px navigation targets.
- `site/src/studio/main.ts:1240` — Escape returns mobile preview to writing and restores editor focus. Open menus and dialogs consume their own Escape first.
- `site/src/studio/main.ts:138` — the empty editor now explains how to begin, open a file or find the sample. The previous screenplay-shaped placeholder could be mistaken for an existing document; it was never actual source content.
- `site/src/studio/panels.css:19` — restrained visible divider grips make existing resizable panels easier to discover without crowding the screenplay.

## Independent verification

- Repeated forward/backward keyboard traversal through Preferences, Rename, Scoped replace, Actor sides, Rehearsal and Breakdown at 1440×900, 320×568, 844×390 and 375×300. No remaining covered-control records in the focused traversal probe.
- Chromium and Firefox: five dialogs across four viewport changes, 40 focused-field resize states. No focused field above its title, below its dialog, or covered at its center; source stayed unchanged. The parent separately reported 20 passing WebKit states; those are supporting evidence, not my independent browser run.
- Actual writing, View preview toggling and Focus/Exit at 320×256, 320×300, 667×375, 844×390 and ordinary 375×700 portrait. Exact source preserved; no body overflow. At 320×256 the normal editor is 83px high and Focus provides 131px. This is constrained but usable rather than an oversized offscreen editor.
- At 320×256, edited both ends of a 100-paragraph document using native caret scrolling, then downloaded Fountain. Downloaded bytes matched the complete expected source exactly.
- Light/dark 320×256: Preview actions and View menu each dismiss on the first Escape; the second returns to writing with editor focus. Preferences Escape closes only the dialog while retaining preview. An expanded Preferences disclosure stays visible and hit-testable below its wrapped title after Tab/Shift+Tab.
- Inspected the final compact preview, landscape writing, dark disclosure and desktop empty-state screenshots. The quiet application chrome, screenplay typography, clear actions and consistent controls remain coherent.

## Evidence and limits

Temporary review artifacts: `/tmp/studio-skill-focus-audit.mjs`, `/tmp/studio-focus-recheck.mjs`, `/tmp/studio-focus-resize-fixed.log`, `/tmp/studio-landscape-review.mjs`, `/tmp/studio-reflow-review.mjs`, `/tmp/studio-reflow-edit.mjs`, `/tmp/studio-final-escape-review.mjs`; screenshots include `/tmp/studio-final-short-{light,dark}.png`, `/tmp/studio-final-disclosure-{light,dark}.png` and `/tmp/studio-landscape-after-*.png`.

This pass supplements the earlier shell, panel, menu and export reviews; it does not independently rerun every export conversion. Physical iPhone keyboards/browser chrome, Brave Shields, screen-reader sessions and studies with working screenwriters remain outside this verification. The responsive viewport tests must not be represented as physical-device certification. No implementation edits or publication were performed by this reviewer.
