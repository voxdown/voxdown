import { EditorView } from "@codemirror/view";

/**
 * The editor's look, from CSS variables a host sets (with plain fallbacks), so it can match any
 * page: the story in a reading face, marks in the interface face, each character in their color.
 *
 *   --vxd-font, --vxd-ui-font, --vxd-mono   faces for the story, the chips and raw marks
 *   --vxd-ink, --vxd-muted, --vxd-line       text, quiet text, hairlines
 *   --vxd-direction, --vxd-sound, --vxd-page, --vxd-note   colors of each kind of mark
 *   --vxd-active                           the line being edited
 */
export const scriptTheme = EditorView.theme({
  "&": {
    color: "var(--vxd-ink, #1f2328)",
    backgroundColor: "transparent",
    fontSize: "var(--vxd-size, 16px)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--vxd-font, Georgia, 'Iowan Old Style', serif)",
    lineHeight: "var(--vxd-leading, 1.65)",
  },
  ".cm-content": { padding: "12px 0 40vh", caretColor: "var(--vxd-ink, #1f2328)" },
  ".cm-line": { padding: "0 18px 0 6px" },
  ".cm-activeLine": { backgroundColor: "var(--vxd-active, rgba(37, 99, 235, 0.035))" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--vxd-muted, #6b7280)",
  },
  ".vxd-raw": { fontFamily: "var(--vxd-mono, ui-monospace, Menlo, monospace)", fontSize: "0.84em" },
  ".vxd-name": { fontWeight: "600", color: "var(--vxd-speaker, #b45309)" },
  ".vxd-direction": { color: "var(--vxd-direction, #7c3aed)", fontStyle: "italic" },
  ".vxd-sound": { color: "var(--vxd-sound, #15803d)" },
  ".vxd-page": { color: "var(--vxd-page, #b7791f)" },
  ".vxd-note": { color: "var(--vxd-note, #6b7280)", fontStyle: "italic" },
  ".vxd-group": { color: "var(--vxd-direction, #7c3aed)", fontStyle: "italic" },
  ".vxd-heading": { fontWeight: "600", fontFamily: "var(--vxd-ui-font, system-ui, sans-serif)" },
  ".vxd-break": { color: "var(--vxd-muted, #6b7280)" },
  ".vxd-escape": { color: "var(--vxd-muted, #6b7280)" },
  ".vxd-frontmatter-fold": {
    fontFamily: "var(--vxd-ui-font, system-ui, sans-serif)",
    fontSize: "0.75em",
    color: "var(--vxd-muted, #6b7280)",
    padding: "2px 6px 10px",
    cursor: "text",
  },
  ".vxd-frontmatter": {
    color: "var(--vxd-muted, #6b7280)",
    fontFamily: "var(--vxd-mono, ui-monospace, Menlo, monospace)",
    fontSize: "0.82em",
  },
  // A speaker's words and a direction's words each get their own lane under the text, so when
  // both apply the solid line sits just under the words and the dashes just under that. Each
  // lane is set by the span's own bottom padding, so it holds whichever span CodeMirror nests.
  ".vxd-speech": {
    // A tint under a character's words, translucent so the selection
    // drawn behind the text still shows.
    backgroundColor: "color-mix(in oklab, var(--vxd-speaker, #b45309) 16%, transparent)",
    backgroundImage:
      "linear-gradient(color-mix(in srgb, var(--vxd-speaker, #b45309) 60%, transparent), color-mix(in srgb, var(--vxd-speaker, #b45309) 60%, transparent))",
    backgroundSize: "100% 2px",
    backgroundRepeat: "repeat-x",
    backgroundPosition: "0 100%",
    paddingBottom: "1px",
  },
  ".vxd-directed": {
    backgroundImage:
      "linear-gradient(to right, color-mix(in srgb, var(--vxd-direction, #7c3aed) 60%, transparent) 50%, transparent 50%)",
    backgroundSize: "6px 1.5px",
    backgroundRepeat: "repeat-x",
    backgroundPosition: "0 100%",
    paddingBottom: "5px",
  },
  ".vxd-directed-hover": {
    backgroundColor: "color-mix(in srgb, var(--vxd-direction, #7c3aed) 12%, transparent)",
    borderRadius: "3px",
  },
  ".cm-line.vxd-blank": { lineHeight: "0.75" },
  ".vxd-warning": {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--vxd-warning, #dc2626)",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "3px",
  },
  ".cm-line.vxd-unheard": {
    color: "color-mix(in srgb, currentColor 70%, transparent)",
    fontStyle: "italic",
  },
  ".vxd-in-group": {
    boxShadow: "inset 3px 0 0 color-mix(in srgb, var(--vxd-direction, #7c3aed) 45%, transparent)",
  },
  ".vxd-chip": {
    display: "inline-block",
    fontFamily: "var(--vxd-ui-font, system-ui, sans-serif)",
    fontSize: "0.72em",
    lineHeight: "1.5",
    padding: "0 0.55em",
    borderRadius: "999px",
    verticalAlign: "0.12em",
    margin: "0 0.25em 0 0",
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
  },
  ".vxd-chip-name": {
    fontWeight: "600",
    color: "color-mix(in srgb, var(--vxd-speaker, #b45309) 42%, var(--vxd-ink, #1f2328))",
    backgroundColor: "color-mix(in srgb, var(--vxd-speaker, #b45309) 18%, transparent)",
    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--vxd-speaker, #b45309) 40%, transparent)",
  },
  // A direction above the words it directs: a zero-width anchor as tall as its label
  // stack, so the row makes room; the label hangs from it, stacked a row up where two would meet.
  ".vxd-label-anchor": {
    display: "inline-block",
    position: "relative",
    width: "0",
    height: "calc(1.15em + var(--vxd-lift, 0px) + var(--vxd-height, 14px))",
    verticalAlign: "baseline",
  },
  ".vxd-label": {
    position: "absolute",
    left: "0",
    bottom: "calc(1.05em + var(--vxd-lift, 0px))",
    transform: "translateX(var(--vxd-shift, 0px))",
    whiteSpace: "nowrap",
    fontFamily: "var(--vxd-ui-font, system-ui, sans-serif)",
    fontStyle: "italic",
    fontSize: "11.5px",
    lineHeight: "14px",
    color: "var(--vxd-direction, #7c3aed)",
    cursor: "text",
  },
  ".vxd-chip-direction": {
    fontStyle: "italic",
    color: "var(--vxd-direction, #7c3aed)",
    padding: "0 0.3em 0 0",
    borderRadius: "0",
  },
  ".vxd-chip-sound": {
    color: "color-mix(in srgb, var(--vxd-sound, #15803d) 70%, var(--vxd-ink, #1f2328))",
    border: "1px solid color-mix(in srgb, var(--vxd-sound, #15803d) 45%, transparent)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".vxd-chip-vocal": {
    color: "color-mix(in srgb, var(--vxd-speaker, #b45309) 42%, var(--vxd-ink, #1f2328))",
    border: "1px solid color-mix(in srgb, var(--vxd-speaker, #b45309) 45%, transparent)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".vxd-chip-pause": {
    color: "var(--vxd-muted, #6b7280)",
    border: "1px dashed var(--vxd-line, #d0d4da)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".vxd-chip-page": {
    color: "var(--vxd-page, #b7791f)",
    border: "1px dashed color-mix(in srgb, var(--vxd-page, #b7791f) 60%, transparent)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".vxd-chip-note": {
    color: "var(--vxd-note, #6b7280)",
    backgroundColor: "var(--vxd-note-bg, rgba(107, 114, 128, 0.1))",
    borderRadius: "6px",
    fontStyle: "italic",
    whiteSpace: "normal",
    margin: "0 0.2em",
  },
  // A host's own small mark (such as a tie a recording tool writes between two sentences): quiet, in the accent.
  ".vxd-chip-tool": {
    color: "var(--vxd-accent, #3b5bdb)",
    fontSize: "1em",
    fontWeight: "600",
    verticalAlign: "-0.15em",
    padding: "0",
    margin: "0",
  },
  ".vxd-chip-instruction": {
    color: "var(--vxd-muted, #6b7280)",
    border: "1px solid var(--vxd-line, #d0d4da)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".vxd-chip-icon": {
    // Inline even where a page's base styles make every SVG a block.
    display: "inline-block",
    width: "0.95em",
    height: "0.95em",
    marginRight: "0.3em",
    verticalAlign: "-0.13em",
    flex: "none",
  },
  ".vxd-chip-warning": {
    color: "var(--vxd-warning, #dc2626)",
    border: "1px dashed var(--vxd-warning, #dc2626)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".vxd-chip-cleared": {
    color: "var(--vxd-muted, #6b7280)",
    border: "1px solid var(--vxd-line, #d0d4da)",
    borderRadius: "6px",
    fontStyle: "italic",
  },
  // A page turn across the page, as a script draws it: its controls either side
  // of the page it turns to, a rule out to each edge.
  ".vxd-line-turn": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: "12px 0",
    fontFamily: "var(--vxd-ui-font, system-ui, sans-serif)",
    fontSize: "11px",
    fontWeight: "600",
    lineHeight: "1",
    letterSpacing: "0.03em",
    color: "var(--vxd-page, #a35b0e)",
    cursor: "pointer",
  },
  ".vxd-line-turn::before, .vxd-line-turn::after": {
    content: '""',
    flex: "1",
    borderTop: "1px solid color-mix(in srgb, var(--vxd-page, #a35b0e) 45%, transparent)",
  },
  // A page turn ending a paragraph: below its words, across the page.
  ".vxd-line-turn[data-trailing]": { margin: "14px 0 4px" },
  // The host's controls on a page turn: never the text's.
  ".vxd-page-tools": {
    display: "inline-flex",
    alignItems: "center",
    gap: "1px",
    cursor: "default",
    userSelect: "none",
  },
  ".vxd-chip .vxd-page-tools": { marginLeft: "3px" },
  // A scene's break and its name, as a script heads a scene: small capitals,
  // spaced, a rule out to each edge.
  ".vxd-line-break, .vxd-line-heading": {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    margin: "14px 0 12px",
    fontFamily: "var(--vxd-ui-font, system-ui, sans-serif)",
    fontSize: "12px",
    fontWeight: "700",
    lineHeight: "1.4",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--vxd-muted, #6b7280)",
    cursor: "pointer",
  },
  // A chapter (`#`) larger and in ink, a scene (`##`) a step down, smaller headings as they were.
  '.vxd-line-heading[data-level="1"]': {
    fontSize: "15px",
    letterSpacing: "0.1em",
    color: "var(--vxd-ink, #1f2328)",
    margin: "22px 0 14px",
  },
  '.vxd-line-heading[data-level="2"]': { fontSize: "13px" },
  // What a heading is for, when not both heard and printed: beside it, as a chip.
  ".vxd-line-tag": {
    flex: "none",
    fontSize: "11px",
    fontWeight: "600",
    letterSpacing: "0.06em",
    padding: "1px 6px",
    border: "1px solid var(--vxd-line, #d0d4da)",
    borderRadius: "999px",
    color: "var(--vxd-muted, #6b7280)",
  },
  ".vxd-line-break::before, .vxd-line-break::after, .vxd-line-heading::before, .vxd-line-heading::after":
    {
      content: '""',
      flex: "1",
      height: "1px",
      background: "var(--vxd-line, #d0d4da)",
    },
  // The speaker beside a scene's name: quiet until wanted, warm when it reads the
  // name aloud, dashed when the line it wrote says an old name.
  ".vxd-read-aloud": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    width: "22px",
    height: "22px",
    margin: "0 -6px",
    padding: "0",
    border: "1px solid transparent",
    borderRadius: "999px",
    background: "transparent",
    color: "inherit",
    opacity: "0.5",
    cursor: "pointer",
    transition:
      "opacity var(--ui-motion-quick, 120ms) ease, background-color var(--ui-motion-quick, 120ms) ease",
  },
  ".vxd-read-aloud:hover, .vxd-read-aloud:focus-visible": {
    opacity: "1",
    backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)",
  },
  ".vxd-read-aloud:focus-visible": {
    outline: "2px solid var(--vxd-focus, #2563eb)",
    outlineOffset: "1px",
  },
  '.vxd-read-aloud[aria-pressed="true"]': { opacity: "1", color: "var(--vxd-page, #a35b0e)" },
  ".vxd-read-aloud[data-stale]": { borderStyle: "dashed", borderColor: "currentColor" },
  ".vxd-read-aloud-icon": { width: "14px", height: "14px" },
  "@media (prefers-reduced-motion: reduce)": { ".vxd-read-aloud": { transition: "none" } },
  ".vxd-line-group": {
    fontFamily: "var(--vxd-ui-font, system-ui, sans-serif)",
    fontSize: "0.74em",
    fontStyle: "italic",
    color: "var(--vxd-direction, #7c3aed)",
    cursor: "pointer",
  },
  ".cm-tooltip.cm-tooltip-autocomplete, .cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--vxd-ui-font, system-ui, sans-serif)",
    fontSize: "13px",
  },
  ".vxd-chip-inactive": { opacity: "0.55", textDecoration: "line-through" },
  ".vxd-option-dot": {
    display: "inline-block",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    marginRight: "6px",
  },
});
