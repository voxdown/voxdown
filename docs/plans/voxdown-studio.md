# VoxDown Studio — experimental browser-only screenplay workspace

Status: first local implementation sprint, 2026-11-18. Not published.

## Product boundary

Writer remains the recommended VoxDown editor. Studio is a separate `/studio/` entry point,
initially focused on a complete native Fountain workflow. Both remain local-first, static-site
applications. No account, server, telemetry, remote screenplay processing, or subscription is
introduced. `.vxd` work continues in Writer. Studio does not silently convert a screenplay into
VoxDown. Research, projects, FDX interchange, and collaboration are later decisions.

## Working loop

Each sprint has an observable user outcome, implementation, automated checks, an independent
Codex review, fixes, and a recorded result. Reviews cover fidelity/data loss, editing UX,
accessibility/mobile layout, performance, security, and export correctness. New review passes
use a fresh reviewer task with explicit scope and known limitations. Stop a sprint when its
acceptance checks pass and blocking findings are fixed, rather than expanding indefinitely.
Publication requires the user's explicit approval of the concrete result.

## Sprint 1: native Fountain to screenplay PDF

- Open and download `.fountain` with source text authoritative. No parse/serialize round trip.
- CodeMirror editing with undo, find/replace, spellcheck, wrapping, and optional live margins.
- Navigable scene outline, discoverable Fountain syntax help, accessible keyboard controls.
- Local recovery with separate draft identities so tabs cannot overwrite one another.
- Worker-based parsing/layout; debounce edits and ignore stale replies. Display one preview
  page at a time. PDF code and embedded fonts load only when exporting.
- Shared deterministic layout for on-screen pages and downloadable PDF, Letter and A4.
- Title pages, inline emphasis, forced elements, scene numbers, notes/omissions, dual dialogue,
  and dialogue continuation across pages. Unsupported cases must be visible and actionable.
- Fonts are bundled Courier Prime, SIL OFL (license beside assets), no runtime font CDN.
- Treat user text strictly as text; never render screenplay HTML. Browser storage failure must
  leave editing/download available and clearly say recovery is unavailable.
- Keep Studio unlinked from the public landing page until it has been reviewed and approved.

## Acceptance and review

Parser tests: official syntax distinctions, offsets, comments, Unicode, malformed input.
Layout tests: page bounds, long speeches/words, dual dialogue, heading/cue keep rules, title and
explicit breaks, no hidden-content leakage. Browser checks: upload/download fidelity, reload
recovery, tab isolation, undo, mobile width, keyboard navigation, hostile text, PDF download,
no external network calls, worker errors, stale results, and reasonable long-script latency.
Visual review: desktop and phone screenshots, readable controls, useful empty states, preview.
Regression: site build/typecheck/lint, existing relevant tests; Studio has no Writer imports.
Document limitations honestly; "experimental" is not a substitute for preventing data loss.

## Research and architecture decisions

- Fountain syntax: https://fountain.io/syntax/
- Fountain implementation guidance: https://fountain.io/developers/
- Live margins reference: https://highland-kb.quoteunquoteapps.com/kb/editor
- Browser PDF library: https://pdf-lib.js.org/ (MIT)
- Bundled font: https://github.com/google/fonts/tree/main/ofl/courierprime (SIL OFL)

The existing VXD importer intentionally changes screenplay meaning (action -> narration,
transitions -> notes) and discards some formatting. It is retained untouched. A separate
read-only native parser powers Studio, keeping original source ranges and screenplay roles.
PDF-lib and fontkit are Studio-only lazy dependencies. A shared page description is used for
both preview and PDF rather than relying on browser-specific print pagination.

## Subsequent sprints (not implicitly included in this release)

1. Improve the screenplay typing workflow based on observed use: completion, element commands,
   richer accessible preview, larger-script performance and additional language/font coverage.
