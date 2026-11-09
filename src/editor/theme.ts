import { EditorView } from "@codemirror/view";

/**
 * The editor's look, from CSS variables a host sets (with plain fallbacks), so it can match any
 * page: the story in a reading face, marks in the interface face, each character in their colour.
 *
 *   --am-font, --am-ui-font, --am-mono   faces for the story, the chips and raw marks
 *   --am-ink, --am-muted, --am-line       text, quiet text, hairlines
 *   --am-direction, --am-sound, --am-page, --am-note   colours of each kind of mark
 *   --am-active                           the line being edited
 */
export const scriptTheme = EditorView.theme({
  "&": {
    color: "var(--am-ink, #1f2328)",
    backgroundColor: "transparent",
    fontSize: "var(--am-size, 16px)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--am-font, Georgia, 'Iowan Old Style', serif)",
    lineHeight: "var(--am-leading, 1.65)",
  },
  ".cm-content": { padding: "12px 0 40vh", caretColor: "var(--am-ink, #1f2328)" },
  ".cm-line": { padding: "0 18px 0 6px" },
  ".cm-activeLine": { backgroundColor: "var(--am-active, rgba(37, 99, 235, 0.035))" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--am-muted, #6b7280)",
  },
  ".am-raw": { fontFamily: "var(--am-mono, ui-monospace, Menlo, monospace)", fontSize: "0.84em" },
  ".am-name": { fontWeight: "600", color: "var(--am-speaker, #b45309)" },
  ".am-direction": { color: "var(--am-direction, #7c3aed)", fontStyle: "italic" },
  ".am-sound": { color: "var(--am-sound, #15803d)" },
  ".am-page": { color: "var(--am-page, #b7791f)" },
  ".am-note": { color: "var(--am-note, #6b7280)", fontStyle: "italic" },
  ".am-group": { color: "var(--am-direction, #7c3aed)", fontStyle: "italic" },
  ".am-heading": { fontWeight: "600", fontFamily: "var(--am-ui-font, system-ui, sans-serif)" },
  ".am-break": { color: "var(--am-muted, #6b7280)" },
  ".am-escape": { color: "var(--am-muted, #6b7280)" },
  ".am-frontmatter-fold": {
    fontFamily: "var(--am-ui-font, system-ui, sans-serif)",
    fontSize: "0.75em",
    color: "var(--am-muted, #6b7280)",
    padding: "2px 6px 10px",
    cursor: "text",
  },
  ".am-frontmatter": {
    color: "var(--am-muted, #6b7280)",
    fontFamily: "var(--am-mono, ui-monospace, Menlo, monospace)",
    fontSize: "0.82em",
  },
  // A speaker's words and a direction's words each get their own lane under the text, so when
  // both apply the solid line sits just under the words and the dashes just under that. Each
  // lane is set by the span's own bottom padding, so it holds whichever span CodeMirror nests.
  ".am-speech": {
    // Performance's tint under a character's words (review r15), translucent so the selection
    // drawn behind the text still shows.
    backgroundColor: "color-mix(in oklab, var(--am-speaker, #b45309) 16%, transparent)",
    backgroundImage:
      "linear-gradient(color-mix(in srgb, var(--am-speaker, #b45309) 60%, transparent), color-mix(in srgb, var(--am-speaker, #b45309) 60%, transparent))",
    backgroundSize: "100% 2px",
    backgroundRepeat: "repeat-x",
    backgroundPosition: "0 100%",
    paddingBottom: "1px",
  },
  ".am-directed": {
    backgroundImage:
      "linear-gradient(to right, color-mix(in srgb, var(--am-direction, #7c3aed) 60%, transparent) 50%, transparent 50%)",
    backgroundSize: "6px 1.5px",
    backgroundRepeat: "repeat-x",
    backgroundPosition: "0 100%",
    paddingBottom: "5px",
  },
  ".am-directed-hover": {
    backgroundColor: "color-mix(in srgb, var(--am-direction, #7c3aed) 12%, transparent)",
    borderRadius: "3px",
  },
  ".cm-line.am-blank": { lineHeight: "0.75" },
  ".am-warning": {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--am-warning, #dc2626)",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "3px",
  },
  ".cm-line.am-unheard": {
    color: "color-mix(in srgb, currentColor 55%, transparent)",
    fontStyle: "italic",
  },
  ".am-in-group": {
    boxShadow: "inset 3px 0 0 color-mix(in srgb, var(--am-direction, #7c3aed) 45%, transparent)",
  },
  ".am-chip": {
    display: "inline-block",
    fontFamily: "var(--am-ui-font, system-ui, sans-serif)",
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
  ".am-chip-name": {
    fontWeight: "600",
    color: "color-mix(in srgb, var(--am-speaker, #b45309) 42%, var(--am-ink, #1f2328))",
    backgroundColor: "color-mix(in srgb, var(--am-speaker, #b45309) 18%, transparent)",
    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--am-speaker, #b45309) 40%, transparent)",
  },
  // A direction above the words it directs (1082): a zero-width anchor as tall as its label
  // stack, so the row makes room; the label hangs from it, stacked a row up where two would meet.
  ".am-label-anchor": {
    display: "inline-block",
    position: "relative",
    width: "0",
    height: "calc(1.15em + var(--am-lift, 0px) + var(--am-height, 14px))",
    verticalAlign: "baseline",
  },
  ".am-label": {
    position: "absolute",
    left: "0",
    bottom: "calc(1.05em + var(--am-lift, 0px))",
    transform: "translateX(var(--am-shift, 0px))",
    whiteSpace: "nowrap",
    fontFamily: "var(--am-ui-font, system-ui, sans-serif)",
    fontStyle: "italic",
    fontSize: "11.5px",
    lineHeight: "14px",
    color: "var(--am-direction, #7c3aed)",
    cursor: "text",
  },
  ".am-chip-direction": {
    fontStyle: "italic",
    color: "var(--am-direction, #7c3aed)",
    padding: "0 0.3em 0 0",
    borderRadius: "0",
  },
  ".am-chip-sound": {
    color: "color-mix(in srgb, var(--am-sound, #15803d) 70%, var(--am-ink, #1f2328))",
    border: "1px solid color-mix(in srgb, var(--am-sound, #15803d) 45%, transparent)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".am-chip-vocal": {
    color: "color-mix(in srgb, var(--am-speaker, #b45309) 42%, var(--am-ink, #1f2328))",
    border: "1px solid color-mix(in srgb, var(--am-speaker, #b45309) 45%, transparent)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".am-chip-pause": {
    color: "var(--am-muted, #6b7280)",
    border: "1px dashed var(--am-line, #d0d4da)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".am-chip-page": {
    color: "var(--am-page, #b7791f)",
    border: "1px dashed color-mix(in srgb, var(--am-page, #b7791f) 60%, transparent)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".am-chip-note": {
    color: "var(--am-note, #6b7280)",
    backgroundColor: "var(--am-note-bg, rgba(107, 114, 128, 0.1))",
    borderRadius: "6px",
    fontStyle: "italic",
    whiteSpace: "normal",
    margin: "0 0.2em",
  },
  // A host's own small mark (Kinu's join, a tie between two sentences): quiet, in the accent.
  ".am-chip-tool": {
    color: "var(--am-accent, #3b5bdb)",
    fontSize: "1em",
    fontWeight: "600",
    verticalAlign: "-0.15em",
    padding: "0",
    margin: "0",
  },
  ".am-chip-instruction": {
    color: "var(--am-muted, #6b7280)",
    border: "1px solid var(--am-line, #d0d4da)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".am-chip-icon": {
    // Inline even where a page's base styles make every SVG a block.
    display: "inline-block",
    width: "0.95em",
    height: "0.95em",
    marginRight: "0.3em",
    verticalAlign: "-0.13em",
    flex: "none",
  },
  ".am-chip-warning": {
    color: "var(--am-warning, #dc2626)",
    border: "1px dashed var(--am-warning, #dc2626)",
    borderRadius: "6px",
    margin: "0 0.2em",
  },
  ".am-chip-cleared": {
    color: "var(--am-muted, #6b7280)",
    border: "1px solid var(--am-line, #d0d4da)",
    borderRadius: "6px",
    fontStyle: "italic",
  },
  // A page turn across the page, as Performance draws it (owner, 9 Nov): its controls either side
  // of the page it turns to, a rule out to each edge.
  ".am-line-turn": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: "12px 0",
    fontFamily: "var(--am-ui-font, system-ui, sans-serif)",
    fontSize: "10.5px",
    fontWeight: "600",
    lineHeight: "1",
    letterSpacing: "0.03em",
    color: "var(--am-page, #a35b0e)",
    cursor: "pointer",
  },
  ".am-line-turn::before, .am-line-turn::after": {
    content: '""',
    flex: "1",
    borderTop: "1px solid color-mix(in srgb, var(--am-page, #a35b0e) 45%, transparent)",
  },
  // A page turn ending a paragraph: below its words, across the page (review r15).
  ".am-line-turn[data-trailing]": { margin: "14px 0 4px" },
  // The host's controls on a page turn: never the text's.
  ".am-page-tools": {
    display: "inline-flex",
    alignItems: "center",
    gap: "1px",
    cursor: "default",
    userSelect: "none",
  },
  ".am-chip .am-page-tools": { marginLeft: "3px" },
  // A scene's break and its name, as Performance heads a scene (owner, 9 Nov): small capitals,
  // spaced, a rule out to each edge.
  ".am-line-break, .am-line-heading": {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    margin: "14px 0 12px",
    fontFamily: "var(--am-ui-font, system-ui, sans-serif)",
    fontSize: "12px",
    fontWeight: "700",
    lineHeight: "1.4",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--am-muted, #6b7280)",
    cursor: "pointer",
  },
  ".am-line-break::before, .am-line-break::after, .am-line-heading::before, .am-line-heading::after":
    {
      content: '""',
      flex: "1",
      height: "1px",
      background: "var(--am-line, #d0d4da)",
    },
  // The speaker beside a scene's name (owner, 9 Nov): quiet until wanted, warm when it reads the
  // name aloud, dashed when the line it wrote says an old name.
  ".am-read-aloud": {
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
  ".am-read-aloud:hover, .am-read-aloud:focus-visible": {
    opacity: "1",
    backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)",
  },
  ".am-read-aloud:focus-visible": {
    outline: "2px solid var(--am-focus, #2563eb)",
    outlineOffset: "1px",
  },
  '.am-read-aloud[aria-pressed="true"]': { opacity: "1", color: "var(--am-page, #a35b0e)" },
  ".am-read-aloud[data-stale]": { borderStyle: "dashed", borderColor: "currentColor" },
  ".am-read-aloud-icon": { width: "14px", height: "14px" },
  "@media (prefers-reduced-motion: reduce)": { ".am-read-aloud": { transition: "none" } },
  ".am-line-group": {
    fontFamily: "var(--am-ui-font, system-ui, sans-serif)",
    fontSize: "0.74em",
    fontStyle: "italic",
    color: "var(--am-direction, #7c3aed)",
    cursor: "pointer",
  },
  ".cm-tooltip.cm-tooltip-autocomplete, .cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--am-ui-font, system-ui, sans-serif)",
    fontSize: "13px",
  },
  ".am-chip-inactive": { opacity: "0.55", textDecoration: "line-through" },
  ".am-option-dot": {
    display: "inline-block",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    marginRight: "6px",
  },
});
