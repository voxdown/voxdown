# Explicit Fountain → VoxDown adaptation

Round 21 provides a deliberate bridge from Studio to VoxDown Writer: prepare and review a separate voice-performance adaptation, then explicitly download a `.vxd` file. The original Fountain source remains authoritative and unchanged. This is not a screenplay backup, reversible conversion, automatic Writer navigation, cloud upload or publishing action.

## Local format research

The implementation follows the repository's current format and core APIs:

- [VoxDown specification](../../spec/SPEC.md): cast front matter (§4.3), narrator and character marks (§5), quoted speech (§5.4), together/unison semantics (§5.10), free-text directions (§6), hidden headings (§9.3), private comments (§10.1), and escapes/character references (§11).
- [Core character handling](../../packages/core/src/chars.ts): every ASCII punctuation character and every supported quotation mark can be backslash-escaped; removing escapes and interpreting character references happens in one pass. Escaping ampersands preserves literal `&amp;` text instead of turning it into `&`.
- [Core parse](../../packages/core/src/parse.ts), [spoken lines](../../packages/core/src/lines.ts), [names](../../packages/core/src/names.ts), and [version](../../packages/core/src/version.ts) supply the runtime validation oracle and current declared format version. Core speech output normalizes whitespace and excludes punctuation-only speech.
- [Existing core Fountain importer](../../packages/core/src/fountain.ts) was reviewed but is not reused. Studio already has a richer parsed snapshot and reliable private ranges; deriving handles by removing punctuation can also collide. This adapter uses Studio's AST and allocates distinct handles deliberately.

No external format schema, server, AI service, Writer modification or new dependency is introduced.

## Mapping and deliberate losses

`adaptToVoxDown(source, {readSceneHeadings?: boolean})` returns `{source, bytes, cast, spokenRows, dualCues, report}`.

- Public action and centered action become narration. Centered alignment is omitted.
- Public dialogue retains its Studio cast identity. Unicode/case/whitespace normalization and trailing cue-extension handling follow the existing character-insights implementation. Handles are allocated `Cast1`, `Cast2`, … in first spoken-use order, with full cast names in quoted YAML. Names such as `MARY JANE` and `MARYJANE`, punctuation variants and non-Latin names stay distinct. A character called `Narrator` receives a cast handle separate from the narrative voice.
- The default scene heading is an escaped `##` heading with `{hidden}`. The reader can explicitly choose to have scene headings spoken by the narrator instead. Production scene numbers are omitted and counted.
- Cue extensions become performance directions. Parentheticals provide directions for following lines until a new direction or cue; consecutive parentheticals are combined. These are free-text instructions for human review, not a claim that a speech engine understands every direction.
- Lyric lines get a `sung` direction, with existing character attribution or narrator attribution when there is no character cue.
- Dual dialogue becomes separate speeches in source order. The UI requires an explicit acknowledgment before downloading any adaptation with dual cues. Overlap and timing are lost. VoxDown `+` is deliberately not generated: it denotes the same words spoken in unison, not separate simultaneous speeches.
- All completed private notes/boneyards, all title-page fields including contact/author details, and all outlines/synopses are excluded. Transition directions and explicit page breaks are omitted and counted. Margins, fonts, pagination and production revisions do not transfer.
- Fountain emphasis is rendered into plain words rather than reinterpreted as VoxDown emphasis. Each nonempty physical action/dialogue/lyric line becomes a separate VoxDown paragraph. Whitespace is normalized to the core's spoken-text semantics. Intentional blank dialogue lines create no spoken words or timed pause; the report discloses their count.
- An unfinished or nested private comment blocks adaptation. The shared `assertUnambiguousOmissions` helper guards nested delimiters consistently with other public exports. A parenthetical without subsequent spoken words in its speech also blocks adaptation, because no silent drop or invented spoken direction is acceptable. Public punctuation/symbol-only lines that core `lines()` would discard are refused with an actionable message. Invalid public control characters or lone surrogates are refused.

Empty cues have no spoken words and do not produce cast entries. Handles are deterministic for the same input, not stable identifiers across edits or reordered speeches. Keep Fountain for exact source and production layout.

## Generated-source safety and validation

All ASCII punctuation and all core-supported quote marks in public content and directions are escaped. That includes literal marks, brackets, grouping colons, heading signs, comments, notes, HTML punctuation, backslashes and entity ampersands. Cast display names are quoted YAML data; only generated alphanumeric handles enter structural marks.

The adapter reparses the complete candidate with the public core `parse()` and `lines()` APIs before returning it. Validation requires:

1. No parser warnings or generated groups.
2. Exactly the planned speech rows in order, with matching normalized text, speaker handle, direction, heading level and no together flag.
3. Exactly the declared cast handles and full names.
4. Exactly the planned scene-heading text and selected visibility.

Any mismatch refuses the entire candidate. There is no partial download or fallback that silently changes attribution. Literal Fountain text cannot introduce VoxDown sounds, instructions, notes, comments, groups or extra speakers without failing validation.

