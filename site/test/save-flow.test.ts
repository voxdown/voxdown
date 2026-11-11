// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { SaveFlow, type SaveHost, type SavedFile, anotherName } from "../src/writer/save-flow";

/** A file on a stand-in disk: its text and when it last changed. */
type Stored = { text: string; modified: number };

/** A page for the save flow to work in: a disk, a story, the questions answered as told. */
function page(options: {
  disk?: Record<string, Stored>;
  text?: string;
  file?: Partial<SavedFile>;
  answers?: string[];
  allowed?: boolean;
  mayWriteNow?: boolean;
  failWrite?: boolean;
  slowWrite?: Promise<void>;
  /** The browser's question about writing the file, answered when this settles. */
  slowAllowed?: Promise<void>;
  keepsFiles?: boolean;
  pick?: string;
}) {
  const disk: Record<string, Stored> = options.disk ?? {};
  const handles = new Map<string, FileSystemFileHandle>();
  const handle = (name: string) => {
    let made = handles.get(name);
    if (!made) {
      made = { kind: "file", name } as unknown as FileSystemFileHandle;
      handles.set(name, made);
    }
    return made;
  };
  const said: string[] = [];
  const asked: string[] = [];
  const versions: Array<[string, string]> = [];
  const marked: string[] = [];
  const answers = [...(options.answers ?? [])];
  let text = options.text ?? "Mine.";
  const state = { shown: "", words: "", replaced: undefined as string | undefined };
  const file: SavedFile = {
    id: "story",
    name: "tale.vxd",
    handle: handle("tale.vxd"),
    saved: "Saved.",
    savedAt: undefined,
    modified: 1,
    ...options.file,
  };
  const host: SaveHost = {
    file,
    text: () => text,
    owner: () => true,
    mayWrite: async () => true,
    commitPending: () => {},
    autosaveOn: () => true,
    keepsFiles: options.keepsFiles ?? true,
    suggestedName: () => file.name,
    files: {
      allowed: async () => {
        await options.slowAllowed;
        return options.allowed ?? true;
      },
      mayWriteNow: async () => options.mayWriteNow ?? true,
      onDisk: async (at) => disk[at.name],
      writeFile: async (at, content) => {
        await options.slowWrite;
        if (options.failWrite) throw new Error("the disk is full");
        const modified = (disk[at.name]?.modified ?? 0) + 1;
        disk[at.name] = { text: content, modified };
        return modified;
      },
      pickSaveTarget: async (name) => handle(options.pick ?? name),
      download: (content, name) => {
        said.push(`downloaded ${name}: ${content}`);
      },
      sameEntry: async (a, b) => a === b,
    },
    ask: async (message) => {
      asked.push(message);
      return answers.shift() ?? "cancel";
    },
    tell: async (message) => {
      said.push(message);
    },
    notice: (message) => {
      said.push(message);
    },
    announce: () => {},
    showSaveState: () => {},
    showState: (shown, words) => {
      state.shown = shown;
      state.words = words;
    },
    named: () => {},
    remember: async () => {},
    replaceText: (next) => {
      state.replaced = next;
      text = next;
    },
    keep: async () => {},
    snapshot: async (why, content) => {
      versions.push([why, content]);
    },
    versionDue: () => false,
    markSaved: async (id) => {
      marked.push(id);
    },
  };
  const flow = new SaveFlow(host);
  return {
    flow,
    file,
    disk,
    said,
    asked,
    versions,
    marked,
    state,
    type: (more: string) => {
      text += more;
    },
    /** Another story in the editor, as opening one puts it there. */
    open: (id: string, words: string) => {
      file.id = id;
      file.name = "Untitled.vxd";
      file.handle = undefined;
      file.saved = "";
      text = words;
    },
  };
}

