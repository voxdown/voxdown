# Consistent private-comment preflight

Fountain comments do not nest. A source such as `[[outer [[inner]] tail]]` closes at the
first `]]`; a writer may nevertheless have intended the tail to remain private. FDX export
already refused this ambiguity, while the full PDF and actor-sides paths did not.

All four public handoffs—full PDF, actor sides, FDX and rehearsal—now use the same bounded
check of parsed omission spans. An unescaped nested opener stops the handoff with a plain
explanation. Ordinary comments and escaped literal openers continue to work. Error messages
never include the comment's content. Incomplete comments retain their existing guards.

This changes export eligibility, not Fountain interpretation or the source. Exact Fountain
downloads and private backups remain available. The full PDF checks its captured current
parse synchronously before starting asynchronous PDF work. Editing invalidates that parse.

Independent review checked four ambiguous forms against all handoffs with zero downloads,
escaped forms, snapshot consistency, and safe error text. Eleven shared-boundary tests and
the built PDF regression protect the observed inconsistency. This is not a claim that source
downloads omit private notes; they intentionally preserve them.
