/**
 * The Markdown a story's text may hold (§11): backslash escapes, emphasis, links and images, as
 * HTML. Everything else is text, escaped.
 */

const ESCAPABLE = /[!-/:-@[-`{-~“”‘’„‚«»‹›「」『』]/u;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A link or image address, kept only when it can't run script: relative addresses, `http`,
 * `https` and `mailto`, and for images raster `data:` URLs. The scheme is read the way a browser
 * reads it, without the spaces and control characters it would ignore.
 */
export function safeUrl(url: string, image = false): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: browsers drop these inside a scheme.
  const cleaned = url.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const normalized = cleaned.replace(/\s+/g, "").toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1];
  if (scheme === undefined) return cleaned;
  if (["http", "https", "mailto"].includes(scheme)) return cleaned;
  if (image && /^data:image\/(?:png|gif|jpe?g|webp|avif)[;,]/.test(normalized)) return cleaned;
  return "#";
}

type Piece = { text: string; literal: boolean };

/** Splits text into literal characters (escaped ones) and characters that may be Markdown. */
function pieces(source: string): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i] as string;
    if (char === "\\" && ESCAPABLE.test(source[i + 1] ?? "")) {
      out.push({ text: source[i + 1] as string, literal: true });
      i++;
    } else {
      out.push({ text: char, literal: false });
    }
  }
  return out;
}

/** Inline Markdown as HTML: `**strong**`, `*em*`, `_em_`, `[link](url)`, `![image](src)`. */
export function inlineHtml(source: string): string {
  return render(pieces(source));
}

/**
 * Where each `]` and `)` that may close a link is, worked out once so that a long line renders in
 * linear time: for each position, the next `]`; and for each `(`, its `)`, with parentheses
 * inside balanced as the parser reads them (§8.3).
 */
function closersOf(chars: readonly Piece[]): { bracket: Int32Array; parens: Map<number, number> } {
  const isChar = (at: number, text: string) => chars[at]?.text === text && !chars[at]?.literal;
  const bracket = new Int32Array(chars.length + 1).fill(-1);
  for (let at = chars.length - 1; at >= 0; at--) {
    bracket[at] = isChar(at, "]") ? at : (bracket[at + 1] as number);
  }
  const parens = new Map<number, number>();
  const open: number[] = [];
  chars.forEach((_, at) => {
    if (isChar(at, "(")) open.push(at);
    else if (isChar(at, ")") && open.length > 0) parens.set(open.pop() as number, at);
  });
  return { bracket, parens };
}

/** A run of `*` or `_`, and the tags it becomes once runs are paired. */
type Run = {
  kind: "run";
  char: "*" | "_";
  /** How long the run was, and how many of its signs are still unpaired. */
  length: number;
  count: number;
  open: boolean;
  close: boolean;
  opens: string[];
  closes: string[];
};
type Node = { kind: "html"; html: string } | Run;

const SPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;

/** A run of emphasis signs, and whether it can open or close emphasis, as Markdown decides. */
function runAt(chars: readonly Piece[], from: number, to: number): Run {
  const char = chars[from]?.text as "*" | "_";
  const before = chars[from - 1]?.text ?? " ";
  const after = chars[to]?.text ?? " ";
  const left =
    !SPACE.test(after) &&
    (!PUNCTUATION.test(after) || SPACE.test(before) || PUNCTUATION.test(before));
  const right =
    !SPACE.test(before) &&
    (!PUNCTUATION.test(before) || SPACE.test(after) || PUNCTUATION.test(after));
  // An underscore inside a word is just a character.
  const open = char === "*" ? left : left && (!right || PUNCTUATION.test(before));
  const close = char === "*" ? right : right && (!left || PUNCTUATION.test(after));
  const length = to - from;
  return { kind: "run", char, length, count: length, open, close, opens: [], closes: [] };
}

/**
 * Pairs runs of emphasis signs as Markdown does: each closing run with the nearest opening run of
 * the same sign before it, two signs for strong and one for emphasis, inside out. A list of the
 * runs still open, with a floor for each kind of closer that found none, keeps it linear.
 */
function pairRuns(nodes: readonly Node[]): void {
  const runs = nodes.filter((node): node is Run => node.kind === "run");
  const previous = runs.map((_, index) => index - 1);
  const floors = new Map<string, number>();
  for (let at = 0; at < runs.length; at++) {
    const closer = runs[at] as Run;
    if (closer.close) {
      const key = `${closer.char}${closer.open ? 1 : 0}${closer.length % 3}`;
      while (closer.count > 0) {
        const floor = floors.get(key) ?? -1;
        let found = -1;
        for (let back = previous[at] as number; back > floor; back = previous[back] as number) {
          const opener = runs[back] as Run;
          if (opener.char !== closer.char || !opener.open || opener.count === 0) continue;
          // Markdown's rule of three: a run that can both open and close pairs with another
          // only if their lengths don't add up to a multiple of three (unless both are one).
          const both = opener.close || closer.open;
          const sum = opener.length + closer.length;
          if (both && sum % 3 === 0 && !(opener.length % 3 === 0 && closer.length % 3 === 0)) {
            continue;
          }
          found = back;
          break;
        }
        if (found < 0) {
          floors.set(key, previous[at] as number);
          break;
        }
        const opener = runs[found] as Run;
        const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
        const tag = use === 2 ? "strong" : "em";
        opener.count -= use;
        closer.count -= use;
        opener.opens.unshift(`<${tag}>`);
        closer.closes.push(`</${tag}>`);
        // The runs between them can no longer pair; a spent opener is gone too.
        previous[at] = opener.count === 0 ? (previous[found] as number) : found;
      }
    }
    // A run that can't open anything is no opener for those after it.
    if ((closer.count === 0 || !closer.open) && at + 1 < runs.length) {
      previous[at + 1] = previous[at] as number;
    }
  }
}

function render(chars: Piece[]): string {
  const nodes: Node[] = [];
  const isChar = (at: number, text: string) => chars[at]?.text === text && !chars[at]?.literal;
  const closers = closersOf(chars);
  let text = "";
  const flush = () => {
    if (text !== "") nodes.push({ kind: "html", html: escapeHtml(text) });
    text = "";
  };
  let i = 0;
  while (i < chars.length) {
    const piece = chars[i] as Piece;
    if (!piece.literal) {
      // Images and links.
      const bang = piece.text === "!" && isChar(i + 1, "[");
      if (piece.text === "[" || bang) {
        const open = bang ? i + 1 : i;
        const close = closers.bracket[open + 1] ?? -1;
        if (close > 0 && isChar(close + 1, "(")) {
          const end = closers.parens.get(close + 1) ?? -1;
          if (end > 0) {
            const label = chars.slice(open + 1, close);
            const url = safeUrl(
              chars
                .slice(close + 2, end)
                .map((c) => c.text)
                .join(""),
              bang,
            );
            flush();
            nodes.push({
              kind: "html",
              html: bang
                ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label.map((c) => c.text).join(""))}">`
                : `<a href="${escapeHtml(url)}">${render(label)}</a>`,
            });
            i = end + 1;
            continue;
          }
        }
      }
      // A run of emphasis signs, paired below.
      if (piece.text === "*" || piece.text === "_") {
        let end = i;
        while (isChar(end, piece.text)) end++;
        flush();
        nodes.push(runAt(chars, i, end));
        i = end;
        continue;
      }
    }
    text += piece.text;
    i++;
  }
  flush();
  pairRuns(nodes);
  return nodes
    .map((node) =>
      node.kind === "html"
        ? node.html
        : node.closes.join("") + node.char.repeat(node.count) + node.opens.join(""),
    )
    .join("");
}
