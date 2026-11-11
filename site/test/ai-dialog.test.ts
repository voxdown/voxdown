// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parse } from "voxdown";
import { copyCommand, placedNow } from "../src/writer/ai-dialog";

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

describe("the helper's command", () => {
  it("is copied in one click, and says so", async () => {
    document.body.innerHTML = `<p><code id="command">npx -y @voxdown/cli connect</code><button id="copy" aria-label="Copy the command"><span class="copy-label">Copy</span></button></p>`;
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void copied.push(text) },
      configurable: true,
    });
    const button = document.getElementById("copy") as HTMLElement;
    copyCommand(button, document.getElementById("command") as HTMLElement);
    button.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(copied).toEqual(["npx -y @voxdown/cli connect"]);
    expect(button.textContent).toBe("Copied");
    expect(button.getAttribute("aria-label")).toBe("Copied the command");
    expect(button.hasAttribute("data-copied")).toBe(true);
  });

  it("is selected for the writer's own keys where the page can't copy", async () => {
    document.body.innerHTML = `<p><code id="command">npx -y @voxdown/cli connect</code><button id="copy"><span class="copy-label">Copy</span></button></p>`;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("not allowed");
        },
      },
      configurable: true,
    });
    const button = document.getElementById("copy") as HTMLElement;
    copyCommand(button, document.getElementById("command") as HTMLElement);
    button.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(getSelection()?.toString()).toBe("npx -y @voxdown/cli connect");
    expect(button.textContent).toMatch(/C to copy$/);
  });
});
