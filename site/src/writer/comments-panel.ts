/**
 * The workbench's Comments: the writer's comments in the order of the story, each a click from
 * its place, to put back in the text (its words read and printed again) or delete once done.
 */
import type { Story } from "voxdown";

export type CommentsHost = {
  story: Story;
  /** The line a place is on. */
  lineAt(at: number): number;
  /** Where the cursor is: the comment it is in is marked. */
  here: number;
  /** A shortcut as this computer writes it. */
  keys(shortcut: string): string;
  goTo(from: number, to: number): void;
  putBack(from: number): void;
  remove(from: number, to: number): void;
};

export function commentsPanel(host: CommentsHost): HTMLElement {
  const found = host.story.blocks
    .flatMap((block) =>
      block.kind === "paragraph" ? block.lines : block.kind === "heading" ? [block.line] : [],
    )
    .flatMap((line) => line.items)
    .filter((item) => item.kind === "comment");
  const list = document.createElement("div");
  list.className = "comments-list";
  const note = document.createElement("p");
  note.className = "sheet-note";
  note.textContent = found.length
    ? "Yours alone: never read aloud, printed or given to a performer."
    : `No comments yet. Insert › A comment for yourself (${host.keys("Mod+Alt+M")}) leaves one at the cursor, or comments out the words selected.`;
  list.append(note);
  const items = document.createElement("ol");
  for (const item of found) {
    const { from, to } = item.range;
    const row = document.createElement("li");
    row.className = "comment-row";
    if (from <= host.here && host.here <= to) row.setAttribute("aria-current", "true");
    const go = document.createElement("button");
    go.type = "button";
    go.className = "comment-go";
    const words = document.createElement("span");
    words.className = "comment-words";
    words.textContent = item.text || "(empty)";
    const where = document.createElement("span");
    where.className = "comment-where";
    where.textContent = `Line ${host.lineAt(from)}`;
    go.append(words, where);
    go.title = "Go to this comment";
    go.addEventListener("click", () => host.goTo(from, to));
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "button quiet comment-delete";
    restore.textContent = "Put back";
    restore.title = "Its words back in the text, read aloud and printed";
    restore.addEventListener("click", () => host.putBack(from));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button quiet comment-delete";
    remove.textContent = "Delete";
    remove.title = "Done with it: take it out of the story";
    remove.addEventListener("click", () => host.remove(from, to));
    const actions = document.createElement("div");
    actions.className = "comment-actions";
    actions.append(restore, remove);
    row.append(go, actions);
    items.append(row);
  }
  list.append(items);
  return list;
}
