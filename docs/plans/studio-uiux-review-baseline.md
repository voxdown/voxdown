# Studio UI/UX polish: independent baseline review

Date: 2026-11-18. Reviewer: separate Codex agent; no implementation in this review. Local development app at `http://localhost:5173/studio/`. This is a visual and task-based expert review, not a user study or physical-device test.

## Baseline judgement

**UI: 6.2/10. UX: 7.1/10.** Useful, careful tools are present, but their organization and presentation feel assembled rather than designed as one writing workspace. Strong source-safety engineering does not compensate for weak information hierarchy. Prior scores near nine were not supported by the rendered UI.

Captured the main workspace and writing-statistics dialog at 1440, 1024, 768, 375 and 320 CSS pixels in both light and dark appearances. Also exercised Commands, Preferences, scene cards, scene numbering, storage/backup controls and the scene drawer at desktop, tablet and phone widths. Used real editor entry and actual command selection; inspected resulting screenshots directly.

## Prioritized findings and acceptance criteria

### P1: Establish one dialog and form language

The reported workbench defect is reproducible: Close, selector and target label share a row; the target input wraps away from its label. The target input is about 25px high while neighboring controls are 36–44px. Statistics are ordinary separated paragraphs, with long gaps and equally prominent caveats. “About 1 minutes” is incorrect and 14 spoken words should not imply a whole minute.

Commands has the same structural defect. On a 320px screen the first result begins around y485, after title, Close, narrow search, category, count and a long keyboard-help paragraph. Preferences is structurally different; checkbox labels are separated from their controls by a wide desktop gap. Scene cards puts Close at the bottom with pagination; other dialogs put Close at the top. Scene numbering makes a short task feel like reading documentation.

Acceptance:

- Dialogs share a recognizable header, visible close control, body spacing, labels, field dimensions and action hierarchy.
- Header and primary controls remain reachable on small screens and short viewports; close is not buried below long content.
- Fields and labels stay grouped at every tested width. No orphaned labels, native undersized text boxes or hard-to-scan checkbox rows.
- Statistics present primary values as a coherent compact group. Target is optional and clearly separate. Grammar and duration presentation are correct.
- Essential guidance stays near the action; detailed caveats and keyboard reference use optional disclosure where appropriate, without hiding destructive consequences.
- Command search is wide and prominent; results begin much sooner on mobile. Helpful hints do not displace the task.

### P1: Put file tasks in a predictable menu

The desktop file row has six equal-looking actions, while mobile's File button opens a generic Commands list. In Files and recovery, Import FDX and Storage precede New and Open. A user must understand how Save to file, Download Fountain, Portable backup and Recovery differ before choosing confidently.

Acceptance:

- A visible File entry is available at all workspace sizes.
- Group and order common tasks first: New/Open; Save/Save as or Download; Import/Export; Recovery/Backup. Use separators and concise explanations for distinct storage behaviors.
- Keep the primary writing surface sparse. Common shortcuts are shown consistently; advanced file operations remain discoverable.
- Menu works with pointer, touch and keyboard, closes predictably, returns focus and never changes source merely by opening.
- PDF may remain a convenient explicit action, but the rest should not compete as an undifferentiated row.

### P1: Real panel management

At 1440 the scene panel is fixed at roughly210px; the search placeholder is clipped. There is no visible desktop scene-collapse control and no separator role. On tablet the fixed editor/preview split creates a tiny page preview under multiple rows of controls. Mobile Scenes overlays most of the editor and has no internal close control: Escape and an outside-editor click both left it open in the audited app.

Acceptance:

- Desktop side panels have visible collapse/expand controls and pointer-resizable boundaries with practical minimum/maximum sizes.
- Resizers are keyboard operable with understandable accessible values and reset behavior. Dragging does not select screenplay text or lose the caret.
- The editor retains a useful minimum width; panels adapt at tablet widths instead of making both editor and page unreadable.
- Reopening preserves a sensible prior width. Resizing the viewport cannot strand a panel or its return control offscreen.
- The mobile scene drawer has an explicit close control, supports Escape, and closes naturally after navigation. Its relationship with the rest of the screen is visually clear.
- Source, selection, undo, scroll and preview calculations remain stable across panel changes.

### P2: Reduce chrome and localize controls

At1440 the global header, filebar, general toolbar, editor formatting strip, preview tabs and preview toolbar all compete for attention. Full size wraps to a lone second row. At768 preview controls occupy several rows above a very small paper. At320 the editor starts at y270 in ordinary mode and the filename is clipped.

Acceptance:

- Distinguish application navigation, document/file identity, writing tools and panel-local controls.
- Move paper-size/preview-specific controls into the preview context or a concise view menu where appropriate.
- Keep frequent writing tools available without exposing every secondary action simultaneously.
- Page navigation, current page and zoom form one coherent control group. Expansion/collapse is visually separate from page navigation.
- Default phone layout makes writing useful without requiring discovery of Focus mode; filename and save/recovery state remain understandable.
- Light and dark themes share consistent surfaces, borders, type hierarchy, control states, spacing and restrained accent use.

### P2: Make help contextual and empty states truthful

The populated scene panel still says “Start a scene with INT. or EXT. to find it here,” and contains a persistent sample-screenplay button and Writer cross-link. Preferences includes long explanations of Enter/Tab, page guides and Focus, diluting the actual settings.

Acceptance:

- Empty-state instructions appear when empty; populated panels prioritize the user's content.
- Sample/help/navigation affordances remain available but do not occupy prime writing space after onboarding.
- Advanced behavior explanations are available on demand without forcing repeated reading.

## Evidence

Screenshots (temporary local artifacts):

- `/tmp/studio-ux-{1440,1024,768,375,320}-{light,dark}-main.png`
- `/tmp/studio-ux-{1440,1024,768,375,320}-{light,dark}-workbench.png`
- `/tmp/studio-ux-{1440,768,320}-{Commands,Preferences,Scene-cards,Scene-numbering,Storage-and-backups}.png`
- `/tmp/studio-ux-{768,320}-scenes.png`

Instrumentation logs: `/tmp/studio-ux-audit.log`, `/tmp/studio-ux-tasks.log`. Screenshots were actually opened and reviewed, not merely generated.

## Scoring gate for subsequent reviews

UI evaluates hierarchy, spacing/alignment, typography, control consistency, density and responsive visual composition. UX evaluates discoverability, task flow, panel management, keyboard/touch behavior, feedback/recovery and writing interruption. A9.5 score requires excellent actual rendered outcomes in both dimensions, not a large number of passing tests. Physical iPhone/Brave, screen-reader and user-study evidence remain separate; automated browser emulation must not be described as those validations.
