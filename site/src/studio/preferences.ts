export type StudioPreferences = {
  theme: "system" | "light" | "dark";
  textSize: 14 | 16 | 18 | 20;
  typewriter: boolean;
  focus: boolean;
  pageGuides: boolean;
  screenplayKeys: boolean;
};
export const defaultPreferences: StudioPreferences = {
  theme: "system",
  textSize: 16,
  typewriter: false,
  focus: false,
  pageGuides: false,
  screenplayKeys: false,
};
export function parsePreferences(value: unknown): StudioPreferences {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    theme: data.theme === "light" || data.theme === "dark" ? data.theme : "system",
    textSize: [14, 16, 18, 20].includes(data.textSize as number)
      ? (data.textSize as StudioPreferences["textSize"])
      : 16,
    typewriter: data.typewriter === true,
    focus: data.focus === true,
    pageGuides: data.pageGuides === true,
    screenplayKeys: data.screenplayKeys === true,
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
