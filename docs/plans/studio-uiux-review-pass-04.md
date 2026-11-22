# Independent UI/UX review: fourth polish integration

Date: 2026-11-18. Separate Codex reviewer; no implementation changes. Reused the preceding actual-rendered workspace review and independently tested the changed export flows at1440×900 and320×568 in light/dark appearances.

## Decision

**UI9.5/10; UX9.5/10 for the reviewed browser workspace and task flows.** The material findings from the earlier reviews are resolved. This is an independent expert judgement based on visual hierarchy and real interactions, not a score inferred from test counts, a user-study result or a claim of physical-device certification.

The shell now has a coherent hierarchy: application menus, document identity and common actions, local writing tools, and independently managed panels. The scene and preview controls are discoverable, resizable/collapsible, keyboard operable and stable around writing. Shared dialog headers, fields, spacing, disclosures and primary actions give the tools a consistent language. Export tasks now present the decision and consequences before optional technical detail.

## Final changed-flow verification

- On320×568, Adaptation's download starts aroundy412 and FDX's aroundy416; both are visible in the initial dialog. Desktop versions are compact and readable rather than report-heavy.
- Light and dark screenshots were opened and visually inspected. Primary actions, boundaries, type hierarchy and secondary disclosures remain clear in both.
- Full compatibility/adaptation reports remain available. Generated VoxDown text can be expanded and is read-only.
- Close remained visible and hit-testable after expanding details and scrolling to the bottom.
- Actual downloaded FDX XML parsed successfully. With title fields selected, author/contact appeared; after deselection they did not. Private notes were excluded in both cases.
- Actual downloaded VoxDown excluded private notes and author/contact. The complete generated preview matched downloaded text; the core parser returned zero warnings for the independently checked fixture.
- Overlapping dialogue disabled adaptation download until explicit acknowledgement. Changing the scene-heading option reset acknowledgement and disabled downloading again. The acknowledged download retained both speeches.
- The exact editor text was unchanged after ordinary export/disclosure/download flows. Escape returned focus to Commands, the visible opener in these tests.
- Source-specific FDX conversion warnings stayed visible outside the collapsed details section.
- Recovery's Close label now computes to16px, consistent with other dialogs.

## Minor follow-up

A warning-specific fixture exposed two remaining copy nits: “1 unrecognized title-page fields omitted” and “1 centered lines exported as centered Action.” These should use the shared pluralization helper. They do not prevent understanding or completing the task and do not constitute a material UI/UX blocker.

## Evidence

- `/tmp/studio-ux-pass4-{1440,320}-{light,dark}-{adaptation,fdx}.png`
- `/tmp/studio-ux-export-review.mjs` and `/tmp/studio-ux-export-review.log`
- `/tmp/studio-ux-final-details.mjs` (visible warnings, generated/download text equality, zero parser warnings and recovery font check)
- Earlier reviewed shell/panel/dialog evidence remains in `studio-uiux-review-pass-03.md` and its referenced artifacts.

The score applies to the reviewed implementation and flows. Physical iPhone/Brave, assistive-technology sessions, native application acceptance and studies with working screenwriters remain distinct validation activities; this review does not represent them as completed.
