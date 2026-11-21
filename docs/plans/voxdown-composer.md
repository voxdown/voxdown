# VoxDown Composer — browser-only ABC music editor

Status: first local implementation sprint, 2026-11-20. Not published, not linked from the site.

## Product boundary

Composer is a separate `/composer/` entry point in the Writer/Studio family: a static,
browser-only editor for standard ABC 2.1 music notation. No account, server, telemetry or
subscription. After the page loads, every request stays on the site (a Content Security Policy
like Studio's enforces it); instrument samples are self-hosted. Composer is unlinked from the
public site until the owner approves it.

The `.abc` text is authoritative. Files open and save byte for byte: an unchanged file is
written back exactly (BOM, CRLF or mixed line ends, encoding), and an edited one keeps its BOM,
first line-end style and encoding. There is no parse/serialize round trip and no VoxDown-specific
syntax. Several tunes per file are normal ABC and fully supported.

## Working loop

As for Studio: each sprint has an observable outcome, implementation, automated checks, an
independent review (Codex and Claude reviewers score each round, target 9.3/10, against the best
music and writing tools they know), fixes, and a recorded result. Stop a round when its acceptance
checks pass and blocking findings are fixed. Publication needs the owner's explicit approval.

## Sprint 1: elegant ABC editing, live notation, exceptional playback

Layout (decided by the owner): menu bar (File, Edit, Insert, View, Play, Help), a toolbar, a
left rail of tunes with their voices and parts, the text, and the score. The score sits beside
the text on wide screens (default at 1200 px and up) or below it at full width (more bars per
line), chosen with View › Score beside/below, the toolbar toggle or Ctrl/⌘ \\, and remembered.
The score reflows to its panel's width and keeps the reader's place across redraws. Phones
(≤ 760 px) get a Text | Score switch, the rail as an overlay, and a two-row transport that is
always visible. Focus mode and the family's six looks (Auto, Paper, Sepia, Night, Slate, High
contrast) are included, with the score drawn in the look's ink on its paper.

Editing: CodeMirror 6 with ABC highlighting for fields, notes, accidentals, octave marks, lengths,
rests, bars and repeats, chord symbols, annotations, decorations, slurs, ties, tuplets, grace
notes, inline fields, voices, lyrics and comments. A quiet status line explains the token at the
caret ("^c' — C♯, two octaves above middle C, an eighth note", with key and bar accidentals).
Completion for header fields, keys, meters, lengths, tempi, voices and decorations. abcjs warnings
and a bar check (L:/M: changes, pickups, repeats and endings, tuplets, broken rhythm, chords,
grace notes, multi-bar rests, each voice separately; quiet while the bar is being typed) are shown
at their place, in the gutter and in a list.

Musical commands, undoable, on every selected range or the note at the caret: transpose by
semitone or octave (spelled for the key, re-spelling later notes in the bar when needed, chord
symbols too), double, halve, add or remove a dot, bar line, tie, slur, decoration, duplicate the
bar or selection, new tune and new voice templates.

Text ⇄ score linking: the caret's note is lit in the score; a click selects a note's text; a
text selection lights its notes; the score scrolls only when the note is out of view. Regions
(owner's addition): drag across notes (across systems too) to select a span of written time; a
drag within one staff selects that voice, across staves every voice (Alt from the start); Shift
click extends; Alt Shift ←/→ extends by a note. A region selects one text range per voice (several
ranges when voices are written in separate `V:` blocks), snapped to whole notes, chords and rests,
including chord symbols, decorations, lyrics and inline fields in between, and the closing bar
line when it ends a bar. Text selections light their notes, with a soft band per system and staff.
Regions play, loop, transpose, change lengths, copy (several voices: each with its `V:` line, said
so in a notice), cut and delete, each as one step.

Playback: play/pause, stop, play from the caret, loop the selection or the caret's bar, play the
selection once, a position bar with bars and repeat passes (click or arrow keys to move), tempo
from `Q:` with ±, typing and tap tempo, metronome, one-bar count-in, volume, room reverb,
instrument, and per-voice (and chord accompaniment) mute and solo. The lit note follows in the
score and the text; the score scrolls smoothly unless the reader scrolled away (Follow ↓ brings it
back, and it resumes by itself when the note is in view again). Notes sound briefly when the caret
lands on them or they are typed (on by default, quiet). Stop and pause fade in 40 ms. Editing while
playing picks the change up at the next scheduling window, at the same place; a looping region is
rebuilt from the edited music. Exports: MIDI (abcjs), WAV (offline render with the same sound) and
print/PDF (every tune, print stylesheet).

Files: New, Open (File System Access where available), Save and Save as (to the opened file, with
a check that it was not changed by another program, or download), Download, recent files (kept
handles), drag and drop, and per-tab recovery: each tab owns a draft identity (session storage
plus a Web Lock, so a duplicated tab starts its own); reload restores it; other drafts are listed
under Recover and on the start screen. Offline: opt-in, on Studio's pattern (View › Work offline).

Start screen in the family's style with four examples, all VoxDown's own transcriptions of
public-domain melodies: Ode to Joy (Beethoven; dynamics and chords), Greensleeves (traditional;
6/8, parts, repeats), Twinkle, Twinkle (traditional melody, Jane Taylor's 1806 words; lyrics) and
Frère Jacques (traditional round; two voices). Help has a one-page ABC cheat sheet in VoxDown's
style and a shortcuts table.

## Acceptance and checks

- Unit tests (`site/test/composer-abc.test.ts`, `composer-playback.test.ts`): tokenizer offsets,
  lengths, meters and keys; explanations; bar check (pickups, tuplets, broken rhythm, chords, grace
  notes, L:/M: changes, multi-bar rests, voices, repeats and endings); transpose (key spelling,
  later notes in the bar, octaves, chord symbols, several ranges); length, tie, slur, decoration
  and duplicate commands; byte-exact sources (BOM, CRLF, Latin-1); the playback timeline (repeats,
  passes, regions over a repeat, sounding notes, beats and count-in); regions ⇄ text ranges; loops.
- Browser check `scripts/check-composer.mjs` (part of `pnpm site:check`, ~20 s; also
  `pnpm composer:check`): light start screen (no abcjs, no samples); open → download byte-identical
  (BOM, CRLF, two tunes), also after edit and undo; reload recovery and separate tab drafts;
  playback schedules audio and the lit note advances in score and text; warm and cold start times;
  play from caret; tempo; caret → score, click → text, drag in one staff → one range, drag across
  staves → one range per voice, Alt Shift →; looping a two-voice region plays and lights only its
  notes and wraps; transposing two ranges is one undo step; redraws keep the score's place without
  layout shift; editing while playing; the bar check and its list; completion; phone layout; no
  console errors; no request leaving the site.
- Contrast: axe-core finds no colour-contrast failures in Paper, Sepia, Night, Slate or High
  contrast with every syntax colour on screen.

## Research and architecture decisions

- ABC 2.1 standard: https://abcnotation.com/wiki/abc:standard:v2.1 (fields, lengths, tuplet
  defaults, broken rhythm, accidentals to the end of the bar, decorations, voices, lyrics).
- abcjs 6.7.3 (MIT): https://github.com/paulrosen/abcjs — parsing, engraving, MIDI and the audio
  description (`setUpAudio`). It is a lazy chunk (≈150 KB gzip) loaded only once there is a tune.
- CodeMirror 6 (MIT), already in the site, for editing; highlighting comes from Composer's own
  line tokenizer as view decorations over visible lines only, so long files cost nothing extra.
- Sound engine: Composer schedules notes itself with Web Audio from abcjs's note events, instead
  of abcjs's `CreateSynth`, which renders a whole-piece buffer before it can play (slow for long
  tunes and on every edit) and fetches soundfonts from a CDN by default. The events already carry
  repeats, dynamics (`!p!`…`!ff!`, crescendos), beat accents, staccato and slurs, and each note's
  text offset, which is what follow-along and regions need. A worker-driven 25 ms clock schedules
  140 ms ahead; tempo changes re-anchor time; stopping fades in 40 ms; a gentle limiter guards
  against blare. Velocity shapes both gain and, for piano and guitar, brightness (a low-pass that
  opens with velocity). Held instruments loop a matched steady section (found at runtime at upward
  zero crossings) with natural release tails. The room is a generated stereo impulse (≈2 s, darker
  as it decays), on by default at a modest level. Humanise (±8 ms, ±6 % velocity) is off by default.
- Samples (self-hosted, CC BY 3.0, licences in `site/public/composer/sounds/LICENSE.md`): piano from
  the Salamander Grand Piano V3 (Alexander Holm, via Tone.js); fiddle, flute, strings and nylon
  guitar from FluidR3_GM (Frank Wen, via gleitz/midi-js-soundfonts). Every third semitone, mono,
  64 kbit/s MP3: piano 30 files ≈ 970 KB, fiddle 16 ≈ 383 KB, flute 13 ≈ 311 KB, strings 21 ≈
  502 KB, guitar 16 ≈ 383 KB. An instrument loads when first chosen (piano on the first sign of
  intent to listen or write: a click or key), is cached in the browser (Cache Storage) for offline
  use, and its loading progress is shown in the transport. `scripts/prepare-composer-sounds.mjs`
  regenerates them.
- Rendering: abcjs draws into a hidden stage at the panel's width (`staffwidth`, `wrap` with
  bars per line from the width), then the new SVG replaces the old in one step, anchored on the
  system at the top of the view, so typing never flashes or jumps. Redraws wait for a pause in
  typing, scaled by tune length and the last redraw's cost. Timing and the bar check run in
  separate tasks afterwards.