Studio input limits still apply: 500,000 normalized characters and 20,000 lines. Generated output is capped at 4 MB UTF-8, with an early two-million-code-unit body guard to stop repeated long directions from creating an excessive candidate. Checks are linear over bounded source/output; core parsing is loaded on demand, outside the editing path.

## Dialog integration

`mountAdaptation(host, {current: () => ({source, name}), download(bytes, name, type)})` returns `open()` and `close()`.

The dialog captures source/name on open and starts adapter/core validation in an on-demand module worker. It displays a compatibility report, up to 30 cast mappings, and an optional read-only preview capped at 8,000 characters. The download contains the complete validated adaptation. Scene headings are hidden by default. Dual-delivery acknowledgment is initially unchecked and resets whenever options change.

Preparation and option changes never download. Only the explicit **Download adapted .vxd** button invokes the host download callback with `text/plain;charset=utf-8`. It is disabled while preparation is pending, on failure, or while dual acknowledgment is missing. Host download exceptions keep the validated result available for retry. A separate snapshot continues to represent the original content if the editor later changes.

Generation and worker guards reject delayed loads/results after Close, Escape, option changes or reopening. Closing clears raw snapshot, generated text, cast/report and preview. Queued close events cannot clear a newly reopened dialog. Source, storage, history and Writer are untouched. This export must not be recorded as an exact-source recovery copy.

Root owns command placement and styles for `.adaptation-dialog`, `.adaptation-cast`, `.adaptation-preview`. Long cast names and report text must wrap; the cast list is keyboard-focusable and the text preview is read-only. The host should use its ordinary file-download helper and leave Writer navigation to the user.

## Verification

22 pure tests exercise known spoken-row mappings, hidden/spoken headings, collision-free Unicode/punctuation/Narrator cast identities, extensions and changing directions, every ASCII punctuation character and supported quote, character references and injection-shaped text, private/title/outline exclusion, malformed/nested comments, dual sequential semantics, unsupported trailing directions/punctuation-only speech, structural-loss reports, BOM/newlines, source limits, 3,000 rows, output expansion and invalid Unicode.

Eleven isolated Chromium tests use the actual worker and core modules through an in-memory module server. They cover explicit download only, captured source/name, no persistence, heading-option recomputation, mandatory dual acknowledgment/reset, delayed module cancellation/reopen, Escape cleanup/focus, malformed-private refusal, bounded preview/cast DOM, hostile filenames and retryable download errors. These are structural and browser integration checks; a human should still review the adapted performance in Writer before production use.

Integrated author smoke: at a 320×700 viewport, the dialog and expanded source preview fit a 294px content width with no horizontal overflow; axe reported no violations. An actual `.vxd` download with two colliding-looking cast names, dual dialogue, private/title text and literal injection-shaped words was independently reparsed through the browser's core module. The expected three spoken rows, distinct handles, directions and literal words matched; the original Fountain download remained exact. Independent implementation review is tracked separately by the parent programme.


## Round 27: cancellable preparation worker

Conversion and the core parse/lines verification now run inside a dedicated module worker. `adaptation-client.ts` is small and imports adaptation types only; its static `new URL("./adaptation-worker.ts", import.meta.url)` creates the heavy worker only after opening the adaptation dialog. Core parsing is not executed or imported into the main thread by this feature. The existing pure adapter and all source/attribution/privacy validation remain unchanged.

The dialog displays Preparing immediately and keeps Close/Escape available. A running option change terminates the obsolete worker before starting a new request. An idle completed worker may be reused while the dialog is open. Close terminates either running or idle workers, settles pending promises, clears captured source/results and releases the worker heap. Request IDs plus worker identity and dialog generation guards prevent late messages/errors/queued close events from changing a newer snapshot or its readiness. Completion never moves focus.

A 15-second deadline covers worker loading and preparation. Constructor/postMessage errors, worker crashes, unreadable messages, malformed results and timeouts terminate the worker and expose an explicit Retry preparation action. Expected source-validation errors likewise terminate and display the adapter's fixed actionable message. Worker runtime exception details are never copied into the UI. There is no automatic retry and no synchronous main-thread fallback when workers are unavailable. Retry, changing options or close/reopen are explicit fresh attempts. Download remains disabled until the latest request validates and any dual-dialogue acknowledgment is given.

The worker entry lives in Studio's asset scope; the existing offline build graph follows worker URL literals and bundles its dependencies. Production/nested-base/offline validation is owned by the build/offline reviewer, separate from isolated module tests.

Validation adds 14 client lifecycle tests and expands the real-module Chromium dialog suite to 11 tests, alongside the unchanged 22 pure conversion tests (47 total). Coverage includes lazy startup and core loading, idle reuse, active-job termination, cancellation settlement, stale callbacks/IDs, close/reopen, constructor/postMessage failure, runtime/message failure, malformed results, timeout cleanup, actual worker crash and retry, and option changes while a worker is still loading. Browser tests execute the actual worker and core modules. Independent performance measurements compare the prior 400–600ms main-thread stalls at 4× CPU throttling with this worker path; those measurements are reported separately rather than treated as unit-test timing guarantees.
