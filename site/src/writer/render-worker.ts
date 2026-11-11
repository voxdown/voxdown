/**
 * The script or the book of a long story, and its counts, worked out in a worker of their own:
 * reading and drawing 100,000 words takes a few hundred milliseconds, which the page then spends
 * on nothing but putting the result in.
 */
import { renderBook, renderScript } from "@voxdown/render";
import { parse } from "voxdown";
import { type Counts, countsOf } from "./counts";

export type RenderAsk = { id: number; text: string; tab: "script" | "book" | "none" };
export type RenderReply = { id: number; html: string } & Counts;

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
  scope.postMessage({ id, html, ...countsOf(story) });
};
