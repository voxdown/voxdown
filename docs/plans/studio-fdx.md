# Conservative Final Draft XML export

Round 14 adds a browser-only, experimental `.fdx` interchange export. Fountain remains the original document. There is no upload, import, external entity resolution, or claim of a byte-preserving round trip. No native Final Draft application was available for acceptance testing; users must check the received document before delivery.

## Primary format evidence

Reviewed on 2026-11-18. These are public producer implementations, not a complete vendor schema. We implement the observed XML vocabulary independently; no exporter source or screenplay fixture was copied.

- [Final Draft 13 Windows user guide](https://www.finaldraft.com/downloads/manuals/fd13-user-guide-win-exported.pdf) describes FDX as Final Draft's XML-based file format. It does not establish a complete XML schema for this implementation. The browser research fetch could not load the full large PDF; its indexed glossary was available.
- [Screenplain FDX exporter, pinned revision abf0d080](https://github.com/vilcans/screenplain/blob/abf0d0800ab0b9dfd5bbe780137641e746afbad4/screenplain/export/fdx.py): `FinalDraft` with Script/No/Version 1, `Content`, typed `Paragraph`, `Text`, `Style` with plus-separated Bold/Italic/Underline, centered Action, line feeds inside text, and a Paragraph/DualDialogue wrapper containing both complete speeches. This established open-source writer is the basis for the screenplay body vocabulary.
- [Beat FDX exporter, pinned revision ab238218](https://github.com/lmparppei/Beat/blob/ab2382184ca41e50440ff695373b17b4e57c915f/Frameworks/BeatFileExport/BeatFileExport/Export/Modules/Final%20Draft/BeatFDXExport.m): scene heading `Number` attributes; `TitlePage/Content` containing ordinary Paragraph/Text content, optionally center-aligned. We preserve title metadata as readable title-page text, without claiming semantic field identity or matching its original placement.

## Contract

Supported body elements: Scene Heading, Action, Character, Parenthetical, Dialogue, Transition. Existing Fountain parsing supplies visible text, extensions, explicit scene numbers, and interpretation. Adjacent action/dialogue/lyric physical lines remain within one paragraph with line feeds. Intentional two-space dialogue lines remain present. Ordinary blank separator lines are represented by element boundaries and receiving-app spacing, not exact source whitespace.

Inline bold, italic and underline use existing Fountain runs. Centered text becomes center-aligned Action. Lyrics become Dialogue; the compatibility report calls out both conversions. Two consecutive complete speeches, with the second marked dual, become one linked pair. Unpaired markers become ordinary cues and are reported. A chain is paired from the left; subsequent unpaired markers are reported.

Title, credit, author/authors, source, draft date, contact and copyright text are included by default. The dialog explicitly discloses inclusion of author/contact data and offers one switch to exclude the whole title page. Unknown title fields are omitted and counted without displaying their names or values. The simplified title-page layout does not reconstruct Fountain metadata on reimport.

Every export has a bounded compatibility report. Private notes, boneyards, section headings and synopses are always excluded. Malformed comments block export. Nested unescaped comment openers also block export: Fountain comments do not nest, so exporting trailing text after the first closing delimiter could expose text the writer intended to hide. Escaped literal delimiters retain ordinary Fountain semantics. Private text is never put in the report, filenames, XML comments, script notes, or hidden metadata.

Explicit page breaks are omitted and counted. Paper size, fonts, margins, headers, footers, pagination and production revisions are not transferred. The target application applies its own defaults. Scene-number text is preserved but production page/scene locking is not supplied. This export is intended for editable content exchange, not print delivery or a source backup.

## Reliability and bounds

`exportFdx(source, { includeTitle })` is pure and uses the existing 500,000-character / 20,000-line source limits. Output has an additional 8 MB UTF-8 cap. It rejects XML 1.0-invalid printable controls, lone surrogates and U+FFFE/U+FFFF instead of replacing them silently. Escaping covers text and attribute metacharacters; there are no DTDs, declared entities, raw XML inserts, stylesheets, external references, or executable elements.

`mountFdxExport(host, { current, download })` captures source/name by value on open. Preparing a report and toggling title inclusion never download anything. Download is an explicit button action on that captured snapshot. There is no asynchronous exporter work that can outlive a closed dialog. Close/Escape clear the retained snapshot and report; queued close events cannot wipe a new open. Download exceptions remain retryable. Source, storage and editor history are never modified.

## Validation

- Chromium's independent XML DOMParser checks the generated tree, element types, text, attributes, styles, dual wrappers, UTF-8 Unicode and title metadata.
- Fixtures cover nested/inline/multiline private passages, malformed omissions, escaped XML/hostile text, invalid XML characters, BOM/mixed newlines, conversion reports, max source/line limits and exact source retention.
- Real browser dialog tests verify explicit download, snapshot isolation, title exclusion, cancellation/reopen, retry and inert filenames.
- Native Final Draft and other receiving-app visual/semantic acceptance remains a manual release gate. XML well-formedness alone does not establish that every importer will render every feature identically.

Integrated local verification: the Commands export opens at a 320px viewport with a 296px dialog and no horizontal overflow; its explicit button produces a `.fdx` download. In Chromium at 4× CPU throttling, a 362,890-character fixture with 6,500 styled action paragraphs and inline private notes exported in approximately 148 ms to 1.33 MB. These are local measurements, not device guarantees.
