/**
 * Go to a chapter or scene: which of them match what is typed, best first. A name that is what
 * was typed comes first, then one that starts with it, then one with every word typed in its own
 * name, then one whose chapter has the rest; in story order within each. A number typed matches a
 * whole number, so "Chapter 3" never finds "Scene 30".
 */
export function rankScenes(
  scenes: ReadonlyArray<{ name: string }>,
  within: readonly string[],
  typed: string,
): number[] {
  const query = typed.trim().toLowerCase().replace(/\s+/g, " ");
  if (!query) return scenes.map((_, index) => index);
  const words = query.split(" ");
  const has = (text: string, word: string) =>
    /^\d+$/.test(word) ? new RegExp(`(?:^|\\D)${word}(?:\\D|$)`).test(text) : text.includes(word);
  const ranked: Array<{ index: number; rank: number }> = [];
  for (const [index, scene] of scenes.entries()) {
    const own = scene.name.toLowerCase();
    const all = `${own} ${(within[index] ?? "").toLowerCase()}`;
    if (!words.every((word) => has(all, word))) continue;
    const rank =
      own === query
        ? 0
        : own.startsWith(query) && !/^\d/.test(own.slice(query.length))
          ? 1
          : words.every((word) => has(own, word))
            ? 2
            : 3;
    ranked.push({ index, rank });
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ index }) => index);
}
