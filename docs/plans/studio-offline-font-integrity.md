# Verified offline font repair

Round 39 closes the service-worker part of corrupt PDF font recovery. `cache: reload`
alone bypasses the browser HTTP cache; it does not override an application's cache-first
service worker. The old worker also treated every present font response as ready, even
when its HTTP 200 body was truncated or corrupt.

The build plugin now records SHA-256 values from the actual emitted font bytes in the
offline manifest and worker. Preparation checks those hashes before committing its staged
resources. Status checks font contents as well as resource presence. An incorrect font
therefore cannot produce a successful initial preparation or a ready status after damage.

Normal font reads verify cached bytes. A corrupt cached font, or an explicit PDF retry
using `cache: reload`, gets a fresh same-origin network request with redirects rejected and
a 15-second deadline covering headers and the complete body. Only a response matching the
expected build hash replaces existing cache entries. A failed, truncated or wrong response
keeps existing fallback data intact and returns a retryable failure; it never replays bytes
that the caller rejected. A cache write failure does not prevent an online PDF from using
the already verified response. Missing resources still use explicit offline preparation
to restore complete offline readiness.

Each prepared cache stores its own font-integrity index, so already-open older editors can
validate and repair their exact old font URLs after a deployment. Retained legacy caches
without such metadata preserve their previous exact-URL fallback behavior; they cannot
retroactively claim hash verification for an unknown old font. Known current font hashes
still apply when those same URLs appear in older caches. No screenplay text is cached or
sent in these operations. Root and subdirectory hosting resolve hashes against the actual
Studio worker scope.

Nine native Chromium tests execute the actual generated worker and build manifest against
a local HTTP server. They cover raw-byte hashes, root/nested scopes, first preparation
rejection and retry, cache damage and truthful status, failed and successful repair,
offline reads, held headers and stalled bodies, preservation of good fallback bytes, and
old-only font URLs with and without integrity metadata. The font-request deadline alone
is shortened in that harness; fetch, response bodies, CacheStorage and SHA-256 remain native.

`scripts/check-studio-offline.mjs` additionally verifies all four built font digests and
exercises real PDF recovery after corrupting cached fonts and reloading the app. It checks
offline failure, online failure, successful verified repair, subsequent offline reload/PDF,
and unchanged Fountain content, alongside the existing offline and old-client update gates.
The final round-40 production build passed that complete gate at both scopes, including
the existing failed-update fallback, active old-client retention/retirement, and bounded
stalled-navigation checks. No product source was changed during the built acceptance run.