describe("saving to the story's file", () => {
  it("writes when the file is as it was read, and keeps a version", async () => {
    const run = page({ disk: { "tale.vxd": { text: "Saved.", modified: 1 } } });
    expect(await run.flow.save()).toBe(true);
    expect(run.disk["tale.vxd"]?.text).toBe("Mine.");
    expect(run.file.saved).toBe("Mine.");
    expect(run.versions).toEqual([["Saved", "Mine."]]);
    expect(run.asked).toEqual([]);
  });

  it("asks before writing over changes made elsewhere, and Cancel writes nothing", async () => {
    const run = page({ disk: { "tale.vxd": { text: "Theirs.", modified: 1 } } });
    expect(await run.flow.save()).toBe(false);
    expect(run.asked[0]).toContain("changed outside the Writer");
    expect(run.disk["tale.vxd"]?.text).toBe("Theirs.");
  });

  it("saves over them when told, theirs kept as a version first", async () => {
    const run = page({
      disk: { "tale.vxd": { text: "Theirs.", modified: 7 } },
      answers: ["mine"],
    });
    expect(await run.flow.save()).toBe(true);
    expect(run.disk["tale.vxd"]?.text).toBe("Mine.");
    expect(run.versions[0]).toEqual(["As it was on disk, before it was saved over", "Theirs."]);
  });

  it("reads theirs in when told, what was here kept as a version", async () => {
    const run = page({
      disk: { "tale.vxd": { text: "Theirs.", modified: 7 } },
      answers: ["theirs"],
    });
    expect(await run.flow.save()).toBe(false);
    expect(run.state.replaced).toBe("Theirs.");
    expect(run.file).toMatchObject({ saved: "Theirs.", modified: 7 });
    expect(run.versions[0]).toEqual(["Before the file was read again", "Mine."]);
    expect(run.disk["tale.vxd"]?.text).toBe("Theirs.");
  });

  it("keeps both: a new file of its own, and never the file itself", async () => {
    const both = page({
      disk: { "tale.vxd": { text: "Theirs.", modified: 7 } },
      answers: ["both"],
    });
    expect(await both.flow.save()).toBe(true);
    expect(both.disk["tale (2).vxd"]?.text).toBe("Mine.");
    expect(both.disk["tale.vxd"]?.text).toBe("Theirs.");
    expect(both.file.name).toBe("tale (2).vxd");
    const itself = page({
      disk: { "tale.vxd": { text: "Theirs.", modified: 7 } },
      answers: ["both"],
      pick: "tale.vxd",
    });
    expect(await itself.flow.save()).toBe(false);
    expect(itself.said.at(-1)).toContain("itself");
    expect(itself.disk["tale.vxd"]?.text).toBe("Theirs.");
    expect(anotherName("tale (2).vxd")).toBe("tale (3).vxd");
  });

  it("never writes blind: a file it can't read is asked about", async () => {
    const run = page({ disk: {} });
    expect(await run.flow.save()).toBe(false);
    expect(run.asked[0]).toContain("couldn’t be read");
    expect(run.disk["tale.vxd"]).toBeUndefined();
  });

  it("says so when the browser doesn't allow writing, or the write fails", async () => {
    const refused = page({ disk: { "tale.vxd": { text: "Saved.", modified: 1 } }, allowed: false });
    expect(await refused.flow.save()).toBe(false);
    expect(refused.said[0]).toContain("didn’t allow");
    const failed = page({ disk: { "tale.vxd": { text: "Saved.", modified: 1 } }, failWrite: true });
    expect(await failed.flow.save()).toBe(false);
    expect(failed.asked[0]).toContain("the disk is full");
    expect(failed.state).toMatchObject({ shown: "error", words: "Not saved" });
    expect(failed.file.saved).toBe("Saved.");
    // What can be done there and then: a copy downloaded.
    const copied = page({
      disk: { "tale.vxd": { text: "Saved.", modified: 1 } },
      failWrite: true,
      answers: ["download"],
    });
    expect(await copied.flow.save()).toBe(false);
    expect(copied.said.some((line) => line.startsWith("downloaded"))).toBe(true);
  });

  it("Save as onto the story's own file asks as Save does", async () => {
    const run = page({ disk: { "tale.vxd": { text: "Theirs.", modified: 7 } }, pick: "tale.vxd" });
    expect(await run.flow.saveAs()).toBe(false);
    expect(run.asked[0]).toContain("changed outside the Writer");
    expect(run.disk["tale.vxd"]?.text).toBe("Theirs.");
  });

  it("a slow save ending after another story opened tells that one's draft, not this one", async () => {
    let finish = () => {};
    const slowWrite = new Promise<void>((done) => {
      finish = done;
    });
    const run = page({ disk: { "tale.vxd": { text: "Saved.", modified: 1 } }, slowWrite });
    const saving = run.flow.save();
    await new Promise((done) => setTimeout(done, 0));
    run.file.id = "another";
    run.file.saved = "Another story.";
    finish();
    expect(await saving).toBe(false);
    expect(run.marked).toEqual(["story"]);
    expect(run.file.saved).toBe("Another story.");
  });

  it("never writes another story into the file, whatever opened while the browser asked", async () => {
    let answer = () => {};
    const slowAllowed = new Promise<void>((done) => {
      answer = done;
    });
    const run = page({ disk: { "tale.vxd": { text: "Saved.", modified: 1 } }, slowAllowed });
    const saving = run.flow.save();
    await new Promise((done) => setTimeout(done, 0));
    // Meanwhile: a new story, its first words typed, "Don't save" told about this one.
    run.open("new", "Second story.");
    answer();
    expect(await saving).toBe(false);
    expect(run.disk["tale.vxd"]?.text).toBe("Saved.");
    expect(run.file.saved).toBe("");
    expect(run.marked).toEqual([]);
  });

  it("leaves a story opened during a Save as with its own name and file, whatever the save did", async () => {
    for (const outcome of ["allowed", "refused", "failed"] as const) {
      let answer = () => {};
      const slowAllowed = new Promise<void>((done) => {
        answer = done;
      });
      const run = page({
        disk: { "tale.vxd": { text: "Saved.", modified: 1 } },
        slowAllowed,
        allowed: outcome !== "refused",
        failWrite: outcome === "failed",
        pick: "copy.vxd",
      });
      const saving = run.flow.saveAs();
      await new Promise((done) => setTimeout(done, 0));
      run.open("new", "Second story.");
      answer();
      expect(await saving).toBe(false);
      // The new story is as it was opened: Untitled, no file; neither file has its words.
      expect(run.file.name).toBe("Untitled.vxd");
      expect(run.file.handle).toBeUndefined();
      expect(run.disk["copy.vxd"]).toBeUndefined();
      expect(run.disk["tale.vxd"]?.text).toBe("Saved.");
    }
  });

  it("saves the words typed while the browser asked, in the same story", async () => {
    let answer = () => {};
    const slowAllowed = new Promise<void>((done) => {
      answer = done;
    });
    const run = page({ disk: { "tale.vxd": { text: "Saved.", modified: 1 } }, slowAllowed });
    const saving = run.flow.save();
    await new Promise((done) => setTimeout(done, 0));
    run.type(" And more.");
    answer();
    expect(await saving).toBe(true);
    expect(run.disk["tale.vxd"]?.text).toBe("Mine. And more.");
  });

  it("downloads where the browser can't keep files", async () => {
    const run = page({ keepsFiles: false, file: { handle: undefined } });
    expect(await run.flow.save()).toBe(true);
    expect(run.said[0]).toBe("downloaded tale.vxd: Mine.");
  });
});

