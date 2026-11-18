# Studio accessibility audit

## Scope and repeatable check

Run `pnpm site:build` followed by `node scripts/check-studio-accessibility.mjs`.
The check uses Playwright Chromium and the pinned development-only `axe-core` dependency.
`STUDIO_A11Y_URL` can target an existing development server; `AXE_PATH` can point to a separately installed axe script.

The audit enables Playwright's `bypassCSP` only to inject axe into the built site. It does not validate the site's content security policy; security tests must retain the normal browser CSP enforcement.

The automated audit covers thirteen states:

- Empty and populated screenplays, including private notes and a section heading.
- Light and dark appearance.
- Preferences, Fountain guide, Commands, Workbench, and Recovery dialogs.
- 720, 390, and 320 CSS pixel viewports with reduced motion requested.
- The Fountain guide at mobile width.
- A 320 × 256 CSS pixel viewport, modeling the available space at 400% zoom on a 1280 × 1024 display.

Additional behavioral assertions cover:

- The skip link focuses the editable screenplay, so typing can begin immediately.
- Tab stays in each native modal or enters browser chrome; background application controls are not reached. Escape restores the opener.
- Mobile Commands can open Preferences, and closing Preferences returns focus to Commands.
- There is no horizontal page overflow at the tested widths. Screenplay paper may scroll within its own region.
- The editor retains usable height in a short viewport and the document can scroll vertically to reach controls.
- Visible mobile buttons, selects, filename input, brand link, and checkbox labels meet the product's 44-pixel touch-target goal.

## Findings repaired during sprint 19

The audit initially found invalid labeling on the page-preview container, a missing first-level heading, insufficient contrast for the empty-editor placeholder and private-note text, non-focusable scrolling regions, a skip link that stopped at a non-editable wrapper, mobile horizontal overflow, small touch targets, and a collapsed editor at high zoom/short viewport height.

The implementation now provides valid region semantics, an accessible page heading, explicit editor keyboard focus, keyboard-scrollable page preview, stronger text contrast, a functional editor skip link, compact mobile controls, larger touch targets, and a vertical-scrolling fallback for short viewports. All thirteen audited development-server states and all thirteen states served from the built `site/dist` subsequently reported zero axe violations, and the accompanying behavioral assertions passed. `node scripts/check-studio-accessibility.mjs` exited successfully against the built output; Biome validation of the script also passed.

## What this evidence does not establish

Axe and synthetic keyboard checks do not establish complete accessibility or a best-in-class score. VoiceOver on a physical iPhone, NVDA on Windows, actual browser zoom and text-only zoom, mobile dictation, switch control, and sustained screen-reader editing remain manual acceptance work. The 320-pixel viewport is a reflow proxy, not a claim that every browser's actual 400% zoom behavior has been tested. Reduced-motion emulation confirms the tested interface remains usable; assistive-technology comfort still needs real-user assessment.


## Comparison follow-up

After persistent comparison excerpts were added in sprint 26, independent review audited populated
changed-hunk states in light and dark appearances at 1440, 390 and 320px. All six additional axe
runs reported zero violations, with no page/dialog horizontal overflow. This supplements the
13-state repeatable gate; it does not replace real screen-reader or touch-input acceptance.
