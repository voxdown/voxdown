/**
 * The Appearance dialog's choices: each look's paper and ink, as a swatch. Loaded when the dialog
 * first opens.
 */
import "./looks.css";
export const LOOKS = [
  {
    id: "auto",
    label: "Auto",
    tone: "As your device",
    swatch: "linear-gradient(135deg, #ffffff 50%, #1b1d21 50%)",
    ink: "#25282d",
  },
  { id: "paper", label: "Paper", tone: "Light", swatch: "#ffffff", ink: "#25282d" },
  { id: "sepia", label: "Sepia", tone: "Light, warm", swatch: "#f7f0e1", ink: "#33291d" },
  { id: "night", label: "Night", tone: "Dark", swatch: "#1b1d21", ink: "#e4e5e3" },
  { id: "slate", label: "Slate", tone: "Dark, softer", swatch: "#262c35", ink: "#d9dee5" },
  {
    id: "contrast",
    label: "High contrast",
    tone: "Light, every mark darker",
    swatch: "#ffffff",
    ink: "#000000",
  },
];

export function lookChoices(current: string, choose: (id: string) => void): Node {
  const intro = document.createElement("p");
  intro.textContent = "The paper and ink for the text and the score.";
  const group = document.createElement("fieldset");
  group.className = "look-choices";
  const legend = document.createElement("legend");
  legend.className = "sr-only";
  legend.textContent = "Look";
  group.append(legend);
  for (const look of LOOKS) {
    const label = document.createElement("label");
    label.className = "look-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "look";
    input.value = look.id;
    input.checked = current === look.id;
    input.addEventListener("change", () => choose(look.id));
    const swatch = document.createElement("span");
    swatch.className = "look-swatch";
    swatch.style.background = look.swatch;
    swatch.style.color = look.ink;
    swatch.textContent = "♪";
    swatch.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = look.label;
    const tone = document.createElement("small");
    tone.textContent = look.tone;
    name.append(tone);
    label.append(input, swatch, name);
    group.append(label);
  }
  const content = document.createDocumentFragment();
  content.append(intro, group);
  return content;
}
