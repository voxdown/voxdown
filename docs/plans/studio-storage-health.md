# Storage and backups

The `mountStorageHealth` dialog provides an on-demand view of this website's storage in the current browser. Opening or refreshing the dialog calls `navigator.storage.estimate()` and `navigator.storage.persisted()` when available. Mounting the controller does not read storage or request permissions.

Estimates are explicitly website-wide (origin-wide), including other workspaces and offline application caches. Usage and quota are approximate browser reports, not free disk space, a count of screenplay files, proof that recovery succeeded, or a backup verification. Missing, nonfinite and invalid values remain unknown; zero quota is reported as zero. High reported utilization suggests keeping an independent download before adding more data.

The separate **Request persistent storage** button calls `navigator.storage.persist()` directly during its click handler. There is no automatic permission request. A granted result is described as reducing automatic eviction, never as protecting against clearing site data, browser resets or device loss. Denial, unsupported APIs, exceptions and unknown results are displayed without blocking writing.

Each read/request has a five-second UI deadline. A native permission prompt cannot be canceled by closing the dialog or by this deadline. If its promise is still pending, the request button stays disabled to prevent duplicate requests; refresh remains available and the copy tells the user to finish or dismiss any browser prompt. Late results cannot reopen a closed dialog or overwrite a newer read. A settled native request permits another explicit request if necessary.

Download, portable-backup and recovery buttons are callbacks into existing Studio flows. The health dialog dismisses before handing off. It does not delete data, alter recovery schemas, request a filesystem handle, or perform cleanup.

## Validation

`pnpm exec vitest run site/test/studio-storage-health.test.ts` runs six isolated Chromium tests. They cover no reads before opening and no permission request before the explicit gesture; approximate origin-wide quota and existing persistence; denied/unsupported/unknown/zero-quota states; hanging reads; a late reply after close/reopen; hanging native permission without duplicate requests; synchronous request failure and retry availability; Escape focus return; and backup/recovery handoff after dismissal.

The browser methods are controlled test doubles. Actual browser permission policy, private modes, quota decisions and persistence behavior require physical-device acceptance. The dialog makes no claim that a positive status guarantees future recovery.

Primary API references: [estimate](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate), [persisted](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persisted), [persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).
