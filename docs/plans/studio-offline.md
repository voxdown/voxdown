# Studio offline preparation

Studio can explicitly prepare its application files for offline reopening and PDF export. This is a built-site feature; the Vite development server reports that preparation is unavailable. HTTPS (or a trustworthy localhost origin), service workers and browser Cache Storage are required.

## Behavior

- Opening Studio only checks availability. The user starts preparation in Preferences or Commands.
- The build emits a service worker within the Studio directory. Its scope is that directory, including when the whole site is hosted in a subdirectory. It does not control Writer or the landing page.
- The parser worker is emitted inside the Studio scope so that it can start after an offline reload. The offline manifest follows Studio's actual build dependencies: its HTML, JavaScript, CSS, parser worker, lazy PDF code, bundled font faces and site icon. It does not preload unrelated application pages.
- Preparation is successful only after every required response is saved. A failed install removes its incomplete cache. Repairs stage complete downloads separately so a failed repair retains the existing usable shell and remaining resources. The controller offers retry and never reports that a partial cache is ready.
- Navigation tries the current online page for at most 2.5 seconds, with the prepared shell as its offline or stalled-network fallback. Application assets use exact versioned cache entries. User-imported files, edited source, backups and generated downloads are not put into the application cache.
- Recovery of screenplay text remains the separate IndexedDB recovery feature. Preparing the app does **not** back up a screenplay. Download a Fountain file or portable backup independently.
- An update prepares a new version before activating it. It never reloads the editor. The worker asks live Studio tabs which build they use before retiring caches. It keeps the current version, one completed fallback, and any versions required by open editors; an unresponsive or still-loading tab conservatively delays retirement.
- Status checks verify the presence of all expected resources rather than treating an existing worker registration as proof. Preparation can repair missing resources after partial cache eviction.

## Acceptance gate

After `pnpm site:build`, run `node scripts/check-studio-offline.mjs`.

The isolated Chromium gate serves the built output at the origin root and `/nested/project/`. It checks no installation before opt-in, scoped registration, deliberate resource-download failure and retry, cache contents excluding a private draft marker, offline reload, exact Fountain download, editing while disconnected, and first-use PDF export after disconnecting. It also removes a font cache entry to verify truthful status and repair, simulates several updated builds to verify failed updates preserve the previous cache and successful updates do not navigate the active editor, checks old-tab retention followed by retirement after closing that tab, and holds a navigation response to verify bounded fallback.

The update fixture changes the version marker and adds an old-only lazy module to the first version. Later versions remove that module from both their manifests and the server; the older open tab must still import it while offline. The gate also injects rejecting storage and cleanup operations to verify that a failed preparation remains retryable in the same worker. This tests the cache lifecycle, not every real-world application migration or deployment. Other application regression gates still cover recovery, parser and exports.

## Limits and manual release checks

- Browsers can evict origin storage or block it in private/privacy modes. A prepared app is not a guarantee of permanent installation or a replacement for independent backups.
- Use the Studio directory URL ending in `/` (or its `index.html`). An offline request to a server redirect outside the worker scope cannot be handled by that worker.
- Existing installed workers can check for updates during later visits. A network failure must retain the prior usable version; an update never forces a document reload.
- An unresponsive Studio tab delays application-cache retirement, because its asset needs cannot be established safely. Close abandoned tabs to allow a later status check or preparation to retire unused versions. Clearing site data removes both application caches and browser recovery.
- The automated gate covers Chromium. Physical iPhone Safari/Brave storage policy, app suspension, installation behavior and airplane-mode reopening remain explicit manual acceptance gates.
