/** Conservative, portable browser-local anchors. No absolute offset survives a reload. */
export type ScrapOrigin = {
  before: string;
  after: string;
  text: string;
  start: boolean;
  end: boolean;
};

export function captureScrapOrigin(source: string, from: number, to: number): ScrapOrigin {
  return {
    before: source.slice(Math.max(0, from - 160), from),
    after: source.slice(to, to + 160),
    text: source.slice(from, to),
    start: from === 0,
    end: to === source.length,
  };
}

export type ScrapDestination = { from: number; to: number; present: boolean };
/** Only accept a unique intact context, either with the original words or an empty gap.
 * Changed/repeated context is deliberately not guessed; no existing text is replaced. */
export function locateScrapOrigin(source: string, origin: ScrapOrigin): ScrapDestination | null {
  const matches: ScrapDestination[] = [];
  for (const present of [true, false]) {
    const middle = present ? origin.text : "";
    const needle = origin.before + middle + origin.after;
    if (!needle && !(origin.start && origin.end && !source)) continue;
    let at = source.indexOf(needle);
    while (at !== -1) {
      const from = at + origin.before.length;
      const to = from + middle.length;
      if ((!origin.start || from === 0) && (!origin.end || to === source.length)) {
        matches.push({ from, to, present });
        if (matches.length > 1) return null;
      }
      if (!needle) break;
      at = source.indexOf(needle, at + 1);
    }
  }
  return matches[0] ?? null;
}
