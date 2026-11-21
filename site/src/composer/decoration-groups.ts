/** The decoration menu (Alt D, the toolbar's !f!), loaded the first time it opens. */
export const DECORATION_GROUPS: [string, [string, string][]][] = [
  [
    "Articulations and ornaments",
    [
      [".", "Staccato"],
      ["accent", "Accent"],
      ["tenuto", "Tenuto"],
      ["fermata", "Fermata"],
      ["trill", "Trill"],
      ["~", "Roll"],
      ["mordent", "Mordent"],
      ["breath", "Breath mark"],
    ],
  ],
  [
    "Dynamics",
    [
      ["ppp", "ppp — very very soft"],
      ["pp", "pp — very soft"],
      ["p", "p — soft"],
      ["mp", "mp — moderately soft"],
      ["mf", "mf — moderately loud"],
      ["f", "f — loud"],
      ["ff", "ff — very loud"],
      ["fff", "fff — very very loud"],
      ["sfz", "sfz — a sudden accent"],
      ["crescendo(", "Crescendo starts"],
      ["crescendo)", "Crescendo ends"],
    ],
  ],
  [
    "Repeats and jumps",
    [
      ["segno", "Segno 𝄋 — where D.S. goes back to"],
      ["coda", "Coda 𝄌 — where the coda starts"],
      ["dacoda", "To Coda — leave for 𝄌 from here"],
      ["fine", "Fine — the end, after D.C. or D.S."],
      ["D.C.", "D.C. — back to the start"],
      ["D.C.alfine", "D.C. al Fine"],
      ["D.C.alcoda", "D.C. al Coda"],
      ["D.S.", "D.S. — back to 𝄋"],
      ["D.S.alfine", "D.S. al Fine"],
      ["D.S.alcoda", "D.S. al Coda"],
    ],
  ],
];
