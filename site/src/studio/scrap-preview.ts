import { parseFountain } from "./fountain";
import { fountainRuns } from "./inline";
import { speakerHue } from "./speaker-color";

/** Bounded, inert DOM: private comments stay visible and no source is interpreted as HTML. */
export function renderScrapPreview(host: HTMLElement, text: string, expanded = false) {
  const limit = expanded ? 20_000 : 800;
  const source = text
    .slice(0, limit)
    .split("\n")
    .slice(0, expanded ? 240 : 8)
    .join("\n");
  const parsed = parseFountain(source);
  let hue = 275;
  for (const [index, element] of parsed.elements.entries()) {
    const line = document.createElement("span");
    line.className = `scrap-line scrap-${element.kind}`;
    const raw = source.slice(element.from, element.to);
    if (element.kind === "character") hue = speakerHue(element.text);
    line.style.setProperty("--studio-speaker-hue", String(hue));
    const comments = parsed.omissions.filter(
      (span) => span.from < element.to && span.to > element.from,
    );
    let from = element.from;
    const append = (value: string, comment = false) => {
      const wrapper = document.createElement("span");
      if (comment) wrapper.className = "scrap-comment";
      for (const run of fountainRuns(value)) {
        const span = document.createElement("span");
        span.textContent = run.text;
        if (run.bold) span.style.fontWeight = "700";
        if (run.italic) span.style.fontStyle = "italic";
        if (run.underline) span.style.textDecoration = "underline";
        wrapper.append(span);
      }
      line.append(wrapper);
    };
    for (const comment of comments) {
      const begin = Math.max(from, comment.from);
      append(source.slice(from, begin));
      from = Math.min(element.to, comment.to);
      append(source.slice(begin, from), true);
    }
    if (!comments.length) append(raw);
    else append(source.slice(from, element.to));
    host.append(line);
    if (index < parsed.elements.length - 1) host.append(document.createTextNode("\n"));
  }
  if (text.length > source.length) {
    const more = document.createElement("small");
    more.className = "scrap-preview-limit";
    more.textContent = expanded
      ? "Preview shortened. Edit or copy to access the complete scrap."
      : "…";
    host.append(more);
  }
}
