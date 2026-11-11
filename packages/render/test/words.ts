/** What a listener hears and what the script view shows of it, letter by letter. */
import type { Window } from "happy-dom";
import { type Story, parse } from "voxdown";
import { renderScript } from "../src/index";

const letters = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "");

/** The letters and digits of every stretch heard, in order: what the script view must show. */
export function heardWords(story: Story): string {
  return story.blocks
    .flatMap((block) =>
      block.kind === "paragraph"
        ? block.lines
        : block.kind === "heading" && block.visibility !== "hidden"
          ? [block.line]
          : [],
    )
    .flatMap((line) => line.items)
    .map((item) => (item.kind === "speech" ? letters(item.text) : ""))
    .join("");
}

/** The letters and digits of every stretch the script view shows, labels aside. */
export function shownWords(window: Window, source: string): string {
  window.document.body.innerHTML = renderScript(parse(source), { header: false });
  return [...window.document.querySelectorAll(".vxd-speech")]
    .map((element) => {
      const words = element.cloneNode(true) as typeof element;
      for (const label of words.querySelectorAll(".vxd-direction")) label.remove();
      return letters(words.textContent ?? "");
    })
    .join("");
}
