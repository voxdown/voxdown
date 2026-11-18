import { type StudioTheme, normalizeStudioTheme } from "./appearance";

export type StudioPreferences = {
  theme: StudioTheme;
  textSize: 14 | 16 | 18 | 20;
  typewriter: boolean;
  focus: boolean;
  pageGuides: boolean;
  screenplayKeys: boolean;
  toolbar: boolean;
  margins: boolean;
  speechColors: "character" | "uniform" | "off";
  paper: "letter" | "a4";
  outline: boolean;
  preview: boolean;
};
export const defaultPreferences: StudioPreferences = {
  theme: "auto",
  textSize: 16,
  typewriter: false,
  focus: false,
  pageGuides: false,
  screenplayKeys: false,
  toolbar: true,
  margins: true,
  speechColors: "character",
  paper: "letter",
  outline: true,
  preview: false,
};
export function parsePreferences(value: unknown): StudioPreferences {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    theme: normalizeStudioTheme(data.theme),
    textSize: [14, 16, 18, 20].includes(data.textSize as number)
      ? (data.textSize as StudioPreferences["textSize"])
      : 16,
    typewriter: data.typewriter === true,
    focus: data.focus === true,
    pageGuides: data.pageGuides === true,
    screenplayKeys: data.screenplayKeys === true,
    toolbar: data.toolbar !== false,
    margins: data.margins !== false,
    speechColors:
      data.speechColors === "off" || data.speechColors === "uniform"
        ? data.speechColors
        : "character",
    paper: data.paper === "a4" ? "a4" : "letter",
    outline: data.outline !== false,
    preview: data.preview === true,
  };
}
export function readPreferences(): StudioPreferences {
  try {
    return parsePreferences(JSON.parse(localStorage.getItem("studio-preferences") ?? "null"));
  } catch {
    return { ...defaultPreferences };
  }
}
export function savePreferences(value: StudioPreferences): boolean {
  try {
    localStorage.setItem("studio-preferences", JSON.stringify(parsePreferences(value)));
    return true;
  } catch {
    return false;
  }
}
