/**
 * The Markdown a story's text may hold (§11): backslash escapes, character references, emphasis,
 * links and images, as HTML. Everything else is text, escaped.
 */
import { characterReference } from "voxdown";

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

/**
 * A character of text, escaped (`literal`) or not; `edge` marks where one piece of text ends, and
 * `written` how a character reference was written (`&eacute;`).
 */
type Piece = { text: string; literal: boolean; edge?: boolean; written?: string };

/**
 * A link's address and title, as Markdown reads them: `<address>` or the address up to a space,
 * then an optional title in quotes or parentheses.
 */
function destination(target: string): { url: string; title: string | null } {
  const text = target.trim();
  // `<address>` to the first `>` not escaped, or the address up to a space; backslash escapes
  // count in both, and in the title.
  const bracketed = /^<((?:\\.|[^<>\n\\])*)>\s*(.*)$/s.exec(text);
  const first = /^\S*/.exec(text)?.[0] ?? "";
  const [url, rest] = bracketed
    ? [bracketed[1] as string, bracketed[2] as string]
    : [first, text.slice(first.length).trim()];
  const title = /^(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|\(((?:\\.|[^()\\])*)\))$/s.exec(rest);
  const said = title ? (title[1] ?? title[2] ?? title[3] ?? null) : null;
  return { url: withoutEscapes(url), title: said === null ? null : withoutEscapes(said) };
}

/** Text with its backslash escapes taken out, and each character reference's character in its place. */
function withoutEscapes(text: string): string {
  return text.replace(
    /\\(.)|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/gsu,
    (whole, char: string | undefined, offset: number) =>
      char !== undefined
        ? ESCAPABLE.test(char)
          ? char
          : whole
        : (characterReference(text, offset)?.char ?? whole),
  );
}

/** Splits text into literal characters (escaped ones) and characters that may be Markdown. */
function pieces(source: string): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i] as string;
    const reference = char === "&" ? characterReference(source, i) : null;
    if (char === "\\" && ESCAPABLE.test(source[i + 1] ?? "")) {
      out.push({ text: source[i + 1] as string, literal: true });
      i++;
    } else if (reference) {
      // A character reference is its character, and never Markdown: `&ast;` is no emphasis.
      out.push({
        text: reference.char,
        literal: true,
        written: source.slice(i, i + reference.length),
      });
      i += reference.length - 1;
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
 * Pieces of one paragraph's text as HTML, each its own: the lines of a printed paragraph, or a
 * line's stretches between marks. Emphasis pairs across them as in the paragraph read whole (an
 * edge counts as a space), and a tag still open at a piece's end is closed there and opened again
 * at the next, so each piece's HTML stands alone. A link stays within its piece.
 */
export function inlineHtmlPieces(sources: readonly string[]): string[] {
  const chars: Piece[] = [];
  sources.forEach((source, index) => {
    if (index > 0) chars.push({ text: " ", literal: true, edge: true });
    for (const piece of pieces(source)) chars.push(piece);
  });
  // A piece of only spaces needs no emphasis around it.
  return renderPieces(chars).map((html) =>
    html.replace(/^(?:<(?:em|strong)>)+(\s*)(?:<\/(?:em|strong)>)+$/, "$1"),
  );
}

/**
 * Where each `]` and `)` that may close a link is, worked out once so that a long line renders in
 * linear time: for each position, the next `]`; for each `[`, the `]` that balances it; and for
 * each `(`, the `)` that ends a link's address and title, as the parser reads them (§8.3).
 */
function closersOf(chars: readonly Piece[]): {
  bracket: Int32Array;
  opener: Int32Array;
  squares: Map<number, number>;
  links: Int32Array;
  nesting: Set<number>;
} {
  const isChar = (at: number, text: string) => chars[at]?.text === text && !chars[at]?.literal;
  // For each position, the next `]`, and the next `[`.
  const bracket = new Int32Array(chars.length + 1).fill(-1);
  const opener = new Int32Array(chars.length + 1).fill(-1);
  for (let at = chars.length - 1; at >= 0; at--) {
    bracket[at] = isChar(at, "]") ? at : (bracket[at + 1] as number);
    opener[at] = isChar(at, "[") ? at : (opener[at + 1] as number);
  }
  const squares = new Map<number, number>();
  const openSquare: number[] = [];
  chars.forEach((_, at) => {
    if (isChar(at, "[")) openSquare.push(at);
    else if (isChar(at, "]") && openSquare.length > 0) squares.set(openSquare.pop() as number, at);
  });
  const links = linkEnds(
    chars.length,
    (at) => chars[at]?.text,
    (at) => chars[at]?.literal === false,
  );
  // A link may not hold another (Markdown): where links nest, the innermost is the link, so a
  // link's text never holds one and rendering it goes one level deep at most. An image may sit
  // in a link's text, and a link in an image's description: only links count.
  // How many images' descriptions hold each place: a link in one is the image's words.
  const inImage = new Int32Array(chars.length + 1);
  for (const [open, close] of squares) {
    if (!isChar(open - 1, "!")) continue;
    (inImage[open + 1] as number)++;
    (inImage[close] as number)--;
  }
  for (let at = 1; at < inImage.length; at++) {
    inImage[at] = (inImage[at] as number) + (inImage[at - 1] as number);
  }
  const candidates = [...squares.keys()]
    .filter((open) => {
      const close = squares.get(open) as number;
      return (
        isChar(close + 1, "(") &&
        (links[close + 1] ?? -1) >= 0 &&
        !isChar(open - 1, "!") &&
        (inImage[open] as number) === 0
      );
    })
    .sort((a, b) => a - b);
  const nesting = new Set<number>();
  candidates.forEach((open, index) => {
    const next = candidates[index + 1];
    if (next !== undefined && next < (squares.get(open) as number)) nesting.add(open);
  });
  return { bracket, opener, squares, links, nesting };
}

