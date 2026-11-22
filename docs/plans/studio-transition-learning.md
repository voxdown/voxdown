# Document-local transition learning

An earlier explicit Fountain transition such as `> FADE OUT.` teaches Studio that
phrase. Typing the same standalone phrase later inserts `> ` in the same undoable
edit. Matching ignores case and repeated horizontal whitespace; punctuation must
match. The typed wording is preserved. The saved source remains standard Fountain,
so PDF, FDX and other readers agree on its interpretation.

Learning is limited to earlier transitions in the current document. Centered text,
private passages, dialogue and forced other elements are excluded. Opening a file
or pasting multiple lines does not rewrite existing prose. Composition input is
left alone. No global preference or additional storage is involved.

A mapped range index updates only changed physical lines. An exact candidate is
checked against a current full parse before rewriting, so stale privacy context
cannot expose private definitions. Ordinary typing does not trigger a full parse.

Validation: unit tests cover definition edits/deletion/mapping, case/spacing,
privacy, source limits, import/paste, caret position and atomic undo/redo. The
browser workflow checks immediate right alignment, caret, undo/redo and recovery
after reload. Related writing/presentation/coach tests, typecheck and production
build pass. The large-document performance check passes with sustained typing
p95 16.3 ms and no observed long tasks on this desktop automation run.
