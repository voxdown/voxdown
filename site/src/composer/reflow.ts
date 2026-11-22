/**
 * Repairs to abcjs's `lineBreaks` reflow, applied to each parsed tune before it is drawn. Loaded
 * with abcjs, which is the only thing that calls it.
 */

/* biome-ignore lint/suspicious/noExplicitAny: abcjs's parsed tune is loosely typed. */
type Any = any;

/** A key signature as the sharps and flats it shows (naturals only cancel, so they don't count). */
const signatureOf = (accidentals: Any[] | undefined): string =>
  (accidentals ?? [])
    .filter((each: Any) => each.acc !== "natural")
    .map((each: Any) => `${each.acc}${String(each.note).toLowerCase()}`)
    .sort()
    .join(" ");
const clefOf = (clef: Any): string => (clef ? `${clef.type}:${clef.verticalPos ?? 0}` : "");

/**
 * Key signatures and clefs as they stand at each line, after abcjs's `lineBreaks` reflow. That
 * reflow (abcjs 6.7.3) repeats the key and clef at every join of the source's own lines, so a
 * key change draws twice (two sharps, then a stray ♯ mid-line) and a line after a clef change can
 * start in the old clef. Each line starts with the key and clef in force, and a key or clef that
 * changes nothing is dropped. Without a reflow this leaves the tune as it was.
 */
export function keepSignatures(tune: Any): void {
  // abcjs records the breaks it reflowed at; without them each line's own key and clef are right.
  const reflowed = Boolean(tune?.lineBreaks);
  const keys = new Map<number, Any>();
  const clefs = new Map<number, Any>();
  for (const line of tune?.lines ?? []) {
    if (!line.staff) continue;
    line.staff.forEach((staff: Any, index: number) => {
      const key = keys.get(index);
      if (reflowed && key && signatureOf(staff.key?.accidentals) !== signatureOf(key.accidentals))
        staff.key = { ...key, accidentals: [...key.accidentals] };
      const clef = clefs.get(index);
      if (reflowed && clef && clefOf(clef) !== clefOf(staff.clef)) staff.clef = { ...clef };
      let lineKey = staff.key;
      let lineClef = staff.clef;
      const startKey = signatureOf(staff.key?.accidentals);
      const startClef = clefOf(staff.clef);
      (staff.voices ?? []).forEach((voice: Any[], number: number) => {
        let keyNow = startKey;
        let clefNow = startClef;
        for (let at = 0; at < voice.length; at++) {
          const element = voice[at];
          if (element.el_type === "key") {
            const shown = signatureOf(element.accidentals);
            if (shown === keyNow) {
              voice.splice(at--, 1);
              continue;
            }
            keyNow = shown;
            if (number === 0)
              lineKey = {
                root: element.root,
                acc: element.acc,
                mode: element.mode,
                accidentals: element.accidentals.filter((each: Any) => each.acc !== "natural"),
              };
          } else if (element.el_type === "clef") {
            if (clefOf(element) === clefNow) {
              voice.splice(at--, 1);
              continue;
            }
            clefNow = clefOf(element);
            if (number === 0) {
              const { el_type: _type, startChar: _start, endChar: _end, ...rest } = element;
              lineClef = rest;
            }
          }
        }
      });
      if (lineKey) keys.set(index, lineKey);
      if (lineClef) clefs.set(index, lineClef);
    });
  }
}
