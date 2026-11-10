import type { Range } from "./source";
import type { Warn } from "./warnings";

/** Names ignore case (§5.2). */
export function nameKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/**
 * Resolves the names written in marks to one spelling each (§5.2): the cast's spelling, else the
 * spelling the file uses first. The narrator is written as the cast or the `narrator:` key spells
 * it, else "Narrator". Marks must be resolved in file order.
 */
export class Names {
  /** How the narrator is written. */
  readonly narrator: string;
  private readonly narratorKey: string;
  private readonly cast = new Map<string, string>();
  /** The spelling each name should be written with: the cast's, the `narrator:` key's or the first used. */
  private readonly spelling = new Map<string, string>();

  constructor(
    castHandles: readonly string[],
    narratorSetting: string | undefined,
    private readonly hasCast: boolean,
    private readonly warn: Warn,
  ) {
    for (const handle of castHandles) {
      if (!this.cast.has(nameKey(handle))) this.cast.set(nameKey(handle), handle);
    }
    this.narratorKey = nameKey(narratorSetting ?? "Narrator");
    this.narrator = this.cast.get(this.narratorKey) ?? narratorSetting ?? "Narrator";
    if (narratorSetting !== undefined) this.spelling.set(this.narratorKey, this.narrator);
    for (const [key, handle] of this.cast) this.spelling.set(key, handle);
  }

  /** The canonical spelling of a name written in a mark, with warnings about how it is written. */
  use(written: string, range: Range): string {
    const key = nameKey(written);
    const expected = this.spelling.get(key);
    if (expected === undefined) this.spelling.set(key, written);
    // The same letters written in another Unicode form (`ë` as `e` and a combining mark) look
    // the same: only another case is worth a warning.
    else if (expected.normalize("NFC") !== written.normalize("NFC")) {
      this.warn("name-case", `“${written}” is written “${expected}” elsewhere.`, range);
    }
    if (this.hasCast && !this.cast.has(key) && key !== this.narratorKey) {
      this.warn("unknown-character", `“${written}” is not in the cast.`, range);
    }
    return key === this.narratorKey ? this.narrator : (this.spelling.get(key) ?? written);
  }
}
