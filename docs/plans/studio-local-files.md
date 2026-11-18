# Studio direct local files

`LocalFileController` is a progressive enhancement; ordinary Fountain downloads remain available in every supported browser. The controller keeps handles and comparison bytes in memory only. It does not persist access permissions or start background writes.

## Integration contract

- Construct `new LocalFileController()` and expose direct-save commands only when `available` is true. Constructor injection accepts a picker function for deterministic tests; `null` simulates unsupported browsers.
- Call `saveAs(exactSource, suggestedName)` directly from a user gesture. Pass source through the existing `writeSource` path first; the adapter never reconstructs Fountain from parsed elements. Suggested names use the existing portable Fountain filename rules.
- `save(exactSource)` writes to the last successfully saved file. `filename` is null until a completed save and after disconnect, conflict or uncertain commit. `busy` prevents concurrent save operations.
- **Call `disconnect()` before every document replacement**, including New, Open, snapshot restore and backup import. Pending work observes a generation token and never attaches an old handle to a replacement document. Keep the UI's own document/revision identity alongside each request so an earlier successful save is never shown as saving later edits.
- Results use `status`: `saved` includes `filename`; `cancelled` is normal picker dismissal; `unsupported` and `unlinked` require Download or Save As; `busy` requests a retry after the existing operation; `conflict` includes filename and requires Save As. `error` includes a bounded explanatory message, `reason`, and `mayHaveWritten`.
- `stale` means the document changed. Usually no write was committed. If `mayHaveWritten` is true, close was already issued before replacement and may have saved the old draft; never announce that the current document was saved.

## Safety and limits

The adapter compares actual bytes, not timestamps, before creating a writable stream and again before committing it. Same-size external edits are detected. Existing Save As targets are explicitly chosen through the native picker and then protected against changes occurring after selection. **Save As is an explicit overwrite decision**, including when the user selects the currently linked file again. It takes a fresh comparison baseline after the native picker; edits made before that selection may be replaced. Ordinary Save retains the previous baseline and reports an external-edit conflict. On conflict the staged write is aborted and the file link is removed. Failed close clears the link because the browser may have committed without confirming success.

Writes use UTF-8 bytes preserving the original BOM and newline characters. Source validation applies Studio's existing character/line/binary limits. Unpaired UTF-16 surrogates are refused rather than silently replaced by the encoder. Destination reads are bounded at approximately 4 MB so unexpected large external files cannot trigger unbounded allocation.

`mode: "exclusive"` asks supporting browsers to reject overlapping browser writers. It is **not an operating-system lock against other applications**. The API provides no atomic compare-and-swap: a different application could change the file between the final comparison and close. Direct save therefore improves conflict detection but cannot promise race-free cross-application editing. If document replacement happens after close has begun, the old write cannot reliably be revoked. Abort is best effort after an I/O failure, and no save is reported successful until close resolves.

The controller never changes the editor source. Cancellation, permission errors, disk/full errors, stale operations and failed writes all leave the text available for recovery or download. Failed I/O is not automatically retried. A pending native picker or disk operation can remain busy until the browser resolves it; replacements disconnect its identity but do not launch a second simultaneous writer.

## Evidence

The adapter tests exercise exact UTF-8 bytes, BOM/mixed newline preservation, same-size external changes, changes during staging, picker cancellation, permission/read-only/locked/quota failures, failed write and close, failed abort, oversized destinations, invalid source, disconnect during picker/write/close, and concurrent Save/Save As. Tests use injected handles and streams and do not claim real OS dialog or disk acceptance.

Primary API references checked during implementation:

- [MDN: showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker): limited availability, secure context and user activation requirements.
- [MDN: createWritable](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable): staged writes, commit on close and optional exclusive mode.

Manual release acceptance should cover Chromium desktop's real save/overwrite dialog, revoked file permissions, external editor changes and device/disk errors. Browsers without the native picker continue to use Download.
