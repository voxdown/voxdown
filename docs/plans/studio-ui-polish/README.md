# Studio UI and UX polish

2026-11-18. Local work only. This is a new polish cycle, separate from the prior feature rounds.

Target: independently reviewed UI and UX of 9.5/10, or up to 30 substantive rounds. Scores are expert judgments of inspected workflows, not user-study measurements. The independent reviewer does not implement the changes it reviews.

## Evidence and review loop

Baseline: [independent review](../studio-uiux-review-baseline.md), UI 6.2 / UX 7.1.
First integration: [independent review](../studio-uiux-review-pass-01.md), UI 8.2 / UX 8.1.
Second integration: [independent review](../studio-uiux-review-pass-02.md), UI 8.7 / UX 8.6 across the product.
Third integration: [independent review](../studio-uiux-review-pass-03.md), UI 9.2 / UX 9.1.
Final integration: [independent review](../studio-uiux-review-pass-04.md), **UI 9.5 / UX 9.5** for the reviewed browser workflows. The target was reached after 14 focused rounds across four independent integration reviews.

| Round | Concrete scope | Validation / follow-up |
|---|---|---|
| 1 | Workbench hierarchy, metrics, word target and result navigation | Actual phone/desktop renders, source-preserving browser tests; short speech wording corrected after review |
| 2 | Adjustable Scenes and preview panels, collapse, keyboard and pointer resizing | Native input tests, persistence/denied-storage/cancellation, independent source/undo check |
| 3 | File/View/Tools/Help menus and command registry reuse | Independent review found Tab navigation flaw; fixed in round 7 |
| 4 | Command search layout, filters and result scrolling | Phone results visible; ranking and keyboard tests; common file actions reordered after review |
| 5 | Preferences grouping and progressive help | Updated paper-size description; checkbox target/label geometry checks |
| 6 | Shared layout for recovery, backups, scene cards, file interchange and revision dialogs | Nine dialogs, responsive geometry and behavioral suites |
| 7 | Menu keyboard traversal, focus return, complete File/View groups and dark surfaces | Actual disclosure navigation; source and selection preserved |
| 8 | Compact desktop document bar and phone Focus layout | Rendered layouts at 1440/768/320; phone focused editor top ≤110px |
| 9 | Compact preview controls and contextual navigation | Dedicated preview actions disclosure; obvious Expand control; readable full-page mode |
| 10 | Secondary dialog consistency, overlay dismissal and integration regression checks | Eighteen tool dialogs share headers; tablet/phone overlay dismisses without stealing focus |
| 11 | Concise task introductions and accurate counts | Numbering, comparison, rehearsal, sides and breakdown; visible warnings retained |
| 12 | Fountain guide organized around a useful example | Practice first, expandable syntax/shortcuts/file explanations |
| 13 | Menu state, nested Escape priority and focus continuity | Four integrated browser tests, including Commands opened from a menu |
| 14 | Export summaries, compatibility disclosures and reachable downloads | Both primary downloads visible at 320×568; full details remain inspectable; actual downloads and mandatory acknowledgements independently verified |

## Acceptance

- Writing remains the dominant activity; routine controls are predictable and consistently placed.
- Real menus work with pointer, Tab, arrows and Escape and restore focus to visible controls.
- Panels resize and collapse without changing source, selection or undo history.
- Dialogs share header, labels, spacing, primary-action and responsive conventions.
- Phone/tablet/desktop, light/dark, long content and empty states are inspected visually.
- Exact source preservation, recovery, file operations, export and existing browser/accessibility/performance gates remain intact.
- No physical-device, screen-reader, native Final Draft or print acceptance is inferred from automation.

## Optional skills

Recommended, not installed: Anthropic frontend-design and Vercel web-design-guidelines. Their availability is not a prerequisite for this authorized local work.

## Final validation

- `pnpm check`: lint, all package typechecks, **2,931 tests in 137 files**, package builds passed.
- Site production build passed. Subsequent FDX singular-wording correction received the focused 29-test export suite and a fresh build.
- Production Chromium, Firefox and WPE WebKit integration gates passed.
- Accessibility gate passed all 47 states: no axe violations, touch-target/focus/reflow assertions passed.
- Direct file-save and offline gates passed earlier in this polish cycle; later changes were confined to presentation, disclosures and report wording.
- Native 1× performance: typing keydown-to-next-frame p95 15.5 ms; completion p95 78.5 ms; large adaptation maximum frame gap 16.8 ms with no main-thread long tasks.
- Menu regression checks include state announcements, dialog return focus, Commands opened from a menu, nested Escape priority and immediate viewport clamping.
- The final review's minor FDX singular-wording follow-up was corrected after review, without changing XML generation.

Changes remain local. Physical-device/assistive-technology sessions and native screenplay-app acceptance are separate from this browser review.
