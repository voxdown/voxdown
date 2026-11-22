# Studio sustained-session regression

`node scripts/check-studio-soak.mjs` serves the production build on an ephemeral local port. Build first with `pnpm site:build`. To test the development server, use `STUDIO_SOAK_URL=http://localhost:5173/studio/ node scripts/check-studio-soak.mjs`.

The gate performs three warm-up cycles, then at least 25 measured cycles and at least two minutes of active operations. It never pads the observation window with idle sleeping. Each measured cycle opens a different 499,000-character screenplay with 19,005 physical lines, edits across three preview calculations, undoes the edits, creates an empty document, restores an immutable snapshot, and opens/closes the notes workbench. The 550ms interval between typing bursts separates CodeMirror history events and allows recovery writes; it is part of the editing scenario.

Every cycle asserts exact downloaded source after opening, editing, undo, New, and snapshot restoration. Undo after document replacement must not expose text from the prior document. Preview content must match the newly opened/restored document. Browser exceptions and unexpected recovery-loss confirmation dialogs fail the run.

Chromium DevTools Protocol collects the page heap after forced garbage collection at a warmed baseline, every five cycles, and completion. The final retained heap must stay within **both 24MiB additional heap and 1.8× the warmed baseline**. These generous regression ceilings allow normal JIT/cache variation while detecting accumulation of many obsolete source documents or editor histories; they are not a performance target. Browser document count must remain constant, and retained DOM-node growth must remain below 1,200 nodes. The same restored source and workbench state are used for each checkpoint.

A test-only Worker subclass records counters without retaining message payloads. Exactly one worker may be created, at most one calculation may be posted at a time, and every settled checkpoint must have zero outstanding calculations. This checks observable worker scheduling; it does not inspect the scheduler's internal queued slot.

Results are written as JSON to `/tmp/voxdown-studio/soak.json`, overridable with `STUDIO_SOAK_REPORT`. The report includes browser version, build/development mode, actual active duration, cycle timing, heap/DOM checkpoints, worker counters, and failures.

## Limits of this evidence

- Two minutes and repeated near-limit replacements can reveal regressions; they cannot establish hours-long reliability.
- CDP page heap excludes worker-process heap, GPU memory, and IndexedDB disk use. Recovery drafts deliberately accumulate in this isolated browser's database; this is expected persistence, not evidence of a page-heap leak.
- Forced garbage collection measures retained memory, not peak memory or real-world garbage-collection pauses.
- Desktop headless Chromium does not substitute for real iPhone Safari/Brave, OS memory pressure, browser suspension, or device storage eviction testing.
- The gate preserves source/download correctness and current preview identity. Screenplay pagination correctness is covered separately by conformance and browser export tests.

## Recorded execution

The development-server run passed on 2026-11-18 with Chromium 153.0.8010.12:

- Three warm-up cycles plus **30 measured cycles over 120.3 seconds** of active cycling.
- Retained page heap: **15,606,916 bytes warmed → 18,424,740 bytes final**, an increase of **2.69MiB / 1.18×**. Intermediate checkpoints plateaued rather than growing with every replaced screenplay.
- Retained DOM nodes: **2,623 → 2,806**; one browser document throughout.
- **233 worker requests and 233 replies**, one worker created, maximum one posted calculation in flight, zero pending at every settled checkpoint.
- Exact source checks, fresh undo history, current-preview markers, recovery, and bounded notes rendering all passed. No browser exceptions or unexpected dialogs occurred.

This records a development-server run. The gate can also run against the production build; that result must be recorded separately rather than inferred.


## Production-build recheck

The production build separately passed on 2026-11-18: three warm-up cycles, **30 measured cycles
in 122.4 seconds**, retained page heap **14,858,996 → 18,608,948 bytes** (**3.58MiB growth**),
DOM **2,639 → 2,909**, one document and one worker. All **233 calculations** received replies,
maximum one in flight and zero pending at settled checkpoints. No browser errors occurred.
Report: `/tmp/voxdown-studio/soak-production.json`. CI and `pnpm studio:check` now run this gate.

Independent review removed the original 50-cycle ceiling because fast machines could hit it
before covering two minutes. A ten-minute active-session timeout now detects excessive runtime
without penalizing faster execution. The page/worker-memory and real-device limitations above
still apply.
