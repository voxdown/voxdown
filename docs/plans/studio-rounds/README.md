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
| 17 | Guarded FDX import with supported-subset conversion report | Verified |
| 18 | Self-paced performer rehearsal cards | Verified |
| 19 | Guided Fountain practice isolated from the writer's screenplay | Verified |
| 20 | Consistent private-comment preflight across public handoffs | Verified |
| 21 | Explicit, validated VoxDown voice adaptation | Verified |
| 22 | Read-only local-file comparison with bounded word highlighting | Verified |
| 23 | Reproducible interchange against an actual pinned Screenplain exporter | Verified |
| 24 | Previewed, collision-safe Fountain scene numbering | Verified |
| 25 | Public scene/cast breakdown with explicit spreadsheet-safe CSV | Verified |
| 26 | Guarded local screenplay drops using the same safe Open path | Verified |
| 27 | Cancellable worker preparation for VoxDown adaptation | Verified |
| 28 | Command names outrank incidental category matches; stable task ordering | Verified |
| 29 | Narrow-dialog reflow and light/dark accessibility coverage | Verified |
| 30 | Lossless UTF-8 source download preserves recovery-loss safeguards | Verified |
| 31 | Bounded PDF font headers/body loading with clean retry | Verified |
| 32 | Explicit mobile focus mode with more room for writing | Verified |
| 33 | Discoverable mobile File menu using the existing task palette | Verified |
| 34 | Temporary expanded tablet/desktop screenplay preview with safe return | Verified |
| 35 | Successful-action notices yield writing space on next accepted edit | Verified |
| 36 | Atomic NUL-input rejection and exact emergency recovery for invalid legacy drafts | Verified |
| 37 | Corrupt PDF font responses release cached bytes for an explicit fresh retry | Verified |
| 38 | Reach every workbench result through bounded pagination | Verified |
| 39 | Verify offline font bytes and repair damaged cache entries without losing good fallbacks | Verified |
| 40 | Explicit printed-Unicode positioning preflight and keyboard-readable warnings | Verified |

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

Rounds 17–20: independent review covered hostile XML, literal Fountain conversion, metadata
loss reports, asynchronous replacement cancellation, complete hidden/revealed speeches,
dual-dialogue context, beginner practice isolation, and shared private-output boundaries.
Mobile rehearsal setup now collapses explicitly for focused practice. Bare scene prefixes
and time-only headings do not complete the location exercise. Component coverage totals
102 tests. Integrated Chromium, Firefox and WPE WebKit, plus 27 accessibility states, pass.
An initial WebKit run timed out in the older degraded-backup confirmation check; an isolated
rerun passed that check and the complete suite. The expanded session
soak passed 30 measured cycles over 121.8 seconds, rotating new tools against a 499k-character
screenplay: 3.74 MiB retained page-heap growth, stable DOM and one reused worker. This is a
short active regression, not proof of hours-long or physical-device stability.


## Review evidence for rounds 21–29

Adaptation validates the generated text through the actual VoxDown core, preserves literal
text/cast attribution, omits private/title/contact fields and requires acknowledgment for
sequential delivery of dual dialogue. File comparison is read-only and bounded; scene
numbering preserves exact source bytes outside intended markers and supports atomic undo.
Breakdown reports distinguish actual scene occurrences and speaking roles, explain complete-
scene filter counts, and protect exported CSV cells from formula interpretation. File drops
reuse recovery confirmation, strict decoding, limits and stale-read guards.

Independent review repairs: empty comparison excerpts now have named region semantics;
nested ambiguous private comments block numbering before preview; unnamed-cue dialogue
contributes words without inventing cast roles. Native-worker preparation cancels obsolete
jobs and releases its worker on close, with explicit Retry and no blocking fallback.
Exact command-name search now chooses the requested tool rather than a category match.
320px Preferences and populated rehearsal selects now fit their dialogs; both appearance
modes receive dialog-level geometry checks beyond page-level overflow and axe.

Actual Screenplain0.12.0 interchange is reproducible from a pinned, hash-verified producer;
root independently regenerated its fixture. It does not substitute for native Final Draft
acceptance. Workerless/blocked-worker editing and Fountain downloads remain available.

Intermediate batch evidence: `pnpm check` passed 2,806 tests in121files, lint, typechecks and
package builds. Built Chromium passed after pacing the test's burst of inspection downloads:
Blink silently throttles10 downloads within one second, and the expanded test exceeded that
rate. Product downloads were unchanged. Full root/nested offline checks proved first-use
adaptation after network disconnection. The final worker build is under full verification.

Measured before worker isolation at4×CPU: near-limit adaptation caused400–600ms main-thread
frame gaps; comparison30ms, numbering109ms, and breakdown296ms on their documented fixtures.
These fixture measurements guide prioritization, not device guarantees. Final post-worker
measurements and cross-browser results are recorded after the gates finish.


Release-audit findings became rounds30–31: malformed Unicode from an exact JSON backup must
not silently become a lossy Fountain download or satisfy the recovery escape hatch; stalled
PDF font headers/body must time out and release the export action for retry. Both have
regressions, with independent acceptance recorded as each finishes.

The intermittent WPE backup-confirmation test was traced to its fault injection: the browser
replaced the IndexedDB instance wrapper, restoring native `open` and allowing a legitimate
successful save. A prototype-level override remains effective across wrapper replacements;
isolated0/1s/2s checks confirm both expected prompts and exact cancel preservation. This is
a test repair, not a new round or evidence of a product data-loss bug.

