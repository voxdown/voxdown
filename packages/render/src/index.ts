/**
 * HTML for a VoxDown story, with no framework: the book view (the printed story) and the script
 * view (a script for reading aloud, SPEC.md §14). Both are strings, so they render on a server as
 * well as in a browser. Style them with `stylesheet` and its CSS variables.
 */
import {
  type Block,
  type Group,
  type Item,
  type Line,
  type Speech,
  type Story,
  type Visibility,
  characterColors,
  parse,
} from "voxdown";
import { escapeHtml, inlineHtml, safeUrl } from "./inline";
import { stylesheet } from "./stylesheet";

export { stylesheet };
export { PALETTE, characterColors } from "voxdown";
export { escapeHtml, inlineHtml, safeUrl } from "./inline";

export type RenderOptions = {
  /** Colors by character name, over the defaults and any `color` in the cast. */
  colors?: Record<string, string>;
  /** The title, author and cast above the story. Default true. */
  header?: boolean;
  /** Book view: show where pages turn, as small numbers in the margin. Default false. */
  pages?: boolean;
  /** Script view: show the narrator's name too, where the speaker changes. Default false. */
  narratorName?: boolean;
  /**
   * Write where each paragraph, heading, line, speech and mark comes from in the source, as
   * `data-from` and `data-to` (UTF-16 offsets), to link a view to an editor. Default false.
   */
  positions?: boolean;
};

/** ` data-from="…" data-to="…"`, when positions are asked for. */
function placed(range: { from: number; to: number }, options: RenderOptions): string {
  return options.positions ? ` data-from="${range.from}" data-to="${range.to}"` : "";
}

export type View = "book" | "script";

/** Either view of a story, or of its source. */
export function render(story: Story | string, view: View, options: RenderOptions = {}): string {
  const parsed = typeof story === "string" ? parse(story) : story;
  return view === "book" ? renderBook(parsed, options) : renderScript(parsed, options);
}

/** A whole HTML page with the stylesheet, for saving or opening in a browser. */
export function renderDocument(
  story: Story | string,
  view: View,
  options: RenderOptions = {},
): string {
  const parsed = typeof story === "string" ? parse(story) : story;
  const title = escapeHtml(parsed.meta.title ?? "Story");
  const lang = parsed.meta.language ? ` lang="${escapeHtml(parsed.meta.language)}"` : "";
  return `<!doctype html>
<html${lang}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body { margin: 0; padding: 48px 20px; background: var(--vxd-paper, #fff); }
${stylesheet}
</style>
</head>
<body>
${render(parsed, view, options)}
</body>
</html>
`;
}

// The book view

/** The printed story: the book text typeset, with emphasis, links and images (§12.2). */
export function renderBook(story: Story, options: RenderOptions = {}): string {
  const out: string[] = [];
  if (options.header !== false && !opensWithTitle(story)) out.push(header(story, false, new Map()));
  let page = "1";
  // Page numbers wait for the next printed paragraph: a page turn on a line of its own prints nothing.
  let markers = "";
  for (const block of story.blocks) {
    if (block.kind === "break") {
      out.push(`<hr class="vxd-break">`);
      continue;
    }
    const lines = block.kind === "heading" ? [block.line] : block.lines;
    if (options.pages) {
      for (const line of lines)
        for (const item of line.items)
          if (item.kind === "instruction" && item.name === "page") {
            page = item.value ?? nextPage(page);
            markers += `<span class="vxd-page-number" aria-label="Page ${escapeHtml(page)}">${escapeHtml(page)}</span>`;
          }
    }
    if (block.visibility === "audio" || block.visibility === "hidden") continue;
    const printed = lines
      .map((line) => {
        const html = printedLine(story.source, line);
        // With positions, each printed line says where it comes from.
        return html && options.positions && block.kind !== "heading"
          ? `<span class="vxd-line"${placed(line.range, options)}>${html}</span>`
          : html;
      })
      .filter((html) => html !== "");
    if (!printed.length) continue;
    const where = placed(block.range, options);
    if (block.kind === "heading") {
      const level = Math.min(6, block.level);
      out.push(`<h${level} class="vxd-heading"${where}>${markers}${printed.join(" ")}</h${level}>`);
    } else {
      out.push(`<p class="vxd-p"${where}>${markers}${printed.join("<br>\n")}</p>`);
    }
    markers = "";
  }
  return article(story, "book", out);
}

const NOT_PRINTED: ReadonlySet<Item["kind"]> = new Set([
  "mark",
  "direction",
  "sound",
  "vocal",
  "instruction",
  "note",
]);

