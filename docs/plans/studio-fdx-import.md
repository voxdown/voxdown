# Conservative local FDX import

Round 17 adds an experimental **Import Final Draft XML (.fdx)…** command. A local file is read into a compatibility preview; only **Open as new screenplay** requests a new document through the host's existing guarded replacement flow. Import does not upload, download, overwrite the original FDX, or copy hidden metadata into Fountain. Keep the original FDX: this is a supported-subset conversion, not a source backup or an exhaustive Final Draft implementation.

## Primary evidence and scope

Reviewed 2026-11-18, alongside [the existing export research](studio-fdx.md). No native Final Draft application is available for acceptance testing.

- [Screenplain's pinned FDX producer](https://github.com/vilcans/screenplain/blob/abf0d0800ab0b9dfd5bbe780137641e746afbad4/screenplain/export/fdx.py) establishes Script/Content, typed Paragraph/Text, plus-separated Bold/Italic/Underline styles, centered Action, embedded line feeds and Paragraph/DualDialogue containing two speeches.
- [Beat's pinned FDX producer](https://github.com/lmparppei/Beat/blob/ab2382184ca41e50440ff695373b17b4e57c915f/Frameworks/BeatFileExport/BeatFileExport/Export/Modules/Final%20Draft/BeatFDXExport.m) provides evidence for scene Number attributes, TitlePage and production tag metadata. Production tags are excluded from this import.

These primary producer implementations establish only the subset tested here; they are not a complete vendor schema. No third-party exporter code or screenplay fixture was copied. Native Final Draft import/export fidelity remains a manual acceptance gate.

## Conversion contract

`importFdx(bytes: Uint8Array): FdxImportResult` uses browser DOMParser and returns `{source, paragraphs, dualPairs, report}`. Supported screenplay types are Scene Heading, Action (including Center alignment), Character, Dialogue, Parenthetical and Transition. A dual wrapper must contain exactly two complete speeches. Dialogue without a preceding character and cues without dialogue are rejected. Valid explicit scene numbers are retained.

All printable text is escaped for Fountain before adding deliberate paragraph forcing. Literal `[[notes]]`, `/*omissions*/`, emphasis delimiters, character/scene markers and hostile HTML remain literal public text. Imported body text never becomes a private passage. A final parse compares each visible line's kind, rendered text, inline styles, scene number and dual marker; any mismatch or new omission blocks the entire import. For example, an FDX Dialogue line beginning with `=` cannot safely retain its exact role with the current Fountain grammar, so conversion stops instead of creating a synopsis. Invalid or punctuation-leading forced headings and multiline headings/cues/transitions/parentheticals likewise require manual conversion.

Supported inline styles are retained when the Fountain renderer can represent them exactly. Styled scene headings and wholly styled parentheticals may require plain-text simplification to retain their structural role. Style combinations that cannot round-trip exactly are also simplified; every such line is counted. Unsupported style sets, layout/production attributes, and whitespace normalization are counted in the report. Structural/dialogue edge whitespace is trimmed and tabs become four spaces; Action edges remain intact except centered Action. Paragraph spacing and pagination are rebuilt. Fonts, page size, margins, headers/footers, revisions and production locking are not transferred.

Known title-page, script-note and metadata containers are excluded completely, including author/contact information. Reports contain counts and fixed explanations, never their contents. Unknown top-level/body structures, paragraph types, and body attributes are rejected, rather than silently flattened or skipped. The report always states the native interoperability limitation.

## Bounds and XML safety

Files must be strict UTF-8, at most 8 MB. The importer rejects DTD/entity declarations, CDATA, XML comments and processing instructions (apart from the initial XML declaration) before parsing. Declared non-UTF-8 encoding, unknown entities, malformed XML and namespaced structures are rejected. There is no resolver, fetch, stylesheet processing, external entity expansion, HTML insertion or script execution. Inert URLs can remain literal screenplay text.

A preparse limit permits at most 60,000 opening/closing markup tokens, followed by node/depth checks (60,000 elements, depth 16). The resulting Fountain must satisfy Studio's existing 500,000-character / 20,000-line limits. Unsupported controls, direction controls and incomplete Unicode are rejected. Paragraph runs are trimmed with index scans, not repeated array shifts.

## Dialog and integration

`mountFdxImport(host, {openScreenplay(value, isCurrent)})` exposes `open()` and `close()`. The callback receives captured `{source, name}` values and may return a boolean or promise. The host must check `isCurrent()` after asynchronous preservation/replacement checks and before changing the editor, for example:

```ts
async openScreenplay(value, isCurrent) {
  if (!(await mayReplace()) || !isCurrent()) return false;
  showSource(value.source, value.name);
  return true;
}
```

The dialog disables duplicate imports/file changes while replacement is pending; Close/Escape invalidate that request. A late file read cannot replace a newer selection or repopulate a closed/reopened dialog. Rejected guards/errors keep the conversion retryable. Only explicit button activation invokes the callback. The compatibility report is bounded, and the optional source preview contains at most 5,000 characters; opening uses the complete captured result. Filename and previews are inserted as text, never HTML. Hooks: `.studio-fdx-import`, `.fdx-import-preview`.

## Verification

`studio-fdx-import.test.ts` executes the converter inside real Chromium's XML DOMParser. It checks supported export/import semantics, styled Unicode, dual dialogue, literal private delimiters and HTML, excluded metadata, reported loss, multiline/empty speech lines, unsupported structures, XML entity/PI/CDATA rejection, strict UTF-8 and resource limits, and zero requests for inert URL text. `studio-fdx-import-dialog.test.ts` checks explicit opening, compatibility/source previews, rejected replacement, stale conversion invalidation, async close/reopen cancellation, late file selection completion, bounded previews and inert filenames. This does not claim native Final Draft or physical-device acceptance.
