import { shortcutLabel } from "./menus";

/** A dialog in the family's style: a sticky title bar with Close, and a body. */
export function createDialog(id: string, title: string, wide = false) {
  const dialog = document.createElement("dialog");
  dialog.id = id;
  dialog.className = `composer-dialog${wide ? " wide" : ""}`;
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  const header = document.createElement("div");
  header.className = "dialog-header";
  const heading = document.createElement("h2");
  heading.id = `${id}-title`;
  heading.textContent = title;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);
  const body = document.createElement("div");
  body.className = "dialog-body";
  dialog.append(header, body);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return {
    dialog,
    body,
    heading,
    open() {
      if (!dialog.open) dialog.showModal();
      (
        body.querySelector<HTMLElement>("[autofocus], button, input, select, [tabindex='0']") ??
        close
      ).focus();
    },
    close: () => dialog.close(),
  };
}

export const SHORTCUTS: [string, string][] = [
  ["Play or pause", "Mod Enter"],
  ["Play from the caret", "Mod Shift Enter"],
  ["Play the selection once", "Mod Alt Enter"],
  ["Loop the selection or bar", "Mod Shift L"],
  ["Stop", "Mod ."],
  ["Faster / slower", "Mod Alt = / Mod Alt -"],
  ["Metronome", "Mod Alt M"],
  ["Up / down a semitone", "Alt ↑ / Alt ↓"],
  ["Up / down an octave", "Alt Shift ↑ / Alt Shift ↓"],
  ["Halve / double lengths", "Alt [ / Alt ]"],
  ["Add / remove a dot", "Alt . / Alt ,"],
  ["Tie, slur, decoration", "Alt T, Alt S, Alt D"],
  ["Next / previous note", "Alt → / Alt ←"],
  ["Extend the selection by a note", "Alt Shift → / Alt Shift ←"],
  ["Say the note at the caret", "Alt N"],
  ["Duplicate the bar or selection", "Mod Shift D"],
  ["Find / replace", "Mod F"],
  ["Next / previous bar to check", "F8 / Shift F8"],
  ["Complete a field, key or decoration", "Ctrl Space"],
  ["Score beside or below", "Mod \\"],
  ["Focus", "Mod Shift F"],
  ["Open / Save / Save as", "Mod O / Mod S / Mod Shift S"],
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
    title: "Bars and repeats",
    rows: [
      ["|  ||  |]", "bar, double bar, end"],
      ["|:  :|  ::", "repeat start, end, both"],
      ["|1  :|2", "first and second endings"],
    ],
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
      [".A  !>!A  !tenuto!A", "staccato, accent, tenuto"],
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
      ...SHORTCUTS.filter(([action]) => action.startsWith("Next / previous bar")),
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