/** A line as printed (§12.2), as HTML. Where a removed mark leaves two spaces, one remains. */
function printedLine(source: string, line: Line): string {
  let printed = "";
  let at = line.range.from;
  let joint = false;
  const append = (to: number) => {
    let piece = source.slice(at, to);
    if (joint && /[ \t]$/.test(printed)) piece = piece.replace(/^[ \t]+/, "");
    printed += piece;
  };
  for (const item of line.items) {
    if (!NOT_PRINTED.has(item.kind) || item.range.from < at) continue;
    append(item.range.from);
    at = item.range.to;
    joint = true;
  }
  append(line.range.to);
  return inlineHtml(printed.trim());
}

// The script view

/** A script for reading aloud (§14): who says what, how, and every sound, pause and page turn. */
export function renderScript(story: Story, options: RenderOptions = {}): string {
  const colors = characterColors(story, options.colors);
  const out: string[] = [];
  if (options.header !== false) out.push(header(story, true, colors));
  const context: ScriptContext = { story, colors, options, last: null, groups: [] };
  const open: Group[] = [];
  for (const block of story.blocks) {
    if (block.kind === "break") {
      out.push(scriptBlock(block, context));
      continue;
    }
    // Close the groups that have ended, and open the ones that begin.
    const groups = block.groups;
    const keep = commonGroups(open, groups);
    while (open.length > keep) {
      open.pop();
      out.push("</div></div>");
    }
    for (const group of groups.slice(keep)) {
      open.push(group);
      out.push(groupOpen(group, context));
    }
    context.groups = groups;
    out.push(scriptBlock(block, context));
  }
  while (open.pop()) out.push("</div></div>");
  return article(story, "script", out);
}

type ScriptContext = {
  story: Story;
  colors: Map<string, string>;
  options: RenderOptions;
  /** Who spoke last, so a name is shown only where the speaker changes. */
  last: string | null;
  /** The groups around the block being written, outermost first. */
  groups: readonly Group[];
};

/** What the labels of the groups around a block already say: a character, and a direction. */
function groupSays(groups: readonly Group[]): {
  character: string | undefined;
  direction: string | undefined;
} {
  const inner = [...groups].reverse();
  return {
    character: inner.find((group) => group.character)?.character,
    direction: inner.find((group) => group.direction)?.direction,
  };
}

