# Studio production hardening programme

User authorized 20–50 focused sprints on 2026-11-18. This sequence starts with the current
typing sprint; the initial Fountain implementation is baseline, not counted toward these 20.
Work stays local. No publication or server/account infrastructure is authorized.

## Review contract

Each numbered sprint must deliver a coherent user outcome, implementation, meaningful checks,
and independent Codex review. Review batches may cover several completed outcomes, but findings
and evidence must identify the affected sprint. A review is independent of its implementation.
Fix blockers before counting a sprint complete. Never inflate scores or count documentation-only
changes as product sprints. Stop after at least 20 and no more than 50 sprints; continue beyond
20 to resolve review findings when actionable. Report external testing gaps honestly.

The final reviewer scores each dimension out of 10, with evidence and objections:
- UI/UX: first-run task, text editing, keyboard/touch workflows, recovery/error feedback.
- Performance: bounded work/memory, long-script editing latency, background layout, lazy assets.
- Reliability: source preservation, undo, recovery, conflicting sessions, export fidelity/failure.
- Design: readable hierarchy, consistent controls, small-screen layouts, focus and contrast.
- Security: untrusted text/imports, network/privacy boundaries, dependency audit, storage handling.

9.5 requires no known material issue in that dimension, broad reproducible evidence, and a
credible production gate. Automated checks cannot establish real-device or screen-reader quality
alone. Missing evidence is a release limitation, not a reason to award an optimistic score.

## Planned sequence

| Sprint | Outcome | Status |
|---|---|---|
| 01 | Predictable pairing, note/emphasis tools, reversible typing assistance | Verified |
| 02 | Screenplay element commands and contextual writing actions | Verified |
| 03 | Character/location completion without intrusive prose suggestions | Verified |
| 04 | Searchable scene/section navigator and keyboard movement | Verified |
| 05 | Source-to-page navigation and readable, accessible preview | Verified |
| 06 | Focus/typewriter modes, text sizing and durable appearance preferences | Verified |
| 07 | Named local snapshots and safe compare/restore | Verified |
| 08 | Bounded recovery library, explicit deletion and storage feedback | Verified |
| 09 | Portable project backup/import with validation | Verified |
| 10 | Discoverable keyboard command palette and shortcut help | Verified |
| 11 | Useful writing statistics and optional writing goals | Verified |
| 12 | Character/dialogue workbench | Verified |
| 13 | Notes workbench and safe note navigation/editing | Verified |
| 14 | Actionable diagnostics with source navigation | Verified |
| 15 | Expanded Fountain/export conformance and regression corpus | Verified |
| 16 | File/recovery state clarity and data-loss prevention | Verified |
| 17 | Bounded worker scheduling, failure recovery and performance budgets | Verified |
| 18 | Mobile/touch and cross-engine browser hardening | Verified |
| 19 | Accessibility audit and keyboard/screen-reader structure improvements | Verified |
| 20 | Security/privacy and release-readiness hardening | Verified |
| 21 | Reuse exact immutable-source parsing to reduce formatting latency | Verified |
| 22 | Bounded, navigable snapshot comparison beyond the preview cutoff | Verified |
| 23 | Character dialogue excerpts with scene and source navigation | Verified |
| 24 | Consolidated writing preferences and recoverable backup cancellation | Verified |
| 25 | Sustained-session regression for recovery, memory and worker lifecycle | Verified |
| 26 | Persistent comparison highlights and compact phone review | Verified |

Sequence may change with findings; scope changes and evidence are recorded here. Later sprints
(21–50) address concrete review shortfalls, not feature accumulation for its own sake.

## Evidence log

### 01 — typing
Research: CodeMirror's automatic bracket-closing API and VS Code's language-aware pairing and
selection-surrounding conventions; Highland's Fountain emphasis shortcuts. Use established
editor behavior instead of intercepting every punctuation keystroke. Pair only brackets and
parentheses; preserve prose apostrophes/quotes and provide a persistent off switch.
Sources: https://codemirror.net/docs/ref/#autocomplete.closeBrackets,
https://code.visualstudio.com/docs/editing/codebasics#_autoclosing-brackets,
https://highland-kb.quoteunquoteapps.com/kb/fountain-syntax

Independent review found unsafe nested-note wrapping and incorrect unwrapping of distinct
formatted spans. These now fail safely without mutating text; targeted regressions cover both.
Browser regressions and fresh independent recheck passed. Further review found private-comment escape-context and partial-selection pairing cases; authoritative omission invariance and selection guards now cover these. Fifteen typing tests and real browser input checks pass.


### 02–06 — writing and navigation
Element commands preserve words and undo as one change. Explicit Ctrl/⌘ Enter inserts a separated
paragraph; ordinary Enter and Tab retain their editor behavior. Character/location completion is
bounded, restricted to screenplay contexts, and suppressed in private passages. Independent
review caught closing-comment line transformations; all commands now validate omission boundaries.
Twenty-six writing tests pass.

