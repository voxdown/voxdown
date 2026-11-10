/**
 * What an edit, the writer or the formatter reads again and again (stories parsed from a text,
 * what each is heard and printed as, a text's tokens) is kept while it works, and let go when it
 * is done: a long story's readings never outlive the call that needed them.
 */

let depth = 0;
const forgetters: Array<() => void> = [];

/** Whether work is under way that keeps what it reads: outside one, nothing is kept. */
export function remembering(): boolean {
  return depth > 0;
}

/** Registers how a module lets go of what it kept, when the outermost work is done. */
export function onForget(forget: () => void): void {
  forgetters.push(forget);
}

/** Does `work`, keeping what it reads until the outermost work under way is done. */
export function session<T>(work: () => T): T {
  depth++;
  try {
    return work();
  } finally {
    depth--;
    if (depth === 0) for (const forget of forgetters) forget();
  }
}