function commonGroups(a: readonly Group[], b: readonly Group[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function groupOpen(group: Group, context: ScriptContext): string {
  const color = group.character ? context.colors.get(group.character) : undefined;
  const style = color ? ` style="--vxd-c: ${color}"` : "";
  const parts: string[] = [];
  if (group.character)
    parts.push(
      `<span class="vxd-group-name">${escapeHtml(fullName(context.story, group.character))}</span>`,
    );
  if (group.direction)
    parts.push(`<span class="vxd-group-direction">${escapeHtml(group.direction)}</span>`);
  for (const instruction of group.instructions)
    parts.push(
      `<span class="vxd-chip vxd-chip-instruction">${escapeHtml(instruction.name)}</span>`,
    );
  const attrs = group.character ? ` data-speaker="${escapeHtml(group.character)}"` : "";
  return `<div class="vxd-group"${attrs}${style}><div class="vxd-group-label"${placed(group.range, context.options)}>${parts.join(" ")}</div><div class="vxd-group-body">`;
}

function scriptBlock(block: Block, context: ScriptContext): string {
  if (block.kind === "break") {
    context.last = null;
    return `<hr class="vxd-break">`;
  }
  // A group's visibility is labeled once, on the group.
  const inherited = !ownVisibility(block) && block.visibility !== "both";
  const label = inherited ? "" : visibilityLabel(block.visibility);
  if (block.kind === "heading") {
    const level = Math.min(6, block.level);
    if (block.visibility === "hidden") {
      return `<div class="vxd-heading-label vxd-h${level}" data-visibility="hidden"${placed(block.range, context.options)}><span class="vxd-chip vxd-chip-label">hidden</span> ${printedLine(context.story.source, block.line)}</div>`;
    }
    context.last = null;
    const inner = scriptLine(block.line, context, true);
    return `<h${level} class="vxd-heading"${visibilityAttr(block.visibility)}${placed(block.range, context.options)}>${label}${inner}</h${level}>`;
  }
  // Each paragraph names its speakers afresh, except the character its group's label names.
  context.last = groupSays(context.groups).character ?? null;
  // A line holding only a page turn is a rule across the page.
  const lines = block.lines.map((line) => {
    const solid = line.items.filter((item) => !(item.kind === "speech" && item.text === ""));
    const only = solid.length === 1 ? solid[0] : undefined;
    if (only?.kind === "instruction" && only.name === "page") {
      return `<span class="vxd-turn" role="separator"${placed(line.range, context.options)}><span>${escapeHtml(only.value ? `page ${only.value}` : "page turn")}</span></span>`;
    }
    return `<span class="vxd-line"${placed(line.range, context.options)}>${scriptLine(line, context, false)}</span>`;
  });
  const joined = lines
    .join("\n")
    .replace(/<\/span>\n<span class="vxd-line"/g, '</span><br>\n<span class="vxd-line"');
  return `<p class="vxd-p"${visibilityAttr(block.visibility)}${placed(block.range, context.options)}>${label}${joined}</p>`;
}

function ownVisibility(block: Block): boolean {
  if (block.kind === "break") return false;
  const lines = block.kind === "heading" ? [block.line] : block.lines;
  return lines.some((line) =>
    line.items.some(
      (item) =>
        item.kind === "instruction" && ["book only", "audio only", "hidden"].includes(item.name),
    ),
  );
}

function visibilityLabel(visibility: Visibility): string {
  if (visibility === "book") return `<span class="vxd-chip vxd-chip-label">book only</span> `;
  if (visibility === "audio") return `<span class="vxd-chip vxd-chip-label">audio only</span> `;
  if (visibility === "hidden") return `<span class="vxd-chip vxd-chip-label">hidden</span> `;
  return "";
}

function visibilityAttr(visibility: Visibility): string {
  return visibility === "both" ? "" : ` data-visibility="${visibility}"`;
}

/** One line of the script: speeches tinted in their speaker's color, marks drawn as chips. */
function scriptLine(line: Line, context: ScriptContext, heading: boolean): string {
  const { story, colors, options } = context;
  const source = story.source;
  const items = [...line.items].sort((a, b) => a.range.from - b.range.from);
  let html = "";
  let at = line.range.from;
  const gap = (to: number) => {
    if (to > at) html += inlineHtml(source.slice(at, to));
    at = Math.max(at, to);
  };
  for (const item of items) {
    if (item.range.from < at && item.kind !== "speech") continue;
    switch (item.kind) {
      case "speech": {
        gap(item.range.from);
        html += speechHtml(item, context, heading);
        at = Math.max(at, item.range.to);
        break;
      }
      case "mark":
      case "direction":
        // Shown as the speech's name and direction label, not as written.
        gap(item.range.from);
        at = item.range.to;
        break;
      case "vocal": {
        gap(item.range.from);
        const color = colors.get(item.speaker);
        const style = color ? ` style="--vxd-c: ${color}"` : "";
        const who =
          context.last !== item.speaker && item.speaker !== story.meta.narrator
            ? `<span class="vxd-chip-who">${escapeHtml(fullName(story, item.speaker))}</span> `
            : "";
        const direction = item.direction
          ? `<span class="vxd-chip-direction">${escapeHtml(item.direction)}</span> `
          : "";
        html += `<span class="vxd-chip vxd-chip-vocal" data-speaker="${escapeHtml(item.speaker)}"${style}${placed(item.range, options)}>${who}${direction}${escapeHtml(item.description)}</span>`;
        context.last = item.speaker;
        at = item.range.to;
        break;
      }
      case "sound":
        gap(item.range.from);
        html += `<span class="vxd-chip vxd-chip-sound"${placed(item.range, options)}>${escapeHtml(item.description)}</span>`;
        at = item.range.to;
        break;
      case "instruction": {
        gap(item.range.from);
        if (item.name === "page") {
          html += `<span class="vxd-chip vxd-chip-page" title="Page turn"${placed(item.range, options)}>${escapeHtml(item.value ? `page ${item.value}` : "page")}</span>`;
        } else if (item.name === "pause") {
          html += `<span class="vxd-chip vxd-chip-pause" title="Pause"${placed(item.range, options)}>${escapeHtml(item.value ?? "pause")}</span>`;
        } else if (!["book only", "audio only", "hidden"].includes(item.name)) {
          html += `<span class="vxd-chip vxd-chip-instruction"${placed(item.range, options)}>${escapeHtml(item.value ? `${item.name} ${item.value}` : item.name)}</span>`;
        }
        at = item.range.to;
        break;
      }
      case "note":
        gap(item.range.from);
        html += `<span class="vxd-note" role="note"${placed(item.range, options)}>${escapeHtml(item.text)}</span>`;
        at = item.range.to;
        break;
      case "image":
        gap(item.range.from);
        html += `<img class="vxd-image" src="${escapeHtml(safeUrl(item.src, true))}" alt="${escapeHtml(item.alt)}"${placed(item.range, options)}>`;
        at = item.range.to;
        break;
    }
  }
  gap(line.range.to);
  return html.trim();
}

function speechHtml(speech: Speech, context: ScriptContext, heading: boolean): string {
  const { story, colors, options } = context;
  const source = story.source;
  const narrator = speech.speaker === story.meta.narrator;
  const color = narrator ? undefined : colors.get(speech.speaker);
  const changed = context.last !== speech.speaker;
  const spoken = /[\p{L}\p{N}]/u.test(speech.text);
  // Narration between two stretches of one character's speech doesn't name them again.
  if (spoken && (!narrator || options.narratorName)) context.last = speech.speaker;
  const name =
    spoken && changed && !heading && (!narrator || options.narratorName)
      ? `<span class="vxd-name"${color ? ` style="--vxd-c: ${color}"` : ""}>${escapeHtml(fullName(story, speech.speaker))}</span>`
      : "";
  // A direction its group's label already says isn't written again over each line.
  const direction =
    speech.direction && spoken && speech.direction !== groupSays(context.groups).direction
      ? `<span class="vxd-direction" aria-label="${escapeHtml(`(${speech.direction})`)}"><span>${escapeHtml(speech.direction)}</span></span>`
      : "";
  const words = inlineHtml(source.slice(speech.range.from, speech.range.to));
  const classes = [
    "vxd-speech",
    narrator ? "vxd-narration" : "",
    speech.direction ? "vxd-directed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style = color ? ` style="--vxd-c: ${color}"` : "";
  return `${name}<span class="${classes}" data-speaker="${escapeHtml(speech.speaker)}"${style}${placed(speech.range, options)}>${direction}${words}</span>`;
}

function fullName(story: Story, speaker: string): string {
  return (
    story.cast.find((member) => member.handle.toLowerCase() === speaker.toLowerCase())?.name ??
    speaker
  );
}

// Shared

/** Whether the story's first block is a heading that says its title, so the header would repeat it. */
function opensWithTitle(story: Story): boolean {
  // The first block that prints anything: notes and page turns before it don't count.
  const first = story.blocks.find(
    (block) =>
      block.kind !== "paragraph" || block.lines.some((line) => printedLine(story.source, line)),
  );
  if (first?.kind !== "heading" || !story.meta.title) return false;
  const text = printedLine(story.source, first.line).replace(/<[^>]+>/g, "");
  return text.trim().toLowerCase() === escapeHtml(story.meta.title).trim().toLowerCase();
}

function header(story: Story, withCast: boolean, colors: Map<string, string>): string {
  const { subtitle, author } = story.meta;
  const repeated = opensWithTitle(story);
  const title = repeated ? undefined : story.meta.title;
  const parts: string[] = [];
  if (title) parts.push(`<div class="vxd-title">${escapeHtml(title)}</div>`);
  if (subtitle && !repeated) parts.push(`<div class="vxd-subtitle">${escapeHtml(subtitle)}</div>`);
  if (author && !repeated) parts.push(`<div class="vxd-author">${escapeHtml(author)}</div>`);
  if (withCast && colors.size) {
    const cast = [...colors].map(([handle, color]) => {
      const about = story.cast.find((member) => member.handle === handle)?.about;
      const title = about ? ` title="${escapeHtml(about)}"` : "";
      return `<li style="--vxd-c: ${color}"${title}><span class="vxd-cast-dot"></span>${escapeHtml(fullName(story, handle))}</li>`;
    });
    parts.push(`<ul class="vxd-cast" aria-label="Cast">${cast.join("")}</ul>`);
  }
  return parts.length ? `<header class="vxd-header">${parts.join("")}</header>` : "";
}

function article(story: Story, view: View, body: string[]): string {
  const lang = story.meta.language ? ` lang="${escapeHtml(story.meta.language)}"` : "";
  return `<article class="vxd vxd-${view}"${lang}>\n${body.filter(Boolean).join("\n")}\n</article>`;
}

function nextPage(label: string): string {
  const match = /(\d+)(?!.*\d)/u.exec(label);
  return match?.[1] ? String(Number(match[1]) + 1) : `${label} +1`;
}
