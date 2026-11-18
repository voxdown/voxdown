import { describe, expect, it } from "vitest";
import { dialogueExcerpts } from "../src/studio/dialogue";
import { parseFountain } from "../src/studio/fountain";
describe("character dialogue excerpts", () => {
  it("uses rendered speech and scene context without private inline text", () => {
    const source =
      "INT. ROOM - DAY\n\nMARA\n(quietly)\n**Hello** [[secret]] there.\n\nJONAH ^\nI heard you.\n";
    const items = [...dialogueExcerpts(parseFountain(source)).values()];
    expect(items).toEqual([
      { line: 3, scene: "INT. ROOM - DAY", text: "(quietly)\nHello  there.", shortened: false },
      { line: 7, scene: "INT. ROOM - DAY", text: "I heard you.", shortened: false },
    ]);
  });
  it("keeps excerpt rendering bounded without changing the screenplay", () => {
    const source = `MARA\n${"word ".repeat(1000)}`;
    const parsed = parseFountain(source);
    const item = [...dialogueExcerpts(parsed).values()][0];
    expect(item?.text.length).toBe(2000);
    expect(item?.shortened).toBe(true);
    expect(parsed.elements[1]?.text.length).toBe(4999);
  });
});
