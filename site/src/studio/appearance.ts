import { LOOKS, type Look, SWATCH_INK } from "../writer/looks";
import { arrangeDialogHeader } from "./dialog-layout";

/** Reuse Writer's catalogue without touching its separate saved appearance. */
export const studioLooks = LOOKS;
export type StudioTheme = Look;

export function normalizeStudioTheme(value: unknown): StudioTheme {
  if (value === "system") return "auto";
  if (value === "light") return "paper";
  if (value === "dark") return "night";
  return LOOKS.some((look) => look.id === value) ? (value as StudioTheme) : "auto";
}

/** Keep the existing light/dark CSS contract; Auto follows media changes natively. */
export function applyStudioTheme(root: HTMLElement, value: unknown): StudioTheme {
  const look = normalizeStudioTheme(value);
  root.dataset.studioLook = look;
  root.dataset.theme =
    look === "auto" ? "system" : look === "night" || look === "slate" ? "dark" : "light";
  return look;
}

export function mountStudioAppearance({
  root,
  select,
  button,
  onChange,
}: {
  root: HTMLElement;
  select: HTMLSelectElement;
  button?: HTMLButtonElement;
  onChange: (theme: StudioTheme) => void;
}) {
  const document = root.ownerDocument;
  const dialog = document.createElement("dialog");
  dialog.id = "studio-appearance";
  dialog.setAttribute("aria-labelledby", "studio-appearance-title");
  const title = document.createElement("h2");
  title.id = "studio-appearance-title";
  title.textContent = "Appearance";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());
  arrangeDialogHeader(dialog, title, close);
  const intro = document.createElement("p");
  intro.textContent = "Choose the paper and ink you like writing with.";
  const grid = document.createElement("fieldset");
  grid.className = "studio-appearance-choices";
  const legend = document.createElement("legend");
  legend.className = "sr-only";
  legend.textContent = "Appearance";
  grid.append(legend);
  const choices = new Map<StudioTheme, HTMLInputElement>();
  const options: HTMLOptionElement[] = [];
  for (const look of LOOKS) {
    const label = document.createElement("label");
    label.className = "studio-appearance-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "studio-appearance";
    input.value = look.id;
    input.setAttribute("aria-label", look.label);
    input.setAttribute("aria-describedby", `studio-look-${look.id}-description`);
    choices.set(look.id, input);
    const swatch = document.createElement("span");
    swatch.className = "studio-appearance-swatch";
    swatch.style.background = look.swatch;
    swatch.style.color = SWATCH_INK[look.id];
    swatch.textContent = "Aa";
    swatch.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "studio-appearance-name";
    name.textContent = look.label;
    const tone = document.createElement("small");
    tone.textContent = look.tone;
    name.append(tone);
    const description = document.createElement("span");
    description.id = `studio-look-${look.id}-description`;
    description.className = "sr-only";
    description.textContent = look.about;
    label.append(input, swatch, name, description);
    grid.append(label);
    const option = document.createElement("option");
    option.value = look.id;
    option.textContent = look.id === "auto" ? "Auto (device setting)" : look.label;
    options.push(option);
  }
  select.replaceChildren(...options);
  const note = document.createElement("p");
  note.className = "studio-appearance-note";
  note.textContent =
    "Changes apply immediately and are saved in this browser. Appearance affects this workspace; exported pages keep their print layout.";
  dialog.append(intro, grid, note);
  document.body.append(dialog);
  let current: StudioTheme = "auto";
  let disposed = false;
  function apply(value: unknown) {
    current = applyStudioTheme(root, value);
    select.value = current;
    for (const [look, input] of choices) input.checked = look === current;
    const label = LOOKS.find((look) => look.id === current)?.label ?? "Auto";
    if (button) {
      button.textContent = `◐ ${label}`;
      button.setAttribute("aria-label", `Appearance: ${label}`);
      button.title = `Appearance: ${label}`;
    }
  }
  function choose(value: unknown) {
    if (disposed) return;
    apply(value);
    onChange(current);
  }
  function open() {
    if (disposed || dialog.open) return;
    dialog.showModal();
    choices.get(current)?.focus();
  }
  const changeSelect = () => choose(select.value);
  const changeChoice = (event: Event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.name === "studio-appearance" && input.checked)
      choose(input.value);
  };
  select.addEventListener("change", changeSelect);
  grid.addEventListener("change", changeChoice);
  button?.addEventListener("click", open);
  button?.setAttribute("aria-haspopup", "dialog");
  button?.setAttribute("aria-controls", dialog.id);
  apply(root.dataset.studioLook ?? root.dataset.theme);
  return {
    apply,
    open,
    dispose() {
      disposed = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      select.removeEventListener("change", changeSelect);
      grid.removeEventListener("change", changeChoice);
      button?.removeEventListener("click", open);
    },
  };
}
