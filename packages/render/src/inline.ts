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

/** A link or image address, kept only when it can't run script. */
function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(?:javascript|vbscript|data):/i.test(trimmed) && !/^data:image\//i.test(trimmed))
    return "#";
  return trimmed;
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

function render(chars: Piece[]): string {
  let html = "";
  let i = 0;
  const isChar = (at: number, text: string) => chars[at]?.text === text && !chars[at]?.literal;
  const find = (from: number, text: string) => {
    for (let at = from; at < chars.length; at++) if (isChar(at, text)) return at;
    return -1;
  };
  while (i < chars.length) {
    const piece = chars[i] as Piece;
    if (!piece.literal) {
      // Images and links.
      const bang = piece.text === "!" && isChar(i + 1, "[");
      if (piece.text === "[" || bang) {
        const open = bang ? i + 1 : i;
        const close = find(open + 1, "]");
        if (close > 0 && isChar(close + 1, "(")) {
          const end = find(close + 2, ")");
          if (end > 0) {
            const label = chars.slice(open + 1, close);
            const url = safeUrl(
              chars
                .slice(close + 2, end)
                .map((c) => c.text)
                .join(""),
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
        if (opens) {
          for (let at = start + 1; at < chars.length; at++) {
            const matches = double
              ? isChar(at, piece.text) && isChar(at + 1, piece.text)
              : isChar(at, piece.text) && !isChar(at + 1, piece.text);
            if (!matches || /\s/u.test(chars[at - 1]?.text ?? " ")) continue;
            // An underscore inside a word is just a character.
            if (piece.text === "_" && /[\p{L}\p{N}]/u.test(chars[at + sign.length]?.text ?? ""))
              continue;
            const tag = double ? "strong" : "em";
            html += `<${tag}>${render(chars.slice(start, at))}</${tag}>`;
            i = at + sign.length;
            break;
          }
          if (i >= start) continue;
        }
      }
    }
    html += escapeHtml(piece.text);
    i++;
  }
  return html;
}
