import type { ChangeSpec, EditorState, SelectionRange } from "@codemirror/state";
import type { FountainDocument, FountainElement } from "./fountain";

export type EmphasisMark = "bold" | "italic" | "underline";
type Unit = {
  from: number;
  to: number;
  raw: string;
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};
type Segment = { from: number; to: number; line: number; units: Unit[] };
const escapable = /[\\*_\[\]@!>~.#^<]/;

/** Source-addressed equivalent of fountainRuns, retaining escapes and printable literals. */
function units(source: string): Unit[] {
  const tokens: (Unit & { delimiter: boolean })[] = [];
  for (let i = 0; i < source.length; ) {
    const from = i;
    let text = String.fromCodePoint(source.codePointAt(i) ?? 0);
    i += text.length;
    let escaped = false;
    if (text === "\\" && source[i] && escapable.test(source[i] as string)) {
      text = source[i++] as string;
      escaped = true;
    }
    tokens.push({
      from,
      to: i,
      raw: source.slice(from, i),
      text,
      delimiter: !escaped && /[*_]/.test(text),
      bold: false,
      italic: false,
      underline: false,
    });
  }
  const stacks: Record<string, { start: number; remaining: number }[]> = { "*": [], _: [] };
  const hidden = new Set<number>();
  const styles = {
    bold: new Int32Array(tokens.length + 1),
    italic: new Int32Array(tokens.length + 1),
    underline: new Int32Array(tokens.length + 1),
  };
  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i] as (typeof tokens)[number];
    if (!token.delimiter) {
      i++;
      continue;
    }
    let end = i + 1;
    while (tokens[end]?.delimiter && tokens[end]?.text === token.text) end++;
    const canOpen = !!tokens[end] && !/\s/.test(tokens[end]?.text ?? "");
    const canClose = i > 0 && !/\s/.test(tokens[i - 1]?.text ?? "");
    const stack = stacks[token.text] as { start: number; remaining: number }[];
    let remaining = end - i;
    let close = i;
    while (canClose && remaining && stack.length) {
      const opener = stack.at(-1) as { start: number; remaining: number };
      const amount = token.text === "*" && remaining >= 2 && opener.remaining >= 2 ? 2 : 1;
      const from = opener.start + opener.remaining;
      const style = styles[token.text === "_" ? "underline" : amount === 2 ? "bold" : "italic"];
      style[from] = (style[from] ?? 0) + 1;
      style[close] = (style[close] ?? 0) - 1;
      for (let n = 0; n < amount; n++) {
        hidden.add(from - n - 1);
        hidden.add(close + n);
      }
      opener.remaining -= amount;
      close += amount;
      remaining -= amount;
      if (!opener.remaining) stack.pop();
    }
    if (canOpen && remaining) stack.push({ start: close, remaining });
    i = end;
  }
  let bold = 0;
  let italic = 0;
  let underline = 0;
  return tokens.flatMap((token, i) => {
    bold += styles.bold[i] ?? 0;
    italic += styles.italic[i] ?? 0;
    underline += styles.underline[i] ?? 0;
    return hidden.has(i)
      ? []
      : [{ ...token, bold: bold > 0, italic: italic > 0, underline: underline > 0 }];
  });
}

function contentBounds(source: string, element: FountainElement): [number, number] {
  let from = source.length - source.trimStart().length;
  let to = source.trimEnd().length;
  const text = source.slice(from, to);
  if (["blank", "note", "boneyard", "page-break"].includes(element.kind)) return [from, from];
  if (/^[@!>~]/.test(text) || (element.kind === "scene" && text.startsWith("."))) from++;
  if (element.kind === "section") from += /^#+/.exec(text)?.[0].length ?? 0;
  if (element.kind === "synopsis" && text.startsWith("=")) from++;
  if (element.kind === "title" && !/^\s/.test(source)) {
    const field = /^[\p{L}_][\p{L}\p{N} _-]*:[ \t]*/u.exec(text);
    if (field) from += field[0].length;
  }
  if (element.kind === "centered" && text.endsWith("<")) to--;
  if (element.kind === "character" && element.dual) to--;
  if (element.kind === "scene" && element.sceneNumber)
    to -= /#[\p{L}\p{N}.-]+#$/u.exec(text)?.[0].length ?? 0;
  if (text.startsWith("(") && text.endsWith(")")) {
    from++;
    to--;
  }
  return [from, Math.max(from, to)];
}

