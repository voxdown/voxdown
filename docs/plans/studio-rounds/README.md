# Studio: 100-round development budget

Authorized 2026-11-18. Baseline: local commit `77ec331` on `studio-fountain`.
This is a budget of up to 100 focused implementation/review cycles, not 100 promised
features or a calendar estimate. The prior 26 sprints are baseline and are not recounted.
No push, publication, account service, remote processing or Writer migration is authorized.

## Working contract

- Each counted round delivers an observable outcome or resolves an identified defect, with
  meaningful verification and independent Codex review before completion.
- Batch related reviews; record findings, repairs and evidence. Do not count tool calls,
  documentation churn or repeated passing tests as rounds.
- Keep Fountain source authoritative. Preserve exact downloads, safe undo, private omissions,
  portable backups and graceful failure when storage, workers or optional APIs are unavailable.
- Treat keyboard and file access as progressive enhancements. No silent cloud fallback.
- Keep the ordinary writing view quiet; advanced tools appear on request.
- Review real user tasks, accessibility, performance, reliability, security and visual design.
  Ratings are judgments of the reviewed scope, not competitive or production certification.
- Physical-device, OS input, screen-reader and writer acceptance remain explicit human gates.
  Do all accessible engineering work; never invent their results or inflate ratings.
- Commit reviewable batches locally. Maintain an honest remaining-work list across sessions.

## First batch

| Round | Outcome | Owner | State |
|---|---|---|---|
| 01 | Optional screenplay Enter/Tab mode with safe undo and composition fallbacks | keyboard agent + root integration | Verified |
| 02 | Optional source page guides derived from actual preview/PDF layout | root | Verified |
| 03 | Direct file saving with cancellation, conflict detection and download fallback | file agent + root integration | Verified |
| 04 | Explicit offline preparation, reload and PDF assets with safe cache updates | offline agent + root integration | Verified |

The first independent review covers the integrated outcomes, including adversarial source,
privacy boundaries, file races, old/new offline versions and accessibility. Review findings
are fixed within their round; a later round is counted only for a distinct outcome.

## Review evidence for rounds 01–07

Rounds 05–07 add previewed character renaming, contextual line help and searchable scene
cards with safe source rearrangement. Independent review covered cue collisions, stale
previews, single-step undo, source/omission preservation, EOF moves, bounded rendering and
320px layouts. Long displayed labels are truncated; their source is unchanged.

| Round | Outcome | State |
|---|---|---|
| 05 | Cue-aware character rename with collision acknowledgement and atomic undo | Verified |
| 06 | On-demand Fountain explanation at the caret with return-to-writing focus | Verified |
| 07 | Searchable scene cards, previewed within-section moves, exact source and undo | Verified |
| 08 | On-demand storage health and explicit persistence request | Verified |
| 09 | Performer PDF sides with complete scene context and private-note exclusion | Verified |
| 10 | Focused editing of a character speech with safe source-boundary checks | Verified |
| 11 | Previewed literal replacement scoped to scene, dialogue, action or selection | Verified |
| 12 | Location directory and conservative heading-only rename | Verified |
| 13 | Session-only literal text reference beside the screenplay | Verified |
| 14 | Conservative FDX export with explicit compatibility report | Verified |
| 15 | Editable portable scene synopses with exact source preview and undo | Verified |
| 16 | Categorized commands, semantic aliases and predictable keyboard discovery | Verified |
| 17 | Guarded FDX import with supported-subset conversion report | Implementing |
| 18 | Self-paced performer rehearsal cards | Implementing |
| 19 | Guided Fountain practice isolated from the writer's screenplay | Implementing |

Validation for the first seven rounds:
- `pnpm check`: lint, typechecks, 2,376 tests in 89 files, package builds passed.
- Built Studio regression suite passed in Chromium, Firefox and WebKit (local WPE runtime).
- Accessibility: 16 audited states, no axe violations; 320px reflow, touch targets and dialog
  focus passed. Native close-event focus assertions wait for the asynchronous event.
- Built direct-file gate passed, including unavailable recovery plus external conflict.
- Full offline gate passed twice, including an independent reviewer rerun: root/nested
  scopes, offline first PDF, partial repair, failure/retry, old lazy assets, live-version
  retention/retirement, injected storage failures, held headers and stalled response bodies.
- Four-times CPU-throttled 500,000-character performance gate passed; sustained typing
  p95 9.3ms keydown-to-next-frame on this machine. This is not a phone benchmark.

Review repairs: external file conflict no longer bypasses recovery-loss guards; service
worker owns its parser-worker path; failed repair preserves a usable cache; updates retire
unused versions without breaking live tabs; navigation has a 2.5s bounded cached fallback;
320px writing controls and 800px tablet chrome were tightened. Manual OS picker, physical
phone, IME, screen-reader and writer/PDF acceptance remain open, not simulated as completed.

## Review evidence for rounds 08–16

Independent reviewers exercised source isolation, private-text omission, stale snapshots,
exact downloads and atomic undo, browser storage failures, narrow layouts and keyboard
access. Repairs within these rounds include late persistence-permission refresh, repeated
actor-search layout work, scrollable rename preview access, reference-read cancellation and
focus theft, removal of an already-empty synopsis block, and Escape closing populated
command searches. No review finding is counted as a separate round.

FDX validation includes an independent browser XML parser and source-preserving real-file
downloads, based on pinned public exporter implementations. Native Final Draft import and
layout remain an explicit manual acceptance gate. Rehearsal and import work is not counted
as complete until its independent review and integration checks pass.

Measured local 4× CPU checks: actor search with unchanged selection 0–0.2ms after caching
its preview (previously 314–418ms); 9,000 scoped replacements on a 405k-character fixture
151ms; a 3200-scene synopsis plan on 442k characters 80ms; FDX export of 363k characters to
1.33MB 148ms. These are fixture measurements on this machine, not device guarantees.

## Prioritised queue after this batch

1. Guided first screenplay, contextual help and intelligent name/location rename previews.
2. Storage health, independent backups, suspension/reload resilience and safe upgrades.
3. Portable projects and stable scene identity; cards, safe rearrangement, plot/status filters
   and reference material beside writing.
4. Editable character dialogue, alternate takes, anchored review notes, scene/word comparisons
   and scoped replacement previews.
5. FDX import/export with explicit compatibility reports; external pagination and PDF checks,
   export presets and staged multilingual coverage.
6. Actor sides, rehearsal cues, local-voice read-through where available, explicit VoxDown
   adaptation and portable performer handoffs.
7. Physical/mobile/IME/assistive-technology findings, longer sessions, memory/battery profiling,
   consistent panels and keyboard discoverability.
8. Production revision sets, scene/page locking, changed-page export, breakdowns and exchanged
   review changes only after the underlying interoperability and revision model is dependable.

Allocate the remaining rounds from evidence, not feature accumulation. The 40-round proposal
is direction, while this 100-round budget gives room for deeper implementation, compatibility
research and meaningful repair loops. Hosted collaboration, generative rewriting, plugin
marketplaces and a full novel-publishing suite remain outside the initial programme.

Validation for rounds 08–16: `pnpm check` passed (2,597 tests in 104 files, lint,
typechecks and package builds). Built Studio flows passed in Chromium, Firefox and WPE
WebKit. All 23 accessibility states passed after fixing the selected preview tab hover
contrast. The root/nested-scope offline gate passed with the expanded asset graph.
The 4× CPU 500k-character performance gate passed, sustained typing p95 15.7ms and no
measured typing long tasks on this machine. These checks cover the second batch only;
rounds 17 onward remain in progress.
