/**
 * Saving a story to its file: Save, Save as, Keep both, the check for changes made elsewhere before
 * any write, reading the file again, saving by itself, and what each says. One at a time, each to
 * its own story. Everything it needs from the page (the text, the questions, the file access, the
 * draft kept) is given to it, so that it can be tried without one.
 */
import { SaveQueue, autosaveCheck, checkDisk as diskCheck, sameText } from "./saving";

/** The story's file, as the page keeps it (`file`): read and written in place. */
export type SavedFile = {
  id: string;
  name: string;
  handle: FileSystemFileHandle | undefined;
  /** The text as last opened or saved. */
  saved: string;
  savedAt: number | undefined;
  /** When the file was last changed on disk, as the Writer last read or wrote it. */
  modified: number | undefined;
};

export type Disk = { text: string; modified: number } | undefined;

export type Button = { label: string; value: string; main?: boolean };

/** What saving needs from the page. */
export type SaveHost = {
  file: SavedFile;
  /** The text as it will be saved. */
  text(): string;
  /** Whether this tab writes the story now. */
  owner(): boolean;
  /** Whether this tab may write it, asking to take it from another if it must. */
  mayWrite(): Promise<boolean>;
  /** A change typed on the side but not yet made, made now. */
  commitPending(): void;
  autosaveOn(): boolean;
  /** Whether the browser lets the page keep files (else saving is a download). */
  keepsFiles: boolean;
  suggestedName(): string;
  files: {
    allowed(handle: FileSystemFileHandle, mode: "readwrite"): Promise<boolean>;
    mayWriteNow(handle: FileSystemFileHandle): Promise<boolean>;
    onDisk(handle: FileSystemFileHandle): Promise<Disk>;
    writeFile(handle: FileSystemFileHandle, text: string): Promise<number>;
    pickSaveTarget(name: string): Promise<FileSystemFileHandle | undefined>;
    download(text: string, name: string): void;
    sameEntry(a: FileSystemFileHandle, b: FileSystemFileHandle): Promise<boolean>;
  };
  ask(message: string, buttons: Button[]): Promise<string>;
  tell(message: string): Promise<unknown>;
  notice(message: string): void;
  announce(message: string): void;
  /** The save state beside the name: as the text says, or saving, or not saved. */
  showSaveState(): void;
  showState(state: "saving" | "error", words: string, title?: string): void;
  /** The name shown, and the files opened lately. */
  named(name: string): void;
  remember(handle: FileSystemFileHandle): Promise<void>;
  /** The story's text replaced by the file's, as one step to undo. */
  replaceText(text: string): void;
  keep(): Promise<void>;
  snapshot(why: string, text: string): Promise<void>;
  /** Whether a version is due (saving by itself keeps one at most every few minutes). */
  versionDue(): boolean;
  /** A story saved after another was opened: its kept draft learns it. */
  markSaved(id: string, content: string, modified: number): Promise<void>;
};

/** A name beside the one given, for a copy: `Story (2).vxd`, or the next number. */
export function anotherName(name: string): string {
  const [, stem = name, number, extension = ""] =
    /^(.*?)(?: \((\d+)\))?(\.[^.]+)?$/.exec(name) ?? [];
  return `${stem} (${number ? Number(number) + 1 : 2})${extension}`;
}

export class SaveFlow {
  /** Saving by itself stopped, and says so until a save goes through. */
  stopped = false;
  private readonly queue = new SaveQueue();

  constructor(private readonly host: SaveHost) {}

  /** Saves to the story's file, or asks where. True once it is saved. */
  async save(): Promise<boolean> {
    const { host } = this;
    host.commitPending();
    // Only the tab that writes the story saves it: another would save what it last saw.
    if (!(await host.mayWrite())) return false;
    if (!host.file.handle) return this.saveAs();
    return this.write(host.file.handle);
  }

