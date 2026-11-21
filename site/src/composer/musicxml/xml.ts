/**
 * A small XML reader for MusicXML: elements, attributes and text, with the five named entities
 * and numeric character references. The DOCTYPE is skipped, never fetched; comments, processing
 * instructions and CDATA are handled. Malformed input throws an XmlError with its line.
 */

export type XmlElement = {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** The element's own text (its text nodes joined, trimmed). */
  text: string;
};

export class XmlError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = "XmlError";
  }
}

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(text: string, lineAt: () => number): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g,
    (match, body: string) => {
      if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      const named = NAMED[body];
      if (named !== undefined) return named;
      // Entities a DTD would define are not fetched; keep the text as written.
      if (!match.endsWith(";")) return match;
      throw new XmlError(`Unknown entity &${body};`, lineAt());
    },
  );
}

/** Parses an XML document and returns its root element. */
export function parseXml(source: string): XmlElement {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  let at = 0;
  const lineAt = () => {
    let line = 1;
    for (let index = 0; index < at && index < text.length; index++)
      if (text.charCodeAt(index) === 10) line++;
    return line;
  };
  const fail = (message: string): never => {
    throw new XmlError(message, lineAt());
  };
  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: { element: XmlElement; texts: string[] }[] = [{ element: root, texts: [] }];
  while (at < text.length) {
    const open = text.indexOf("<", at);
    const top = stack[stack.length - 1] as { element: XmlElement; texts: string[] };
    if (open < 0) {
      if (text.slice(at).trim() && stack.length > 1) top.texts.push(decode(text.slice(at), lineAt));
      break;
    }
    if (open > at) {
      const chunk = text.slice(at, open);
      if (stack.length > 1) top.texts.push(decode(chunk, lineAt));
      else if (chunk.trim()) fail("Text outside the root element");
    }
    at = open;
    if (text.startsWith("<!--", at)) {
      const end = text.indexOf("-->", at + 4);
      if (end < 0) fail("A comment is not closed");
      at = end + 3;
    } else if (text.startsWith("<![CDATA[", at)) {
      const end = text.indexOf("]]>", at + 9);
      if (end < 0) fail("A CDATA section is not closed");
      top.texts.push(text.slice(at + 9, end));
      at = end + 3;
    } else if (text.startsWith("<?", at)) {
      const end = text.indexOf("?>", at + 2);
      if (end < 0) fail("A processing instruction is not closed");
      at = end + 2;
    } else if (text.startsWith("<!DOCTYPE", at) || text.startsWith("<!doctype", at)) {
      // Skip the DOCTYPE, an internal subset in [ ] included; nothing is fetched.
      let depth = 0;
      let index = at + 9;
      for (; index < text.length; index++) {
        const char = text[index];
        if (char === "[") depth++;
        else if (char === "]") depth--;
        else if (char === ">" && depth <= 0) break;
      }
      if (index >= text.length) fail("The DOCTYPE is not closed");
      at = index + 1;
    } else if (text.startsWith("</", at)) {
      const end = text.indexOf(">", at);
      if (end < 0) fail("A closing tag is not finished");
      const name = text.slice(at + 2, end).trim();
      if (stack.length < 2) fail(`</${name}> closes nothing`);
      const current = stack.pop() as { element: XmlElement; texts: string[] };
      if (current.element.name !== name)
        fail(`</${name}> found where </${current.element.name}> was expected`);
      current.element.text = current.texts.join("").trim();
      at = end + 1;
    } else {
      const match = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(at, at + 200));
      if (!match) fail("A tag is not well formed");
      const name = (match as RegExpExecArray)[1] as string;
      let index = at + (match as RegExpExecArray)[0].length;
      const attrs: Record<string, string> = {};
      for (;;) {
        while (index < text.length && /\s/.test(text[index] as string)) index++;
        if (index >= text.length) fail(`<${name}> is not finished`);
        if (text.startsWith("/>", index) || text[index] === ">") break;
        const attr = /^([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(
          text.slice(index, index + 2000),
        );
        if (!attr) fail(`An attribute of <${name}> is not well formed`);
        const found = attr as RegExpExecArray;
        attrs[found[1] as string] = decode(found[3] ?? found[4] ?? "", lineAt);
        index += found[0].length;
      }
      const element: XmlElement = { name, attrs, children: [], text: "" };
      top.element.children.push(element);
      if (text.startsWith("/>", index)) at = index + 2;
      else {
        stack.push({ element, texts: [] });
        at = index + 1;
      }
    }
  }
  if (stack.length > 1)
    fail(`<${(stack[stack.length - 1] as { element: XmlElement }).element.name}> is not closed`);
  const first = root.children[0];
  if (!first) throw new XmlError("The file has no XML elements", 1);
  if (root.children.length > 1) throw new XmlError("More than one root element", 1);
  return first;
}

/* Helpers for reading the tree. */
export const child = (element: XmlElement | undefined, name: string): XmlElement | undefined =>
  element?.children.find((each) => each.name === name);
export const children = (element: XmlElement | undefined, name: string): XmlElement[] =>
  element ? element.children.filter((each) => each.name === name) : [];
export const textOf = (element: XmlElement | undefined, name: string): string | undefined =>
  child(element, name)?.text;
export const numberOf = (element: XmlElement | undefined, name: string): number | undefined => {
  const value = textOf(element, name);
  if (value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/** Escapes text for XML content and attribute values. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
