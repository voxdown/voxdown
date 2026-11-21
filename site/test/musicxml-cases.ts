/** Hand-written ABC cases for MusicXML export and the round trip. */
export const MORE: [string, string][] = [
  [
    "two voices on one staff, a grand staff, key, meter and clef changes",
    'X:1\nT:Voices\nM:3/4\nL:1/8\n%%score {(1 2) 3}\nV:1 name="Piano"\nV:2\nV:3 clef=bass\nK:F\nV:1\nA2 B2 c2 | [K:D] [M:2/4] d2 e2 | [K:clef=bass] D,4 |]\nV:2\nF6 | F4 | x4 |]\nV:3\nF,6 | D,4 | D,4 |]\n',
  ],
  [
    "a general tuplet, a multi-bar rest, endings and a final bar",
    "X:1\nT:Tuplets\nM:4/4\nL:1/8\nK:C\n|: (5:4:5CDEFG A2 B2 | Z4 |1 c8 :|2 C8 |]\n",
  ],
  [
    "two verses, extensions, chord symbols with a bass, and annotations",
    'X:1\nT:Verses\nM:3/4\nL:1/4\nK:G\n"G"G A "D/F#"B | "Em7"c2 "^softly"d | "C"e3- | e3 |]\nw: Sing a song_ of joy\nw: Here the sec-ond verse\n',
  ],
  [
    "D.S. al Coda, segno, coda, tremolo, arpeggio, bowing",
    "X:1\nT:Marks\nM:2/4\nL:1/8\nK:C\n!segno!!upbow!C2 !downbow!D2 | !coda!!trem2!E4 | !arpeggio![CEG]4 | !D.S.alcoda!G4 |]\n",
  ],
];