- Score geometry for regions comes from the drawn notes' boxes and staff lines, measured once per
  redraw in the score's own coordinates (so scrolling keeps it valid).
- A drag reads the pointer in time, not by the nearest note: the pointer reaches a note when it gets
  to the note's head (accidentals included, chord symbols and text above excluded), so the space
  after a bar's last note still belongs to that bar, and the next bar starts only at its first
  note. A region takes, in every voice, the notes whose start the pointer reached, so a long note
  under the pointer never lets another voice run ahead (round 1 fix, after the owner's report).
- File › Examples (a submenu, → and ← by keyboard) opens each example as a new draft; the open
  tune's draft is written at once and stays under Recover.
- Shared look: `site/src/workspace-theme.css` and the family's tokens; Composer keeps its own look
  preference (`vxd-composer-look`), applied before first paint by a same-origin script (CSP-safe),
  and does not import Writer or Studio code.

## Measurements (development machine, Chromium, production build served locally)

Measured with throwaway Playwright scripts (not committed) and the browser check.

- First view (the start screen, everything the page loads): 708 KB uncompressed, about 341 KB with
  gzip on scripts and styles (HTML 4 KB, Composer 46 KB, CodeMirror and shared code 116 KB, CSS
  10 KB, the family's Literata and Recursive fonts the rest). abcjs (520 KB, ≈ 155 KB gzip) loads
  only once there is a tune to draw; with a tune drawn the total is about 496 KB transferred.
  No samples load before the first click or key press.
- Time to first sound (press → first note scheduled; add the device's output latency): warm,
  37 ms each time (25 ms of it is a deliberate scheduling margin). Cold, with nothing loaded, the
  samples the tune needs are fetched first and playing starts as soon as they arrive: 0.1 s from
  the local server, 0.32 s on a simulated 20 Mbps / 40 ms link, 2.5 s on 1.6 Mbps / 150 ms. The
  transport shows "Loading piano… n%" meanwhile; the remaining samples follow in the background,
  and a note whose sample has not arrived borrows the nearest one that has.
- Long tasks, 200-bar tune: one 57–67 ms task to redraw after a pause in typing (abcjs engraving;
  ≈ 80–100 ms in the development server), nothing else while typing, none while playing.
- Samples per instrument (MP3, served as is): piano 30 files, 993 KB; fiddle 16, 392 KB; flute 13,
  318 KB; strings 21, 514 KB; guitar 16, 392 KB; 2.6 MB in all.

## Limitations and next priorities

- Engraving is abcjs's: no page layout control beyond width, no cross-staff beams, limited
  `%%` formatting. Regions are rectangular in written time; a region that starts or ends in the
  middle of a tuplet or a tie snaps to whole notes.
- abcjs repeats `|: :|`, endings and `P:`-less tunes; `P:` part orders (`P:AABB`) and `D.S./D.C.`
  jumps are as abcjs plays them.
- Bar check: free meter is skipped; short bars beside any repeat, ending or double bar are
  accepted (so a wrong short bar there goes unnoticed).
- Transpose changes notes and chord symbols, not the `K:` line; a whole-tune transpose with a new
  key is a next step. Spelling prefers the key's notes, then naturals, then the key's sharps or flats.
- Samples are single-velocity; dynamics shape gain and brightness, not timbre layers. Long held
  piano notes decay naturally and stop after about 4–6 s.
- The 200-bar redraw is a 60 ms task on a fast machine; slower phones will exceed 100 ms. Next: incremental redraw by systems (render only the changed systems, abcjs `oneSvgPerLine`).
- Desktop Chromium and emulated phone checks do not replace real iPhone/Android Safari, Firefox and
  screen-reader testing, which come before promotion. Safari's audio latency and MP3 decoding need
  a real-device pass.

## Polish round 2 (after round 1: Codex 7.8, Claude 8.2)

Fixed: named decorations are always `!name!` (only `.` and `~` are bare), so `!p!`/`!f!` no
longer become notes; ties join same-pitch neighbours only, otherwise the next note when equal, or
a notice says why; the menu bar switches on click and closes with Escape; View › Work offline is
reachable and preparing also keeps the instrument (offline stays opt-in, as in Studio); Loop is a
mode; count-in shows its beats and the metronome button pulses; WAV exports are normalised to
−1 dBFS. Editor: no selection-match highlight; completions in the editor's type, ordered by use.
Text ≥ 12 px (tick labels 11 px). Copy: broken rhythm and tuplets as played, bars versus problems,
dates in words, directives styled as directives. Header: the saved state follows the name, and
notices float without moving the workspace. Start screen: tools at rest, layout-neutral copy, the
score's tempo style (♩ = 104). Keyboard: skip to the tune, one Tab stop each for the menu bar,
toolbar and transport (a fresh visit reaches the editor in 12 stops), and score keys that announce
the note, bar and voice, with ↑/↓ for voices and Home/End along the line. Phone: a More menu, a
closable tunes panel, 40 px targets and a one-row transport.

Redraws: edits that keep the bar count and width reuse abcjs's chosen line breaks (one engraving
pass instead of measure, wrap, re-parse and draw), the reader's place is read before engraving,
and the new score goes in on the next task. On a 200-bar tune, typing and edits while playing
now take a 30–48 ms engraving task and a 4–11 ms placing task (was one 60–70 ms task). Opening a
long tune, or adding or removing bars, still does the full two-pass wrap (≈ 62–66 ms there).
Breaks are not refreshed while bars only change inside; a bar that grows a lot keeps its line
until the bar count or width changes.

## Polish round 3 (after round 2: Claude 8.4, Codex 7.7 partial)

Line breaks are now Composer's own, from the bar widths abcjs measures: the author's bars per
source line when consistent and they fit, else 4 bars (8 when 4 leave lines sparse), 2, then 1; a
pickup rides with the first line, abcjs's empty measure before a leading `|:` is skipped, and a
short remainder line joins the line above when it fits. Measuring and drawing are separate tasks.

Lyrics (owner's report: "this song," drawn as "thissong," in a narrow panel): abcjs reserves each
lyric's measured width and nothing more, so at minimum spacing neighbours meet. Each syllable now
carries a no-break space on both sides (and a narrow one before a hyphen) in the parsed tune before
engraving, so abcjs itself reserves at least 0.5em between words; the source text, linking, the
bar check and saving are untouched. The browser check sweeps every splitter position at 1440, and
checks 1024 and 390, for a gap of at least 0.4em between lyric words.

Also: bar checks return after typing pauses or the caret leaves the bar; only a short first bar is
a pickup; the status line describes the bar at the caret; problems name their bar in a popover and
F8 steps through them; notes are read before their dynamics; wrapped lines hang; region bands align
across staves; notices sit above the transport and fade; the clock shows the written bar and the
pass; Voices shows mutes; the stopped marker is hollow; 36 px toolbar targets; drawn ♯/♭; 2×2
example cards; light motion; tablet widths put the score beside with the rail closed; the file
handle is kept with the draft so Save reconnects after a reload; phone toolbar fits with More.

Performance: unthrottled, opening a 200-bar tune is a 23–26 ms measuring task and a 37–48 ms
drawing task; typing redraws are 32–40 ms plus a 3–11 ms placing task. With the CPU throttled 4×
the drawing pass is 130–190 ms: abcjs engraves a tune in one synchronous pass, and splitting it
needs per-system engraving (with ties, slurs, endings and lyrics across systems), planned as its
own step. Redraws wait for a pause in typing, so keystrokes still reach the screen in 32–55 ms at 4×.

## Polish round 4 (after round 3: Claude 7.6 with a HIGH data-loss bug, Codex 7.7 partial)

Data loss (HIGH): the problem marks were stored with ranges past the end of a shortened document;
the next edit's position mapping threw inside CodeMirror's state update, the transaction was
dropped, and the screen and the draft stopped following the typing. Marks are now clamped to the
document before they are stored and before they are mapped, every state field's update is
guarded (a failure empties the marks and is reported), and a safety net resyncs the editor and
keeps the draft from the visible text with an error notice. The browser check replays the three
reported triggers and a seeded 300-edit fuzz, comparing document, screen and kept draft.

Owner's requests: the playing note is a vivid blue per look (Paper #2f6fde) with a soft glow, and
beams, stems, flags, dots, accidentals, ties and slurs take the selection or playing colour (a beam
only when all its notes are in). Dynamics per pass are plain ABC annotations, `"^2nd time p"`,
`"^1st time f, 2nd time p"`, `"_on repeat pp"`: playback scales the velocities of that pass from
the marked note until the next written dynamic or the music jumps back; the score draws their
dynamic letters as bold italic glyphs.

Also: the selection status counts from the text at once; the timeline names passes ("1 · 2nd"),
bands only what is played again and its value, maximum and text agree; Print uses the screen
fonts and the browser's own Print fills the score on `beforeprint`; Focus has a quiet Exit focus
control and Escape, and without the score the text sits in a centred column; shortcut text follows
the platform; a w: line with more syllables than notes is a quiet problem; a header subtitle no
longer adds abcjs's 60 px system gap (abcjs counts its line as a line before the first staff);
narrow scores are drawn at 0.86 with tighter title and system spacing (set on the parsed tune's
formatting, so no source offsets move), lyrics and chord symbols set larger to compensate, voice
names once, and two bars per line wherever they fit; the phone transport labels its icons and
Voices moves into the Sound sheet; the start screen's transport is a slim empty state.

## Polish round 5, the last (after round 4: Claude 8.4, Codex 8.1)

Help: the cheat sheet's code-column rule no longer reaches the key tables; keys wrap between
chords and stack under their action below 520 px. Shortcuts name punctuation keys ("Alt Comma",
"Mod Backslash"), so "Remove a dot" reads Alt+, (⌥, on a Mac) everywhere. The Tab hint shows
after the indent and stays through typing.

Editor truth: a blank line ends a tune where abcjs ends it, so the index, checks, rail and summary
agree with what is drawn; the music below is a problem with a gutter mark, opening a sheet with a
one-click "Remove the empty line"; music before the first X: is noted the same way. abcjs's
warnings are read into plain words where the text shows the cause (unclosed or unknown
decorations with a guess, unclosed chords, chord symbols and grace notes, stray characters,
unknown bar lines), plus Composer's own check for unbalanced slurs; abcjs's words remain only as a
second line when nothing fits. Its warning columns are 1-based. The tokenizer no longer reads an
unclosed !decoration's letters as notes, and a bar line closes a chord left open.

Timeline: labels are measured and dropped rather than touching (first and last bar always kept),
written bar numbers appear on their first time through only, the repeat band carries a "2nd"
tag, and a readout names the bar under the pointer. On a phone, scrubbing shows a large readout
over the finger, snaps to bar starts and lets the ruler take the whole row; the ruler is 44 px.

Weight: completion and Find (with closeBrackets) load on first use of the text; the cheat sheet
and shortcut list load, with their CSS, when first opened. First view 752 KB → 707 KB raw,
354 KB → 340 KB gzip; DOMContentLoaded on a warm reload is unchanged (about 30 ms). What
remains is CodeMirror's core (306 KB, needed to draw the editor), Composer's own code (171 KB)
and three Latin-only variable fonts (162 KB: Recursive, Literata, Literata italic for the brand).
Splitting further means drawing the start screen without the editor, a larger change.

Final pass at 1440, 1024 and 390 in Paper, Night and High contrast: see the round 5 reply for
the list of fixes.

## Tidy-up after the polish rounds (round 5 scored Claude 8.6, Codex 8.2)

Paused or stopped, nothing glows: a hollow marker shows where the music will go on and follows
every seek, and Stop clears it. A drag starting or ending just past a bar line reads it as that
bar's start, in one voice or two, and a note alone in its bar (a whole-bar rest drawn mid-bar)
spans the bar. The bar check waits only for the bar being typed. A new tune's file name follows
its first T: until it is renamed or saved. The header keeps a compact name and an unsaved dot on
tablets and a name chip on phones, and Save is quiet when there is nothing to save. Tablets keep
the transport's labels, with Voices in the Sound sheet. F10 goes to the menus, and Edit has Cut,
Copy, Paste and Select all. Typing . ~ ( over selected music marks every note with staccato, a
roll or a slur, and typing it again removes them; anything that is not music is typed as usual.

## Sprint A: editing and selection (EasyABC parity, then better)

EasyABC (GPLv2) was used for ideas only; none of its code.

- Broken rhythm: typing `>` or `<` over selected music makes each neighbouring pair of notes
  dotted-short or short-dotted. A chord counts as one note; a bar line, a rest or another voice
  starts a new run, and an odd note is left alone. Typing the same sign again removes it, and
  the other sign turns it round. It takes one undo step and sets the status line.
- A selection in several places: Ctrl/⌘ click toggles a note, Ctrl/⌘ drag adds a region, and
  ranges that overlap or touch (only spaces between) merge. The text selection holds every
  range, so the commands, marks, copy and delete act on all of them. The score draws one band
  per run of selected notes, and the status says "in 3 places" when the ranges cover separate
  stretches of time ("in 2 voices" when one stretch spans voices). Play selection and Loop play
  from the first selected note to the last. In the score, Ctrl/⌘ with the arrows moves a
  dashed cursor without changing the selection, and Ctrl/⌘ Space toggles its note. `.` `~` `(`
  `<` `>` also work from the score's keyboard. A mark at a range's edge joins the range, so the
  selection stays on the same notes.
- Typing helpers (Edit › Typing helpers; off by default, remembered):
  - Bar line on Space: uses the bar check's arithmetic, only at the end of a music line right
    after a note.
  - Automatic octave: picks the octave nearest the previous note in the voice by staff steps,
    whatever the case typed (ties go towards middle C), within the clef's range (treble G, to
    c''', bass C,, to e'). A ' or , typed after the note moves it the ABC way. (The first
    reading, a capital for the other side, drifted upwards; the owner chose this rule.)
  
  Each writes what was typed, then its change as its own undo step, and each says once what it
  did.
- Zoom per pane: score 50–200% (abcjs lays out at width ÷ zoom and draws larger, so it
  re-wraps) and text 80–160%. Ctrl/⌘ + − 0 act on the pane with focus or under the pointer,
  and are left to the browser elsewhere. Ctrl/⌘ wheel and a pinch zoom the score.

### Sprint A fixes (after Codex 8.3, Claude 8.2)

- With the score focused, keys with Ctrl/⌘ or Alt (and F8) run the text's own keymap, so play,
  from caret, play selection, loop, stop, transpose, lengths, undo, redo and Find all work from
  the score. Only a bare Enter goes to the text.
- Ranges of rests alone are skipped by marks. A mark never types over music: when it cannot
  apply, the status line says why.
- `M:C|` is 2/2.
- `(` and `'` are no longer auto-paired. A digit typed into a fresh `[]` is an ending.
- Broken rhythm, taken off, restores the exact gap it replaced. The gaps are kept in a state
  field that follows edits.
- Places are counted from runs of selected notes per voice.
- Phones get More › Select more.
- The helpers read back only from the caret: about 3 ms of handler time per key at p90 on a
  200-bar tune, measured with Event Timing.

## Sprint B: MusicXML import and export

Our own TypeScript converter (no xml2abc, which is LGPL, and no other converter's code). It
runs in the browser, and an import becomes a new ABC draft, so the text stays the source of
truth.

### Scope and shape

- `site/src/composer/musicxml/` is a pure module with no DOM:
  - `xml.ts`, a small XML reader. It reads the five named entities and character references,
    CDATA, comments and PIs. The DOCTYPE is skipped: never fetched, and its entities never
    expanded. Every error is an XmlError with its line and column, a character reference outside
    XML's characters (`&#x110000;`, `&#0;`, surrogates) included.
  - `zip.ts`, a zip reader and writer. The reader follows the central directory and inflates
    deflate entries with `DecompressionStream("deflate-raw")`; the writer stores entries
    uncompressed. `META-INF/container.xml` names the root file(s); names with `../` or an
    absolute path are ignored. Encrypted and zip64 archives are refused in plain words.
  - `text.ts`: bytes to text by the byte-order mark, else the encoding the XML declaration names,
    else UTF-8, decoded strictly. Text that does not decode is a plain error, never an empty
    document.
  - `import.ts` (MusicXML → ABC plus a report) and `export.ts` (abcjs's parse → MusicXML 4.0
    partwise).
- The module is a lazy chunk (59 KB, 24 KB gzipped), loaded on the first import or export. The
  first view went from 714 KB to 718 KB (served uncompressed; the check allows 720 KB), for the
  menu items, the file sniffing and the import dialog.
- **Limits** (a zip bomb or a runaway file must not freeze the tab):
  - an .mxl is refused by the sizes its directory gives, before anything is unpacked: a file
    over 64 MB, more than 128 MB in all, or more than 1,000 files;
  - unpacking stops as soon as a file passes 64 MB, whatever its header claims;
  - a plain document over 64 MB, or with more than five million elements, is refused.

  The messages are plain: "This .mxl unpacks to more than 64 MB, too large to open here." The
  reviewer's 2 GB and 300 MB bombs are refused in under a millisecond under node, and in about
  40 ms in the browser, file reading included.
- Ways in:
  - File › Open (the filter is "ABC or MusicXML": .abc .txt .musicxml .xml .mxl);
  - drag and drop;
  - the start screen's Open button.

  A file is MusicXML by its extension, its zip magic, or `<score-partwise` or
  `<score-timewise` near the top. UTF-8 and UTF-16 are both read.
- Import reads partwise and timewise, MusicXML 3.0–4.0 (a later version is read as 4.0 and the
  report says so), and an opus is refused with a plain message. Several `<score-partwise>`
  documents, or several root files in an .mxl, become X:1, X:2… in one file.
- **Transposing instruments are written at sounding pitch** (concert score), so every voice in the
  ABC plays and checks at the pitch heard. The report names the parts this applies to. A
  transposition that changes (Clarinet in B♭ to Clarinet in A) applies from its place on, and the
  report says in which bar.
- **Instruments written an octave from where they sound keep their written octave**, so they are
  drawn where the original draws them and played where they sound:
  - a tenor's or a guitar's treble-8 clef, and treble+8, bass-8, bass+8, alto-8, alto+8, become
    abcjs's octave clefs (abcjs draws the notes where they are written and plays them an octave
    away);
  - an octave in `<transpose>` (piccolo, double bass, Finale's guitar) becomes `transpose=±12` on
    the voice, with the clef as written.

  abcjs has two limits here, and the importer works round both:
  - it plays a plain clef that follows an octave clef in the same line an octave off, so a staff
    that goes back from an octave clef to a plain one is written without octave marks, at
    sounding pitch;
  - other clefs with an octave mark (tenor-8, baritone-8) are written without it, at sounding
    pitch.

  Both cases are said in the report.
- Huge files: the conversion yields to the page every 25 measures and shows "Importing
  name: n%" in the status line. Only the XML read itself is one task.
- After an import the dialog "Imported from MusicXML" gives the summary ("Imported “Title”: 2
  parts, 8 bars. Left out: page layout."), then "Left out" (each kind with its count) and
  "Good to know". It is painted as soon as the conversion is done: the new draft loads and its
  score draws behind it. The status line keeps the summary. A malformed file gives a notice
  ("name could not be imported. This file is not well-formed XML, so it cannot be read: …
  (line n, column m).") and the open draft stays as it was.
- Text that would break an ABC line is kept to one line, spaces collapsed, with `%` written
  `\%` so it cannot start a comment. This covers titles, composers, part names, annotations,
  chord symbols and lyrics. A subtitle credit or a movement title is an extra `T:` line. The
  draft's file name is made safe the same way.
- Export: File › Export MusicXML › "This tune (.musicxml)…", or "Every tune, N files in one
  .zip…" (one .musicxml per tune, stored zip). It is built from `abcjs.parseOnly`, the parse
  the score uses. Element order follows the MusicXML 4.0 XSD sequences, and a test checks every
  element we write against an encoded order table. Export specifics:
  - a brace over the staves of one instrument (one name, or a name and unnamed staves) is one
    `<part>` with `<staves>`, `<staff>` on each note and `<backup>` between staves, as MuseScore
    reads a piano; other braces and brackets are part groups;
  - an octave clef is written with `<clef-octave-change>` and the pitch heard, and a voice's
    `transpose=` as `<transpose>` with the written pitch;
  - segno, coda, D.C., D.S., Fine and To Coda carry `<sound>` (`segno`, `coda`, `dacapo`,
    `dalsegno`, `fine`, `tocoda`);
  - chord symbols are a kind and degrees (`A7b9`: dominant with a flat ninth).

### Mapping

| MusicXML | ABC | Notes |
|---|---|---|
| work-title / movement-title / first credit-words | `T:` | movement-title as a second `T:` when both exist |
| creator composer, lyricist, arranger | `C:`, `C:Words: …`, `Z:Arranged by …` | |
| first metronome / sound tempo | `Q:1/4=96` | later tempos are `[Q:]` inline |
| divisions | `L:` | the unit (1/8, 1/4 or 1/16) whose lengths read most plainly: whole numbers cost nothing, fractions most, a dotted pair written `B>G` nothing; ties go to 1/8 |
| type, dot, time-modification | the note's written length, and its tuplet | `<duration>` only for a note with no type, rounded to a length abcjs draws (reported); so 256- and 768-division files with rounded tuplets come out exact. A rest whose type disagrees with its duration is a bar rest, by its duration |
| pitch step/alter/octave | `^ _ = ^^ __` letters `'` `,` | accidentals only where the key and the bar don't imply them; ties carry them |
| rest, whole-measure rest | `z`; a lone whole-bar rest is `z` and the bar's length (`z4`, `z3`) | abcjs draws `Z` as a "1" bar |
| `<chord/>` | `[CEG]` | |
| tie / tied | `-` | only where the next note has the same pitch and ends the tie; others are reported |
| a dotted note and a note a third its length | `B>G`, `G<B` | when they read so in units of `L:` and nothing comes between them |
| slur | `( )` | |
| time-modification, tuplet | `(3` or `(p:q:r` | p ≤ 9 |
| grace, slash | `{g}`, `{/g}` | |
| beam | no space inside a group, a space between | |
| key, time, clef changes | `[M:]`, `[K:]`, `[K:clef=]` at their time in the bar, bar 1 included | clef: treble, bass, alto, tenor, percussion, and G/F/C on other lines (treble1…, bass3…, alto1…) |
| clef-octave-change ±1 | `treble-8`, `bass+8`, `alto-8`… | notes in the octave abcjs draws them in |
| transpose (semitones) | sounding pitch | changes apply from their place |
| transpose (octave-change) | `transpose=±12` on the voice | notes as written |
| part, part-name | `V:n name="…" clef=…` | |
| several `<voice>` in a part, backup/forward | one `V:` each | |
| two staves in a part | two voices, `%%score {1 2}` | voices sharing a staff in `( )` |
| part-group bracket (square, line) / brace | `%%score [ … ]`, `{ … }` | a brace may sit inside a bracket; deeper or overlapping groups are reported |
| barline: light-light, light-heavy, heavy-light | `\|\|`, `\|]`, `[\|` | |
| repeat forward/backward | `\|:` `:\|` `::` | |
| ending 1, 2, 1,2 | `[1` `[2` `[1,2` | |
| segno, coda; D.C., D.S., Fine, al Fine, al Coda as words | `!segno!` `!coda!` `!D.C.!` `!D.S.!` `!fine!` `!D.C.alfine!` `!D.S.alcoda!` … | other words become annotations |
| multiple-rest | `Zn` | in the tune's first meter only: abcjs times `Zn` by that meter, so elsewhere the bars are written out (reported) |
| dynamics pppp … ffff, sfz | `!p!` … | sf, sfp, fz, rf… are written as `!sfz!`, fp/pf as their first letter, and each is reported |
| wedge crescendo/diminuendo | `!<(!` `!<)!` `!>(!` `!>)!` | |
| staccato, accent, tenuto, strong-accent, staccatissimo/spiccato, breath, caesura | `.` `!>!` `!tenuto!` `!marcato!` `!wedge!` `!breath!` `!shortphrase!` | |
| fermata (on a note) | `!fermata!` / `!invertedfermata!` | |
| trill, mordent, inverted mordent, turn(s), shake | `!trill!` `!lowermordent!` `!uppermordent!` `!turn!` `!invertedturn!` `!pralltriller!` | |
| tremolo single / arpeggiate | `!trem1!`… / `!arpeggio!` | |
| up-bow, down-bow, open, snap pizzicato, thumb, stopped | `!upbow!` `!downbow!` `!open!` `!snap!` `!thumb!` `!+!` | |
| harmony root/kind/degrees/bass | `"Am7"`, `"G/B"`, `"A7b9"`, `"Cmaj7#11"`, `"G7sus4"`, `"C6/9"`, `"Cadd9"`, `"C7no3"` | as lead sheets spell them; kinds with no spelling (Neapolitan, Italian…) are simplified and reported |
| words, rehearsal | `"^text"` / `"_text"` | by placement |
| lyric number, syllabic, extend, elision | one `w:` per verse, `-`, `_`, `~` | `\|` per bar keeps lines aligned |
| print new-system / new-page | a new ABC line | otherwise 4 bars a line |
| implicit first measure | a pickup | |
| unpitched (percussion) | the display step/octave in a `perc` clef voice | reported |

### What is dropped, and why

Everything here is counted in the report: nothing is dropped without being reported.

- **Page layout** (`<defaults>`, `<credit>`, system/page/staff layout, fonts, positions): ABC
  lays itself out, and Composer wraps by phrase.
- **Marks ABC or abcjs cannot draw:**
  - fingerings;
  - pedal marks;
  - octave lines (8va);
  - brackets, dash lines and trill lines;
  - glissandos and slides;
  - harmonics, bends, hammer-ons, pull-offs, taps, frets and strings (tablature);
  - figured bass;
  - chord diagrams;
  - notehead shapes;
  - two-note tremolos;
  - cue notes;
  - beat, measure and slash repeats;
  - harp pedals;
  - scordatura;
  - accordion registrations;
  - swing settings;
  - images;
  - other or unknown articulations, ornaments and dynamics.
- **Part brackets and braces ABC cannot nest** (a bracket inside a bracket, a brace around a
  grand staff, overlapping groups): the widest are kept.
- **Approximations** (said in the report):
  - composite time signatures written as their total;
  - microtones rounded to the nearest semitone;
  - the first note of a grace chord;
  - lyrics on grace notes;
  - fermatas on bar lines;
  - ties to a note of another pitch, and ties that do not end (let ring);
  - overlapping notes in one voice.
- **Good to know** (the report's second list: what is kept, but drawn or played differently):
  - transposing parts written at sounding pitch, and where a transposition changes;
  - octave instruments kept in their written octave (an octave clef or `transpose=`), and octave
    marks left off where abcjs cannot draw or play them;
  - cross-staff notes, drawn on their voice's own staff;
  - "To Coda" written as text: playback does not jump;
  - D.C., D.S., Fine, segno and coda: drawn, but playback plays the music as written (abcjs
    follows repeats and endings, not these jumps);
  - chord kinds with no symbol of their own, simplified;
  - notes without a type, their lengths rounded to a note value;
  - multi-bar rests in another meter than the tune's first, written bar by bar;
  - a MusicXML version later than 4.1, read as 4.0.
- **Limits of ABC/abcjs:**
  - tuplets of 10 or more notes, and nested tuplets: the notes are kept at their sounding
    lengths, without the tuplet sign, so the bar check flags the bar;
  - notes shorter than a 128th or longer than a long: kept and reported, but abcjs warns.
- **Bars that do not add up** in the file (incomplete or overfull) are kept as written. The bar
  check flags them as problems; the importer never fixes them silently.

### Coverage: feature × import × export × round trip

✓ = done and tested; ≈ = done, with the approximation noted.

| Feature | Import | Export | Round trip |
|---|---|---|---|
| Title, composer, lyricist, tempo | ✓ | ✓ | ✓ |
| Notes, accidentals in key and bar | ✓ | ✓ | ✓ |
| Rests, whole-measure and multi-measure rests | ✓ | ✓ | ✓ |
| Chords | ✓ | ✓ | ✓ |
| Ties, slurs | ✓ | ✓ | ✓ |
| Triplets and general tuplets (p ≤ 9) | ✓ | ✓ | ✓ |
| Grace notes, acciaccatura | ✓ | ✓ | ✓ |
| Beams | ✓ | ✓ | ✓ |
| Key, time and clef changes | ✓ | ✓ | ✓ |
| Transposing instruments, and changes of instrument | ✓ (sounding, from their place) | sounding pitch | ✓, played pitch checked |
| Octave clefs and octave instruments (tenor, guitar, piccolo, double bass) | ✓ drawn as written, played as heard | ✓ (`clef-octave-change`, `<transpose>`) | ✓, drawn and played pitch checked |
| Rounded tuplet durations (Sibelius 256, Finale 768) | ✓ (lengths from the type) | n/a | ✓ |
| Changes in the middle of a bar | ✓ | ✓ | ✓ |
| Several voices in a part | ✓ | ✓ (`<backup>`) | ✓ |
| Grand staff, `%%score` groups | ✓ | ✓ (one part of two staves; other groups as part groups) | ✓ |
| Repeats, endings, double and final bars | ✓ | ✓ | ✓ |
| D.C./D.S./Fine/segno/coda | ✓ (playback ignores the jumps: reported) | ✓ (with `<sound>`) | ✓ |
| Dynamics, wedges | ✓ (≈ for sf, fp…) | ✓ | ✓ |
| Articulations, fermatas | ✓ | ✓ | ✓ |
| Ornaments, tremolo, arpeggio, bowing | ✓ | ✓ | ✓ |
| Chord symbols (with degrees and bass) | ✓ | ✓ (kind and degrees) | ✓ |
| Annotations and words | ✓ | ✓ | ✓ |
| Lyrics: verses, syllables, extend, elision | ✓ | ✓ | ✓ |
| System breaks | ✓ | ✓ (`<print new-system>`) | (layout, not compared) |
| Pickup | ✓ | ✓ (`implicit`) | ✓ |
| Several movements / tune book | ✓ (X:1, X:2…) | ✓ (a .zip) | ✓ |
| .mxl (deflate) / plain / timewise | ✓ | plain .musicxml | n/a |
| Percussion (unpitched) | ≈ (display pitch) | as pitched notes | ✓ |

The round trip compares, per voice:
- pitches as MIDI numbers (after key and bar accidentals);
- lengths, ties and graces;
- marks, with synonyms such as `!<(!`/`!crescendo(!` treated as one;
- chord symbols, slurs, bars, repeats and lyrics.

It does not compare bytes. Pitches are compared as heard: an octave clef or a voice's
`transpose=` counts.

A round trip alone cannot catch errors that cancel out (an import an octave low and an export an
octave high). So a second test compares **the played MIDI pitch** with the MusicXML's sounding
pitch, read straight from the XML: what abcjs schedules for Composer's player, at what time,
against each note's pitch with its transposition. Grace notes and tied continuations are
counted as the player plays them, and rounding of a 480th of a whole is allowed. It runs on the
original import and again after export and a second import.

- **Examples (4):** Ode to Joy, Greensleeves, Twinkle and Frère Jacques all come back the same.
- **Handwritten cases (4):** all come back the same.
- **Fixtures (17):** all come back the same. They are:
  - MuseScore-style, Dorico-style, timewise, transposing with percussion, and features;
  - octave instruments, Sibelius-256 and Finale-768 tuplets, changes in the bar, bar rests, and
    awkward text;
  - six of the reviewer's files (MuseScore song, Dorico winds, Finale guitar, Sibelius
    tuplets, SATB, text injection).

  Played pitch matches the MusicXML in all 11 fixtures checked. The reviewer's Sibelius file is
  not one of them: its septuplet's durations add up to a half note where its types make a
  quarter, so the type is taken and the bar adds up.
- **The unofficial MusicXML test suite:**
  - **Source and licence:** Reinhold Kainhofer's suite, 166 files, from LilyPond's
    `input/regression/musicxml`, under the MIT licence. It is committed in
    `site/test/fixtures/musicxml/lilypond-suite/` with its LICENSE beside it.
  - **Import:** all 166 import without failing, and 159 draw without warnings with every bar
    adding up. The other 7 are listed in the test with reasons:
    - three use durations beyond abcjs;
    - two use a 17-note tuplet or nested tuplets;
    - two have bars that really are incomplete or overfull, and the bar check flags them.
  - **Round trip:** 164 come back the same. The other 2 are listed: a chord shared between
    voices, and tablature spacing.
  - **Played pitch:** 143 files are checked; the rest are left out because their playing order
    differs from their written order (repeats, endings, jumps), or abcjs plays their ornaments
    as several notes, or they are unpitched. 138 play exactly what the MusicXML sounds. The other
    5 are listed: notes beyond abcjs's longest and shortest, multi-dotted notes, a 17-note or a
    nested tuplet, and the shared chord.

### Timings

A generated orchestral score (12 parts × 300 bars, 4.8 MB, 28,800 notes, with dynamics, slurs,
lyrics and three transposing parts), on the development machine with the production build in
Chromium:

| Stage | Time |
|---|---|
| Read the XML (one task) | 112 ms |
| Convert, yielding every 25 measures (progress 0 → 100%) | about 650 ms, no task over 50 ms |
| Load the ABC into the editor | 255 ms |
| The rest of the 2.4 s to the report dialog | the existing score draw of 28,800 notes |

- **Under node (vitest):** 102 ms for the XML read and 330 ms for the whole import. abcjs's
  parse takes 67 ms.
- **The result:** 76 KB of ABC, with no abcjs warnings and no bar problems.
- **The draw:** it has one task of about 1 s. Opening the same ABC as a plain .abc file gives
  the same task, so it is the score renderer, not the import. A future sprint could split the
  draw.
- **The check:** `check-composer` imports a 12 × 300 score built in memory. It asserts a
  progress line, that no task runs a quarter second or more while importing, and that the report
  is painted before the score is drawn: about 15 ms after the conversion, with the score drawn at
  about 1.6 s.
- **The reviewer's 8-part score** (13.3 MB, 1,000 bars): converted in 1.7 s, report painted at
  1.7 s (it was 7.5 s), drawn and timed behind it by 7.5 s.

## Sprint C: tune books, exports, and the play order

Every command that changes the text is one undo step of its own (`isolateHistory`), never
automatic, and touches only the text it is asked to change. Saving stays byte-faithful. The new
code loads on first use:
- the play order (5 KB) loads with abcjs;
- the tune-book commands (9 KB), the exports (15 KB) and the MIDI writer load when used.

The first view is 719 KB, under its 720 KB check. To make room, the MusicXML import report and
MusicXML export moved into the MusicXML module.

### 1. The play order: D.C., D.S., Fine and Coda

abcjs plays repeats and endings but ignores jumps, so Composer works out the order itself
(`playorder.ts`, pure, with unit tests).

- **What it reads.** The first voice's bars give the bars, repeats and endings; the jump marks
  come from every voice. Marks may be decorations or words:
  - decorations: `!segno!`, `!coda!`, `!fine!`, `!dacoda!`, `!D.C.!`, `!D.S.!`, `!D.C.alfine!`,
    `!D.C.alcoda!`, `!D.S.alfine!`, `!D.S.alcoda!`;
  - words: "D.C.", "Da Capo", "D.S.", "Dal Segno", with "al Fine" or "al Coda", "Fine", "To Coda",
    "Coda".
- **Repeats are played as abcjs plays them.** A unit test checks this against abcjs's own
  expansion on ten repeat forms:
  - `:|` goes back to the last `|:` or `::`, else to just after the last `:|`, else to the start;
  - a section with endings is played as many times as its highest ending number, taking the
    ending with each pass's number;
  - a second ending runs on, as abcjs draws it, until a double, thick or repeat bar.
- **The jump.** D.C. goes back to the start and D.S. to `!segno!`. Either happens at the end of
  the bar that carries it, once that bar's own repeat is played out.
- **On the return,** repeats are not played again, and each run of endings takes its last ending.
- **Where the return ends:**
  - al Fine stops at the end of the bar with Fine;
  - a plain D.C. or D.S. does the same when the tune has a Fine, and otherwise plays to the end;
  - al Coda leaves at the end of the bar with "To Coda" (`!dacoda!`, or the first `!coda!` when
    there is no "To Coda") and goes on from the next `!coda!`.
- **A mark written on a bar line** (`!segno!|:`) belongs to the bar after it if it is a segno or
  coda, and to the bar before it otherwise.
- **The timeline is laid out in this order.** Each written note appears where its stretch is
  played, and bars and passes are worked out again. The scheduler, the clock, the ruler,
  follow-along, WAV and MIDI all use it:
  - the clock says "Bar 5 · D.S." (or D.C.), and "Coda" in the coda;
  - the ruler draws a band for each.

  MIDI is now written from this timeline by Composer's own writer (`midi.ts`), not abcjs's: type
  1, a track per voice, per-pass dynamics in the velocities.
- **Play › Follow D.C./D.S. jumps** is on by default. Off, the music is played as written, for
  practising sections.
- **Tested forms:** D.C. al Fine (decoration and words), D.S. al Fine, D.S. al Coda (with "To
  Coda", or with two coda signs), D.C. al Coda with `!dacoda!`, plain D.C. with and without a
  Fine, Dal Segno as words, repeats and endings inside the return, a D.C. on a repeat's last bar,
  and jumps not followed. check-composer plays a D.S. al Coda and checks three things: the notes
  lit in order, the clock's "D.S." and "Coda", and the setting.

### 2. Tune-book commands

These are under Edit › Tune book, and in a menu on each tune in the rail (right-click, Shift F10
or the menu key). Pure functions in `book.ts`, unit-tested.

- **Renumber X: 1…n:** only each X: line's number changes. Spaces and comments after it are kept.
- **Sort tunes…** by title, X: or key.
  - By title ignores a leading The, A or An, accents and case; by key goes from C to B, major
    before minor.
  - The file's header (everything before the first X:) stays first.
  - Comments or other text between two tunes move with the tune after them. The blank lines
    between tunes stay where they were.
  - The dialog says all this.
- **Line up bars** pads music lines with spaces so their bar lines stand in columns.
  - It works on every tune, the selection, or the rail's tune.
  - A run of music lines is aligned together. Voice and lyrics lines inside the run don't break
    it, so the voices of a system line up too.
  - A run of bar lines (`:| [2`) counts as one, aligned on its first. A leading bar (`|:`) is not
    counted.
  - Lines whose bar count is far from the run's usual count stay as they are.
  - Spaces go in only just before a bar line, so the notes and beams cannot change. Tests check
    that abcjs's whole parse, positions aside, is identical before and after (for the examples, a
    two-voice tune and endings), and that running it twice changes nothing.
- **Incipits…** makes a new draft for a tune index and leaves the file untouched.
  - For each tune: X:, T:, M:, L: and K: (with the first voice's clef), then its first 1–4 bars
    in its first voice, chosen in the dialog.
  - A pickup comes with its bars. Lyrics and other voices are left out.
  - Short tunes now share a printed page instead of taking one each, so incipits print well.
- **Duplicate tune** puts a copy after the tune, with the next free X:. **New tune after this one**
  inserts the template there.
- **The editor is now monospaced, as its CSS always intended.** It asked for Recursive's MONO
  axis, but the Recursive it loads has only the weight axis, so the text was proportional and no
  alignment could look like a table.
  - The new font is a 45 KB static instance of Recursive Mono: Latin, weight 300–800, made with
    fontTools from the fontsource file the site already has. It sits in `composer/fonts/` with
    the OFL and a README.
  - It loads once something is open, never behind the start screen. Line numbers keep the
    interface font.
  - check-composer measures the lined-up bar lines on screen.

### 3. Exports

These are under File › Export. Each choice is made in a small dialog.

- **SVG of this tune…** is the tune as drawn (as print draws it, 740 px wide), plain black on
  white by default or in the current look's colours. The file is standalone:
  - our classes, data attributes and styles are removed, and so are abcjs's own `<style>` and
    XHTML `<title>`;
  - the colours are written in, over a background rectangle;
  - the view box takes in everything drawn, with a 14 px margin;
  - there is one `<title>`;
  - font families fall back to serif or sans-serif (the music itself is paths);
  - pass dynamics are bold italic by attribute.

  It is valid XML, and our strict XML reader parses it in the tests.
- **HTML tune book…** is one self-contained page.
  - **Contents:** the title, the number of tunes, and a contents list with each tune's composer,
    key and meter.
  - **Each tune:** inline SVG, and its ABC in a block that is closed, open or left out, as chosen.
  - **Printing:** a print stylesheet starts each tune on a new page (a tune longer than a page
    flows on) and hides the buttons and closed blocks.
  - **No scripts are needed to read it.**
  - **Optional Play button per tune:** a triangle-wave synth in about 1.1 KB of inline script, with
    each tune's notes in the order played as JSON beside it. It works offline.
  - **Size:** a book of four reels and jigs is 278 KB.
  - **Checked in a browser:** it opens offline with every tune drawn and no network requests, and
    printed to PDF it is 5 pages (contents, then a page per tune).
- **MIDI… and Audio (WAV)…** export this tune, or every tune as files in one .zip (the in-house
  zip writer).
  - Each tune's timeline is built as the player builds it: abcjs's description, the play order,
    per-pass dynamics.
  - A .zip of separate files was chosen over one type-1 file with a track per tune: each tune can
    be opened, played and shared on its own.
  - WAV renders tune by tune with the current instrument (four tunes in 3.7 s).
- **Names** come from titles, made safe, and are numbered when two titles are the same: "Drowsy
  Maggie.svg", "Session tunes MIDI.zip".

### Sprint C fixes (after Claude 8.7, Codex 8.3)

- **The first bar's length** comes from the meter at the first note, the bar check's reading
  (`tuneMeter`), for the player and the exports. abcjs's rendered tune once gave the wrong one
  when a subtitle came first, so a 3/4 tune "had a pickup" and Élan lost a bar from the ruler.
- **Line up bars:**
  - a bar line with only inline fields, decorations, chord symbols or annotations before it
    (`[V:1] |:`, `!segno!|:`) leads its line and isn't a column;
  - lines go in groups of like bar counts (within one bar), each lined up on its own.
- **The ruler with jumps:**
  - every band's first bar is numbered;
  - the D.C./D.S./Coda chips always show, in short (𝄌) when their band is narrow;
  - bands sit 1 px inside their stretch, so neighbouring bands show a gap.
- **Jump marks are easy to find:**
  - completion lists To Coda and the four "al" forms beside segno, coda and fine;
  - each has a plain meaning ("D.S. al Coda: go back to 𝄋, play to To Coda, then jump to 𝄌");
  - the decoration menu has a "Repeats and jumps" group;
  - the cheat sheet has Repeats and jumps, Tune book and Exports.
- **Tune-book commands say what they did** in a notice ("Renumbered 4 tunes (X:1–4)", "Lined up
  6 lines in 2 tunes", "Duplicated Élan as X:13", "Sorted 4 tunes by title", "Made incipits of
  4 tunes").
- **Dialogs:** Sort, Incipits and the export dialogs are forms, so Enter confirms, and their
  radios show a focus ring.
- **One caret rule:** between two notes the status line, the highlight and Say note all name the
  note to the left.
- **One problem per cause:** after an unclosed chord-symbol quote or decoration, the letters
  abcjs skips on that line fold into its problem.
- **HTML book:**
  - each Play button is labelled "Play <title>";
  - Play and "ABC text" share a baseline;
  - the text is set in Literata where the reader has it.
- **Sort** puts exactly one blank line where two tunes would now touch; gaps that were already
  there are kept.
- **Menus:**
  - a **Tunes** menu holds the tune-book commands;
  - Edit is down to 13 items, with the pitch, length, dot, tie and slur commands under Edit ›
    Notes;
  - on a phone the bar shows File, Edit, Tunes and ⋯ (Insert, View, Play, Help). The menu
    titles, editing buttons and Text/Score switch are 44 × 44, and the file name shows in full.
- **Small things:**
  - "8va↓" is "8vb";
  - the Appearance Auto card reads on one line;
  - on desktop the clock and status line are 13 px and the rail's code 12 px, in the muted
    colour at 5.4:1;
  - a new tune with no notes shows "Type notes after K: and the score draws here".
- **The first view** is 719 KB. To keep it there, the decoration menu's labels, the About text
  and the offline panel now load when first opened.

## Sprint D: finding and playing in

Everything new loads on first use:
- melody search: 9 KB, plus 2 KB of CSS;
- the MIDI keyboard: 9 KB, plus 2 KB of CSS;
- the MIDI file reader: 24 KB, which loads the MusicXML importer behind it;
- the import glue (`importers.ts`) and the Sound popover (`sound-panel.ts`), moved out of the main bundle to make room.

The first view is 719 KB, under its 720 KB check.

### 1. Melody search (Edit › Find melody…, Ctrl/⌘ Shift M)

`melody.ts` is pure and unit-tested. `melody-ui.ts` is the panel.

**Reading the music.** Each voice of each tune is read once into sounding notes:
- one note per note or chord: the chord's top note;
- a tied note is one note;
- grace notes, rests, decorations, chord symbols, slurs and bar lines are left out;
- broken rhythm and tuplets count in the lengths.

**The cache.** Reads are cached by the tune's text and the file header, so a search re-reads only tunes that changed.

**Matching.**
- Matching compares the steps between notes, not the notes:
  - in semitones (exact intervals, the default);
  - or as up, down and same (contour).
- So any key, octave or L: matches.
- "Ignore repeated notes" (on by default) folds a note played again into one.
- "Same rhythm" requires the same length ratios.

**The query.** It is typed ABC, read in the current tune's key and unit. It can also come from the selection ("Find this melody"), or from the MIDI keyboard. Notes played into it are spelled for the key, with one bar's accidentals for the whole query.

**Scope.** This tune, this file (the default), or every draft in this browser (read only; choosing a result opens that draft).

**Results.**
- Each result shows the tune, voice, bar and the ABC excerpt.
- Choosing one selects the matched notes as ranges, merged per line, across bar lines. The score lights them.
- Enter, F3 and Shift F3 step through the results.
- The count and the time taken are shown.

**Timing.** 200 tunes searched in 34 ms cold and 5 ms cached (unit test, Node).

### 2. A MIDI keyboard (Play › MIDI keyboard…)

`stepentry.ts` is pure and unit-tested. `midi-input.ts` is the panel.

**Support.** Web MIDI is in Chrome, Edge and Opera. Elsewhere the panel says "MIDI keyboards need Chrome or Edge (or Opera)". Access is asked with `sysex: false`, never SysEx.

**The panel.**
- Picks the input device and remembers it by name.
- Shows the notes held and a velocity meter.
- Says on its status line when a keyboard is plugged in or out; the device list follows.

**Modes.**
- Nothing.
- Hear it: the player's own instrument, with the key's velocity.
- Write it at the caret: step entry.

**Step entry.**
- A note or chord is written when the last key of it is let go. Keys held together are a chord, written `[...]`, low to high.
- The length is picked in the panel, or with keys 1–6 (32nd to whole) and `.` (dotted) while the panel has focus. It is written in the tune's L:.
- **Spelling:**
  - the key's own note first;
  - then sharps in sharp keys and flats in flat keys;
  - in C: E♭ and B♭, but F♯, C♯ and G♯.
  - An accidental is written only when the key and the bar's earlier accidentals don't already give it, so a natural after a sharp is written.
- **Octaves:** a voice with an octave clef (treble-8 and the others) is written an octave from where it sounds, so it plays as played. Without one, `transpose=` counts.
- **Rests:** the sustain pedal (or a key chosen with "Use a key…") writes `z` at the current length.
- **Bar lines:**
  - When the notes fill the bar, " |" follows. This uses the typing helper's own check (`barIsFull`), always on here.
  - It needs the caret at the end of its line. Writing in the middle of a line never adds bar lines.
- **Spacing:** notes shorter than a beat join the note before them inside a beat, so they beam by beat. Otherwise a space comes first.
- **Undo:** each step is one undo (`isolateHistory`), the bar line with its note.

**Real-time recording is left out.** Playing along with the metronome needs latency compensation and a quantiser that handles held notes across bar lines. A rough version would write worse ABC than step entry, so it waits.

### 3. MIDI files (File › Open, or drop a .mid or .midi)

The pieces:
- `midifile/smf.ts` reads the file;
- `midifile/convert.ts` turns it into notation;
- the MusicXML importer writes the ABC, so both imports share one writer (units, line breaks, lyrics, ties, tuplets, voices and `%%score`).

**Reading.**
- Formats 0 and 1; a format 2 file's tracks are read one after another.
- RIFF-wrapped .rmi files are read too.
- Running status (including across meta events, as many files rely on).
- Note-on with velocity 0 counts as note-off.
- Meta events kept: tempo, time and key signatures, track names and lyrics.
- SysEx is skipped and counted.
- Controllers, pedal, pitch bends, aftertouch, program changes and markers are counted for the report.
- **Refused, with a plain message:**
  - files over 16 MB;
  - files with more than 2 million events;
  - SMPTE timing;
  - damaged files: cut short, data with no status, bad data bytes.

**Time.** Time is counted in slots of 1/96 of a whole note, so 32nds (3 slots), eighth-note triplets (8) and sixteenth-note triplets (4) are all whole numbers.

**The grid.**
- **Straight grid:** eighths, sixteenths or 32nds, the coarsest that holds the notes' starts. At most 1 note in 100 may start more than a quarter step (and half a slot) off it; in a short piece, none.
- Notes on thirds of a beat are left out of that choice.
- **Triplet beats:** a quarter beat is written in triplets when two or more notes start inside it, and they sit on thirds at least twice as closely as on the straight grid.
- Compound and /8 meters stay straight unless triplets are asked for.
- So swing, with one note inside each beat, stays straight eighths; a hard 2:1 written as triplets has to be asked for.
- **Snapping:** starts and ends snap to the grid of the beat they fall in. A note that would vanish gets one step.
- **Re-import grids:** the report can import again with:
  - Eighths;
  - Sixteenths;
  - 32nds;
  - Eighth-note triplets throughout;
  - Sixteenths with triplets where they fit;
  - or Chosen from the music.

**Parts and voices.**
- Each track with notes is a part. In format 0, and in a track that mixes channels, each channel is a part.
- **Part names:**
  - a track's own name, when the track is one part (in format 0 the track's name is the title);
  - else the General MIDI program's name;
  - else "Channel n".
- Notes that start and end together are a chord.
- **Splitting into voices:**
  - A chord goes to the first voice of its part that is free when it starts.
  - Before opening a new voice, a note still sounding into the new one by at most a sixteenth (and at most half its length) is trimmed to meet it, as legato playing does.
  - At most four voices per part. Past that, the voice held longest lets go.
- Voices after the first show only their notes; their gaps are invisible rests.
- **Clefs:** a part averaging below middle C gets the bass clef.

**Drums (channel 10).** Left out by default, and the report says so with the count; Composer has no drum sounds. On request they go on a percussion staff in the usual places: kick in the bottom space, snare in the third, toms between, hi-hat and cymbals above.

**Key.**
- From the key signature meta.
- Else estimated with the Krumhansl–Kessler profiles over how long each pitch class sounds, plus a small lean toward the key whose tonic is the last bass note. The report says it was estimated.
- **Spelling:**
  - the key's notes first, then naturals;
  - then sharps in sharp keys and flats in flat keys; in C, E♭ and B♭, with F♯, C♯ and G♯;
  - a minor key's leading note is raised (C♯ in D minor).
- Key changes take effect at the next bar start.

**Meter.** From the time signature meta, else 4/4, said so. Meter changes take effect at the next bar start.

**Tempo.**
- The first tempo is Q:. Later changes are inline [Q:], the first in a bar.
- With no tempo in the file, MIDI's default 120 is written and said.

**Notation.**
- Notes are split at bar lines.
- A note that starts off the beat and runs over the next beat is split at that beat; the pieces are tied.
- Lengths that aren't a note value are cut into the largest ones that fit.
- Notes shorter than a beat are beamed by beat (a dotted quarter in compound time).
- Each triplet beat is one tuplet.

**Lyrics.**
- Lyric meta events go under the first voice of the part whose notes start where the syllables are.
- A trailing "-" joins a syllable to the next. So does a missing trailing space in karaoke-style files, where words end in a space.
- Syllables with no note starting under them are counted as left out.

**The report says:**
- the file's format, and how many tracks or channels became how many parts and voices;
- the grid chosen;
- what was estimated (key, meter, tempo);
- where the lyrics went, and what became of the drums;
- that loudness isn't written;
- **left out:** pedal, controllers, pitch bends, aftertouch, program changes (the first names a part), SysEx, markers, notes cut short by a fifth voice, and notes never released.

**Re-importing.** "Import again" applies the chosen grid and drums. While the draft is unchanged since the import, it is replaced rather than a new one made.

**Composer's MIDI export** now writes 6/8, 9/8 and 12/8 time signatures. Before, a dotted beat gave none.

**Timing.** A 570 KB file (16 tracks, 400 bars, 68,400 notes, 19 voices) is read, converted and written as ABC in 1.4 s in the browser, not counting loading the module or drawing the score.

### Checks

**Unit tests:**
- the matcher, in `composer-melody.test.ts`;
- step-entry spelling, lengths and octave clefs, in `composer-stepentry.test.ts`;
- the SMF reader, quantiser, key and speller, in `composer-midifile.test.ts`. That file also covers:
  - every example re-imported from Composer's own MIDI export, with the same notes and lengths;
  - handmade files: format 0 with several channels and running status; format 1 with a conductor track and tempo changes; triplets; swing-ish timing; drums; lyrics; overlapping lines; ties across beats and bars; an estimated key;
  - damaged and hostile files.

**`check-composer` (step 24):**
- a melody found a tone up across a 3-tune file and selected; F3 to the next;
- the keyboard playing into the search;
- step entry with a fake MIDIAccess (D major and the bar's accidentals, a chord, lengths, the pedal's rest, a bar line, F major on a treble-8 voice, undo per note, unplug and plug);
- the unsupported message with `requestMIDIAccess` removed;
- a .mid opened with its report, then imported again at sixteenths with the drums;
- the first view without melody or MIDI code.

### Sprint D fixes (after Claude 8.4, Codex 7.8)

1. **Key changes drawn right across the score's reflow.** abcjs 6.7.3's `lineBreaks` reflow repeats the key and clef at every join of the source's own lines. A key change was drawn twice (two sharps, then a stray ♯ mid-line), and a line after a clef change could start in the old clef. Playback was always right.
   - `reflow.ts` (`keepSignatures`, loaded with abcjs) runs on every parsed tune. On a reflowed tune, each line starts with the key and clef in force. Everywhere, a key or clef element that changes nothing is dropped.
   - Meter, L: and Q: elements were checked and are drawn once, where written.
   - The MusicXML and MIDI importers write [K:] only when the signature changes.
   - Tests:
     - unit tests over abcjs's own reflow: C→G, Em→G, D→F, a change at a drawn line's start, two voices, `[K:G clef=bass]`, [M:]/[L:]/[Q:], and an unreflowed tune left alone;
     - check-composer step 25: drawn key signatures, clefs and time signatures by line and bar, at 1440 beside, below and 390.
2. **Large files.** Every spread of a data-sized list into a call is now a loop (`extent.ts`): in the MusicXML and MIDI code, and in the score and play order they feed. A 200,000-note file imports. Error messages Composer writes are shown as they are; any other error is logged to the console and a plain sentence stands in (`plain.ts`).
3. **Both hands of a piano in one track** go on a grand staff (`splitHands`).
   - **When:** the part's range spans both clefs (its low 15% below G3, its high 15% above E4).
   - **How:** notes are taken onset by onset. Each goes to the hand whose line it continues: nearest to where the hand is heading (its last note moved on by its last step).
   - **Costs and tie-breaks:**
     - a hand still holding notes is less likely to take a new one;
     - no hand stretches past a tenth;
     - a slight pull toward middle C;
     - ties go to one note per hand, uncrossed.
   - Each hand gets its own voices, so a chord never mixes hands.
   - Tests: an alberti bass under a melody, block chords, and lines that cross.
4. **The key estimate** leans toward the key whose tonic is the last bar's lowest note only when that key's Krumhansl–Kessler score is within 0.05 of the best. A C major piece ending on an alberti G stays in C. Tests: that piece, A minor, G major.
5. **Step entry across bar lines.** A step that overflows the bar is split at the bar line and tied (a rest without a tie). The bar line goes in, and the count starts again in the new bar, where accidentals are written afresh. A long note crosses as many bars as it needs, and a bar already full is closed first. This is the pure `stepInsert`, with tests.
6. **The start screen** makes the text, score, splitter and tunes panel `inert` and `aria-hidden` while it shows.
7. **Step entry's caret:** a steady caret mark (a CodeMirror widget) where the next note goes, while step entry is on. The score lights the caret's note as before.
8. **Docked panels.**
   - Find melody and the MIDI keyboard dock in the rail's column, which widens to 340 px while one is open (`dock.ts`). They never cover the text, the score or the lit match, and the score scrolls the match into view.
   - On a phone they sit above the transport. A chosen melody result folds the panel to one line (2 of 7 ‹ › Close).
   - Both use the dialogs' 1 px border; focus on the panel shows in the border, not a ring.
9. **Melody search.**
   - Matches may overlap.
   - "Every draft" reads every draft, one at a time.
   - Results are drawn 500 at a time with "Showing 500 of N. Show 500 more".
   - Ranking: exact intervals first, then the same rhythm, then those with no repeats folded. Matches that needed repeats folded say so.
   - Unnamed voices are named by their V:.
   - The hint says what contour and Same rhythm match.
   - Tab stays in the panel; Escape closes it and returns focus.
10. **Step entry's state.** A "Step entry" pill shows in the status line. Closing the panel goes back to Hear it. A refusal, or no keyboard, shows only its message and Retry.
11. **MIDI copy and metadata.**
    - The start screen and the "Coming from MuseScore" help mention MIDI.
    - Composer's MIDI export writes the key signature (it already wrote the meter and track names), so its files come back in their own key.
    - The importer writes Q: in the meter's beat (Q:3/8=80 in 6/8).
12. **A file cut short** is read as far as it goes. The report says the bar where it stops, any tracks the header promised that aren't there, and the notes still sounding at the cut.
13. **The status line folds away** (Hide on a phone, View › Status line), remembered. Folded, it is gone, about 40 px back on a phone.

14. **A note never gets two staccatos (or two rolls).**
    - **The path that stacked them:** the decoration menu's `decorate` checked only the characters right before a note. Staccato on `"Am".C`, `.!p!C`, `!staccato!C`, or a mark set apart by a space or a line break, added a second.
    - **Marks read as abcjs reads them:** `prefixMarks` goes across chord symbols, annotations, other decorations, grace groups, a slur's start, spaces and the end of the line before. `.` and `!staccato!` count as one mark, `~` and `!roll!` as another.
    - **The guard:** every change that adds a mark passes `guardMarks`. A mark the note already has is never added, and a whole-file check (`doubledMarks`, one pass) makes sure no note has the same mark twice afterwards.
    - A held mark key acts once, in the text and the score.
    - **Ruled out:** the score's key handler and the editor's input can't both act, since the score calls `preventDefault` and the editor hasn't the focus. IME composition skips the mark handler, so the browser types the character as usual.
    - **Tests:** every split form, both spellings, space and line break, a selection that starts between a mark and its note, a mixed selection typed once and then again (text, score and decoration menu, in check-composer step 27), and the guard itself.
15. **Shift+click in the score takes the note clicked.** A note counted as reached only from its head's left edge, so a click on the middle of a note's box (where Playwright clicks) stopped one note short. A pointer over a note's own drawing (head, stem, chord symbol, words), clipped to its bar so nothing reaching over a bar line counts, is now on that note. check-composer step 27 covers the head, the stem and the middle, both ways.

**First view.** 718 KB, under its 720 KB check. To stay there:
- the reflow repair loads with abcjs;
- the Appearance and Recover drafts dialogs fill when first opened;
- the problems list and those dialogs' styles load with them.

## Selection hardening

### Round 1 fixes (after Codex 7.0, Claude 7.6)

1. **A score selection takes only music.**
   - A voice's range stops at every line that isn't its music (`breaksRun`): fields (P:, K:, T:, M:, L:), w: lyrics, %% directives, comment lines, and a comment at a line's end.
   - So cutting, deleting or typing over a score selection never takes them.
   - Ctrl/⌘ A in the score selects every voice's music, never the headers.
   - A typed mark over a selection that mixes notes with other lines marks the notes and leaves the rest (`musicParts`); it is never typed over the selection.
2. **A drag reads what is drawn, voice by voice** (`drawnRegion`). Each voice takes the notes whose heads lie between where the drag started and where the pointer is, in reading order, so voices drawn out of line take only what was dragged over. A multi-bar rest counts as the bars it stands for.
   - Not done: expanding `Z4` into one-bar rests in the copy abcjs draws. It would mean mapping offsets back through the index, the timeline, the bar lines and the exports; reading the drawing gets the selection right whatever abcjs draws.
3. **Touch.** A finger's drag scrolls, and the tap's selection stands when the browser takes the move. Held still for 400 ms, a finger selects instead: the band shows, the page stops panning, and the drag selects.
4. **Scrolling while dragging.** Near the score's top or bottom edge a drag scrolls every frame, faster the nearer the edge, and the selection follows. A wheel scroll during a drag moves its end, and the release counts.
5. **Shift Alt ←/→** keep an anchor and a moving end, so going back shrinks the selection first.
6. **Hidden voices.** Voices of invisible rests (`x`) are left out of score selections and of "in N voices".
7. **Redo** after a typed mark or a music command restores the selection it left.
8. **Overlays.** An overlay's (`&`) closing bar line is no longer indexed as a note.

**Also:**
- **The sweep** (check-composer step 28) drags between many note pairs in six tunes:
  - two voices on one staff;
  - inline voices;
  - interleaved V: blocks;
  - lyrics with comments and parts;
  - a grand staff with a spacer voice, shaped like the Moonlight sonata's import (a hand-written excerpt, not the owner's file);
  - a multi-bar rest.

  Every selection is checked:
  - the notes lit are the notes selected;
  - a range holds one voice and no header, V:, w:, %% or comment line;
  - nothing is taken past the pointer or skipped before it.

  Step 29 covers each finding as the reviewers found it.
- **A `%%vskip` inside a tune** stopped the score redrawing: abcjs wants a list of line breaks per reflowed section. Each section now gets one.
- **The large-import timing check:**
  - it starts from a clean heap;
  - it times a reference task like the importer's work just before importing;
  - it allows 250 ms or 7 times that reference, the best of up to three runs.
- **First view.** 718.5 KB. The typing helpers, Voices and File › Recent now load when used.

### Round 2 fixes (after Codex 7.5, Claude 7.0)

**The one rule** (`selected.ts`). One function decides which notes a set of text ranges selects. Lighting, the status count, every command (transpose, lengths, marks, ties, slurs, Insert, Duplicate), Play and Loop, and Find melody all use it.
- **What counts as touching a note.** A note is selected when a range touches any part of it:
  - its letters, accidental, octave marks and length;
  - what is attached before it: decorations, annotations, chord symbol, grace notes;
  - what is attached after it: a tie, a broken-rhythm sign.
- **A caret** stands for the note it is in, or the one just before it.
- **Chord tones.** A range strictly inside a chord's brackets selects only the tones it covers. The chord is lit and the status says "1 chord tone selected": abcjs draws a chord's heads as one element, so single heads can't be lit.
- **Typing over attachments.** Selected text inside an attachment (`trill`, `Am`, the `>` of `d>e`) counts as its note. A mark typed over it marks the note rather than replacing the text.
- **Transpose** moves a selected note's chord symbol and grace notes with it.
- **check-composer step 30** selects random stretches of a hard tune and checks that the notes lit, counted and moved an octave are the same.

1. **Paste of a copy of several voices** (`paste.ts`):
   - Each selected place takes its own voice's part, matched by `V:` id, else in order.
   - At a caret or over one range, it takes the part of the voice there, else the music without its `V:` lines, and says so.
   - Anything else is refused, with the reason in the status line. The paste is one undo step.
2. **Double-clicked or partly selected notes** transpose and change length: the one rule.
3. **Phone:**
   - A finger's press no longer selects or plays; a tap does, or a long press.
   - A scroll leaves the selection as it was before the press.
4. **Play the selection and Loop** play exactly the selected notes, plus what sounds with them without text of its own (chord-symbol accompaniment, ornaments).
   - **Decision:** a selection in several places plays its pieces back to back, a sixteenth note apart (`PIECE_GAP`), rather than keeping their times with silence between. The ruler shows a band per piece.
5. **Find this melody** builds its query from the selected notes' sounding pitches and lengths in one voice (the main range's, else the highest), written in the tune's key. It no longer reads the selection's text.
6. **Insert by the notes, not the head:**
   - Triplet puts `(3` before each range's first selected note.
   - Repeat wraps each range's notes, a bar line there becoming `|:` or `:|`.
   - Chord symbol attaches to the first selected note.
   - Bar line, lyrics line, 2nd-time dynamic and second voice use the selection's start or end, not its head.
7. and 8. **A voice selected across `V:` blocks** is one passage (`passagesOf`). Duplicate copies it once after its end, in the voice's last block. A slur opens at its first note and closes at its last.
9. **Lone notes.** Only a rest alone and drawn well inside its bar (a whole-bar rest) reads from the bar's start. A lone note is taken at its head, like the other voices' notes at that time.
