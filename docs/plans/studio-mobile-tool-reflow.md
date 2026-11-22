# Mobile tool reflow and appearance coverage

Round29 extends mobile geometry checks to the actual dialogs, in light and dark appearance.
Page-level overflow and automated accessibility alone missed two clipped native selects:
Preferences' Appearance selector measured 329px scroll width in a 294px interior, and a
rehearsal scene selector with a real heading measured334px. The writing page itself still
fit320px, so earlier page-level checks passed.

Preferences select rows now wrap at narrow widths; rehearsal filter controls may shrink
inside their grid and fill only its available width. Numbering's confirmation label has a
44px touch target. The same native controls, keyboard interactions and stored preferences
remain intact. No content is hidden to make the measurements pass.

The accessibility acceptance script now checks both the page and each narrow dialog's own
scroll/client width, plus axe in light/dark states for Preferences, numbering, breakdown,
adaptation, comparison, rehearsal and guided practice. Physical iPhone/Safari/Brave and
screen-reader acceptance remain manual gates.