/**
 * Where the parentheses after each would-be link's text close, as Markdown reads a link's address
 * and title (CommonMark 0.31, §6.3): from a `(`, spaces, then an address (`<…>` on one line, or up
 * to a space with its own parentheses balanced), then perhaps a title in `"…"`, `'…'` or `(…)`
 * after a space, then spaces and `)`. So a title may hold a lone `(` and a `<…>` address a `)`.
 * The parser reads links this way too (`voxdown`'s inline.ts). For each `(` of the `length` characters, the index of that `)`, or -1 where no address and
 * title close; for every `(` at once, in linear time. `plain` says which characters aren't escaped.
 */
function linkEnds(
  length: number,
  char: (at: number) => string | undefined,
  plain: (at: number) => boolean,
): Int32Array {
  const is = (at: number, sign: string) => char(at) === sign && plain(at);
  const space = (code: number) => code === 32 || code === 9 || code === 10 || code === 13;
  // For each position, the first at or after it of: no space; a space or control character (an
  // address's end); `<`, `>` or a line break (an `<…>` address's end); each title's closing mark.
  const solid = new Int32Array(length + 1).fill(length);
  const gap = new Int32Array(length + 1).fill(length);
  const angle = new Int32Array(length + 1).fill(length);
  const double = new Int32Array(length + 1).fill(length);
  const single = new Int32Array(length + 1).fill(length);
  const paren = new Int32Array(length + 1).fill(length);
  for (let at = length - 1; at >= 0; at--) {
    const sign = char(at) ?? "";
    const code = sign.charCodeAt(0);
    solid[at] = space(code) ? (solid[at + 1] as number) : at;
    gap[at] = code <= 32 || code === 127 ? at : (gap[at + 1] as number);
    angle[at] =
      sign === "\n" || (plain(at) && (sign === "<" || sign === ">"))
        ? at
        : (angle[at + 1] as number);
    double[at] = is(at, '"') ? at : (double[at + 1] as number);
    single[at] = is(at, "'") ? at : (single[at + 1] as number);
    paren[at] = is(at, "(") || is(at, ")") ? at : (paren[at + 1] as number);
  }
  // How deep in parentheses each position is, and the `)` that balances each `(`.
  const depth = new Int32Array(length + 1);
  const balance = new Int32Array(length).fill(-1);
  const open: number[] = [];
  for (let at = 0; at < length; at++) {
    depth[at + 1] = (depth[at] as number) + (is(at, "(") ? 1 : is(at, ")") ? -1 : 0);
    if (is(at, "(")) open.push(at);
    else if (is(at, ")") && open.length > 0) balance[open.pop() as number] = at;
  }
  const ends = new Int32Array(length).fill(-1);
  for (let start = 0; start < length; start++) {
    if (!is(start, "(")) continue;
    const at = solid[start + 1] as number;
    if (at >= length) continue;
    let end: number;
    if (is(at, "<")) {
      // `<…>`: to the first `>`, with no `<` or line break before it.
      const close = angle[at + 1] as number;
      if (!is(close, ">")) continue;
      end = close + 1;
    } else {
      // Up to a space, its parentheses balanced; a `)` that balances the link's own `(` before
      // then ends the address and the link.
      const balanced = balance[start] as number;
      const stop = gap[at] as number;
      if (balanced >= 0 && balanced < stop) {
        ends[start] = balanced;
        continue;
      }
      if ((depth[stop] as number) !== (depth[at] as number)) continue;
      end = stop;
    }
    let next = solid[end] as number;
    if (is(next, ")")) {
      ends[start] = next;
      continue;
    }
    // A title, after a space if there was an address.
    if (next === end && end > at) continue;
    const close = is(next, '"')
      ? (double[next + 1] as number)
      : is(next, "'")
        ? (single[next + 1] as number)
        : is(next, "(")
          ? (paren[next + 1] as number)
          : length;
    if (close >= length || (is(next, "(") && !is(close, ")"))) continue;
    next = solid[close + 1] as number;
    if (is(next, ")")) ends[start] = next;
  }
  return ends;
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
type Node = { kind: "html"; html: string } | { kind: "edge" } | Run;

const SPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;

/** A run of emphasis signs, and whether it can open or close emphasis, as Markdown decides. */
function runAt(chars: readonly Piece[], from: number, to: number): Run {
  const char = chars[from]?.text as "*" | "_";
  // The characters around the run as written: a character reference is its `&…;` here.
  const previous = chars[from - 1];
  const next = chars[to];
  const before = previous?.written?.slice(-1) ?? previous?.text ?? " ";
  const after = next?.written?.[0] ?? next?.text ?? " ";
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
  return renderPieces(chars).join("");
}

/** The HTML of each piece of `chars`, the pieces being split at their edges. */
function renderPieces(chars: Piece[]): string[] {
  const nodes: Node[] = [];
  const isChar = (at: number, text: string) => chars[at]?.text === text && !chars[at]?.literal;
  const closers = closersOf(chars);
  // How many piece edges come before each character: a link can't cross one.
  const edges = new Int32Array(chars.length + 1);
  chars.forEach((piece, at) => {
    edges[at + 1] = (edges[at] as number) + (piece.edge ? 1 : 0);
  });
  let text = "";
  const flush = () => {
    if (text !== "") nodes.push({ kind: "html", html: escapeHtml(text) });
    text = "";
  };
  let i = 0;
  while (i < chars.length) {
    const piece = chars[i] as Piece;
    if (piece.edge) {
      flush();
      nodes.push({ kind: "edge" });
      i++;
      continue;
    }
    if (!piece.literal) {
      // Images and links.
      const bang = piece.text === "!" && isChar(i + 1, "[");
      if ((piece.text === "[" || bang) && !closers.nesting.has(bang ? i + 1 : i)) {
        const open = bang ? i + 1 : i;
        // The text runs to the `]` that balances it, as the parser reads a link (§8.3).
        const balanced = closers.squares.get(open) ?? -1;
        let close =
          balanced > 0 && isChar(balanced + 1, "(") ? balanced : (closers.bracket[open + 1] ?? -1);
        // A `[` whose text would hold another `[` before that `]` opens nothing: that `[` is
        // the link's, and this one is text (Markdown pairs a `]` with the nearest `[`).
        const inner = closers.opener[open + 1] ?? -1;
        if (close !== balanced && inner >= 0 && inner < close) close = -1;
        if (close > 0 && isChar(close + 1, "(")) {
          const end = closers.links[close + 1] ?? -1;
          if (end > 0 && edges[end + 1] === edges[i]) {
            const label = chars.slice(open + 1, close);
            // Escaped characters are written as escapes again, and character references as they
            // were written, for `destination` to read.
            const target = destination(
              chars
                .slice(close + 2, end)
                .map((c) => c.written ?? (c.literal && !c.edge ? `\\${c.text}` : c.text))
                .join(""),
            );
            const url = safeUrl(target.url, bang);
            const title = target.title === null ? "" : ` title="${escapeHtml(target.title)}"`;
            flush();
            // An image's description as text: emphasis, links and images in it as their words.
            const alt = () =>
              render(label)
                .replace(/<img [^>]*alt="([^"]*)"[^>]*>/g, "$1")
                .replace(/<[^>]+>/g, "");
            nodes.push({
              kind: "html",
              html: bang
                ? `<img src="${escapeHtml(url)}" alt="${alt()}"${title}>`
                : `<a href="${escapeHtml(url)}"${title}>${render(label)}</a>`,
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
  // At a piece's edge, the tags still open close, and open again after it.
  const open: string[] = [];
  const done: string[] = [];
  let html = "";
  for (const node of nodes) {
    if (node.kind === "html") html += node.html;
    else if (node.kind === "edge") {
      const closing = [...open]
        .reverse()
        .map((tag) => `</${tag}>`)
        .join("");
      done.push(html + closing);
      html = open.map((tag) => `<${tag}>`).join("");
    } else {
      for (const close of node.closes) {
        html += close;
        open.pop();
      }
      html += node.char.repeat(node.count);
      for (const opening of node.opens) {
        html += opening;
        open.push(opening.slice(1, -1));
      }
    }
  }
  done.push(html);
  return done;
}