describe("saving by itself", () => {
  it("writes without asking, and keeps a version only when one is due", async () => {
    const run = page({ disk: { "tale.vxd": { text: "Saved.", modified: 1 } } });
    await run.flow.autosave();
    expect(run.disk["tale.vxd"]?.text).toBe("Mine.");
    expect(run.versions).toEqual([]);
    expect(run.asked).toEqual([]);
  });

  it("stops, and says so once, when the file changed elsewhere or needs the browser's go-ahead", async () => {
    const changed = page({ disk: { "tale.vxd": { text: "Theirs.", modified: 1 } } });
    await changed.flow.autosave();
    await changed.flow.autosave();
    expect(changed.disk["tale.vxd"]?.text).toBe("Theirs.");
    expect(changed.flow.stopped).toBe(true);
    expect(changed.state).toMatchObject({ shown: "error", words: "Not saved: changed on disk" });
    expect(changed.said).toHaveLength(1);
    const lapsed = page({
      disk: { "tale.vxd": { text: "Saved.", modified: 1 } },
      mayWriteNow: false,
    });
    await lapsed.flow.autosave();
    expect(lapsed.said[0]).toContain("go-ahead");
    expect(lapsed.disk["tale.vxd"]?.text).toBe("Saved.");
  });

  it("does nothing with nothing to save", async () => {
    const run = page({ text: "Saved.", disk: { "tale.vxd": { text: "Saved.", modified: 1 } } });
    await run.flow.autosave();
    expect(run.disk["tale.vxd"]?.modified).toBe(1);
  });
});

describe("coming back to the Writer", () => {
  it("reads the file again when nothing here is unsaved", async () => {
    const run = page({ text: "Saved.", disk: { "tale.vxd": { text: "Theirs.", modified: 5 } } });
    await run.flow.checkDisk();
    expect(run.state.replaced).toBe("Theirs.");
    expect(run.said[0]).toContain("read again");
  });

  it("leaves unsaved words here as they are, and says Save will ask", async () => {
    const run = page({ disk: { "tale.vxd": { text: "Theirs.", modified: 5 } } });
    await run.flow.checkDisk();
    expect(run.state.replaced).toBeUndefined();
    expect(run.flow.stopped).toBe(true);
    expect(run.said[0]).toContain("Save will ask");
  });

  it("only learns the new date when the words are the same", async () => {
    const run = page({ text: "Saved.", disk: { "tale.vxd": { text: "Saved.", modified: 9 } } });
    await run.flow.checkDisk();
    expect(run.file.modified).toBe(9);
    expect(run.state.replaced).toBeUndefined();
  });
});
