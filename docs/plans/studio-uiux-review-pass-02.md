# Independent UI/UX review: second polish integration

Date: 2026-11-18. Separate Codex reviewer; no implementation edits. Actual dev-app interactions and directly inspected screenshots at1440,1101,768,375,320 CSS pixels, light/dark. This review was made while the implementation continued; fixes reported after captures are explicitly distinguished.

## Judgement

Main workspace: approximately **UI9.0/10, UX9.0/10**. Product-wide at the captured state: **UI8.7/10, UX8.6/10**. The remaining gap is mostly consistent secondary-dialog presentation and small but real navigation/state details. The requested9.5 threshold is not yet supported across the product.

## Verified improvements

- Desktop document controls fit a single row, leaving significantly more writing height.
- Mobile Focus is visible again. Ordinary phone editor begins around254px rather than292px in the previous integration.
- File includes PDF; View includes Focus and panel controls.
- File click focuses the first item; Tab reaches Open, ShiftTab from the first item returns File, and Tab from the last item reaches View.
- Preferences description no longer incorrectly claims Paper size cannot affect printed pages.
- Workbench reports short speech as less than one minute.
- Desktop collapse, keyboard/pointer sizing and mobile scene Escape remain functional.
- No source changes or JavaScript page errors occurred in the width/theme/menu matrix.
- Numbering, scene cards and scoped replace have recognizable header/close structure and larger coherent fields.

## Remaining concrete work

1. **Preview action-menu keyboard exit:** opening the preview ellipsis, pressing End then Tab focused File at the top-left of the workspace. The preview trigger is outside the top-level navigation list, so its menu must exit locally rather than falling through to the first global menu.
2. **View toggle state:** Focus writing, Scenes panel, Preview panel and Toggle live margins expose no checked/pressed state and no show/hide wording. Users cannot read the current state from the menu; Focus writing also continues to say the same thing while focused.
3. **Finish secondary-dialog consistency:** at capture time Actor sides and Rehearsal still placed Close beneath the title; Adaptation, Breakdown and Compare placed Close below long content. The implementation agent is now migrating these. Rename's latest DOM confirms its header Cancel button is present and clickable; an earlier capture was superseded and is not a retained blocker.
4. **Reduce technical prose before action:** Number scenes on320 puts its preview action aroundy738 after lengthy explanation/status text. Compare foregrounds normalization and excerpt limits before file choice; Adaptation fills a phone viewport with validation prose. Keep the essential consequence explicit and concise, with calculation/interchange detail available on demand.
5. **Finish count grammar:** observed “1 speeches,” “1 speech blocks,” “1 cues,” and “1 segments” in breakdown/rehearsal/sides. These are small but visible polish defects.
6. **Dark resting controls:** captured dark menus still had filled rounded item surfaces inconsistent with light. Root subsequently identified specificity and changed the selector; the new styling needs a fresh screenshot confirmation before calling this closed.

The tablet fit-to-page preview remains a small overview, but the much shorter toolbar and prominent Expand make that a defensible design. It is not by itself a release blocker if the control behaves reliably and the view is presented as a page overview.

## Evidence

- `/tmp/studio-ux-pass2-{1440,1101,768,375,320}-{light,dark}-{main,file,view,tools,statistics,preferences}.png`
- `/tmp/studio-ux-pass2-{1440,320}-{Scene-cards,Number-scenes,Actor-sides-PDF,Adapt-screenplay,Scene-and-cast-breakdown,Rehearsal-cue-cards,Compare-with-local,Scoped-find-and-replace,Rename-a-character}.png`
- `/tmp/studio-ux-integration2.log`
- `/tmp/studio-ux-keyboard3.mjs`

No physical-device or screen-reader validation is claimed. Further score movement should follow actual rendered rechecks, not test-count increases.
