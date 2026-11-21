import "./help.css";
import { isApple, shortcutLabel } from "./menus";

export const SHORTCUTS: [string, string][] = [
  ["Play or pause", "Mod Enter"],
  ["Play from the caret", "Mod Shift Enter"],
  ["Play the selection once", "Mod Alt Enter"],
  ["Loop the selection or bar", "Mod Shift L"],
  ["Stop", "Mod Period"],
  ["Faster / slower", "Mod Alt Equal / Mod Alt Minus"],
  ["Metronome", "Mod Alt M"],
  ["Up / down a semitone", "Alt ↑ / Alt ↓"],
  ["Up / down an octave", "Alt Shift ↑ / Alt Shift ↓"],
  ["Halve / double lengths", "Alt BracketLeft / Alt BracketRight"],
  ["Add / remove a dot", "Alt Period / Alt Comma"],
  ["Tie, slur, decoration", "Alt T, Alt S, Alt D"],
  ["Next / previous note", "Alt → / Alt ←"],
  ["Extend the selection by a note", "Alt Shift → / Alt Shift ←"],
  ["Say the note at the caret", "Alt N"],
  ["Duplicate the bar or selection", "Mod Shift D"],
  ["Find / replace", "Mod F"],
  ["Next / previous bar to check", "F8 / Shift F8"],
  ["Complete a field, key or decoration", "Ctrl Space"],
  ["Score beside or below", "Mod Backslash"],
  ["Zoom the score or the text in / out / to actual size", "Mod Equal / Mod Minus / Mod 0"],
  ["Focus", "Mod Shift F"],
  ["Open / Save / Save as", "Mod O / Mod S / Mod Shift S"],
  ["Indent in the text / leave it (Escape, then Tab)", "Tab / Escape, Tab"],
  ["This cheat sheet", "F1"],
];

const SHEET: { title: string; rows?: [string, string][]; example?: string; note?: string }[] = [
  {
    title: "A tune",
    example: "X:1\nT:My tune\nM:6/8\nL:1/8\nQ:3/8=110\nK:D\n|: A | dfa afd | ...",
    note: "X: starts a tune, K: ends its header. Several tunes can share one file.",
  },
  {
    title: "Notes and octaves",
    rows: [
      [
        "Typing helpers",
        "Edit › Typing helpers: a bar line on Space when a bar is full; each letter in the octave nearest the last note (type ' or , to move it)",
      ],
      ["C, D, … B,", "the octave below middle C"],
      ["C D E F G A B", "from middle C up"],
      ["c d e … b", "an octave higher"],
      ["c' d'   C,,", "more octaves: ' up, , down"],
    ],
  },
  {
    title: "Sharps, flats, naturals",
    rows: [
      ["^F  ^^F", "sharp, double sharp"],
      ["_B  __B", "flat, double flat"],
      ["=F", "natural"],
    ],
    note: "The key gives its sharps or flats; a mark lasts to the end of the bar.",
  },
  {
    title: "Lengths (L: is the unit)",
    rows: [
      ["A2  A4", "twice, four times the unit"],
      ["A/  A//  A/4", "half, a quarter"],
      ["A3/2  A3", "dotted"],
      ["A>B  A<B", "dotted then short, and back"],
      ["z  z2  x  Z4", "rest, longer rest, invisible, 4 bars"],
    ],
  },
  {
    title: "Repeats and jumps",
    rows: [
      ["|  ||  |]", "bar, double bar, end"],
      ["|:  :|  ::", "repeat start, end, both"],
      ["|1  :|2", "first and second endings"],
      ["!segno!  !coda!  !fine!", "𝄋, 𝄌, and where the piece ends after a jump"],
      ["!D.C.!  !D.S.!", "back to the start, back to 𝄋"],
      ["!D.C.alfine!  !D.S.alfine!", "back, then play to Fine"],
      ["!D.S.alcoda!  !dacoda!", "back to 𝄋, play to To Coda, then jump to 𝄌"],
    ],
    note: "Playback follows repeats, endings and jumps: on the way back, repeats are played once and the last ending taken. The clock says “D.S.” or “Coda” as it goes. Play › Follow D.C./D.S. jumps turns jumps off, to practise a section as written. The jumps are in the decoration menu (Alt D).",
  },
  {
    title: "Together and joined",
    rows: [
      ["[CEG]2", "a chord"],
      ['"Am7"A', "chord symbol, played as accompaniment"],
      ['"^rit."A', "text above (_ below)"],
      ["A-A", "tie"],
      ["(ABc)", "slur: played smoothly"],
      ["(3ABc", "triplet: three in the time of two"],
      ["{g}A  {/g}A", "grace note, acciaccatura"],
    ],
  },
  {
    title: "Decorations",
    rows: [
      ["!p!  !mf!  !ff!", "dynamics: playback follows them"],
      ["!<(! … !<)!", "crescendo (diminuendo: !>(! !>)!)"],
      ['"^2nd time p"A', "a dynamic for the 2nd time through; playback follows it"],
      [".A  !>!A  !tenuto!A", "staccato, accent, tenuto"],
      [". ~ (", "select notes and type . ~ ( to mark them all; again to remove"],
      ["> <", "select notes and type > or < : each pair dotted-short or short-dotted"],
      ["~A  !trill!A  !fermata!A", "roll, trill, pause"],
    ],
    note: "Type ! for the full list.",
  },
  {
    title: "Voices and lyrics",
    example:
      'V:1 name="Tune"\nV:2 clef=bass\n%%score 1 2\nV:1\nG A B c |\nV:2\nG,4 |\nw: syl-la-bles un-der notes',
    note: "In w: lines, - splits a word, _ holds a note, * skips one, | jumps to the next bar.",
  },
  {
    title: "Selecting music in the score",
    rows: [
      [`${isApple ? "⌘" : "Ctrl"} click`, "add a note to the selection, or take it out"],
      [`${isApple ? "⌘" : "Ctrl"} drag`, "add another region: one selection in several places"],
      ["Phone: More › Select more", "then taps add notes or take them out, and drags add passages"],
      [
        `${isApple ? "⌘" : "Ctrl"} arrows, ${isApple ? "⌘" : "Ctrl+"}Space`,
        "move a cursor in the score, and put its note in or out",
      ],
      ["Click a note", "selects its text"],
      ["Drag", "a time region: one staff selects its voice"],
      ["Drag across staves", "the same span in every voice"],
      ["Alt drag", "every voice from the start"],
      ["Shift click", "extends the region"],
      ["Alt Shift → / ←", "extend by a note (in the text too)"],
      ["Score: ← →", "previous / next note, read aloud with bar and voice"],
      ["Score: ↑ ↓", "the voice above / below, at the same time"],
      ["Score: Home End", "first / last note of the line"],
      ["Score: Shift ← →", "select by note; Space plays, Enter goes to the text"],
    ],
    note: "A region selects its text in each voice. Play, loop, transpose, change lengths, copy or delete it.",
  },
  {
    title: "Tune book",
    rows: [
      ["Renumber X:", "1 to n in file order; nothing else changes"],
      ["Sort tunes…", "by title, X: or key; text between tunes moves with the tune after it"],
      [
        "Line up bars",
        "spaces before bar lines, so lines read like a table; the music is unchanged",
      ],
      ["Incipits…", "a new draft: each tune's header and first bars, for an index"],
      ["Duplicate, New tune after", "a copy with the next X:, or a new tune right after"],
    ],
    note: "In the Tunes menu, and on each tune in the tunes panel (right-click or Shift F10). Each command is one undo step.",
  },
  {
    title: "Exports",
    rows: [
      ["SVG of this tune", "the drawing, plain black on white or in the current look"],
      [
        "HTML tune book",
        "one page with contents, every tune drawn and its ABC; prints a tune a page",
      ],
      ["MIDI, Audio (WAV)", "this tune, or every tune in one .zip; repeats and jumps as played"],
      ["MusicXML", "for MuseScore, Dorico, Finale and Sibelius"],
    ],
    note: "File › Export. Names come from the tunes' titles.",
  },
  {
    title: "Coming from MuseScore or Dorico?",
    note: "Export MusicXML there (File › Export › MusicXML, .musicxml or .mxl) and open it here: it becomes ABC text in a new draft. Notes, rests, chords, ties, slurs, tuplets, grace notes, beams, keys, meters, clefs, voices and staves, repeats and endings, dynamics, hairpins, articulations, ornaments, chord symbols, words, lyrics, title, composer and tempo carry over. Transposing instruments come in at concert pitch; tenor, guitar, piccolo and double bass keep their written octave. Page layout, fingerings, pedal marks, guitar notation and other specialist marks do not, and the import report lists each. File › Export MusicXML… sends a tune back.",
  },
];

