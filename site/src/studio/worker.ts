import { parseFountain } from "./fountain";
import { layoutScreenplay } from "./layout";
self.onmessage = (event: MessageEvent<{ id: number; source: string; paper: "letter" | "a4" }>) => {
  const { id, source, paper } = event.data;
  try {
    const document = parseFountain(source);
    try {
      self.postMessage({ id, document, layout: layoutScreenplay(document, paper) });
    } catch (error) {
      self.postMessage({
        id,
        document,
        error: error instanceof Error ? error.message : "Could not lay out this screenplay.",
      });
    }
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "Could not read this screenplay.",
    });
  }
};