  async saveAs(keepBoth = false): Promise<boolean> {
    const { host } = this;
    const { file } = host;
    host.commitPending();
    if (!(await host.mayWrite())) return false;
    if (!host.keepsFiles) {
      // Where a page can't keep a file, saving is a download.
      const content = host.text();
      host.files.download(content, host.suggestedName());
      this.saved(content);
      return true;
    }
    const name = host.suggestedName();
    const handle = await host.files.pickSaveTarget(keepBoth ? anotherName(name) : name);
    if (!handle) return false;
    const itself = file.handle ? await host.files.sameEntry(handle, file.handle) : false;
    // Keeping both: never the file it is to be kept beside.
    if (keepBoth && itself) {
      await host.tell(
        `That is ${file.name} itself: keeping both needs a file of its own. Nothing was saved.`,
      );
      return false;
    }
    // The story's own file, chosen again: a Save, with its check for changes made elsewhere.
    if (itself && file.handle) return this.write(file.handle);
    // The new file is the story's from here: its name and handle go with what is kept, and back
    // to the old ones if it can't be written.
    const before = { handle: file.handle, name: file.name, modified: file.modified };
    file.handle = handle;
    file.name = handle.name;
    file.modified = undefined;
    host.named(file.name);
    const done = await this.write(handle);
    if (done) await host.remember(handle);
    else {
      file.handle = before.handle;
      file.name = before.name;
      file.modified = before.modified;
      host.named(file.name);
      host.showSaveState();
    }
    return done;
  }

  /** Writes the story to `handle`, after asking what must be asked. True once it is saved. */
  async write(handle: FileSystemFileHandle): Promise<boolean> {
    const { host } = this;
    const { file } = host;
    // The browser may want to ask before the page writes the file again (after a restart):
    // asked now, on the click, so that the file can be read before it is written.
    try {
      if (!(await host.files.allowed(handle, "readwrite"))) {
        await host.tell(`${file.name} wasn’t saved: the browser didn’t allow writing it.`);
        return false;
      }
    } catch {
      // Writing will say what is wrong.
    }
    // Changed on disk since the Writer read it (another app, another computer syncing it):
    // asked first, never overwritten unseen; whichever is kept, the other is in Earlier versions.
    const check =
      handle === file.handle && file.modified !== undefined
        ? diskCheck(await host.files.onDisk(handle), {
            modified: file.modified,
            saved: file.saved,
          })
        : ({ kind: "write" } as const);
    if (check.kind === "unread") {
      const answer = await host.ask(
        `${file.name} couldn’t be read to see whether it changed outside the Writer. Save over it anyway?`,
        [
          { label: "Cancel", value: "cancel", main: true },
          { label: "Save over it", value: "mine" },
        ],
      );
      if (answer !== "mine") return false;
    } else if (check.kind === "changed") {
      const disk = check.disk;
      const answer = await host.ask(
        `${file.name} was changed outside the Writer since it was opened here. Keep both, open the file as it is now, or save over it? The one you don’t keep stays in Earlier versions.`,
        [
          { label: "Cancel", value: "cancel" },
          { label: "Open it as it is now", value: "theirs" },
          { label: "Save over it", value: "mine" },
          { label: "Keep both…", value: "both", main: true },
        ],
      );
      if (answer === "theirs") {
        await this.readAgain(disk);
        return false;
      }
      if (answer === "both") {
        // Theirs stays in the file, and among this story's versions; mine goes to a new file.
        await host.snapshot("As it was on disk", disk.text);
        return this.saveAs(true);
      }
      if (answer !== "mine") return false;
      await host.snapshot("As it was on disk, before it was saved over", disk.text);
    }
    const content = host.text();
    host.showState("saving", "Saving…");
    try {
      const id = file.id;
      const modified = await this.queue.run(() => {
        // Checked again when its turn comes: another tab may have taken the story meanwhile.
        if (!host.owner()) throw new Error("another tab writes this story now");
        return host.files.writeFile(handle, content);
      });
      if (!this.savedAs(id, content, modified)) return false;
      host.announce(`Saved ${file.name}`);
      return true;
    } catch (error) {
      host.showState("error", "Not saved");
      host.announce(`${file.name} wasn't saved`);
      // What can be done there and then: save it somewhere else, or download it; the draft is
      // kept in this browser whatever is chosen.
      const answer = await host.ask(
        `${file.name} couldn't be saved: ${(error as Error).message}. The story is kept in this browser; save it somewhere else, or download a copy?`,
        [
          { label: "Not now", value: "cancel" },
          { label: "Download a copy", value: "download" },
          { label: "Save as…", value: "save-as", main: true },
        ],
      );
      if (answer === "download") host.files.download(content, host.suggestedName());
      else if (answer === "save-as") return this.saveAs();
      return false;
    }
  }

  /**
   * The file as it is on disk now, in place of the story here: the same story with its versions,
   * Undo to take it back; and what was here kept as a version first.
   */
  async readAgain(disk: { text: string; modified: number }): Promise<void> {
    const { host } = this;
    // The file and the story agree again: saving by itself can go on.
    this.stopped = false;
    await host.snapshot("Before the file was read again", host.text());
    host.file.saved = disk.text;
    host.file.savedAt = Date.now();
    host.file.modified = disk.modified;
    host.replaceText(disk.text);
    host.showSaveState();
    await host.keep();
    await host.snapshot("Read again from disk", disk.text);
  }

