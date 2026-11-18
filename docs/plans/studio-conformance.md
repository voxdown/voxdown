# Studio Fountain and export conformance gate

Sprint 15 adds `site/test/studio-conformance.test.ts`, an original adversarial corpus checked against the [official Fountain syntax reference](https://fountain.io/syntax/). The examples are newly written rather than copies of the reference screenplay.

## Behaviors covered

The corpus exercises title continuations and duplicate metadata; forced action and mixed-case character cues; escaped carets; note/boneyard boundaries and backslash parity; mixed newline source offsets; malformed omissions; single-line emphasis; explicit page breaks; asymmetric dual dialogue; and styled long-token wrapping on Letter and A4. The existing parser and layout tests add scene-number bounds, lyrics, speech continuation, parenthetical pagination, embedded fonts, unsupported glyph rejection, title overflow, and PDF dimensions.

Three regressions were repaired in this sprint:

- At the beginning of a document, `CUT TO: ` (with a trailing space) was consumed as title metadata. It now remains action, while `CUT TO:` remains a transition.
- An escaped final caret in a character cue incorrectly enabled dual dialogue and lost the literal caret. It now stays in the printed name.
- Malformed private syntax was blocked only by the application's Export button. Layout now carries `exportBlocked`, and the PDF function rejects that layout before downloading fonts. Preview intentionally retains malformed text for repair; completed notes and boneyards are excluded.

## Exact implementation limits

- The source remains authoritative. Element offsets address the original UTF-16 text, including files with BOM and mixed LF/CRLF/CR endings. Layout never rewrites source.
- Automatic scene headings accept an immediate following action line. This matches the official complete example, although the introductory scene-heading prose calls for a following blank line. This compatibility choice is deliberate; strict blank-following validation is not claimed.
- Completed comments do not nest. An escaped delimiter stays literal. Unclosed comments remain visible with warnings and cannot be exported to PDF.
- Standalone notes are excluded, but surrounding author-written blank lines are retained. This may produce more vertical whitespace than applications that remove those blank lines together with the note.
- Unknown title keys remain in the source and produce a nonblocking warning; they are not printed. Overlong title pages, scene numbers, cues, or unpageable parentheticals fail with repair instructions.
- Long unbroken tokens wrap with a warning. Blank runs that would create otherwise empty pages are collapsed at page boundaries with a warning; leading, trailing, and consecutive explicit breaks do not create empty pages.
- PDF uses bundled Courier Prime, 12-point text and 12-point leading. Characters absent from those fonts fail explicitly instead of becoming missing-glyph boxes. Multiscript font fallback and matching another product's exact pagination are not claimed.
- Tests cover the shared preview/PDF layout model and PDF generation. They are not a substitute for visual checking in external PDF readers or real-device browser testing.

## Validation

`pnpm exec vitest run site/test/studio-conformance.test.ts site/test/studio-fountain.test.ts site/test/studio-layout.test.ts`: **45 passing tests**, including **14 new conformance cases**. Independent review is a separate gate; this implementation report is not an independent certification or a 9.5/10 rating.
