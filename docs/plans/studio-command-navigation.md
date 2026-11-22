# Studio command navigation

Round 28 keeps the existing command dialog and native button keyboard behavior. A browser audit at 320 and 1440 CSS pixels found that an exact “Export PDF” search ran Actor sides instead: the shared “Export and perform” category made both results match, and registration order selected the wrong first result. “Open” similarly put FDX import before Open Fountain, while “recovery” put the actual recovery tool last.

Search now prioritizes exact normalized command names, then name prefixes, then names containing all query words, then category/keyword matches. Matching still accepts words in any order and combines with the category filter. Categories stay together: the category with the strongest result appears first, and results within it follow the same ranking. Equal matches retain their existing order. No command is duplicated. An unavailable exact match stays visibly disabled; Enter continues to run the first available result, as the help now states, and availability is rechecked on execution.

Without a query, categories follow a stable task order: Files and recovery, Writing space, Navigate, Plan and revise, Export and perform, Learn and inspect. The select and headings agree. Future unknown categories follow in registration order, and commands retain their supplied order inside each group. Adding a tool in a new source-code position no longer reshuffles known categories.

Keyboard behavior remains native buttons plus Arrow Up/Down navigation, composition protection, Escape dismissal, and opener restoration. Closing a launched dialog returns to the original Commands opener. No storage, favourites, new controls, or changes to editor content are introduced.

Validation includes Chromium regression tests for exact-name execution versus category matches, prefix ranking, grouped results, category filter/order, disabled commands, composition, and palette→tool→opener focus. Integrated browser checks cover 320/1440 layouts and dialog return focus; these are desktop Chromium viewport checks, not physical-device coverage. The audit also found a 320px Preferences theme-select overflow, reported separately for the shared CSS round.

## File entry point on narrow screens

The full writing-journey review found that mobile New/Open/Recover actions depended on finding Commands first. A `File…` button can use the same command dialog without introducing another menu or extra toolbar row. `palette.open("Files and recovery")` opens with that category selected and focuses the search field; an unknown category falls back to All tools. Ordinary `palette.open()` still opens All tools and clears previous filters. Users can change the category normally. Escape restores the actual entry button, and a launched tool retains the existing dialog-to-opener behavior.

`File…` names the missing task group more clearly than a generic `More` button. The ellipsis indicates that another choice follows. Browser tests cover category preselection, ranked search within it, focus restoration, invalid-category fallback, and returning to the unfiltered Commands entry point.