The outline includes searchable scenes and sections, 500 rendered matches, binary-search caret
tracking, and Alt PageUp/PageDown navigation. Four navigation tests plus browser jumps cover it.
Preview controls find the caret's page and return to source. Preferences provide system/light/dark,
four text sizes, focus, and optional typewriter scrolling, persisted defensively in local storage.
Integrated independent Chromium review passed command undo, completion, outline navigation,
appearance persistence, and centered typing. It found focus/preview state disagreement and
unbounded desktop editor height; both were repaired and independently rechecked.

### 07–10 — saved work and command access
Recovery v2 migrates valid legacy records without deleting damaged originals. Indexed metadata
pages avoid hydrating every screenplay. Ten real IndexedDB tests cover migration, corruption,
atomic writes, immutable snapshots, pagination, blocked upgrades and stalled transaction deadlines.
The library creates named snapshots, compares bounded previews, restores exact full source to a
new draft, and requires explicit deletion. Three real-browser library tests cover these flows.

Portable JSON backups validate schema/version, Unicode-safe filenames, source and combined size
limits before any replacement. Twelve engine tests and browser roundtrips cover exact BOM/newline
preservation, optional snapshots, malformed imports, and closing an unfinished import. Import
opens one selected draft/snapshot as a fresh draft; other versions remain in the backup file.
The command palette exposes secondary tools on small screens and supports filtering, arrows,
Enter and Escape. Independent integrated review passed these flows. Reliability review found
unbounded IDB operations and abandoned backup reads; deadlines and close epochs repair them.

### 11–14 — screenplay workbench
A lazy workbench provides printable/spoken word counts, an optional local draft-word target,
character cue/dialogue indexes, private notes/omissions, and source-linked parser diagnostics.
Nine insights tests cover Unicode, exact omission ranges, repeated/dual character cues and
20,000-line input. Counts exclude private passages and title/outline metadata. Speech duration is
explicitly an estimate, and unspaced-language word counts are approximate. Rendered results are
bounded; large private-note previews are shortened with access to exact source. Independent
engine and integrated browser reviews found no remaining blocker in these outcomes.

### 15 — conformance and export
Fourteen additional adversarial cases fixed first-line escaped transitions, escaped dual-dialogue
carets, and a direct-PDF malformed-comment bypass. PDF now independently checks exportBlocked.
The parent reviewed the parser/layout/PDF changes and the test corpus independently of its
implementer. See [conformance evidence](studio-conformance.md) for precise compatibility limits.

### 16–18 — recovery clarity, worker load and browser hardening
Startup/replacement lock the header and workspace together. Slow earlier file reads cannot
replace later user intent. Renaming updates recovery status; timed-out storage fails visibly while
source remains downloadable. The worker scheduler runs one calculation and retains only the
newest queued request, with explicit retry after timeout/crash. Eleven deterministic tests exercise
1,000-request bursts, stale callbacks, errors, restart and disposal. Maximum-source browser
performance checks additionally verify exact limits, source preservation and bounded DOM.

The full Studio browser regression suite passed Chromium, Firefox and WebKit on Linux. The
WebKit run used locally extracted runtime dependencies and a temporary wrapper; system packages
were unchanged. These runs include phone-sized layouts, source/download/PDF, private passages,
blocked workers/storage, delayed results, multiple tabs and already-loaded offline editing.
They are not physical iPhone, Brave Shields, virtual-keyboard or IME certification.

Independent UI review found header sizing and editor overflow; body/grid sizing now keeps the
workspace bounded. A separate refinement reduces phone chrome to one file row and one tool row,
puts secondary actions in Commands, provides 44px targets, and permits vertical scrolling on
short viewports rather than collapsing the editor. No desktop source margins were replaced with
literal indentation.

### 19 — accessibility
The repeatable built-output audit passes thirteen axe states with zero violations, plus keyboard
modal return, editable skip link, 320px reflow, short-viewport and touch-target checks. Repairs
include semantic headings/regions, keyboard-scrollable preview, placeholder/private-note contrast,
focusable editor, compact phone controls and usable 320×256 layout. See
[accessibility evidence](studio-accessibility.md). VoiceOver/NVDA and physical-device input remain
manual release gates; an automated pass is not a claim about those tests.

### 20 — security and release checks
Independent hostile-source checks and two PDF/security tests found no script execution or story
transmission. Production dependency audit reported zero advisories across 47 dependencies.
Built Studio now has a same-origin CSP, blocked objects/forms/base changes and no-referrer policy;
CodeMirror/page placement require inline styles. Development HMR does not receive the production
CSP. Filename handling is shared and bounds Unicode bytes, strips bidi/path characters and handles
reserved device names. GitHub Pages cannot supply frame-ancestors via a meta policy; recovery is
unencrypted same-origin browser storage. See [security evidence](studio-security.md).

CI now installs browsers for real IndexedDB unit tests and runs Studio in Chromium/Firefox/WebKit,
plus accessibility, maximum-source performance and sustained-session gates. `pnpm studio:check`
is the focused local release command. Final evidence is recorded below.

