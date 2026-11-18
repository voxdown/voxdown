# Text reference beside the screenplay

The preview pane has Page preview and Text reference tabs. The reference is a read-only,
literal view of a local `.txt`, `.md`, `.fountain` or `.vxd` file. It is held in this tab's
memory only, cleared on reload, and excluded from screenplay downloads, PDF, recovery and
portable backups. Private notes in the selected reference are intentionally visible.

Files must be valid UTF-8 and fit the existing source limits (500,000 characters and 20,000
lines). Binary controls and invalid encodings are rejected. Rendering uses a textarea, never
HTML or Markdown execution. A failed replacement retains the existing reference. Clear and
new selections invalidate pending reads; late completion cannot steal focus from writing.

Keyboard tabs support arrows, Home and End. The command reveals the side pane and focuses
its file-open button. On mobile, Back to writing returns to the screenplay. The reference
pane scrolls independently at narrow heights; its text remains at least 16px on mobile.

Independent review exercised file validation, replacement/cancellation races, literal hostile
text, exact screenplay isolation, reload clearing, keyboard tabs, dark selection visibility
and 320px mobile layouts. Five browser tests cover the local reference component; the built
Studio regression also opens a real reference and verifies the screenplay stays unchanged.
Physical-device and assistive-technology acceptance remain manual gates.
