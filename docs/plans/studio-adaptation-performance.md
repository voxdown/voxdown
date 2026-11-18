# Adaptation responsiveness — round 27

The dedicated adaptation worker passes the production offline gate and the
desktop responsiveness regression. Conversion keeps its original pure adapter,
privacy rules and core-parser validation; cancellation stops obsolete work.

## Measured UI responsiveness

Measurements were taken in isolated Chromium contexts against the locally
served production build, at 4× CDP CPU slowdown. The draft contained 4,900
speeches and approximately 444,000 UTF-16 characters. These are desktop
regression measurements, not physical-phone or mobile-network benchmarks.

| Measurement | Before worker | With worker |
| --- | --- | --- |
| Maximum animation-frame gap, three dialog preparations | 600 / 417 / 400 ms | 16.7 / 16.7 / 16.7 ms |
| Main-thread long task during those preparations | 613 / 434 / 409 ms | None observed |
| Blank startup ready, three fresh contexts | 218–231 ms | 235–283 ms |
| Blank startup main-thread long task | 80–109 ms | 83–104 ms |

The before measurements were taken while other gates were finishing; the
after measurements ran after the heavy gates became quiet. This is sufficient
to identify and verify removal of the adaptation stall, but not to attribute
small startup timing differences. CDP throttling is not uniform real-device
hardware emulation; elapsed conversion differences are not claimed as a CPU
speedup. The worker's benefit is keeping the main thread available.

The durable full performance gate independently measured three warmed
preparations of a 444,311-character fixture: maximum frame gaps
16.8 / 16.7 / 16.7 ms, no main-thread long tasks, and 189–207 ms until validated
results. Closing a pending preparation took 7.3 ms, terminated its native
worker, cleared the preview, and left the downloaded Fountain source exact.
The existing input and DOM checks also passed at 4× slowdown: sustained typing
p95 11.5 ms, typing across preview updates p95 16.5 ms, bracket pairing p95
69.8 ms, formatting p95 82.5 ms, and completion popup p95 95.3 ms.

## Reproduce and preserve the contract

```sh
STUDIO_PERF_CPU_RATE=4 node scripts/check-studio-performance.mjs
node scripts/check-studio-offline.mjs
```

Run after the production build, with other heavy browser tests idle. The
performance script retains the existing input budgets and adds a 150 ms maximum
frame-gap budget for explicit adaptation. It warms the worker asset, samples
actual animation frames and long tasks during three preparations, and delegates
to native Worker while observing construction/termination. Closing immediately
after starting guarantees a pending request without synthetic parser delays.
It verifies worker release and unchanged source. Elapsed conversion time is
reported rather than given a fragile narrow budget.

The offline gate verifies that neither an adaptation page import nor worker
startup occurs before the network is disabled. After offline reload, it first
starts adaptation, downloads a `.vxd`, independently checks core speech rows,
excludes title/private markers, and confirms unchanged Fountain source. This
passes both `/studio/` and `/nested/project/studio/`, alongside first-use PDF,
cache repair, safe updates, retirement of unused caches and stalled navigation.

The checked worker build was `bdd91d117001c64fc0cdadb2`. Its initial JavaScript
was 579,914 bytes before compression, approximately 191,131 gzip bytes, including
the shared editor chunk. Startup still creates 22 dialogs and 606 DOM nodes;
lazy dialog mounting is a possible later optimization, not a demonstrated
critical stall. Physical iOS/Brave behavior and degraded-device network/storage
conditions still require separate validation.
