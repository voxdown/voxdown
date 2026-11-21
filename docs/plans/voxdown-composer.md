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