Post-worker quiet4×CPU performance: three near-limit adaptation samples had16.7–16.8ms
maximum animation-frame gaps and zero main-thread long tasks; pending Close took7.3ms and
terminated the worker. Ordinary sustained typing p9511.5ms. Full root/nested offline first-
worker adaptation passes. Final browser tests and remaining findings remain in progress.


Final validation for rounds21–31: `pnpm check` passed2,841 tests in123files, lint,
typechecks and package builds. Built Chromium, Firefox and WPE WebKit regression suites
passed, including malformed-Unicode source/download/replacement/JSON-backup preservation.
Direct-file failure/race gate passed.47 accessibility states passed; prototype-level WPE
storage denial is now durable. Font deadlines were independently exercised against real
stalled HTTP headers and bodies in allthree engines, with shared rejection and successful
retry. All work remains local; no publication or push.

Independent journey review passed desktop1440,tablet768 and320px workflows from six practice
lessons through writing/revision, downloads, rehearsal, snapshots, reload and older-version
recovery.21 populated phase accessibility audits had no violations. Scoped judgments were
UX8.8/design8.6/accessibility9.0, performance9.4, and provisional reliability9.2/security9.3;
these are candid reviews, not production certification. Identified mobile-control density
and file-action discovery are being addressed in32–33. Physical input/screenreader/native
file and print gates remain unverified; code-only rounds do not substitute for them.


Rounds32–34 independent native-browser checks: Focus recovers168px at320×700; File tools
fit the existing44px row at320/375px and preserve exact source/keyboard return. Expanded
preview grows tablet text6.19→14.33px, caps desktop paper at816px and preserves source,
selection, zoom and outline preferences. Reference tab changes, source navigation, Focus
and mobile resizing safely leave expansion. No horizontal overflow or axe violations.
Built Chromium and47-state accessibility gates pass after the layout changes. Full pnpm
check passes; physical-device input and screenreader acceptance remain unverified.

Expanded active-session regression now exercises adaptation workers, breakdown, numbering
preview and comparison alongside the earlier tools:27 cycles/123seconds,2.27MiB retained
page-heap growth, bounded DOM, one reused parser worker and zero adaptation workers left
alive after tools close. It does not measure worker heap or prove hours-long stability.


Rounds35–40 close findings from complete-task and failure audits. Success-only notices clear
on the next accepted source edit; important messages remain. NUL paste is rejected atomically,
and invalid legacy records can be downloaded unchanged as explicit emergency recovery JSON.
Workbench Characters/Private notes/Diagnostics now page through every match while retaining
at most100 rows. Font embedding/subsetting failures invalidate only their own rejected bytes;
HTTP cache reload and worker cache repair are explicit, bounded and preserve good fallbacks.
Build-specific SHA256 checks detect damaged offline fonts. Printed combining marks and format
controls receive a bounded warning and block PDF before fetching fonts; precomposed supported
letters and private omissions retain their intended behavior. Both scrolling warning panels
are keyboard accessible. No source normalization or unsupported shaping claim was added.

Independent final-batch audit:54 targeted tests and live nested-private handoff/hostileFDX
flows passed, with no external requests or private-tail leakage. Native320×300/320×700
warning panels pass keyboard and axe checks. Candid reviewed-scope ratings: UX9.0/design8.9/
accessibility9.1/reliability9.3/security9.3. Remaining mobile chrome density and advanced-tool
discovery are usability tradeoffs. These judgments do not certify physical input, screenreaders,
OS file permissions, external screenplay applications or printed pages. Final built regressions
and quiet performance results follow when completed.


## Validated local checkpoint:40 rounds

Final `pnpm check` passes2,909 tests in134files, lint, typechecks and package builds. Built
Chromium, Firefox and WPE WebKit complete regression gates pass;47 accessibility states,
direct-file failure/race tests and root/nested offline gates pass. Offline acceptance includes
real corrupted-font repair, subsequent offline PDF, first-use voice adaptation, failed updates,
stalled headers/bodies and old-client retention. Build: `ad733cedc71e2b377486f2bb`.

Quiet4×CPU final performance: sustained typing keydown-to-next-frame p95=16.0ms/max20.6ms;
typing across worker updates p95=16.8ms/max17.4ms; zero observed main-thread long tasks in
those flows. Three near-limit adaptations had maximum frame gaps16.7ms with zero long tasks.
Editor/outline/workbench/recovery DOM bounds all pass. These are desktop regression measurements,
not physical-phone latency promises. The expanded27-cycle/123-second soak remains the active-
session check; it is not an hours-long endurance or worker-heap claim.

One initial full-suite run timed out in the new notes-pagination browser test, while2,908
others passed. Isolated checks and the complete rerun passed; a shorter Playwright locator
timeout now yields useful call-site diagnostics before the overall test deadline. No product
cause was reproduced, so this remains a recorded intermittent test observation, not a claimed
product repair. No acceptance failures were suppressed or budgets relaxed.

All40 rounds are implemented and independently reviewed. The100-round authorization is a
ceiling;60 rounds remain unspent. This is a strong experimental release with documented
manual acceptance gates, not a claim that every dimension has reached9.5 or that physical
browser/OS/native-app testing occurred. See [hands-on walkthrough](../studio-hands-on.md).
No push, publication, account backend or Writer migration occurred.
