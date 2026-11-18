# Studio: speech colours, comments and scraps

Implemented locally on `studio-fountain`.

## Writing surface

- Completed Fountain notes (`[[...]]`) and boneyards (`/*...*/`) use green ink, including inline passages. Unclosed markers remain ordinary source with the existing parser warning.
- An uppercase character cue followed by the first dialogue character immediately acquires screenplay margins and a contiguous speech background. Parentheticals share the speaker's colour. Source and exported layout are unchanged.
- The speech background paints above the current-line bar; the bar remains visible outside the speech block.
- **View → Preferences → Speech boxes** offers character colours (default), one purple colour, and no boxes. Character colours derive from normalized names; extensions such as `(V.O.)` keep the same colour. Preferences persist separately from Writer.
- Small scripts update synchronously. Large scripts reclassify a bounded paragraph on input, while the existing worker supplies authoritative full-document results. Ambiguous private spans and oversized paragraphs defer to the worker.
- Colours follow Paper, Sepia, Night, Slate, Contrast and Auto, including Auto on dark devices. Syntax colours continue to work with live margins disabled.

## Outline comments

Comments appear under their nearest scene or section, with a separate group before the first heading. Disclosures start collapsed, remember their state during editing, and render excerpts in batches of 50. Clicking a comment jumps to its source line. Stale source snapshots cannot navigate to an unrelated location. The existing 500-heading limit remains intact.

## Scraps

**View → Scraps** opens the right-panel tab. Writers can add passages, copy a selection without cutting it, edit, search, insert at the cursor, drag plain text, delete and restore. Insertion uses the editor's validation and undo history. Text is always rendered literally.

Scraps are local to the browser draft, with independent namespaces for recovered working copies. They inherit lazily and are materialized when either source or scraps are saved; simply reloading does not duplicate the collection. Failed writes and stale writes remain visible. Scraps-only changes keep their source draft reachable on reload.

Writer-compatible `.scraps.md` import/export is available. Scraps are intentionally separate from Fountain/PDF exports and Studio backups; the panel states this. Native sidecar autosave is not included.

## Review and validation

Independent review covered desktop, mobile, light, dark and Auto-dark. Findings fixed: active-line background masking speech, Auto-dark contrast, stretched outline rows, scraps-only recovery loss and eager storage duplication.

Focused tests cover synchronous first-character classification, bounded large-document updates, private spans, character identity, persisted colour settings, outline navigation, literal scraps, storage failure/conflict, recovery inheritance and Writer interchange. Production accessibility audits include populated Scraps and expanded outline comments. Performance checks count heading buttons separately from the bounded disclosure controls and assert that collapsed comments render lazily.

Validation results: lint, workspace typecheck, package builds and production site build pass. The 3,030-test run had one manuscript download timeout under parallel load; that unchanged test passed in isolation, and all 22 affected workflow/library/scraps tests passed after the final recovery integration. Chromium, Firefox and WebKit production smoke checks pass. All 105 accessibility audit states report zero axe violations. The 499,500-character performance fixture passes: sustained typing p95 12 ms, typing across worker updates p95 17.2 ms, no long tasks in either; 63 rendered editor lines, 500 headings and 501 lazy comment disclosures. These are desktop automation measurements, not physical-phone benchmarks.
