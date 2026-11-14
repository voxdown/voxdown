/**
 * The Writer's looks: the page's colours, each one designed (its marks, notes and the characters'
 * colours read on its paper), never a colour picked freely.
 *
 * Two keys hold the choice: the site's own light or dark (`vxd-theme`, which the playground and the
 * Listen page share), and the Writer's paper on top of it (`vxd-writer-paper`). A line in the page's
 * head applies both before the page draws.
 */

export type Look = "auto" | "paper" | "sepia" | "night" | "slate" | "contrast";

/** Each look, with its paper and ink for its swatch (the same as in writer.css). */
export const LOOKS: ReadonlyArray<{ id: Look; label: string; about: string; swatch: string }> = [
  {
    id: "auto",
    label: "Auto",
    about: "Paper, or Night when the computer is set dark",
    swatch: "linear-gradient(135deg, #ffffff 50%, #1b1d21 50%)",
  },
  { id: "paper", label: "Paper", about: "White, and soft black ink", swatch: "#ffffff" },
  { id: "sepia", label: "Sepia", about: "Warm cream, and brown ink", swatch: "#f7f0e1" },
  { id: "night", label: "Night", about: "Dark grey, and pale ink", swatch: "#1b1d21" },
  { id: "slate", label: "Slate", about: "Blue-grey: softer than Night", swatch: "#262c35" },
  {
    id: "contrast",
    label: "High contrast",
    about: "Black on white, every mark darker",
    swatch: "#ffffff",
  },
];

/** The ink on each swatch. */
export const SWATCH_INK: Record<Look, string> = {
  auto: "#25282d",
  paper: "#25282d",
  sepia: "#33291d",
  night: "#e4e5e3",
  slate: "#d9dee5",
  contrast: "#000000",
};

const BASE = "vxd-theme";
const PAPER = "vxd-writer-paper";

const PARTS: Record<Look, { base?: "light" | "dark"; paper?: "sepia" | "slate" | "contrast" }> = {
  auto: {},
  paper: { base: "light" },
  sepia: { base: "light", paper: "sepia" },
  night: { base: "dark" },
  slate: { base: "dark", paper: "slate" },
  contrast: { base: "light", paper: "contrast" },
};

/** The look chosen on this computer. */
export function savedLook(): Look {
  try {
    const base = localStorage.getItem(BASE);
    const paper = localStorage.getItem(PAPER);
    const found = (Object.keys(PARTS) as Look[]).find(
      (look) =>
        PARTS[look].base === (base ?? undefined) && PARTS[look].paper === (paper ?? undefined),
    );
    if (found) return found;
    return base === "dark" ? "night" : base === "light" ? "paper" : "auto";
  } catch {
    return "auto";
  }
}

/** The look on the page now (kept or not). */
export function applyLook(look: Look): void {
  const root = document.documentElement;
  const { base, paper } = PARTS[look];
  if (base) root.dataset.vxdTheme = base;
  else delete root.dataset.vxdTheme;
  if (paper) root.dataset.writerPaper = paper;
  else delete root.dataset.writerPaper;
}

/** Chooses a look, and keeps it on this computer. */
export function chooseLook(look: Look): void {
  applyLook(look);
  const { base, paper } = PARTS[look];
  try {
    if (base) localStorage.setItem(BASE, base);
    else localStorage.removeItem(BASE);
    if (paper) localStorage.setItem(PAPER, paper);
    else localStorage.removeItem(PAPER);
  } catch {
    // Private windows may refuse: the look holds for this visit.
  }
}

export function lookLabel(look: Look): string {
  return LOOKS.find((each) => each.id === look)?.label ?? "Paper";
}
