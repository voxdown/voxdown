// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { redo, undo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import { VoxdownEditorElement, charactersOf, defineVoxdownEditor } from "../src/element";

defineVoxdownEditor();

/** Puts an element in the page as a page would, and waits for it to read its story. */
async function mount(html: string): Promise<VoxdownEditorElement> {
  document.body.innerHTML = html;
  await Promise.resolve();
  return document.body.firstElementChild as VoxdownEditorElement;
}

describe("<voxdown-editor>", () => {
  it("takes its story from its text, without the page's indentation", async () => {
    const editor = await mount(`<voxdown-editor>
      @Gerald “Could you not?”
        He yawned.
    </voxdown-editor>`);
    expect(editor).toBeInstanceOf(VoxdownEditorElement);
    expect(editor.value).toBe("@Gerald “Could you not?”\n  He yawned.");
    expect(editor.view?.state.doc.toString()).toBe(editor.value);
    expect(editor.shadowRoot?.querySelector(".cm-editor")).toBeTruthy();
  });

  it("takes its story from a value attribute or a script, which keeps < and & as written", async () => {
    expect((await mount(`<voxdown-editor value="Once."></voxdown-editor>`)).value).toBe("Once.");
    const editor = await mount(
      `<voxdown-editor><script type="text/voxdown">\n@Wanda “1 < 2 & 3 > 2.”\n</script></voxdown-editor>`,
    );
    expect(editor.value).toBe("@Wanda “1 < 2 & 3 > 2.”");
  });

  it("sets its value and fires input", async () => {
    const editor = await mount("<voxdown-editor>One.</voxdown-editor>");
    let inputs = 0;
    editor.addEventListener("input", () => inputs++);
    editor.value = "@Wanda “Two.”";
    expect(editor.value).toBe("@Wanda “Two.”");
    expect(inputs).toBe(1);
    editor.value = "@Wanda “Two.”";
    expect(inputs).toBe(1);
  });

  it("keeps a story's CRLF line endings and byte order mark as written", async () => {
    const corpus = resolve(dirname(fileURLToPath(import.meta.url)), "../../../corpus");
    const book = readFileSync(join(corpus, "the-keeper-and-the-gull.vxd"), "utf8");
    expect(book).toContain("\r\n");
    const editor = await mount("<voxdown-editor></voxdown-editor>");
    editor.value = book;
    expect(editor.value).toBe(book);
    const small = "\uFEFF---\r\ntitle: T\r\n---\r\n@Ann “Hi.”\r\n";
    editor.value = small;
    expect(editor.value).toBe(small);
    editor.value = "One.\nTwo.\n";
    expect(editor.value).toBe("One.\nTwo.\n");
  });

  it("keeps a value set before it is in the page", () => {
    const editor = document.createElement("voxdown-editor");
    editor.value = "Early.";
    document.body.replaceChildren(editor);
    expect(editor.view?.state.doc.toString()).toBe("Early.");
  });

  it("undoes and redoes, as any text box does", async () => {
    const element = document.createElement("voxdown-editor") as VoxdownEditorElement;
    element.value = "@Gerald “Hi.”";
    document.body.append(element);
    const view = element.view;
    if (!view) throw new Error("no view");
    view.dispatch({ changes: { from: view.state.doc.length, insert: " [snores]" } });
    expect(element.value).toBe("@Gerald “Hi.” [snores]");
    expect(undo(view)).toBe(true);
    expect(element.value).toBe("@Gerald “Hi.”");
    expect(redo(view)).toBe(true);
    expect(element.value).toBe("@Gerald “Hi.” [snores]");
    // A new value is a new story: undo doesn't go back into the old one.
    element.value = "@Wanda “Hello.”";
    expect(undo(view)).toBe(false);
    expect(element.value).toBe("@Wanda “Hello.”");
    element.remove();
  });

  it("follows readonly", async () => {
    const editor = await mount("<voxdown-editor readonly>Fixed.</voxdown-editor>");
    expect(editor.view?.state.readOnly).toBe(true);
    editor.removeAttribute("readonly");
    expect(editor.view?.state.readOnly).toBe(false);
  });
});

describe("charactersOf", () => {
  it("lists the cast, then names the story marks, with colors", () => {
    const characters = charactersOf("---\ncast:\n  Wanda: Wanda the Witch\n---\n@Gerald “Hi.”");
    expect(characters).toEqual([
      { handle: "Wanda", name: "Wanda the Witch", color: "#2563eb" },
      { handle: "Gerald", name: "Gerald", color: "#c2410c", provisional: true },
    ]);
  });
});
