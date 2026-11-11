// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import { placedNow } from "../src/writer/ai-dialog";

const sent = "“Hi,” said Tom.\n\n“Bye,” said Ann.\n\n“Wait,” said Tom.\n";
const placed = (text: string) => {
  const at = placedNow(sent, text, parse(text));
  return [1, 2, 3].map((quote) => at(quote));
};

describe("the AI's answers, after the writer wrote on", () => {
  it("are given where the quotes are now, whatever was typed elsewhere", () => {
    expect(placed(`${sent}\nThe end, typed meanwhile.\n`)).toEqual([1, 2, 3]);
    // A quote written above them all: each moves down one.
    expect(placed(`“Oh,” said Kim.\n\n${sent}`)).toEqual([2, 3, 4]);
  });

  it("keep the writer's own give, and leave a quote whose line changed", () => {
    expect(placed(sent.replace("“Bye,”", "@Ann “Bye,”"))).toEqual([1, "theirs", 3]);
    // The tag now names someone else: the AI's answer may no longer hold.
    expect(placed(sent.replace("said Ann", "said Kim"))).toEqual([1, undefined, 3]);
    // Gone.
    expect(placed(sent.replace("“Wait,” said Tom.\n", ""))).toEqual([1, 2, undefined]);
  });
});
