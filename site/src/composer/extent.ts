/**
 * The largest and smallest of a list, by a loop: `Math.max(...list)` passes every item as an
 * argument and overflows the call stack past about 100,000 (a large MIDI file has more notes).
 */
export function maxOf(list: Iterable<number>, empty = Number.NEGATIVE_INFINITY): number {
  let most = empty;
  let any = false;
  for (const value of list) {
    if (!any || value > most) most = value;
    any = true;
  }
  return any ? Math.max(most, empty) : empty;
}

export function minOf(list: Iterable<number>, empty = Number.POSITIVE_INFINITY): number {
  let least = empty;
  let any = false;
  for (const value of list) {
    if (!any || value < least) least = value;
    any = true;
  }
  return any ? Math.min(least, empty) : empty;
}
