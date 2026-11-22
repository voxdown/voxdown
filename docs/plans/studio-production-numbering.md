# Production numbering and margin suggestions

Scene margins distinguish committed source labels from uncommitted suggestions.
Solid, darker numbers come from `#label#` and print in screenplay output. Dashed,
italic numbers are suggestions only. Either margin accepts a suggestion; hover
and keyboard focus show the accept symbol. Ctrl/Command+Alt+N accepts the current
scene's suggestion. Both margins are centered against the complete heading,
including wrapped headings. Buttons have accessible names and explanatory titles.

Tools → Scene numbering defaults to the same suggestions as the margins. Existing
explicit labels never change through this action. Custom sequential numbering and
renumbering remain available when unlocked. Ambiguous/private headings and exotic
or descending label contexts are not guessed. Standard combined prefixes include
INT/EXT., INT./EXT. and I/E.; I., IN. and IN/EX. can be forced with a leading period
or the toolbar's Scene heading action, preserving the author's spelling.

Production locking is document-local and portable. A versioned, completed Fountain
boneyard stores reserved labels and is omitted from PDF and FDX output. Native
Fountain files, local recovery and source-based backups retain the lock. FDX
retains scene labels but not Studio's private reservation metadata. This is scene
number locking, not page locking or automatic OMITTED scene placeholders.

The editing guard prevents accidental label changes and new hand-entered labels
while locked. Ordinary prose and heading words remain editable; complete scenes
can be removed or moved. Explicit suggestion acceptance, unlock and undo/redo
remain available. Deleted labels stay reserved, including labels added by another
editor before import. Reservation updates join the deletion's undo transaction.
Unlocking preserves committed labels but clears reservations. Damaged or unknown
lock metadata has an explicit, undoable release action that preserves labels and
comment contents; an unclosed comment still needs repair before export.

Inserted scenes use free integers where possible, then suffixes such as 15A/15B.
Nested insertions use 15AA/15AB rather than modifying existing references. This is
a deterministic Studio convention, not an implementation of every production's
letter-prefix or mixed-case insertion scheme. Suffixes use bounded-length sibling
allocation even for thousands of consecutive insertions.

The guard maps indexed ranges during ordinary typing; suspicious edits receive
fresh parsing. Margin suggestions reuse worker results for large documents and
are revalidated against current source when accepted. Changes remain standard
Fountain and honor source limits.

Independent review found and prompted fixes for externally added deleted-label
reservations, suffix growth, clipped margin labels, and malformed-lock recovery.
Tests cover click acceptance on both sides, focus/Enter acceptance, shortcut,
atomic undo, lock/reload/unlock, batch suggestions, private content, damaged locks,
long documents, heading variants, and phone-width centering without text overlap.
The 1,233-test site suite passed; subsequent focused checks cover final visual and
help changes. Typecheck and production build pass. The large-document performance
check passes with bounded DOM and no observed long tasks in sustained typing.
Production smoke and accessibility checks pass, including modal focus, reflow,
reduced motion, and 44-pixel mobile touch targets for suggestion acceptance.