export function cheatsheet(): HTMLElement {
  const root = document.createElement("div");
  root.className = "cheatsheet";
  for (const section of SHEET) {
    const element = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = section.title;
    element.append(heading);
    if (section.rows) {
      const table = document.createElement("table");
      for (const [code, meaning] of section.rows) {
        const row = table.insertRow();
        row.insertCell().textContent = code;
        row.insertCell().textContent = meaning;
      }
      element.append(table);
    }
    if (section.example) {
      const pre = document.createElement("pre");
      pre.textContent = section.example;
      element.append(pre);
    }
    if (section.note) {
      const note = document.createElement("p");
      note.className = "hint";
      note.style.color = "var(--muted)";
      note.style.fontSize = "12px";
      note.style.margin = "6px 0 0";
      note.textContent = section.note;
      element.append(note);
    }
    root.append(element);
  }
  const keys = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = "Keys";
  keys.append(
    heading,
    shortcutTable([
      ...SHORTCUTS.slice(0, 12),
      ...SHORTCUTS.filter(
        ([action]) => action.startsWith("Next / previous bar") || action.startsWith("Indent"),
      ),
    ]),
  );
  root.append(keys);
  const more = document.createElement("p");
  more.style.fontSize = "12px";
  more.textContent =
    "All shortcuts: Help › Keyboard shortcuts. The full ABC 2.1 standard is at abcnotation.com/wiki/abc:standard:v2.1.";
  root.append(more);
  return root;
}

export function shortcutTable(rows = SHORTCUTS): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "shortcut-table";
  for (const [action, keys] of rows) {
    const row = table.insertRow();
    row.insertCell().textContent = action;
    const cell = row.insertCell();
    keys.split(" / ").forEach((combo, index) => {
      if (index) cell.append(" / ");
      combo.split(", ").forEach((part, at) => {
        if (at) cell.append(", ");
        const kbd = document.createElement("kbd");
        kbd.textContent = shortcutLabel(part);
        cell.append(kbd);
      });
    });
  }
  return table;
}

/** About VoxDown Composer. */
export function aboutContent(): Node {
  const panel = document.createElement("div");
  for (const line of [
    "Composer is a browser-only editor for ABC music notation. Your music stays on this device: there is no account, no server and no tracking, and nothing is sent anywhere.",
    "Scores are drawn by abcjs (MIT licence). The piano is the Salamander Grand Piano by Alexander Holm; fiddle, flute, strings and guitar come from the FluidR3 General MIDI SoundFont by Frank Wen. Both are Creative Commons Attribution 3.0 and served from this site.",
    "Composer is experimental. Keep your own copies of your files.",
  ]) {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    panel.append(paragraph);
  }
  return panel;
}
