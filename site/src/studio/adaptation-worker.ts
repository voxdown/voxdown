import { adaptToVoxDown } from "./adaptation";
import type { AdaptationRequest } from "./adaptation-client";

self.onmessage = (event: MessageEvent<AdaptationRequest>) => {
  const { id, source, readSceneHeadings } = event.data;
  try {
    if (
      !Number.isSafeInteger(id) ||
      typeof source !== "string" ||
      typeof readSceneHeadings !== "boolean"
    )
      throw new Error("The adaptation request is invalid. Close and retry preparation.");
    self.postMessage({ id, result: adaptToVoxDown(source, { readSceneHeadings }) });
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error
          ? error.message
          : "Could not prepare the adaptation. Your screenplay is unchanged.",
    });
  }
};