  /**
   * Coming back to the Writer: if the file changed on disk meanwhile, a story with nothing unsaved
   * here is read again; one with changes here is left as it is, and Save will ask.
   */
  async checkDisk(): Promise<void> {
    const { host } = this;
    const { file } = host;
    const handle = file.handle;
    if (!handle || file.modified === undefined || !host.owner()) return;
    const disk = await host.files.onDisk(handle);
    if (!disk || handle !== file.handle) return;
    // What it says, not its date: a sync or a copy can keep the date and change the words.
    if (sameText(disk.text, file.saved)) {
      if (disk.modified !== file.modified) {
        file.modified = disk.modified;
        void host.keep();
      }
      return;
    }
    if (sameText(host.text(), file.saved)) {
      await this.readAgain(disk);
      host.notice(
        `${file.name} changed outside the Writer, so it was read again. Undo (Ctrl+Z) takes it back.`,
      );
    } else {
      this.stop(
        `${file.name} changed outside the Writer. Save will ask which to keep.`,
        "Not saved: changed on disk",
      );
    }
  }

  /** Saving by itself: to the story's own file, where the browser already lets it. Never asks. */
  async autosave(): Promise<void> {
    const { host } = this;
    const { file } = host;
    const handle = file.handle;
    const base = {
      on: host.autosaveOn(),
      owner: host.owner(),
      hasFile: Boolean(handle),
      unsaved: !sameText(host.text(), file.saved),
    };
    // Nothing to do (off, another tab's, no file, nothing changed): the file isn't looked at.
    const first = autosaveCheck({ ...base, mayWriteNow: true, disk: { kind: "write" } });
    if (first.kind === "wait" || !handle) return;
    const may = await host.files.mayWriteNow(handle);
    const check = autosaveCheck({
      ...base,
      mayWriteNow: may,
      disk: may
        ? diskCheck(await host.files.onDisk(handle), {
            modified: file.modified,
            saved: file.saved,
          })
        : { kind: "write" },
    });
    if (check.kind === "ask") {
      // The browser asks again after a restart, and only on a click: Save asks, once.
      this.stop(`Saving ${file.name} automatically needs your go-ahead: press Save once (Ctrl+S).`);
      return;
    }
    if (check.kind === "stop") {
      // Shown beside the name for as long as it lasts; said once.
      const changed = check.check.kind === "changed";
      this.stop(
        changed
          ? `${file.name} changed outside the Writer, so it isn’t saved automatically. Save will ask which to keep.`
          : `${file.name} couldn’t be read, so it isn’t saved automatically. Save will ask what to do.`,
        changed ? "Not saved: changed on disk" : "Not saved: can’t read the file",
      );
      return;
    }
    if (check.kind !== "write" || handle !== file.handle) return;
    const content = host.text();
    const id = file.id;
    try {
      const modified = await this.queue.run(() => {
        if (!host.autosaveOn() || !host.owner())
          throw new Error("saving automatically was stopped");
        return host.files.writeFile(handle, content);
      });
      this.savedAs(id, content, modified, true);
      this.stopped = false;
    } catch (error) {
      // Switched off, or taken by another tab, while it waited its turn: nothing to say.
      if (!host.autosaveOn() || !host.owner()) return;
      this.stop(`${file.name} couldn’t be saved automatically: ${(error as Error).message}`);
    }
  }

  /** Saving by itself stopped: said once, and shown beside the file's name until it saves. */
  stop(message: string, short = "Not saved: press Save"): void {
    this.host.showState("error", short, message);
    if (this.stopped) return;
    this.stopped = true;
    this.host.notice(message);
  }

  /** Saved: a version kept each time it is saved by hand, and at most every few minutes by itself. */
  saved(content: string, automatic = false): void {
    const { host } = this;
    host.file.saved = content;
    host.file.savedAt = Date.now();
    this.stopped = false;
    host.showSaveState();
    void host.keep();
    if (!automatic || host.versionDue()) void host.snapshot("Saved", content);
  }

  /**
   * A save finished: the story it was for is saved as `content`. If another story is open by
   * now, only that story's kept draft learns it; the open one is left as it is. True if it is the
   * open story.
   */
  private savedAs(id: string, content: string, modified: number, automatic = false): boolean {
    if (id !== this.host.file.id) {
      void this.host.markSaved(id, content, modified);
      return false;
    }
    this.host.file.modified = modified;
    this.saved(content, automatic);
    return true;
  }
}
