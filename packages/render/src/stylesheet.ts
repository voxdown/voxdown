/**
 * The views' look, driven by CSS variables a page may set on `.vxd` or any ancestor:
 *
 *   --vxd-font, --vxd-ui-font    the story's face, and the face of names, chips and labels
 *   --vxd-size, --vxd-measure    the text size, and the line length
 *   --vxd-ink, --vxd-muted       text, and quiet text
 *   --vxd-paper, --vxd-line      the page, and hairlines
 *   --vxd-direction, --vxd-sound, --vxd-page, --vxd-note   each kind of mark
 *   --vxd-c                      a character's color, set on their words by the renderer
 *
 * Dark paper follows `prefers-color-scheme`, or `data-vxd-theme="dark"` on an ancestor.
 *
 * Every rule is inside `.vxd`, the element a view is rendered in, so a page can also hold
 * the editor, whose marks have the same class names. The `:where()` keeps each rule as easy
 * to override as a single class.
 */
export const stylesheet = `
.vxd {
  --vxd-font: var(--vxd-story-font, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif);
  --vxd-ui-font: var(--vxd-interface-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
  --vxd-ink: #1f2328;
  --vxd-muted: #6b7280;
  --vxd-paper: #ffffff;
  --vxd-line: #e5e7eb;
  --vxd-direction: #7c3aed;
  --vxd-sound: #0f766e;
  --vxd-page: #b45309;
  --vxd-note: #a16207;
  --vxd-note-paper: #fefce8;
  color: var(--vxd-ink);
  font-family: var(--vxd-font);
  font-size: var(--vxd-size, 1.125rem);
  line-height: 1.65;
  max-width: var(--vxd-measure, 36em);
  margin: 0 auto;
  overflow-wrap: break-word;
}
@media (prefers-color-scheme: dark) {
  :where(:not([data-vxd-theme="light"])) > .vxd:not([data-vxd-theme="light"]) {
    --vxd-ink: #e6e6e3; --vxd-muted: #9ca3af; --vxd-paper: #17181a; --vxd-line: #2f3236;
    --vxd-direction: #c4b5fd; --vxd-sound: #5eead4; --vxd-page: #fbbf24; --vxd-note: #fde68a;
    --vxd-note-paper: #2a2615;
  }
}
[data-vxd-theme="dark"] .vxd, .vxd[data-vxd-theme="dark"] {
  --vxd-ink: #e6e6e3; --vxd-muted: #9ca3af; --vxd-paper: #17181a; --vxd-line: #2f3236;
  --vxd-direction: #c4b5fd; --vxd-sound: #5eead4; --vxd-page: #fbbf24; --vxd-note: #fde68a;
  --vxd-note-paper: #2a2615;
}
.vxd *, .vxd *::before, .vxd *::after { box-sizing: border-box; }

:where(.vxd) .vxd-header { text-align: center; margin: 0 0 2.5em; }
:where(.vxd) .vxd-title { font-size: 1.9em; line-height: 1.2; font-weight: 600; letter-spacing: -0.01em; }
:where(.vxd) .vxd-subtitle { font-size: 1.15em; color: var(--vxd-muted); margin-top: 0.2em; }
:where(.vxd) .vxd-author { font-style: italic; color: var(--vxd-muted); margin-top: 0.6em; }
:where(.vxd) .vxd-cast { list-style: none; padding: 0; margin: 1.4em 0 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 0.35em 1.1em; font: 0.8em/1.4 var(--vxd-ui-font); color: var(--vxd-muted); }
:where(.vxd) .vxd-cast li { display: inline-flex; align-items: center; gap: 0.4em; }
:where(.vxd) .vxd-cast-dot { width: 0.6em; height: 0.6em; border-radius: 50%; background: var(--vxd-c); }

:where(.vxd) .vxd-p { margin: 0 0 1em; }
:where(.vxd) .vxd-heading { font-weight: 600; line-height: 1.3; margin: 1.8em 0 0.8em; }
:where(.vxd) h1.vxd-heading { font-size: 1.6em; text-align: center; }
:where(.vxd) h2.vxd-heading { font-size: 1.25em; }
:where(.vxd) h3.vxd-heading, :where(.vxd) h4.vxd-heading, :where(.vxd) h5.vxd-heading, :where(.vxd) h6.vxd-heading { font-size: 1.05em; }
:where(.vxd) .vxd-break { border: 0; text-align: center; margin: 2em 0; height: 1em; }
:where(.vxd) .vxd-break::before { content: "\\2042"; color: var(--vxd-muted); }
.vxd img { max-width: 100%; height: auto; }
.vxd a { color: inherit; text-decoration-color: var(--vxd-muted); }

.vxd-book .vxd-p + .vxd-p { text-indent: 1.4em; margin-top: -0.6em; }
:where(.vxd) .vxd-page-number { float: right; margin-right: -3.2em; width: 2.4em; text-align: left; font: 0.7em/2.4 var(--vxd-ui-font); color: var(--vxd-muted); text-indent: 0; }

/* The script view */
/* Room above a line for a direction's label only where a paragraph has one: the rest reads close. */
.vxd-script { line-height: 1.75; }
.vxd-script .vxd-p:has(.vxd-direction:not(.vxd-direction-long)) { line-height: 2.35; }
.vxd-script .vxd-p { margin-bottom: 0.9em; }
/* Two lanes under the words: the speaker's solid line just below them, a direction's dashes below that. */
:where(.vxd) .vxd-speech {
  --vxd-speaker-line: linear-gradient(color-mix(in srgb, var(--vxd-c, currentColor) 55%, transparent), color-mix(in srgb, var(--vxd-c, currentColor) 55%, transparent));
  --vxd-direction-line: linear-gradient(to right, color-mix(in srgb, var(--vxd-direction) 60%, transparent) 50%, transparent 50%);
  --vxd-tint: linear-gradient(color-mix(in srgb, var(--vxd-c, currentColor) 11%, transparent), color-mix(in srgb, var(--vxd-c, currentColor) 11%, transparent));
  border-radius: 0.2em;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
:where(.vxd) .vxd-speech:not(.vxd-narration) {
  padding: 0.08em 0.05em 0.14em;
  background: var(--vxd-speaker-line) 0 100% / 100% 0.1em no-repeat, var(--vxd-tint) content-box;
}
:where(.vxd) .vxd-speech.vxd-directed {
  padding-bottom: 0.42em;
  background: var(--vxd-direction-line) 0 100% / 0.36em 0.09em repeat-x;
}
:where(.vxd) .vxd-speech.vxd-directed:not(.vxd-narration) {
  background:
    var(--vxd-speaker-line) 0 calc(100% - 0.28em) / 100% 0.1em no-repeat,
    var(--vxd-direction-line) 0 100% / 0.36em 0.09em repeat-x,
    var(--vxd-tint) content-box;
}
:where(.vxd) .vxd-name {
  display: inline-block;
  font: 600 0.62em/1 var(--vxd-ui-font);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vxd-c, var(--vxd-muted));
  margin-right: 0.45em;
  vertical-align: 0.18em;
}
:where(.vxd) .vxd-name:has(+ .vxd-narration) { color: var(--vxd-muted); }
:where(.vxd) .vxd-direction { display: inline-block; position: relative; width: 0; height: 1em; vertical-align: baseline; }
:where(.vxd) .vxd-direction.vxd-direction-long { display: inline; position: static; width: auto; height: auto; }
:where(.vxd) .vxd-direction.vxd-direction-long > span { position: static; white-space: normal; font-size: 0.8em; line-height: inherit; margin-right: 0.35em; }
:where(.vxd) .vxd-direction.vxd-direction-long > span::before { content: "("; }
:where(.vxd) .vxd-direction.vxd-direction-long > span::after { content: ")"; }
:where(.vxd) .vxd-direction > span {
  position: absolute;
  left: 0;
  bottom: 1.05em;
  font: italic 0.66em/1 var(--vxd-ui-font);
  color: var(--vxd-direction);
  white-space: nowrap;
  pointer-events: none;
}

:where(.vxd) .vxd-chip {
  display: inline-block;
  font: 500 0.66em/1.5 var(--vxd-ui-font);
  padding: 0 0.6em;
  border-radius: 999px;
  border: 1px solid currentColor;
  vertical-align: 0.15em;
  white-space: nowrap;
  margin: 0 0.1em;
}
:where(.vxd) .vxd-chip-sound { color: var(--vxd-sound); background: color-mix(in srgb, var(--vxd-sound) 9%, transparent); }
:where(.vxd) .vxd-chip-sound::before { content: ""; display: inline-block; width: 0.45em; height: 0.45em; margin-right: 0.4em; border-radius: 50%; background: currentColor; vertical-align: 0.05em; }
:where(.vxd) .vxd-chip-vocal { color: var(--vxd-c, var(--vxd-sound)); background: color-mix(in srgb, var(--vxd-c, var(--vxd-sound)) 10%, transparent); }
:where(.vxd) .vxd-chip-who { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
:where(.vxd) .vxd-chip-direction { font-style: italic; opacity: 0.85; }
:where(.vxd) .vxd-chip-pause { color: var(--vxd-muted); border-style: dashed; }
:where(.vxd) .vxd-chip-pause::before { content: "\\2016\\2009"; }
:where(.vxd) .vxd-chip-page { color: var(--vxd-page); }
:where(.vxd) .vxd-chip-instruction, :where(.vxd) .vxd-chip-label { color: var(--vxd-muted); border-color: var(--vxd-line); }
:where(.vxd) .vxd-chip-label { text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.58em; }
:where(.vxd) .vxd-turn { display: flex; width: 100%; align-items: center; gap: 0.8em; margin: 0.2em 0; font: 500 0.66em/2 var(--vxd-ui-font); color: var(--vxd-page); text-transform: uppercase; letter-spacing: 0.08em; }
:where(.vxd) .vxd-turn::before, :where(.vxd) .vxd-turn::after { content: ""; flex: 1; border-top: 1px dashed color-mix(in srgb, var(--vxd-page) 55%, transparent); }
:where(.vxd) .vxd-note {
  display: inline-block;
  font: italic 0.72em/1.45 var(--vxd-ui-font);
  color: var(--vxd-note);
  background: var(--vxd-note-paper);
  border-left: 2px solid var(--vxd-note);
  padding: 0.25em 0.6em;
  margin: 0 0.2em;
  vertical-align: 0.1em;
  max-width: 100%;
  white-space: normal;
}
@media (min-width: 72rem) {
  .vxd-script .vxd-note { float: right; clear: right; width: 13rem; margin: 0.4em -15rem 0.4em 0; vertical-align: baseline; }
}
.vxd-script [data-visibility="book"], .vxd-script [data-visibility="hidden"] { opacity: 0.6; }
:where(.vxd) .vxd-heading-label { font: 0.8em/2 var(--vxd-ui-font); color: var(--vxd-muted); margin: 1.4em 0 0.4em; }
:where(.vxd) .vxd-heading-label.vxd-h1, :where(.vxd) .vxd-heading-label.vxd-h2 { font-weight: 600; }
:where(.vxd) .vxd-image { display: block; margin: 0.6em auto; }

:where(.vxd) .vxd-group { position: relative; margin: 0.4em 0 1em; padding-left: 1.1em; }
:where(.vxd) .vxd-group::before { content: ""; position: absolute; left: 0; top: 0.3em; bottom: 0.3em; width: 3px; border-radius: 3px; background: color-mix(in srgb, var(--vxd-c, var(--vxd-direction)) 60%, transparent); }
:where(.vxd) .vxd-group-label { font: italic 0.68em/1.6 var(--vxd-ui-font); color: var(--vxd-c, var(--vxd-direction)); margin-bottom: 0.1em; }
:where(.vxd) .vxd-group-direction { font-style: italic; }
:where(.vxd) .vxd-group-body > .vxd-p:last-child { margin-bottom: 0; }
:where(.vxd) .vxd-group-name { font-style: normal; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 0.4em; }

@media print {
  .vxd { max-width: none; }
  .vxd-script .vxd-note { float: none; margin: 0 0.2em; width: auto; }
}
`;
