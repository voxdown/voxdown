/** Fountain emphasis is text, never HTML. Runs also carry the PDF font choice. */
export interface FountainRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}
const escapable = /[\\*_\[\]@!>~.#^<]/;

/** Matched emphasis on one source line. Unmatched/escaped markers stay literal. */
export function fountainRuns(text: string): FountainRun[] {
  const characters: { text: string; delimiter: boolean }[] = [];
  const source = Array.from(text);
  for (let i = 0; i < source.length; i++) {
    const char = source[i] as string;
    if (char === "\\" && source[i + 1] && escapable.test(source[i + 1] as string))
      characters.push({ text: source[++i] as string, delimiter: false });
    else characters.push({ text: char, delimiter: char === "*" || char === "_" });
  }
  type Opening = { start: number; remaining: number };
  const stacks: Record<string, Opening[]> = { "*": [], _: [] };
  const hidden = new Uint8Array(characters.length);
  const bold = new Int32Array(characters.length + 1);
  const italic = new Int32Array(characters.length + 1);
  const underline = new Int32Array(characters.length + 1);
  for (let i = 0; i < characters.length; ) {
    const token = characters[i] as { text: string; delimiter: boolean };
    if (!token.delimiter) {
      i++;
      continue;
    }
    let end = i + 1;
    while (characters[end]?.delimiter && characters[end]?.text === token.text) end++;
    const canOpen = !!characters[end] && !/\s/.test((characters[end] as { text: string }).text);
    const canClose = i > 0 && !/\s/.test((characters[i - 1] as { text: string }).text);
    const stack = stacks[token.text] as Opening[];
    let remaining = end - i;
    let close = i;
    while (canClose && remaining > 0 && stack.length) {
      const opener = stack.at(-1) as Opening;
      const amount = token.text === "*" && remaining >= 2 && opener.remaining >= 2 ? 2 : 1;
      const from = opener.start + opener.remaining;
      const style = token.text === "_" ? underline : amount === 2 ? bold : italic;
      style[from] = (style[from] ?? 0) + 1;
      style[close] = (style[close] ?? 0) - 1;
      for (let n = 0; n < amount; n++) {
        hidden[from - n - 1] = 1;
        hidden[close + n] = 1;
      }
      opener.remaining -= amount;
      close += amount;
      remaining -= amount;
      if (!opener.remaining) stack.pop();
    }
    if (canOpen && remaining) stack.push({ start: close, remaining });
    i = end;
  }
  let b = 0;
  let em = 0;
  let u = 0;
  const out: FountainRun[] = [];
  for (let i = 0; i < characters.length; i++) {
    b += bold[i] ?? 0;
    em += italic[i] ?? 0;
    u += underline[i] ?? 0;
    if (hidden[i]) continue;
    const text = (characters[i] as { text: string }).text;
    const last = out.at(-1);
    if (last && last.bold === b > 0 && last.italic === em > 0 && last.underline === u > 0)
      last.text += text;
    else out.push({ text, bold: b > 0, italic: em > 0, underline: u > 0 });
  }
  return out;
}
