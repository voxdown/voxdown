/**
 * The light and dark switch in the masthead: as the system is, light, or dark. The choice is kept
 * on this computer only. A one-line script in each page's head applies it before the page draws.
 */
const KEY = "vxd-theme";
const THEMES = ["auto", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const LABELS: Record<Theme, string> = { auto: "Auto", light: "Light", dark: "Dark" };

function saved(): Theme {
  try {
    const theme = localStorage.getItem(KEY);
    return theme === "light" || theme === "dark" ? theme : "auto";
  } catch {
    return "auto";
  }
}

export function themeSwitch(): void {
  const button = document.querySelector<HTMLButtonElement>("#theme");
  if (!button) return;
  let theme = saved();
  const show = () => {
    if (theme === "auto") delete document.documentElement.dataset.vxdTheme;
    else document.documentElement.dataset.vxdTheme = theme;
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] as Theme;
    button.textContent = LABELS[theme];
    button.title = `Theme: ${LABELS[theme].toLowerCase()}. Click for ${LABELS[next].toLowerCase()}.`;
  };
  button.addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] as Theme;
    try {
      if (theme === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // Private windows may refuse; the switch still works for this visit.
    }
    show();
  });
  show();
  button.hidden = false;
}

themeSwitch();
