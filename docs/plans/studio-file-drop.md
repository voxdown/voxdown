# Guarded local screenplay drops

Round26 accepts one `.fountain` or `.txt` file dropped onto Studio as an explicit Open.
It routes through the same strict UTF-8 decoder, source bounds, recovery/save confirmation,
stale-read generation and draft replacement path as the Open chooser. Exact BOM and newline
spelling remain available in source downloads. A late failed read cannot overwrite a newer
operation's notice.

File drag/drop is intercepted in document capture before editor insertion or browser
navigation. Multiple files and unsupported formats are rejected without opening a partial
selection. An open modal or ongoing recovery/replacement prevents a drop from changing the
screenplay. Native file-input drops remain available for the specific import/comparison
control. Text/selection drags remain native. No file handles are retained or permissions
requested; downloads remain explicit.

Five isolated browser tests cover accepted file types, default prevention, multiple/wrong
files, plain text drags, locked/modal state, native input targeting and listener disposal.
The built regression drops a real File/DataTransfer onto CodeMirror and verifies a subsequent
Fountain download preserves BOM and CRLF exactly. Physical desktop file-manager dragging
remains a manual acceptance check.
