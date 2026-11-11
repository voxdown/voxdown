/**
 * The script or the book of a long story, and its counts, worked out in a worker of their own:
 * reading and drawing 100,000 words takes a few hundred milliseconds, which the page then spends
 * on nothing but putting the result in.
 */
import { renderBook, renderScript } from "@voxdown/render";
import { bookText, lines, parse } from "voxdown";

export type RenderAsk = { id: number; text: string; tab: "script" | "book" | "none" };
export type RenderReply = { id: number; html: string; words: number; said: number; voices: number };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderAsk>) => void) | null;
  postMessage(message: RenderReply): void;
};

scope.onmessage = ({ data: { id, text, tab } }) => {
  const story = parse(text);
  const html =
    tab === "script"
      ? renderScript(story, { positions: true })
      : tab === "book"
        ? renderBook(story, { pages: true, positions: true })
        : "";
  const said = lines(story).filter((line) => line.kind === "speech" || line.kind === "vocal");
  scope.postMessage({
    id,
    html,
    words: bookText(story).match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu)?.length ?? 0,
    said: said.length,
    voices: new Set(said.map((line) => line.speaker)).size,
  });
};
