# Writer / Studio visual parity

## Brief and design direction

Studio is the experimental sibling of Writer, not a separate design system. The acceptance reference is Writer's actual rendered application and source. Previous review scores did not establish visual maturity. This pass is judged by side-by-side screens and real writing workflows, without numerical score targets.

Palette (from Writer): paper #ffffff, desk #e7eaee, ink #25282d, quiet #646b75, edge #d5dae1, brand #245f61. Dark equivalents follow Writer's neutral charcoal surfaces, not Studio's green-tinted surfaces. Recursive Variable provides interface typography; Literata provides the VoxDown wordmark; Courier Prime remains the screenplay face. Reuse bundled fonts, no remote requests.

Layout choices considered:

A: Preserve three permanently visible columns and repaint them. Rejected: this keeps the fragmented composition and cramped screenplay.

B: Writer-family frame with a central editable manuscript and supporting panels. Selected:

    VoxDown Studio | File … Help | document name          Save | panels
    undo redo | emphasis | element | note / help          Commands | Export
    [scenes]        grey desk / white manuscript        [preview/reference]
    draft / file status                                         line / counts

Keep existing controls and source handlers, reparenting them into coherent groups. One compact menu/document row and one toolbar; no separate Screenplay heading. A clear writing page, bounded reading width, generous page margins when space permits; narrow viewports retain usable text. Scenes and preview remain available through familiar toggles and menus. Supporting panes resize and collapse without affecting source or selection.

Critique against the brief: this is deliberately Writer's identity, not a generic "premium app" facelift. No gradients, cards, new marketing language or extra headings. The manuscript is the focal point; controls recede. A screenplay must retain its monospaced structure rather than copying Writer's prose typography.

## Acceptance criteria

- At equivalent desktop sizes, Studio visibly belongs to Writer's family: wordmark, palette, typography, controls, menu rhythm, status bar and desk/page composition.
- Document identity shares the menu row; toolbar actions form consistent groups; Save is prominent and Export secondary.
- Default writing gives the manuscript usable width; optional panels never turn editing into a tiny middle strip.
- Scenes, preview, reference, command search, preferences and workbench follow the same visual system.
- Empty, populated, light, dark, portrait, landscape and short/zoomed layouts receive actual screenshot inspection.
- Native typing, selection, undo, file/export, menu hover/keyboard, resizing, focus return and source preservation continue to work.
- Independent reviewer compares actual Writer and Studio screens, reports remaining visual gaps, and rechecks fixes. No numerical score is used as a substitute for evidence.
- Shared improvements to Writer must preserve its existing identity and behavior; the main work is raising Studio to that reference.
- Local work only; nothing published without authorization.

## Implementation and review outcome

Implemented locally on `studio-fountain`. Writer and Studio now import shared identity tokens and bundled fonts from `workspace-theme.css`. Writer keeps its existing appearance; Studio adopts its compact two-row desktop frame, wordmark, neutral desk/paper, control rhythm and quiet status bar. Courier Prime and actual Fountain source remain the screenplay editing model.

The desktop document row contains filename, Save and panel toggles. The grouped toolbar adds native Undo/Redo and an Edit menu shares the same commands. Menus support active mouse-hover switching, left/right traversal and existing Escape/Tab behavior. Preview is optional by default. The manuscript has an 816px maximum width and responsive margins; CodeMirror remains the scroll owner so selection, virtualization, page guides and typewriter mode retain their coordinates.

Scenes, preview/reference, command search, workbench, Preferences and export/recovery dialogs received the same visual language. Phone layouts keep a 44px control target while reducing persistent tools; complete actions remain in menus and Commands. Layout advisories open from a compact status action instead of occupying a permanent banner; parser warnings and errors remain visible. On very short phone screens, Review layout notes stays available in Commands. Note details render only when needed, avoiding a hidden list rebuilt on every edit.

Independent inspection rejected and corrected the initial integration's dark green remnants, clipped mobile controls, weak logo presence, detached checkbox labels and excessive informational banner. Automated accessibility then exposed and corrected small tap targets, a 320px select overflow, dark primary/preformatted-text contrast, and short-screen note height. Preferences now groups appearance, writing, printed pages, files and offline settings.

The [independent final report](studio-writer-design-parity-review.md) concludes that the inspected Studio screens have visual maturity comparable to Writer. It includes eleven before/after/reference screenshots and explicit limits; no numerical score substitutes for visual judgment.

A late integration check also exposed an intermittent breakpoint defect: a pending hidden resize handle could make automatic grid placement assign writing to an 8px separator track. Explicit track placement now preserves the manuscript immediately across viewport changes. The deterministic regression and independent Chromium/Firefox resize review pass. At 320×256, writing and Focus provide 134px; the preview scroll region provides 121px.

## Verification

- `pnpm check`: lint, all workspace typechecks, 2,942 tests in 138 files and package builds passed.
- Final site build passed; a final focused 28-test integration run covers menus, mobile focus/files, notices and manuscript behavior. After late resize and lazy-note refinements, another 28-test run passed for menus, panels, manuscript and mobile focus; final lint/typecheck/build also passed.
- Production Chromium, Firefox and WPE WebKit Studio gates passed, covering source preservation, edits/undo, panels/preferences, exports, malformed/hostile input, recovery, offline fallback and independent drafts.
- Writer/playground production workflows and all seven appearance/contrast checks passed after shared-token extraction.
- Desktop production performance passed: sustained typing keydown-to-next-frame p95 **15.4 ms**, maximum 17.8 ms; typing across worker updates p95 **15.8 ms**. Large adaptation's maximum frame gap was 16.8 ms with no main-thread long tasks. Editor and supporting result DOM remained bounded. [Recorded performance report](studio-ui-polish/parity-performance.json). These are 1× desktop results, not mobile-device timings. The benchmark's outdated adaptation readiness wording was corrected to the current validated row count and enabled Download state; timing budgets and measurement logic were retained.
- Direct save and installed-offline gates passed. All resources remain local; no server processing or remote fonts were added.
- Accessibility: 51 states passed axe and custom keyboard/focus/reflow/mobile-target checks, including notes in short-screen Focus. This is not a physical-device or screen-reader certification.
- Test helpers now open actual menus and explicitly enable preview for preview-dependent checks; no forced clicks or relaxed performance budgets. Forward Escape/Tab traversal supplies a next in-page target because headless Firefox leaves `activeElement` unchanged at the end of the tab sequence; backward traversal is also checked with preview closed, and the exact source stays unchanged.

Physical iPhone/Brave, assistive technology and native screenplay application/print acceptance remain outside this local browser verification. Studio remains experimental. No remote publication is authorized by this change.
