# WebKit storage-failure test injection

This is a correction to the release acceptance harness, not a new Studio feature or delivery round.

The degraded-recovery scenario in `scripts/check-studio.mjs` originally assigned a throwing function directly to `indexedDB.open`. In the Linux WPE WebKit runtime, that instance override did not remain in place. Independent production-build reproduction observed the override before opening Backup and restore, then the native `open` method and “Draft kept in this browser” after a one-second pause. The following replacement correctly succeeded without invoking `window.confirm`, because recovery had become available again. The acceptance test timed out waiting for a confirmation it no longer had grounds to expect.

Instrumentation wrapped `window.confirm` to distinguish a missing call from native dialog suppression, recorded the actual `indexedDB.open` function and recovery status, and preserved the original native confirmation behavior. Immediate reproductions produced both confirmations; delayed reproductions showed the instance override disappear. The conclusion is a transient browser host-object override in the test, not a demonstrated Studio data-loss guard failure.

The fault injection now defines the throwing method on `IDBFactory.prototype`, so replacement of the `indexedDB` host wrapper cannot discard it. Independent WPE reproductions with zero-, one-, and two-second pauses then consistently produced both native confirmations. Cancelling the second confirmation preserved the exact unsaved text and reopened the populated backup dialog.

The other instance override found in acceptance scripts delays the initial recovery database open in the same script. That scenario intercepts the first open immediately, then uses the cached database connection; it does not depend on repeated instance interception like the degraded-storage scenario. No equivalent instance overrides were found in the file/offline acceptance scripts.

After the repair, the full `scripts/check-studio.mjs` acceptance gate passed against the production build containing rounds 30–31 in Linux WPE WebKit. This included the degraded recovery cancellation and malformed-Unicode download guard, exact backup preservation, editing/recovery/PDF flows, and mobile/offline checks. Real Safari/iOS behavior remains a separate manual gate from Linux WPE automation.
