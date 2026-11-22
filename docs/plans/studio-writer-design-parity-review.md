# Independent review: Studio alongside Writer

Date: 2026-11-18. Independent Codex reviewer. No implementation edits; this report and screenshot evidence are the only repository changes from the reviewer. No numerical score is assigned.

## Judgment

The reviewed Studio workspace now looks like a deliberate Writer sibling. The shared wordmark, interface typography, neutral desk and paper, compact application frame, quiet panel controls and consistent dialogs establish visual maturity comparable to Writer in these screens. The screenplay is now the visual center. The earlier Studio did not meet that comparison, despite its previous review scores and passing functional tests.

This conclusion comes from actual side-by-side application captures and writing tasks, rather than test totals. No remaining material mismatch with the Writer visual reference was found in the final inspected states. This is a bounded design judgment, not a claim that every workflow or physical device is certified, or that Studio has Writer's feature set.

## Reference and changes

Writer was opened with **The Dragon Who Would Not Roar**; Studio imported the repository's **The Lighthouse** Fountain screenplay. Both were captured at equal 1440×900, 1024×768 and 375×812 viewports in light and dark appearances. Writer's actual `style.css`, `writer.css` and markup were read. The installed frontend-design and web-design-guidelines skills informed the review, including a fresh fetch of the [interface guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

| Area | Earlier Studio | Final reviewed result |
| --- | --- | --- |
| Identity | System-font wordmark and green surfaces differed from Writer | Writer logo, Literata wordmark, Recursive interface type and neutral light/dark surfaces |
| Frame | Separate header, document controls and local formatting header competed for space | Document identity and Save share the application row; one grouped toolbar below |
| Writing | Editor appeared as an unbounded middle column while preview carried the only page boundary | Bounded editable manuscript on a desk; preview optional by default; screenplay Courier retained |
| Panels | Duplicate preview heading, boxed controls and onboarding copy persisted beside populated scenes | Clear tabs, quieter navigation/close controls, restrained scene list, relevant populated-state content |
| Tools | Green dark dialogs and inconsistent form/control treatment | Neutral surfaces, modest serif titles, aligned statistics, common action/disclosure rhythm |
| Phone | Lighthouse began writing around y307 after stacked controls and a permanent notice | Paper begins at y152; logo and menus retained, Save beside filename, deliberate reduced toolbar |
| Informational notes | Ordinary metadata omission consumed a full-width message band | Compact layout-note control opens complete details; parser warnings/errors retain their banner |

The first integration was not accepted unchanged. Review found residual green dark controls, an outlined rather than filled Save button, a missing phone logo, clipped mobile toolbar controls, a detached checkbox label, redundant pane copy and excessive space consumed by a layout notice. Those were revised and the actual screens were recaptured. The final Preferences select was also rechecked after it became full-width on phones; its selected value is now readable at 320px.

## Inspectable comparisons

- Desktop reference: [Writer light](studio-ui-polish/parity-screens/writer-desktop-light.png), [Writer dark](studio-ui-polish/parity-screens/writer-desktop-dark.png).
- Studio desktop: [before](studio-ui-polish/parity-screens/studio-before-desktop-light.png), [final light](studio-ui-polish/parity-screens/studio-desktop-light.png), [final dark](studio-ui-polish/parity-screens/studio-desktop-dark.png).
- Phone comparison: [Writer](studio-ui-polish/parity-screens/writer-phone-light.png), [Studio](studio-ui-polish/parity-screens/studio-phone-light.png).
- Supporting views: [phone workbench](studio-ui-polish/parity-screens/studio-workbench-phone.png), [phone Preferences](studio-ui-polish/parity-screens/studio-preferences-phone-dark.png), [320×256 preview](studio-ui-polish/parity-screens/studio-short-preview.png).

Writer was recaptured after the shared theme extraction and remained visually consistent with its baseline. Studio's deliberate differences remain appropriate: monospaced screenplay text and Fountain metadata, scene-oriented navigation, and a print-layout preview rather than Writer's prose/script rendering.

## Interaction and responsive evidence

Independent Chromium and Firefox tasks used real pointer and keyboard input: import Lighthouse, type additional prose, toolbar Undo/Redo, retain a text selection through panel changes, apply Bold, undo it, switch File to View by mouse hover, dismiss with Escape and download the complete Fountain source. Actual downloaded bytes were compared, avoiding assumptions about CodeMirror's virtualized DOM. These checks passed.

The responsive review included empty and populated writing, Preferences and workbench captures at 1440×900, 1024×768, 375×812, 667×375 and 320×256 in light/dark. Representative captures were opened and visually inspected; auxiliary desktop panes, reference, Commands and FDX export were inspected separately. The inspected layouts had no horizontal body overflow. With both desktop panes open at 1440, the editable sheet remained 592px wide; with preview beside writing at 1024 it was about 508px. Default writing retained an 816px sheet where room permitted.

At 320×256, the final populated writing area is 134px high in both ordinary and Focus modes, and the preview scroll region is 121px, improving the earlier 65px preview strip caused by the informational banner. This is a constrained fallback, not a claim that such a small viewport is an ideal writing environment. The layout-note dialog retained the full message and Escape returned focus to its footer opener at ordinary sizes. At short heights the footer note action is hidden to preserve writing space; Commands → Review layout notes remains available and closes back into Focus without changing that mode. An independent final Chromium/Firefox recheck confirmed this behavior. Repeated resize passes through 1100/1101px, including preview and collapsed-outline states, produced no captured animation frame with a compressed or overflowing manuscript. Simulating a pending hidden outline handle still left a 592px editor at 1440px.

Final geometry probe: `/tmp/studio-parity-final-geometry.mjs`. Temporary probes and broader captures remain under `/tmp/studio-parity-*.mjs`, `/tmp/studio-parity-*.log` and `/tmp/parity-*.png`. Supporting agents' test results were not substituted for this visual judgment.

## Remaining limits

No further material visual-family issue was identified in the inspected slice. Preferences is still a long scrolling surface because it contains appearance, writing, printing, file and offline settings; its sections and sticky close make the structure clear, but user observation may justify further simplification. The raw Fountain title metadata remains part of editing; it is not equivalent to Writer's folded story details.

This pass did not independently exercise every Studio tool after restyling, certify export semantics in external screenplay applications, run screen-reader sessions, or reproduce physical iPhone keyboard/browser chrome and Brave Shields behavior. Desktop browser viewport emulation must not be presented as those checks. The user should judge the attached comparisons directly; the review does not replace their aesthetic acceptance with another score.
