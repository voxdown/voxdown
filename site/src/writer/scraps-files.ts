/**
 * A story's scraps in their file beside it (`owl.scraps.md`): saved there when asked, and again
 * with the story after that, only when they changed; never written over when the file changed
 * outside the Writer since (asked: joined, or saved over it); downloaded where a browser can't
 * keep files. And what is said of scraps this browser alone has: after a save, once a visit; and,
 * for a story opened afresh with none, those kept under its file name.
 */
import {
  type Keeper,
  joinScraps,
  keepScraps,
  markScrapsSaved,
  mergeScraps,
  readScrapsFile,
  scrapsByName,
  scrapsFile,
  scrapsFileName,
  scrapsOf,
  scrapsStanding,
} from "./scraps";

export type ScrapsFilesHost = {
  /** The story open: its key, its file's name, and its title. */
  story(): { id: string; name: string; title: string };
  notice(message: string, action?: { label: string; run: () => void }): void;
  ask(
    message: string,
    buttons: Array<{ label: string; value: string; main?: boolean }>,
  ): Promise<string>;
  download(text: string, name: string): void;
  /** The Scraps tab drawn again, if it shows. */
  redraw(): void;
  /** The Scraps tab shown. */
  show(): void;
};

/** A file the browser can write, as the File System Access API gives one. */
type Handle = FileSystemFileHandle;

export class ScrapsFiles {
  /** The file each story's scraps were saved to this visit, to save them there again. */
  private readonly files = new Map<string, Handle>();
  /** What was last written there: a file that differs has been changed outside the Writer. */
  private readonly written = new Map<string, string>();
  /** The stories this visit has already been told their scraps are in this browser only. */
  private readonly told = new Set<string>();

  constructor(
    private readonly host: ScrapsFilesHost,
    private readonly keeper: Keeper = localStorage,
  ) {}

  /**
   * The story's scraps in their file. Asked where the first time (or always, `asked`), and
   * written there again with the story after that. A file the Writer wrote before, chosen again
   * or saved to with the story, is read first: changed outside since, or not to be read, it is
   * asked about, never written over unasked.
   */
  async save(asked: boolean): Promise<void> {
    const { id, name: storyName, title } = this.host.story();
    let scraps = scrapsOf(this.keeper, id);
    const standing = scrapsStanding(this.keeper, id, scraps);
    // None: nothing to save, unless the ones saved beside the story were all deleted since, when
    // the file is emptied too, so that it never brings them back.
    if (!scraps.length && standing !== "changed") return;
    // Saved with the story: only when they changed, so a file changed elsewhere is left alone.
    if (!asked && standing === "saved") return;
    const name = scrapsFileName(storyName);
    const known = this.files.get(id);
    if (!known && !asked) return;
    if (!window.showSaveFilePicker) {
      this.host.download(scrapsFile(scraps, title), name);
      markScrapsSaved(this.keeper, id, scraps);
      this.host.redraw();
      return;
    }
    let handle = known;
    try {
      if (!handle || asked)
        handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: "Scraps", accept: { "text/markdown": [".md"] } }],
        });
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        this.host.notice("The scraps couldn’t be saved there.");
      return;
    }
    // The file written before (chosen again, or saved to with the story): checked first.
    const same =
      known !== undefined &&
      (handle === known || (await handle.isSameEntry(known).catch(() => false)));
    const written = same ? this.written.get(id) : undefined;
    if (written !== undefined) {
      let onDisk: string | undefined;
      try {
        onDisk = await (await handle.getFile()).text();
      } catch {
        onDisk = undefined;
      }
      if (onDisk === undefined) {
        const answer = await this.host.ask(
          `${handle.name} couldn’t be read to see whether it changed outside the Writer. Save these scraps over it?`,
          [
            { label: "Leave it", value: "cancel", main: true },
            { label: "Save over it", value: "over" },
          ],
        );
        if (answer !== "over") {
          this.host.notice(`The scraps weren’t saved: ${handle.name} is as it was.`);
          return;
        }
      } else if (onDisk !== written) {
        const answer = await this.host.ask(
          `${handle.name} changed outside the Writer since it was saved here. Join its scraps with these, or save these over it?`,
          [
            { label: "Leave it", value: "cancel" },
            { label: "Save over it", value: "over" },
            { label: "Join them", value: "join", main: true },
          ],
        );
        if (answer !== "over" && answer !== "join") {
          this.host.notice(`The scraps weren’t saved: ${handle.name} is as it was changed.`);
          return;
        }
        if (answer === "join") {
          const joined = joinScraps(scraps, readScrapsFile(onDisk), readScrapsFile(written));
          scraps = joined.scraps;
          keepScraps(this.keeper, id, scraps, storyName);
          this.host.notice(
            `${joined.fromThere ? `${joined.fromThere} ${joined.fromThere === 1 ? "scrap" : "scraps"} from ${handle.name} joined these;` : "Joined:"} both are the same now.`,
          );
        }
      }
    }
    const text = scrapsFile(scraps, title);
    try {
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      this.files.set(id, handle);
      this.written.set(id, text);
      markScrapsSaved(this.keeper, id, scraps);
      this.host.redraw();
      if (asked) this.host.notice(`Scraps saved in ${handle.name}.`);
    } catch {
      this.host.notice("The scraps couldn’t be saved there.");
    }
  }

  /**
   * After a save: scraps this browser alone has, never saved beside the story or changed since,
   * said once a visit, with the way to keep them there.
   */
  remind(): void {
    const { id, name } = this.host.story();
    const scraps = scrapsOf(this.keeper, id);
    const standing = scrapsStanding(this.keeper, id, scraps);
    if ((standing !== "browser" && standing !== "changed") || this.files.has(id)) return;
    if (this.told.has(id)) return;
    this.told.add(id);
    const file = scrapsFileName(name);
    if (!scraps.length) {
      this.host.notice(`Saved. Its scraps are all deleted, but ${file} still holds them.`, {
        label: `Empty ${file}`,
        run: () => void this.save(true),
      });
      return;
    }
    this.host.notice(
      `Saved. Its ${scraps.length === 1 ? "scrap is" : `${scraps.length} scraps are`} kept in this browser only: clearing the browser's data would lose ${scraps.length === 1 ? "it" : "them"}.`,
      { label: `Save in ${file}`, run: () => void this.save(true) },
    );
  }

  /**
   * A story opened with no scraps here, where this browser has some under the same file name (a
   * file opened again where the browser can't tell it is the same one): offered, never taken.
   */
  offerByName(): void {
    const { id, name } = this.host.story();
    if (/^Untitled/i.test(name) || scrapsOf(this.keeper, id).length) return;
    const found = scrapsByName(this.keeper, name, id);
    if (!found) return;
    const count = found.scraps.length;
    setTimeout(() => {
      if (this.host.story().id !== id) return;
      this.host.notice(
        `${count === 1 ? "A scrap" : `${count} scraps`} from an earlier ${name} ${count === 1 ? "is" : "are"} in this browser.`,
        {
          label: "Bring them here",
          run: () => {
            if (this.host.story().id !== id) return;
            const { scraps } = mergeScraps(scrapsOf(this.keeper, id), found.scraps);
            keepScraps(this.keeper, id, scraps, name);
            this.host.show();
          },
        },
      );
    }, 900);
  }
}
