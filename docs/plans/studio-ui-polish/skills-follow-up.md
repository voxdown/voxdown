# Skills-informed UI/UX follow-up

The frontend-design and web-design-guidelines skills are now installed and applied. This pass reopens the review rather than carrying forward the earlier scores.

## Design plan and critique

Keep the screenplay writing desk: paper surface #fffefb, quiet chrome #f5f5f1, ink #263a36, secondary ink #5b6963, teal action #205d4c, border #d6dcd5. Retain the existing interface sans-serif and Courier Prime screenplay face; screenplay text remains visually distinct from controls.

Two layout options: keep every toolbar row at all heights, or adapt chrome density when height limits writing. Choose the latter, retaining access through existing menus and Commands. A taller toolbar does not help someone writing in landscape. Avoid an aesthetic reset: the current hierarchy is coherent; the fresh review found interaction failures, not a need for decorative novelty.

Principles: writing owns available space; keyboard focus must remain visible; sticky dismissal must not conceal fields; empty-state copy should clearly be instruction rather than apparent document content. No source, export, storage or privacy semantics change.

## Independent findings

- Sticky dialog titles obscure keyboard-focused inputs in Rename, Preferences, Replace and Sides; similar trouble in Rehearsal on desktop. Fix scroll offsets using actual header geometry and verify hit testing after real keyboard traversal.
- At 667×375, five chrome rows leave only 121 visible pixels for writing. Adapt short-viewport layout, preserving navigation and explicit Focus mode.
- The empty editor begins with an apparent scene heading, while the document and preview are empty. Make the placeholder explicitly instructional.

Review source: https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

## Implementation and review iterations

- Shared dialog headers now reserve scroll space from measured header height. Focus traversal reveals the active control below the title; resizing also keeps its lower edge inside the dialog. The independent recheck caught the lower-edge case after the first fix, and the implementation was corrected before acceptance.
- Preferences and Guide use the same behavior. Dialog scroll containment prevents scroll chaining at modal edges.
- A short-height workspace compacts navigation and document controls while keeping actions available through the existing menus. It does not toggle or save Focus mode automatically.
- Empty-editor instructions explicitly describe how to begin and where to find examples. Panel dividers have a quiet visible grip.
- Added actual keyboard traversal/hit-testing and focused-field viewport-shrink regressions. The independent reviewer repeated focus checks in Chromium and Firefox and confirmed source preservation.

The short-height review also caught a cramped mobile preview and the absence of an Escape return path. The final layout gives page preview 118px at 320×256 and 162px at 320×300, with its own scrolling and full-sized controls. Escape returns to writing after any open menu or dialog has been dismissed. At 667×375, the editor now begins at y141 and has 202px of visible height; ordinary 375×700 and 1440×900 layouts retain their geometry.

The reflow check now verifies actual control reachability, 44px targets, internal editor/caret scrolling, Focus exit, preview scrolling and return to writing. It no longer requires the obsolete whole-page scrolling layout.

## Validation

- `pnpm check`: lint, typechecks, all **2,936 tests in 137 files**, and package builds passed.
- Final production site build, Chromium integration and accessibility/reflow gates passed.
- WPE WebKit integration passed during this pass; the focused-field resize probe also passed all 20 WebKit states. Independent Chromium/Firefox resize checks covered 40 states, with source unchanged.
- Eight focused mobile tests cover the final compact layout, source/selection preservation, reachable controls and explicit Focus exit.
- No physical iOS keyboard, VoiceOver, native screenplay-app or print acceptance is inferred from these automated checks.

Everything remains local; nothing was pushed or published.

## Menu hover follow-up

A user check caught an omitted desktop convention: opening File and moving the mouse over View did not switch menus. Open menu-bar disclosures now switch to a sibling on mouse entry. Hovering a closed menu bar does not open it, touch remains single-tap toggling, and the separate preview-actions disclosure is excluded. Integrated real mouse and touch tests cover switching, dismissal, Escape focus, single visible dropdown and source preservation. This interaction was missing from the earlier review scope.
