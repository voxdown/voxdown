/**
 * The problems list's contents: each problem as a button that goes to it, abcjs's own words when
 * they add something, and a one-click fix where there is one. Loaded when the list first opens.
 */
import "./problem-list.css";

type Fix = { label: string; from: number; to: number; insert: string };
type Listed = { kind: string; message: string; detail?: string; fix?: Fix };

export function problemsTitle(shown: Listed[]): string {
  const bars = shown.filter((problem) => problem.kind === "bar").length;
  const lyrics = shown.filter((problem) => problem.kind === "lyrics").length;
  return bars === shown.length
    ? "Bars to check"
    : lyrics === shown.length
      ? "Lyrics to check"
      : bars
        ? "Bars and problems to check"
        : shown.length === 1
          ? "A problem to check"
          : "Problems to check";
}

export function fillProblems<T extends Listed>(
  panel: HTMLElement,
  shown: T[],
  fromGutter: boolean,
  act: { text: (problem: T) => string; go: (problem: T) => void; fix: (fix: Fix) => void },
) {
  panel.classList.add("problems-popover");
  const list = document.createElement("ul");
  list.className = "problem-list";
  for (const problem of shown) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    // From the gutter mark: the whole sentence; in the list, the short label with its line.
    button.textContent = fromGutter ? problem.message : act.text(problem);
    button.addEventListener("click", () => act.go(problem));
    item.append(button);
    // abcjs's own words under ours, only when no reading of ours fits.
    if (problem.detail) {
      const detail = document.createElement("p");
      detail.className = "problem-detail";
      detail.textContent = problem.detail;
      item.append(detail);
    }
    if (problem.fix) {
      const { fix } = problem;
      const repair = document.createElement("button");
      repair.type = "button";
      repair.className = "problem-fix";
      repair.textContent = fix.label;
      repair.addEventListener("click", () => act.fix(fix));
      item.append(repair);
    }
    list.append(item);
  }
  panel.append(list);
  if (!fromGutter) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "F8 goes to the next, Shift F8 to the previous.";
    panel.append(hint);
  }
}