2. Character dialogue workbench and alternate takes; share applicable improvements with Writer.
3. Plot threads, reference notes, and portable multi-document projects.
4. FDX interchange and performer-specific revision handoffs.

Promotion to default requires Writer's simple workflow, speed, phone usability and file
portability to remain available. More features alone are not a reason to deprecate Writer.

## Sprint results

Implemented on local branch `studio-fountain`, in `site/studio/` and `site/src/studio/`.
Run `pnpm site` from the repository and open `/studio/` on the printed local address.
Writer's source and feature set are unchanged; the new app shares CodeMirror dependencies.

The first independent Codex review found startup and document-replacement races, a mismatch
between normalized input limits and CRLF downloads, lyric layout errors, and an unbounded
scene outline. These were fixed with regression coverage. Other fixes keep parser warnings
visible after downloads and preserve editing/download when workers or browser storage fail.
The phone visual pass added a full-size, scrollable page preview alongside fit-to-page.
A fresh independent review confirmed those fixes and found a quadratic character-cue parsing
expression. That expression and related whitespace suffix checks were replaced with linear
scans. A third, focused independent review passed the fix, including three pathological
490,000-character inputs. No review blockers remain.

Validation includes source fidelity with BOM/mixed newlines, source size/line bounds, parser
and page-layout cases, real browser uploads/downloads, PDF generation, reload recovery,
independent tabs, delayed recovery writes, storage/worker failures, stale worker messages,
hostile text, mobile layout and offline editing in an already-loaded session. The 182,889-
character browser fixture laid out in 80ms on the development machine; this is not a phone
performance claim. The exported sample PDF was independently read and rasterized with PDFium:
two Letter pages, selectable screenplay text, omitted notes absent, dual dialogue side by side.
The browser checks are part of `pnpm site:check` and the Pages build gate.
All 37 Studio unit tests pass. Repository lint, typechecks, tests, package builds, and the
complete website/Writer/Studio browser regression gate pass;
the production dependency audit reports zero known vulnerabilities. Browser PDF checks also
read the downloaded files and verify their page counts and Letter/A4 dimensions.

### Current limits and next sprint priorities

- Experimental Fountain interpretation and pagination, not certified equivalence to a
  production screenplay tool. No locked pages, revision colors, FDX, or production reports.
- Courier Prime coverage limits PDF text: unsupported characters produce an actionable
  error; the original Fountain remains downloadable. No silent glyph replacement.
- Up to 500,000 normalized UTF-16 characters and 20,000 source lines per draft. Only the first
  500 scenes get outline buttons; all source remains editable/searchable/exportable.
- Local recovery is a browser copy, not a disk save or backup. Recovery currently reads all
  saved sessions and retains old copies. Next reliability work: indexed metadata listing,
  explicit draft deletion, and storage-usage feedback, without automatic destructive pruning.
- Offline typing and Fountain download work after loading. Offline reload/install and reliable
  first-use PDF export offline are not implemented. PDF/fontkit is a lazy ~508KB gzip chunk.
- Desktop Chromium and emulated phone viewport checks do not replace real iPhone Brave/Safari
  keyboard, touch, download and assistive-technology testing. Complete those before promotion.
- Next UX sprint: screenplay element shortcuts/completion, stronger scene/page navigation,
  preview accessibility, and clearer import/export feedback. Measure changes against a short
  writing task; keep optional UI out of Writer until it proves useful there.


## Production-hardening follow-up — 2026-11-18

The baseline status above is historical. The [production sprint log](studio-production-sprints.md)
tracks the subsequent 26 focused outcomes, independent review findings and release gates. Recovery
now uses indexed metadata pages and explicit deletion; Studio adds typing tools, completion,
navigation, workbenches, snapshots, portable backups, preferences and a command palette. Cross-engine,
accessibility, performance, security and sustained-session checks are repeatable. Studio remains
Experimental until the documented physical-device, assistive-technology and screenplay acceptance
gates are met; no publication is authorized by this local work.