/** Each visible line/comment-delimited fragment is styled independently; private spans stay byte-for-byte intact. */
export function planEmphasis(state: EditorState, parsed: FountainDocument, mark: EmphasisMark) {
  const ranges = state.selection.ranges;
  const segments: Segment[] = [];
  let omissionIndex = 0;
  for (const element of parsed.elements) {
    if (!ranges.some((range) => range.from < element.to && range.to > element.from)) continue;
    const source = state.sliceDoc(element.from, element.to);
    while (
      omissionIndex < parsed.omissions.length &&
      (parsed.omissions[omissionIndex]?.to ?? 0) <= element.from
    )
      omissionIndex++;
    const omissions = [];
    for (let index = omissionIndex; index < parsed.omissions.length; index++) {
      const omission = parsed.omissions[index];
      if (!omission || omission.from >= element.to) break;
      omissions.push({
        from: Math.max(0, omission.from - element.from),
        to: Math.min(source.length, omission.to - element.from),
      });
    }
    // Interpret emphasis across private comments as the renderer does, but retain
    // every printable character's original address so comments are never rewritten.
    let visible = source;
    let offsets: number[] | undefined;
    if (omissions.length) {
      const pieces: string[] = [];
      offsets = [];
      let cursor = 0;
      for (const omission of omissions) {
        pieces.push(source.slice(cursor, omission.from));
        for (let at = cursor; at < omission.from; at++) offsets.push(at);
        cursor = omission.to;
      }
      pieces.push(source.slice(cursor));
      for (let at = cursor; at < source.length; at++) offsets.push(at);
      visible = pieces.join("");
    }
    const [start, end] = contentBounds(visible, element);
    if (start >= end) continue;
    const lower = offsets?.[start] ?? start;
    const upper = (offsets?.[end - 1] ?? end - 1) + 1;
    const interpreted = units(visible).map((unit) => {
      const from = offsets?.[unit.from] ?? unit.from;
      const to = (offsets?.[unit.to - 1] ?? unit.to - 1) + 1;
      return { ...unit, from, to, raw: source.slice(from, to) };
    });
    let unitIndex = 0;
    const append = (from: number, to: number) => {
      if (from >= to) return;
      const fragment: Unit[] = [];
      while (
        unitIndex < interpreted.length &&
        (interpreted[unitIndex]?.to ?? Number.POSITIVE_INFINITY) <= to
      ) {
        const unit = interpreted[unitIndex++] as Unit;
        if (unit.from >= from)
          fragment.push({ ...unit, from: unit.from - from, to: unit.to - from });
      }
      segments.push({
        from: element.from + from,
        to: element.from + to,
        line: element.line,
        units: fragment,
      });
    };
    let from = lower;
    for (const omission of omissions) {
      if (omission.to <= from) continue;
      if (omission.from >= upper) break;
      append(from, omission.from);
      from = omission.to;
    }
    append(from, upper);
  }

  const selected = (segment: Segment, unit: Unit) =>
    ranges.some(
      (range) => range.from < segment.from + unit.to && range.to > segment.from + unit.from,
    );
  const eligible = segments.flatMap((segment) =>
    segment.units.filter((unit) => selected(segment, unit) && /\S/.test(unit.text)),
  );
  if (!eligible.length) return null;
  const enable = !eligible.every((unit) => unit[mark]);
  const replacements: {
    from: number;
    to: number;
    insert: string;
    positions: { oldFrom: number; oldTo: number; from: number; to: number }[];
  }[] = [];
  const changedLines = new Set<number>();
  for (const segment of segments) {
    for (const unit of segment.units) {
      if (selected(segment, unit) && unit[mark] !== enable) {
        unit[mark] = enable;
        changedLines.add(segment.line);
      }
    }
  }
  for (const segment of segments) {
    if (!changedLines.has(segment.line)) continue;
    // Delimiters cannot touch whitespace on their inner edge. Keep separating spaces
    // inside a style only when both neighboring words share it.
    for (const style of ["bold", "italic", "underline"] as const) {
      for (let i = 0; i < segment.units.length; ) {
        if (/\S/.test(segment.units[i]?.text ?? "")) {
          i++;
          continue;
        }
        let end = i;
        while (end < segment.units.length && /\s/.test(segment.units[end]?.text ?? "")) end++;
        const enabled = !!segment.units[i - 1]?.[style] && !!segment.units[end]?.[style];
        for (let at = i; at < end; at++) (segment.units[at] as Unit)[style] = enabled;
        i = end;
      }
    }
    let insert = "";
    let active: EmphasisMark[] = [];
    const positions: { oldFrom: number; oldTo: number; from: number; to: number }[] = [];
    const markers = { bold: "**", italic: "*", underline: "_" };
    for (const unit of segment.units) {
      const order: EmphasisMark[] = enable
        ? [mark, ...(["bold", "italic", "underline"] as const).filter((style) => style !== mark)]
        : ["bold", "italic", "underline"];
      const next = [
        ...active.filter((style) => unit[style]),
        ...order.filter((style) => unit[style] && !active.includes(style)),
      ];
      let common = 0;
      while (common < active.length && active[common] === next[common]) common++;
      for (let at = active.length - 1; at >= common; at--)
        insert += markers[active[at] as EmphasisMark];
      for (let at = common; at < next.length; at++) insert += markers[next[at] as EmphasisMark];
      const from = insert.length;
      insert += unit.raw === "*" || unit.raw === "_" ? `\\${unit.raw}` : unit.raw;
      positions.push({ oldFrom: unit.from, oldTo: unit.to, from, to: insert.length });
      active = next;
    }
    for (const style of active.reverse()) insert += markers[style];
    // Do not accept ambiguous marker combinations (including escaped closers).
    const rendered = units(insert);
    if (
      rendered.length !== segment.units.length ||
      rendered.some((unit, i) => {
        const expected = segment.units[i] as Unit;
        return (
          unit.text !== expected.text ||
          (["bold", "italic", "underline"] as const).some(
            (style) => unit[style] !== expected[style],
          )
        );
      })
    )
      return null;
    replacements.push({ from: segment.from, to: segment.to, insert, positions });
  }
  if (!replacements.length) return null;
  const changes = state.changes(replacements satisfies ChangeSpec);
  const map = (position: number, end: boolean) => {
    const replacement = replacements.find((item) => position >= item.from && position <= item.to);
    if (!replacement) return changes.mapPos(position, end ? -1 : 1);
    const local = position - replacement.from;
    const token = end
      ? [...replacement.positions].reverse().find((item) => item.oldFrom < local)
      : replacement.positions.find((item) => item.oldTo > local);
    const offset = token ? (end ? token.to : token.from) : end ? 0 : replacement.insert.length;
    return changes.mapPos(replacement.from, -1) + offset;
  };
  return {
    changes,
    mapRange: (range: SelectionRange) => ({
      from: map(range.from, false),
      to: map(range.to, true),
    }),
  };
}
