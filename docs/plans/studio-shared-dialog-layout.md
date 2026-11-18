# Shared dialog layout

Eighteen tools now use the same dialog header: title on the left, the existing Close or Cancel action on the right. Existing controls are moved without recreating them, so callbacks, accessible names, disabled states and source protections stay attached.

Applied to portable backup, recovery library, storage health, FDX import/export, scoped replacement, character rename, scene numbering, scene cards, rehearsal, practice, file comparison, VoxDown adaptation, actor sides, breakdown, locations, line help and speech editing. Headers remain visible while the dialog scrolls. Shared styling provides consistent spacing, stacked field labels, fitting input widths, wrapping action rows and mobile-sized dismiss controls. Backup explicitly separates Save a backup from Open a backup. Apply/download actions use the existing primary treatment; preview and dismissal remain secondary.

The styling is scoped to opted-in dialogs. Workbench and Commands retain their own independently reviewed interaction layouts. Long compatibility/private-data explanations remain visible; this pass does not silently remove warnings or change export inclusion.

## Validation

- Native Chromium geometry tests open all eighteen real dialog implementations at 320, 768 and 1440px: no internal horizontal overflow, header title and dismiss control share a row without overlapping, visible form controls fit, and existing dismiss actions stay visible after scrolling and still close the dialog.
- Portable-backup grouping test checks distinct Save/Open sections and the private-notes disclosure.
- Existing FDX, import, replacement, recovery, numbering, storage-health and scene-card browser suites validate unchanged workflow behavior. Three test harnesses received data-URL import wiring for the new shared helper.
- Actual rendered backup dialog screenshots were inspected at desktop and mobile dimensions. Artifacts: `/tmp/studio-dialog-backup-desktop.png`, `/tmp/studio-dialog-backup-mobile.png`.

Root imports `dialog-layout.css` after the base dialog styles. Independent integrated review remains necessary; these geometry and behavior checks are not a subjective UI score.

## Follow-up copy and navigation review

Numbering, comparison, actor sides and breakdown foreground their choices and actions; longer mechanics remain in explicit disclosures. Private-data inclusion/exclusion warnings stay visible. Singular counts now read “1 cue”, “1 segment”, “1 speech” and “1 speech block”. A 320px regression confirms the numbering Preview action is reachable before y600 on the standard fixture. In the actual app at 320×900, the first action moved from the reviewer's y738 to y575 before the final field-spacing improvement.

Rehearsal's secondary keyboard/list explanation is a nested disclosure. Its setup test now selects the direct summary, preserving the original reopen-and-retain-cue assertion. Adaptation safety tests now select the Download button by its action text rather than DOM order (the first button is now Close), and delayed-worker cancellation tests wait for the actual held request before canceling it.

## Export review follow-up

VoxDown adaptation and FDX export now put a short ready summary and Download ahead of technical detail. The adaptation keeps its private-content exclusion, formatting/timing consequence and required dual-dialogue acknowledgment visible before download; the complete parser report, cast handles and captured filename are in an explicit disclosure. FDX keeps title/contact opt-in, layout/revision losses and source-specific conversion warnings visible; routine compatibility mechanics are expandable. Original source validation and disabled-download guards remain unchanged.

At 320×568 in the actual app with one scene and one speech, adaptation Download is at y412 (previous review y1789) and FDX Download at y416 (previous y1155). Both fit without scrolling through a report. Screenshots were inspected at 320×568 and 320×700: `/tmp/studio-export-adaptation-320x568.png`, `/tmp/studio-export-fdx-320x568.png` and matching `320x700` files. Native tests verify action visibility at both heights, disclosure access, visible privacy/conversion warnings and source-specific page-break loss reporting. Recovery's shared Close font now overrides the old 24px icon rule with the standard 16px text control.
