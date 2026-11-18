# Studio performance gate

Sprint 17 adds `scripts/check-studio-performance.mjs`. Run after `pnpm site:build`:

```sh
node scripts/check-studio-performance.mjs
STUDIO_PERF_CPU_RATE=4 STUDIO_PERF_REPORT=/tmp/voxdown-studio/performance-cpu4.json node scripts/check-studio-performance.mjs
```

By default it serves the production build on an ephemeral loopback port and opens a fresh, isolated Chromium context. `STUDIO_PERF_URL=http://localhost:5173/studio/` can target the development server. Reports are written to `/tmp/voxdown-studio/performance.json`, overridable with `STUDIO_PERF_REPORT`. The browser context and local server are closed even on failure. Fixtures and seeded snapshots never enter the user's browser storage.

## Workload and assertions

The fixture starts at **499,500 UTF-16 characters and 19,950 physical lines**, near both supported limits, while reserving space for real edits. It contains 1,994 scenes, 1,995 distinct characters, 1,995 private notes, and one unusually long action line. It must produce a valid page layout before measurement begins.

The gate exercises:

- 180 ordinary characters at 20 ms intervals, followed by eight typing bursts with pauses that allow debounced worker results to update the editor.
- Twelve opening-parenthesis / paired-Backspace sequences.
- Twelve selected-word formatting toggles. A separate assertion proves formatting actually changes the source, avoiding a falsely fast no-op measurement.
- Eight explicit character-completion openings and dismissals. The actual popup must appear; its end-to-end appearance is measured separately from keydown response.
- Exact downloaded-source comparison after each interaction group.
- Bounded CodeMirror viewport, 500 outline entries, 100 character rows, 100 note cards, and 100 library rows after paging through a database with 1,200 snapshots.
- Exact 500,000-character and 20,000-line boundary rejection with byte-preserved source.
- No page exceptions.

The worker queue itself is covered by `site/test/studio-scheduler.test.ts`: at most one active request and one newest queued request, superseded requests settled, bounded timeout/restart behavior, stale replies ignored, and disposal rejection. The browser workload complements those deterministic queue tests.

## Budgets and interpretation

Ordinary typing uses a **250 ms p95 / 1,500 ms maximum** keydown-to-next-animation-frame budget. Explicit commands use **500 ms p95 / 2,000 ms maximum**; completion popup appearance must have p95 at or below **500 ms**. Preview readiness has a 15-second timeout. These deliberately generous regression ceilings tolerate shared CI load. They are release failure thresholds, not claimed ideal UX targets or evidence of a 9.5/10 product score.

The input metric starts in a capture-phase `keydown` listener and ends at the next animation frame. It measures event handling and frame scheduling, **not** physical display presentation or field INP. Modifier keydown events are included. Event Timing and long-task observations are recorded as supporting diagnostics; their asynchronous delivery can overlap neighboring phases, so their counts are not standalone assertions. Popup timings include browser-automation overhead and intentional completion scheduling delay.

CPU throttling is a controlled desktop stress test. It does not emulate an iPhone's hardware, memory pressure, keyboard, thermal behavior, WebKit engine, or Brave Shields. Real-device writing, IME composition, and long-session memory behavior remain separate release evidence.

## Recorded production-build run — 2026-11-18

Chromium 153.0.8010.12, Linux desktop, 1,440 × 1,000 viewport, fresh browser context. Two runs passed all assertions:

| Interaction | Normal desktop p95 | 4× CPU slowdown p95 |
| --- | ---: | ---: |
| Continuous ordinary typing | 14.7 ms | 10.8 ms |
| Typing across worker updates | 15.5 ms | 9.5 ms |
| Parenthesis pairing/deletion | 22.9 ms | 43.1 ms |
| Selected-word formatting | 30.7 ms | 63.2 ms |
| Completion keydown to next frame | 15.8 ms | 14.5 ms |
| Completion popup visible | 83.7 ms | 95.7 ms |

Opening the maximum-size fixture took 258 ms normally and 478 ms under 4× slowdown. The non-monotonic frame timings for ordinary typing reflect frame-phase sampling; they do not mean throttling made typing faster. The DOM contained 55 editor lines, 500 outline buttons, 100 character rows, 100 note rows, and 100 snapshot rows.

No long tasks were observed during the measured normal-desktop interaction phases. Under 4× slowdown, selected formatting produced twelve 56–60 ms long tasks, and one 56 ms task appeared during the burst/worker phase. Formatting performs conservative synchronous parsing before and after the candidate edit to protect private passages. It remains within budget, but this is the clearest optimization candidate if real-device measurements show input delays: reuse validated current-document context without weakening the candidate omission-invariance check. No performance-driven change to privacy protections is justified by these passing measurements alone.

Raw reports from this run: `/tmp/voxdown-studio/performance-desktop.json` and `/tmp/voxdown-studio/performance-cpu4.json`. Regenerate them on the release machine; this table is an observed sample, not a hardware-independent guarantee.


## Sprint 21 recheck — immutable-source cache

Current-source parse results are now shared by immutable CodeMirror Text identity and seeded only
by fresh worker results. Candidate edits still receive their own omission validation. The final
production-build run with 4× CPU slowdown passed every budget: ordinary typing 10.2ms p95,
worker-interleaved typing 9.1ms, pairing 62.1ms, formatting 56.6ms and completion keydown 15.4ms.
Opening the near-limit fixture took 810ms. Report: `/tmp/voxdown-studio/performance-final-cpu4.json`.
The earlier table is retained as historical evidence; host load and frame phase vary between runs.

An independent reviewer separately ran the development-server gate under 4× slowdown and observed
ordinary typing 8.6ms, pairing 50.1ms, formatting 44.9ms and popup appearance 98.1ms p95. Production and
development measurements must not be combined into a single claimed speedup. Sustained-session
memory/recovery evidence is now covered by [the soak gate](studio-soak.md).
