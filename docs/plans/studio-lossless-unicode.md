# Lossless Unicode source downloads

Round30 closes a source-integrity gap found by independent release review. A valid Studio
JSON backup can preserve a lone UTF-16 surrogate using a JSON escape. Blob/TextEncoder UTF-8
conversion replaces that code unit with U+FFFD. Download Fountain previously treated the
lossy file as an exact independent copy, allowing replacement without confirmation when
browser recovery was unavailable.

Fountain download and direct file save now share a lossless UTF-8 encoder. It checks the
encoded roundtrip before creating a download or recording `lastDownload`; incomplete Unicode
produces a repair notice and leaves the screenplay and recovery guard unchanged. The source
remains editable and a Studio JSON backup still preserves it exactly. Valid supplementary
characters, combining marks, BOM and mixed line endings remain unchanged.

Pure encoding regressions cover valid Unicode and lone/reversed surrogate combinations.
The built browser regression imports an escaped surrogate from JSON with storage/workers
blocked, verifies zero lossy downloads, dismisses the required replacement confirmation,
and downloads an exact JSON backup. This does not claim native OS filesystem acceptance.
