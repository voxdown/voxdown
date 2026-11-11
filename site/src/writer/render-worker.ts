/**
 * A long story read away from the page, in a worker of its own: once each time typing pauses, for
 * everything the page shows of it. Its marks for the editor, its scenes for the rail, its cast, its
 * passages for the bar over them, what to put right, its counts, and the script or the book for
 * the side. Reading and drawing 100,000 words takes a few hundred milliseconds, which the page
 * then spends on nothing but putting the results in.
 */
import { type EditorMark, editorMarks, readStory } from "@voxdown/editor";
import { renderBook, renderScript } from "@voxdown/render";
import { characterColors } from "voxdown";
import { type Counts, countsOf } from "./counts";
import { type Problem, problems } from "./problems";
import {
  type CastView,
  type Passage,
  type SceneData,
  castOf,
  passagesOf,
  scenesOf,
} from "./story-data";

export type RenderAsk = { id: number; text: string; tab: "script" | "book" | "none" };

/** Everything the page shows of the story, read once. */
export type StoryRead = {
  marks: EditorMark[];
  scenes: SceneData[];
  colors: Array<[string, string]>;
  cast: CastView;
  passages: Passage[];
  problems: Problem[];
} & Counts;

export type RenderReply = { id: number; html: string } & StoryRead;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderAsk>) => void) | null;
  postMessage(message: RenderReply): void;
};

/** The line each place is on, from where the lines start. */
function linesOf(text: string): (at: number) => number {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return (at) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] as number) <= at) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

scope.onmessage = ({ data: { id, text, tab } }) => {
  // The story read once: the editor's marks read the same story (`readStory` keeps it).
  const story = readStory(text);
  const marks = editorMarks(text);
  const html =
    tab === "script"
      ? renderScript(story, { positions: true })
      : tab === "book"
        ? renderBook(story, { pages: true, positions: true })
        : "";
  scope.postMessage({
    id,
    html,
    marks,
    scenes: scenesOf(story),
    colors: [...characterColors(story)],
    cast: castOf(story),
    passages: passagesOf(story),
    problems: problems(story, marks, linesOf(text)),
    ...countsOf(story),
  });
};
