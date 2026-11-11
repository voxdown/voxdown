/**
 * The cast, on the side: everyone who speaks, in the cast's order, then those the story names who
 * aren't in the cast yet. A short name is renamed everywhere (`renameCharacter`), a full name set
 * in the front matter (`setFullName`), and a name not yet in the cast added to it.
 */
import { type Story, isName, lines } from "voxdown";

export type CastActions = {
  rename: (from: string, to: string) => boolean;
  fullName: (handle: string, name: string) => boolean;
  /** What the cast says about them: who they are, how they sound. */
  about: (handle: string, text: string) => boolean;
  /** Takes the cursor to the character's next line. */
  find: (handle: string) => void;
  /** Says why something wasn't done. */
  notice: (message: string) => void;
};

/**
 * After the side is drawn again, the focus goes where it was going: the field just changed, or
 * the one Tab went on to (a field of the character just renamed, under their new name).
 */
function refocus(key: string): void {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(`#side-sheet [data-focus="${CSS.escape(key)}"]`)?.focus(),
  );
}

export function castPanel(
  story: Story,
  colors: ReadonlyMap<string, string>,
  actions: CastActions,
  /** Another tab writes the story: the cast is shown, not changed. */
  readOnly = false,
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
  // The narrator first, whom the colours leave out: they read the rest, and the cast may say how.
  if (!names.some((name) => name.toLowerCase() === narrator.toLowerCase())) names.unshift(narrator);
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
    "Rename a character everywhere by their short name, the word after @. Their full name is what the script shows, and what you write about them is for whoever performs them; both go in the front matter.";
  const list = document.createElement("ul");
  list.className = "cast-list";

  /**
   * A field's change is made as the focus leaves it (Enter, Tab, a click elsewhere); Escape puts
   * it back as it was. The focus then goes where it was going.
   */
  const commit = (
    field: HTMLInputElement | HTMLTextAreaElement,
    run: (value: string) => { done: boolean; renamed?: string; from?: string } | undefined,
    /** Made as typing pauses too, so nothing typed waits on the field being left. */
    asTyped = false,
  ) => {
    field.readOnly = readOnly;
    if (asTyped) {
      let pause: ReturnType<typeof setTimeout> | undefined;
      field.addEventListener("input", () => {
        clearTimeout(pause);
        pause = setTimeout(() => {
          if (field.value === field.defaultValue || document.activeElement !== field) return;
          if (run(field.value)?.done) field.defaultValue = field.value;
        }, 1200);
      });
      field.addEventListener("focusout", () => clearTimeout(pause));
    }
    field.addEventListener("keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.key === "Enter" && !key.shiftKey) {
        key.preventDefault();
        field.blur();
      } else if (key.key === "Escape") {
        field.value = field.defaultValue;
        field.blur();
      }
    });
    field.addEventListener("focusout", (event) => {
      if (field.value === field.defaultValue) return;
      const to = (event as FocusEvent).relatedTarget as HTMLElement | null;
      // Gone elsewhere on the page: the focus stays there.
      const going = to === null ? field.dataset.focus : wrap.contains(to) ? to.dataset.focus : null;
      const result = run(field.value);
      if (!result?.done || !going) return;
      const [handle, part] = going.split(":");
      refocus(result.renamed && handle === result.from ? `${result.renamed}:${part}` : going);
    });
  };

  for (const handle of names) {
    const member = inCast.get(handle.toLowerCase());
    const isNarrator = handle.toLowerCase() === narrator.toLowerCase();
    const count = said.get(handle) ?? 0;
    const item = document.createElement("li");
    item.className = "cast-member";
    if (!member && !isNarrator) item.dataset.provisional = "";
    item.innerHTML = `<span class="dot"></span><label class="cast-handle"><span aria-hidden="true">@</span><input type="text" spellcheck="false" autocomplete="off"></label><input class="cast-name" type="text" autocomplete="off"><span class="cast-lines"></span><button type="button" class="cast-find" title="Go to their next line" aria-label="Go to their next line">→</button><textarea class="cast-about" rows="1"></textarea>`;
    (item.querySelector(".dot") as HTMLElement).style.setProperty(
      "--c",
      colors.get(handle) ?? "var(--quiet)",
    );
    const handleInput = item.querySelector(".cast-handle input") as HTMLInputElement;
    handleInput.value = handle;
    handleInput.defaultValue = handle;
    handleInput.dataset.focus = `${handle}:handle`;
    handleInput.setAttribute("aria-label", `Short name of ${handle}`);
    handleInput.size = Math.max(6, handle.length + 1);
    const nameInput = item.querySelector(".cast-name") as HTMLInputElement;
    nameInput.value = member && member.name !== member.handle ? member.name : "";
    nameInput.defaultValue = nameInput.value;
    nameInput.dataset.focus = `${handle}:name`;
    nameInput.placeholder = isNarrator ? "Narrator" : member ? "Full name" : "Not in the cast yet";
    nameInput.setAttribute("aria-label", `Full name of ${handle}`);
    const aboutInput = item.querySelector(".cast-about") as HTMLTextAreaElement;
    aboutInput.value = member?.about ?? "";
    aboutInput.defaultValue = aboutInput.value;
    aboutInput.dataset.focus = `${handle}:about`;
    aboutInput.placeholder = "Who they are, how they sound";
    aboutInput.spellcheck = true;
    aboutInput.setAttribute("aria-label", `About ${handle}`);
    const spoken = words.get(handle) ?? 0;
    (item.querySelector(".cast-lines") as HTMLElement).textContent =
      `${count} ${count === 1 ? "line" : "lines"}${spoken ? ` · ${spoken.toLocaleString()} ${spoken === 1 ? "word" : "words"}` : ""}${isNarrator ? " · reads the rest" : ""}`;

    commit(handleInput, (value) => {
      const next = value.trim();
      if (next === handle) return undefined;
      if (!isName(next)) {
        handleInput.value = handle;
        actions.notice(`“${next}” isn’t a name: one word of letters, digits, - and _.`);
        return undefined;
      }
      return { done: actions.rename(handle, next), renamed: next, from: handle };
    });
    commit(
      nameInput,
      (value) => {
        const next = value.trim();
        if (next === nameInput.defaultValue.trim()) return undefined;
        return { done: actions.fullName(handle, next || handle) };
      },
      true,
    );
    commit(
      aboutInput,
      (value) => {
        if (value.trim() === aboutInput.defaultValue.trim()) return undefined;
        return { done: actions.about(handle, value.trim()) };
      },
      true,
    );
    const find = item.querySelector(".cast-find") as HTMLElement;
    if (readOnly) item.dataset.readonly = "";
    find.dataset.focus = `${handle}:find`;
    find.addEventListener("click", () => actions.find(handle));
    if (!member && !isNarrator) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "button quiet cast-add";
      add.textContent = "Add to the cast";
      add.disabled = readOnly;
      add.dataset.focus = `${handle}:add`;
      add.addEventListener("click", () => {
        if (actions.fullName(handle, handle)) refocus(`${handle}:name`);
      });
      item.append(add);
    }
    list.append(item);
  }
  wrap.append(note, list);
  return wrap;
}
