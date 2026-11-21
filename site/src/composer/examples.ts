/**
 * Examples: VoxDown's own transcriptions of public-domain melodies (traditional tunes, Beethoven,
 * and Jane Taylor's 1806 words), written for this app. Not copied from any collection.
 */
export type Example = {
  id: string;
  title: string;
  about: string;
  /** For menus: what the example is, in a few words. */
  blurb: string;
  file: string;
  text: string;
};

export const EXAMPLES: Example[] = [
  {
    id: "ode",
    title: "Ode to Joy",
    blurb: "Beethoven's melody, with dynamics and chords",
    about: "Beethoven · dynamics and chords",
    file: "Ode to Joy.abc",
    text: `X:1
T:Ode to Joy
C:Ludwig van Beethoven, 1824
M:4/4
L:1/4
Q:1/4=108
K:D
%%MIDI program 0
!mf!"D"F F G A | "A"A G F E | "D"D D E F | "A"F3/2 E/ E2 |
"D"F F G A | "A"A G F E | "D"D D E F | "A"E3/2 D/ "D"D2 |
!p!"A"E E F D | E F/G/ F D | "A"E F/G/ F E | "D"D E "A"!<(!A,2!<)! |
!f!"D"F F G A | "A"A G F E | "D"D D E F | "A"E3/2 D/ "D"!fermata!D2 |]
`,
  },
  {
    id: "greensleeves",
    title: "Greensleeves",
    blurb: "a traditional tune in 6/8, with repeats and parts",
    about: "Traditional · 6/8, repeats",
    file: "Greensleeves.abc",
    text: `X:1
T:Greensleeves
C:Traditional, 16th century
M:6/8
L:1/8
Q:3/8=60
K:Am
P:A
|: A | "Am"c2 d e>fe | "G"d2 B G>AB | "Am"c2 A A>^GA | "E"B2 ^G E2 A |
"Am"c2 d e>fe | "G"d2 B G>AB | "Am"c>BA "E"^G>^F^G | "Am"A3 A2 :|
P:B
"C"g3 g>^fe | "G"d2 B G>AB | "Am"c2 A A>^GA | "E"B2 ^G E3 |
"C"g3 g>^fe | "G"d2 B G>AB | "Am"c>BA "E"^G>^F^G | "Am"A3 !fermata!A3 |]
`,
  },
  {
    id: "twinkle",
    title: "Twinkle, Twinkle, Little Star",
    blurb: "a song with lyrics under the notes",
    about: "Words by Jane Taylor · lyrics",
    file: "Twinkle Twinkle.abc",
    text: `X:1
T:Twinkle, Twinkle, Little Star
C:Traditional melody; words by Jane Taylor, 1806
M:2/4
L:1/4
Q:1/4=96
K:C
"C"C C | G G | "F"A A | "C"G2 | "F"F F | "C"E E | "G"D D | "C"C2 |
w: Twin-kle, twin-kle, lit-tle star, how I won-der what you are!
"C"G G | "F"F F | "C"E E | "G"D2 | "C"G G | "F"F F | "C"E E | "G"D2 |
w: Up a-bove the world so high, like a dia-mond in the sky.
"C"C C | G G | "F"A A | "C"G2 | "F"F F | "C"E E | "G"D D | "C"C2 |]
w: Twin-kle, twin-kle, lit-tle star, how I won-der what you are!
`,
  },
  {
    id: "frere",
    title: "Frère Jacques",
    blurb: "a round in two voices",
    about: "Traditional round · two voices",
    file: "Frere Jacques.abc",
    text: `X:1
T:Frère Jacques
T:a round for two voices
C:Traditional
M:4/4
L:1/4
Q:1/4=104
K:G
V:1 name="First" clef=treble
V:2 name="Second" clef=bass
%%score 1 2
V:1
!mp!G A B G | G A B G | B c d2 | B c d2 |
V:2
z4 | z4 | !mp!G, A, B, G, | G, A, B, G, |
V:1
d/e/d/c/ B G | d/e/d/c/ B G | G D G2 | G D G2 |
V:2
B, C D2 | B, C D2 | D/E/D/C/ B, G, | D/E/D/C/ B, G, |
V:1
B c d2 | !fermata!B4 |]
V:2
G, D, G,2 | !fermata!G,4 |]
`,
  },
];

export const NEW_TUNE = `X:1
T:Untitled tune
M:4/4
L:1/8
Q:1/4=100
K:C
`;
