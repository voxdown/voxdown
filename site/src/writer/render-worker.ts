/**
 * A long story read away from the page, in a worker of its own: once each time typing pauses, for
 * everything the page shows of it (story-read.ts). Reading and drawing 100,000 words takes a few
 * hundred milliseconds, which the page then spends on nothing but putting the results in. A
 * reading that fails says so, so that the page can read it itself.
 */
import { type RenderAsk, type RenderReply, readFor } from "./story-read";

export type { RenderAsk, RenderReply, StoryRead } from "./story-read";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderAsk>) => void) | null;
  postMessage(message: RenderReply | { id: number; error: string }): void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage(readFor(data));
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