### 21 — follow-up performance refinement
The throttled maximum-source audit found ~63ms p95 formatting with repeated full parsing. A
WeakMap keyed by CodeMirror's immutable Text now shares exact current-source parses between
commands and fresh worker results; changed text has a distinct identity. Candidate edits are still
parsed and checked against all omission boundaries. This reduces redundant work without weakening
private-comment safeguards. Regression/performance recheck and independent review passed. The final recorded production 4×
CPU run measured 56.6ms formatting p95; the independent dev-server run measured 44.9ms. These
are separate observed runs, not a controlled benchmark or a physical-device performance claim.


### 22–24 — review-driven workflow refinements
A bounded Myers comparison reports added/removed/unchanged lines and navigates actual changes,
including changes after 50,000 characters. A work/trace budget reports when comparison cannot be
calculated safely. Original source remains exact for restoration. Engine tests include 300 LCS
oracle comparisons, repeated lines and pathological replacements. Real-browser library tests
exercise navigation, long sources, hostile markup and exact restore.

Character rows now expand to rendered dialogue excerpts, parentheticals and scene labels with
source links. One character is expanded at a time, with 25 cues per page and bounded excerpt text.
Private notes remain excluded. The pairing switch lives in Preferences, and mobile guide wording
matches the Commands menu. Canceling a backup replacement preserves the validated import and
selected snapshot; explicit dismissal clears it. Independent browser review forced storage failure
to verify both paths without replacing the current screenplay. Sixty-five targeted tests passed
in that independent review, with no correctness/security blocker.

### 25 — sustained-session gate
The regression exercises near-limit scripts through open/edit/undo/New/snapshot restore while
checking exact source, preview freshness, worker reuse and retained page heap/DOM. The independent
implementation ran 30 measured cycles over 120.3 seconds, plus three warm-up cycles: heap grew
2.69MiB then plateaued; one worker handled 233 calculations, with no outstanding requests at
settled checkpoints. See [soak evidence](studio-soak.md) for the precise bounds and limitations.
Review removed a speed-dependent cycle cap: healthy faster machines may execute more cycles to
cover the same duration. A ten-minute timeout now bounds an unexpectedly slow session.

### 26 — comparison clarity
Independent review found that textarea selection does not visibly highlight changes when neither
textarea has focus. Comparison now shows persistent labeled removed/added excerpts, arranged
side by side on desktop and as compact adjacent panels on phones. Changes are distinguished by
words/signs as well as tint. Full source versions expand on demand. Each excerpt is bounded to
40 lines/4,000 characters, with an explicit shortening notice and full-source access. Browser
regressions cover literal HTML, added-only changes, distant changes and a 420,000-character hunk.

## Release decision and remaining acceptance

Studio remains **Experimental**. Completing focused implementation sprints is not equivalent to
certifying a production screenplay tool. Local desktop automation cannot establish these gates:

- Physical iPhone Safari, Chrome and Brave with Shields on: keyboard, touch, downloads, memory
  pressure and reload/suspension behavior. The earlier landing-page incident is not evidence that
  Studio passes this matrix.
- Real IME composition, mobile dictation and VoiceOver/NVDA editing with OS input and speech.
- Long real writing sessions, storage eviction and low-device-memory behavior; the two-minute
  repeated-operation test is deliberately narrower evidence.
- Writer acceptance of pagination and printable PDF in external readers/printers, especially
  dialogue continuation, dual dialogue and Unicode/font limits.

Final independent scoped scores after sprint 26:

| Area | Rating |
|---|---:|
| UI/UX | 9.3/10 |
| Performance | 9.4/10 |
| Reliability | 9.3/10 |
| Design | 9.3/10 |
| Security | 9.3/10 |

The reviewer accepted the implementation within this scope with no remaining blocking software
finding. Six additional changed-comparison axe audits (light/dark at 1440, 390 and 320px) passed
without violations or horizontal overflow. The final blank-line-labeling finding is fixed and
covered by a browser regression. The scores remain below the requested 9.5 target because the
manual evidence above is still absent. Further feature accumulation cannot substitute for that
acceptance. This is a 26-sprint local checkpoint, not a declaration of production readiness.

Final repository `pnpm check` passed lint, typechecks, **2,254 tests across 83 files**, and package
builds. The production site build passed. Studio browser regression passed Chromium, Firefox and
WebKit; the 13-state production accessibility gate passed. Near-limit performance passed at 4×
CPU slowdown. The production soak passed **30 cycles / 122.4 seconds**, with **3.58MiB** retained
page-heap growth, one worker, and no pending calculations or browser errors. Earlier complete
landing/Writer/playground/docs visual/browser checks passed; a mixed-build Studio-tail failure
was resolved by rebuilding and separately rerunning all three Studio engines.
Work is local on `studio-fountain`; no GitHub repository, push or publication is part of this run.
