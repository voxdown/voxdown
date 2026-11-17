// Keep the phone's illustrations in the HTML, even before JavaScript or fonts arrive.
// Refresh after changing the walkthrough: pnpm site:build && node scripts/front-examples.mjs
// Then build again to include the updated HTML, as with front-shots.mjs.
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const site = fileURLToPath(new URL("../site/", import.meta.url));
const dist = resolve(site, "dist");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 393, height: 852 },
    reducedMotion: "reduce",
  });
  // Serve the built files through routing; no server or production site is needed.
  await page.route("https://voxdown.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const file = resolve(dist, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
    if (!file.startsWith(`${dist}/`)) return route.abort();
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: types[extname(file)] ?? "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
  await page.goto("https://voxdown.test/");
  await page.evaluate(() => window.dispatchEvent(new Event("pointerdown")));
  await page.waitForFunction(
    () => document.querySelectorAll(".step-example:not([data-static-example])").length === 7,
  );
  const examples = await page.evaluate(() =>
    [...document.querySelectorAll("#steps .step")].map((step) => {
      const example = step
        .querySelector(".step-example:not([data-static-example])")
        .cloneNode(true);
      // These are illustrations, not controls awaiting a click. The live copy replaces them.
      for (const node of example.querySelectorAll(".picker, .desk-alt, .pv-p-book, .pv-p-lines"))
        node.remove();
      for (const node of example.querySelectorAll(
        "[id], [aria-controls], [aria-labelledby], [aria-describedby]",
      )) {
        for (const name of ["id", "aria-controls", "aria-labelledby", "aria-describedby"])
          node.removeAttribute(name);
      }
      example.querySelector(".mini-tabs")?.setAttribute("data-pane", "script");
      const title = step.querySelector("h3").textContent;
      const label = `Illustration in the Writer: ${title}`;
      const wrapper = document.createElement("div");
      wrapper.className = "step-example seen near";
      wrapper.setAttribute("data-static-example", "");
      wrapper.setAttribute("role", "img");
      wrapper.setAttribute("aria-label", label);
      const inside = document.createElement("div");
      inside.inert = true;
      inside.setAttribute("aria-hidden", "true");
      inside.innerHTML = example.innerHTML;
      wrapper.append(inside);
      return { step: step.dataset.step, html: wrapper.outerHTML.replace(/[\t ]+$/gm, "") };
    }),
  );
  const file = resolve(site, "index.html");
  let html = await readFile(file, "utf8");
  for (const example of examples) {
    const start = `<!-- static-example:${example.step} -->`;
    const end = `<!-- /static-example:${example.step} -->`;
    const block = `${start}\n          ${example.html}\n          ${end}`;
    if (html.includes(start)) {
      const from = html.indexOf(start);
      html = html.slice(0, from) + block + html.slice(html.indexOf(end, from) + end.length);
    } else {
      const step = html.indexOf(`class="step" data-step="${example.step}"`);
      const afterCopy = html.indexOf("</p>", step) + 4;
      if (step < 0 || afterCopy < 4) throw new Error(`Missing step ${example.step}`);
      html = `${html.slice(0, afterCopy)}\n          ${block}${html.slice(afterCopy)}`;
    }
  }
  await writeFile(file, html);
  console.log("Updated seven static walkthrough illustrations in site/index.html");
} finally {
  await browser.close();
}
