/**
 * The cast, on the side: everyone who speaks, in the cast's order, then those the story names who
 * aren't in the cast yet. A short name is renamed everywhere (`renameCharacter`), a full name set
 * in the front matter (`setFullName`), and a name not yet in the cast added to it.
 */
import { type Story, isName, lines } from "voxdown";

export type CastActions = {
  rename: (from: string, to: string) => boolean;
  fullName: (handle: string, name: string) => boolean;
  /** Takes the cursor to the character's next line. */
  find: (handle: string) => void;
  /** Says why something wasn't done. */
  notice: (message: string) => void;
};

/** After the side is drawn again, the focus goes back to the field that was changed. */
function refocus(selector: string): void {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(`#side-sheet ${selector}`)?.focus(),
  );
}

export function castPanel(
  story: Story,
  colors: ReadonlyMap<string, string>,
  actions: CastActions,
): HTMLElement {
  const said = new Map<string, number>();
  const words = new Map<string, number>();
  for (const line of lines(story)) {
    if ((line.kind === "speech" || line.kind === "vocal") && line.speaker) {
      said.set(line.speaker, (said.get(line.speaker) ?? 0) + 1);
      const count = line.text.match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu)?.length ?? 0;
      words.set(line.speaker, (words.get(line.speaker) ?? 0) + count);
    }
  }
  const narrator = story.meta.narrator;
  const inCast = new Map(story.cast.map((member) => [member.handle.toLowerCase(), member]));
  const names = [...colors.keys()];
  // The narrator first, then the cast in its order, then everyone else the story names.
  names.sort((a, b) => rank(a) - rank(b));
  function rank(name: string): number {
    if (name.toLowerCase() === narrator.toLowerCase()) return -1;
    const index = story.cast.findIndex((m) => m.handle.toLowerCase() === name.toLowerCase());
    return index < 0 ? story.cast.length : index;
  }

  const wrap = document.createElement("div");
  wrap.className = "cast-panel";
  const note = document.createElement("p");
  note.className = "sheet-note";
  note.textContent =
    "Rename a character everywhere by their short name, the word after @. Their full name is what the script shows; it goes in the front matter.";
  const list = document.createElement("ul");
  list.className = "cast-list";
  for (const handle of names) {
    const member = inCast.get(handle.toLowerCase());
    const isNarrator = handle.toLowerCase() === narrator.toLowerCase();
    const count = said.get(handle) ?? 0;
    const item = document.createElement("li");
    item.className = "cast-member";
    if (!member && !isNarrator) item.dataset.provisional = "";
    item.innerHTML = `<span class="dot"></span><label class="cast-handle"><span aria-hidden="true">@</span><input type="text" spellcheck="false" autocomplete="off"></label><input class="cast-name" type="text" autocomplete="off"><span class="cast-lines"></span><button type="button" class="cast-find" title="Go to their next line" aria-label="Go to their next line">→</button>`;
    (item.querySelector(".dot") as HTMLElement).style.setProperty(
      "--c",
      colors.get(handle) ?? "var(--quiet)",
    );
    const handleInput = item.querySelector(".cast-handle input") as HTMLInputElement;
    handleInput.value = handle;
    handleInput.setAttribute("aria-label", `Short name of ${handle}`);
    handleInput.size = Math.max(6, handle.length + 1);
    const nameInput = item.querySelector(".cast-name") as HTMLInputElement;
    nameInput.value = member && member.name !== member.handle ? member.name : "";
    nameInput.placeholder = isNarrator ? "Narrator" : member ? "Full name" : "Not in the cast yet";
    nameInput.setAttribute("aria-label", `Full name of ${handle}`);
    const spoken = words.get(handle) ?? 0;
    (item.querySelector(".cast-lines") as HTMLElement).textContent =
      `${count} ${count === 1 ? "line" : "lines"}${spoken ? ` · ${spoken.toLocaleString()} ${spoken === 1 ? "word" : "words"}` : ""}${isNarrator ? " · reads the rest" : ""}`;

    const commit = (input: HTMLInputElement, run: () => void) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        } else if (event.key === "Escape") {
          input.value = input.defaultValue;
          input.blur();
        }
      });
      input.addEventListener("change", run);
    };
    handleInput.defaultValue = handle;
    nameInput.defaultValue = nameInput.value;
    commit(handleInput, () => {
      const next = handleInput.value.trim();
      if (next === handle) return;
      if (!isName(next)) {
        handleInput.value = handle;
        actions.notice(`“${next}” isn’t a name: one word of letters, digits, - and _.`);
        return;
      }
      // The focus stays with the name just changed, in the list drawn again.
      if (actions.rename(handle, next)) refocus(`.cast-handle input[value="${CSS.escape(next)}"]`);
    });
    commit(nameInput, () => {
      const next = nameInput.value.trim();
      if (next === nameInput.defaultValue) return;
      if (actions.fullName(handle, next || handle))
        refocus(`.cast-name[aria-label="Full name of ${CSS.escape(handle)}"]`);
    });
    (item.querySelector(".cast-find") as HTMLElement).addEventListener("click", () =>
      actions.find(handle),
    );
    if (!member && !isNarrator) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "button quiet cast-add";
      add.textContent = "Add to the cast";
      add.addEventListener("click", () => actions.fullName(handle, handle));
      item.append(add);
    }
    list.append(item);
  }
  wrap.append(note, list);
  return wrap;
}
