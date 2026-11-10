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
 * Where each mark that may close something is, worked out once so that a long line renders in
 * linear time: for each position, the next `]`, and the next closing run of each emphasis sign;
 * and for each `(`, its `)`, with parentheses inside balanced as the parser reads them (§8.3).
 */
type Closers = {
  bracket: Int32Array;
  emphasis: Record<"*" | "**" | "_" | "__", Int32Array>;
  parens: Map<number, number>;
};

function closersOf(chars: readonly Piece[]): Closers {
  const isChar = (at: number, text: string) => chars[at]?.text === text && !chars[at]?.literal;
  const size = chars.length + 1;
  const bracket = new Int32Array(size).fill(-1);
  const emphasis = {
    "*": new Int32Array(size).fill(-1),
    "**": new Int32Array(size).fill(-1),
    _: new Int32Array(size).fill(-1),
    __: new Int32Array(size).fill(-1),
  };
  for (let at = chars.length - 1; at >= 0; at--) {
    bracket[at] = isChar(at, "]") ? at : (bracket[at + 1] as number);
    const spaced = /\s/u.test(chars[at - 1]?.text ?? " ");
    for (const sign of ["*", "_"] as const) {
      const run = isChar(at, sign);
      const twice = run && isChar(at + 1, sign);
      // Not after a space; an underscore run inside a word is just characters.
      const wordAfter = (length: number) =>
        sign === "_" && /[\p{L}\p{N}]/u.test(chars[at + length]?.text ?? "");
      const single = run && !twice && !spaced && !wordAfter(1);
      const double = twice && !spaced && !wordAfter(2);
      emphasis[sign][at] = single ? at : (emphasis[sign][at + 1] as number);
      const key = sign === "*" ? "**" : "__";
      emphasis[key][at] = double ? at : (emphasis[key][at + 1] as number);
    }
  }
  const parens = new Map<number, number>();
  const open: number[] = [];
  chars.forEach((_, at) => {
    if (isChar(at, "(")) open.push(at);
    else if (isChar(at, ")") && open.length > 0) parens.set(open.pop() as number, at);
  });
  return { bracket, emphasis, parens };
}

function render(chars: Piece[]): string {
  let html = "";
  let i = 0;
  const isChar = (at: number, text: string) => chars[at]?.text === text && !chars[at]?.literal;
  const closers = closersOf(chars);
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
            html += bang
              ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label.map((c) => c.text).join(""))}">`
              : `<a href="${escapeHtml(url)}">${render(label)}</a>`;
            i = end + 1;
            continue;
          }
        }
      }
      // Emphasis: a closing run of the same sign, not across spaces at its edges.
      if (piece.text === "*" || piece.text === "_") {
        const double = isChar(i + 1, piece.text);
        const sign = double ? piece.text.repeat(2) : piece.text;
        const start = i + sign.length;
        const opens = chars[start] && !/\s/u.test(chars[start]?.text ?? " ");
        const at = opens
          ? (closers.emphasis[sign as keyof Closers["emphasis"]][start + 1] ?? -1)
          : -1;
        if (at > 0) {
          const tag = double ? "strong" : "em";
          html += `<${tag}>${render(chars.slice(start, at))}</${tag}>`;
          i = at + sign.length;
          continue;
        }
      }
    }
    html += escapeHtml(piece.text);
    i++;
  }
  return html;
}
