// Run after pnpm site:build: node scripts/check-studio-accessibility.mjs
// Optional AXE_PATH points to a separately installed axe-core/axe.min.js.
// Optional STUDIO_A11Y_URL tests an existing development server instead.
// Automated checks cannot replace VoiceOver/NVDA or real-device keyboard testing.
import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";
import { clickWorkspaceAction } from "./studio-ui.mjs";

const axePath =
  process.env.AXE_PATH ?? createRequire(import.meta.url).resolve("axe-core/axe.min.js");
assert.ok(
  axePath && existsSync(axePath),
  "Set AXE_PATH to an externally installed axe-core/axe.min.js",
);
const dist = resolve("site/dist");
let server;
let base = process.env.STUDIO_A11Y_URL;
if (!base) {
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
    let file = resolve(dist, `.${pathname}`);
    if (!file.startsWith(`${dist}/`)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".ttf": "font/ttf",
          ".svg": "image/svg+xml",
        }[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}/studio/`;
}
const browser = await chromium.launch();
// Permit test instrumentation under the built site CSP. Security checks run separately without this override.
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, bypassCSP: true });
const failures = [];
const record = (condition, description) => {
  if (!condition) failures.push(description);
};
async function ready() {
  await page.waitForFunction(
    () =>
      !document.getElementById("app").inert &&
      !document.getElementById("counts").textContent.includes("Updating"),
  );
}
async function audit(name) {
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] },
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })),
    }));
  });
  for (const violation of violations) failures.push(`${name}: ${JSON.stringify(violation)}`);
  console.log(`Studio accessibility: ${name}: ${violations.length} axe violations`);
}
async function dialog(button) {
  if (button === "commands") await page.locator("#commands").click();
  else await clickWorkspaceAction(page, button);
  const active = page.locator("dialog[open]");
  await active.waitFor();
  await audit(`dialog ${button}`);
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");
    record(
      await page.evaluate(
        () => !document.hasFocus() || !!document.activeElement.closest("dialog[open]"),
      ),
      `Dialog ${button}: Tab escaped the modal`,
    );
  }
  await page.keyboard.press("Escape");
  const opener =
    { preferences: "view-menu", help: "help-menu", workbench: "tools-menu", recent: "file-menu" }[
      button
    ] ?? button;
  record(
    await page.locator(`#${opener}`).evaluate((node) => document.activeElement === node),
    `Dialog ${button}: Escape did not restore opener focus`,
  );
}
try {
  await page.goto(base);
  await ready();
  await page.addScriptTag({ path: axePath });
  await audit("empty screenplay, light appearance");
  await page.locator(".skip").focus();
  await page.keyboard.press("Enter");
  record(
    await page.locator(".cm-content").evaluate((node) => document.activeElement === node),
    "Skip to screenplay did not focus editable content",
  );
  for (const button of ["preferences", "help", "commands", "workbench", "recent"])
    await dialog(button);
  await page.locator("#file").setInputFiles({
    name: "Accessibility.fountain",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "INT. LIGHTHOUSE - NIGHT\n\nA light moves.\n\nMARA\nSomeone is here.\n\n[[Private reminder]]\n\n# Act two\n\nEXT. BEACH - DAY\n\nWaves break.",
    ),
  });
  await ready();
  await page.locator("#line-help").click();
  await audit("contextual Fountain help");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.activeElement === document.querySelector(".cm-content"),
  );

  for (const command of [
    "Rename a character",
    "Scene cards and rearrangement",
    "Storage and backups",
    "Actor sides PDF",
    "Scoped find and replace",
    "Locations and location rename",
    "Export Final Draft XML (FDX)",
    "Import Final Draft XML (FDX)",
    "Rehearsal cue cards",
    "Practice Fountain step by step",
    "Number scenes",
    "Scene and cast breakdown",
    "Compare with local Fountain file",
    "Adapt screenplay to VoxDown",
  ]) {
    await page.locator("#commands").click();
    await page.getByRole("searchbox", { name: "Find a command" }).fill(command);
    await page.keyboard.press("Enter");
    if (command === "Adapt screenplay to VoxDown")
      await page
        .getByRole("button", { name: "Download adapted .vxd", exact: true })
        .waitFor({ state: "visible" });
    await audit(command);
    if (command === "Number scenes") {
      await page.getByRole("button", { name: "Preview scene numbering", exact: true }).click();
      await audit("scene numbering preview");
    }
    if (command === "Compare with local Fountain file") {
      await page.getByLabel("Baseline Fountain or text file", { exact: true }).setInputFiles({
        name: "Previous.fountain",
        mimeType: "text/plain",
        buffer: Buffer.from("INT. LIGHTHOUSE - NIGHT\n\nA light fades."),
      });
      await page.getByRole("button", { name: "Compare source", exact: true }).click();
      await audit("local source comparison excerpts");
    }
    if (command === "Rehearsal cue cards") {
      await page.getByRole("button", { name: "Start rehearsing", exact: true }).click();
      await page.getByRole("button", { name: "Reveal speech", exact: true }).click();
      await audit("focused rehearsal with revealed speech");
    }
    if (command === "Scene cards and rearrangement") {
      await page.getByRole("button", { name: "Add synopsis…", exact: true }).first().click();
      await page.getByLabel("Scene synopsis", { exact: true }).fill("A visitor arrives.");
      await page.getByRole("button", { name: "Preview synopsis", exact: true }).click();
      await audit("scene synopsis editing and preview");
    }
    await page.keyboard.press("Escape");
  }
  await page.locator("#commands").click();
  await page.getByRole("searchbox", { name: "Find a command" }).fill("Open text reference");
  await page.keyboard.press("Enter");
  await audit("read-only text reference");
  await page.getByRole("tab", { name: "Page preview", exact: true }).click();
  await audit("populated screenplay, light appearance");
  await clickWorkspaceAction(page, "preferences");
  await page.locator("#theme").selectOption("dark");
  await page.keyboard.press("Escape");
  await audit("populated screenplay, dark appearance");
  await clickWorkspaceAction(page, "preferences");
  await page.locator("#theme").selectOption("light");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [720, 390, 320]) {
    await page.setViewportSize({ width, height: width === 720 ? 500 : 844 });
    await audit(`${width}px viewport, reduced motion`);
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    record(
      dimensions.scroll <= dimensions.width,
      `${width}px viewport has horizontal page overflow: ${dimensions.scroll}px`,
    );
    record(
      await page
        .locator(".cm-scroller")
        .evaluate((node) => node.getBoundingClientRect().height > 0),
      `${width}px viewport has no visible editor`,
    );
  }
  // 320 CSS pixels models 400% zoom on a 1280px-wide screen for reflow.
  // The screenplay paper is explicitly two-dimensional and may scroll internally.
  await page.setViewportSize({ width: 390, height: 844 });
  const smallTargets = await page.evaluate(() =>
    [...document.querySelectorAll("button, select, input:not([type=checkbox]), a.brand")]
      .filter((node) => node.getClientRects().length && !node.disabled)
      .map((node) => ({
        name: node.id || node.getAttribute("aria-label") || node.textContent.trim(),
        rect: node.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.width < 44 || rect.height < 44)
      .map(({ name, rect }) => `${name} (${Math.round(rect.width)}×${Math.round(rect.height)})`),
  );
  record(
    smallTargets.length === 0,
    `Mobile controls below 44px target: ${smallTargets.join(", ")}`,
  );
  await page.locator("#commands").click();
  await page.getByRole("searchbox", { name: "Find a command" }).fill("Preferences");
  await page.keyboard.press("Enter");
  await page.locator("#preferences-dialog[open]").waitFor();
  const checkboxTarget = await page
    .locator("#margins")
    .evaluate((node) => node.closest("label").getBoundingClientRect().height);
  record(checkboxTarget >= 44, "Live margins checkbox label is below the 44px touch target");
  const pairingTarget = await page
    .locator("#smart-pairs")
    .evaluate((node) => node.closest("label").getBoundingClientRect().height);
  record(pairingTarget >= 44, "Automatic pairing checkbox label is below the 44px touch target");

  await page.keyboard.press("Escape");
  record(
    await page.locator("#commands").evaluate((node) => document.activeElement === node),
    "Mobile command-opened preferences did not return focus to Commands",
  );
  await page.locator("#commands").click();
  await page.getByRole("searchbox", { name: "Find a command" }).fill("Fountain guide");
  await page.keyboard.press("Enter");
  await audit("mobile Fountain guide");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 844 });
  for (const appearance of ["light", "dark"]) {
    await page.locator("#commands").click();
    await page.getByRole("searchbox", { name: "Find a command" }).fill("Preferences");
    await page.keyboard.press("Enter");
    await page.locator("#theme").selectOption(appearance);
    await audit(`320px preferences, ${appearance}`);
    record(
      await page.locator("#preferences-dialog").evaluate((d) => d.scrollWidth <= d.clientWidth),
      `320px preferences overflow in ${appearance}`,
    );
    await page.keyboard.press("Escape");
    for (const command of [
      "Number scenes",
      "Scene and cast breakdown",
      "Adapt screenplay to VoxDown",
      "Compare with local Fountain file",
      "Rehearsal cue cards",
      "Practice Fountain step by step",
    ]) {
      await page.locator("#commands").click();
      await page.getByRole("searchbox", { name: "Find a command" }).fill(command);
      await page.keyboard.press("Enter");
      if (command === "Number scenes")
        await page.getByRole("button", { name: "Preview scene numbering", exact: true }).click();
      if (command === "Adapt screenplay to VoxDown")
        await page
          .getByRole("button", { name: "Download adapted .vxd", exact: true })
          .waitFor({ state: "visible" });
      await audit(`320px ${command}, ${appearance}`);
      record(
        await page.locator("dialog[open]").evaluate((d) => d.scrollWidth <= d.clientWidth),
        `320px ${command} overflow in ${appearance}`,
      );
      await page.keyboard.press("Escape");
    }
  }
  await page.setViewportSize({ width: 320, height: 256 });
  const shortViewport = await page.evaluate(() => ({
    editorHeight: document.querySelector(".cm-scroller").getBoundingClientRect().height,
    bodyOverflow: getComputedStyle(document.body).overflowY,
    pageOverflow: document.documentElement.scrollWidth > innerWidth,
  }));
  record(shortViewport.editorHeight >= 100, "400% zoom / short viewport collapses the editor");
  record(
    shortViewport.bodyOverflow !== "hidden",
    "Short viewport prevents scrolling to controls and editor",
  );
  record(!shortViewport.pageOverflow, "Short viewport causes horizontal page overflow");
  await audit("320×256px viewport (400% reflow equivalent)");
  assert.deepEqual(failures, [], `Accessibility regressions:\n${failures.join("\n")}`);
  console.log(
    "Studio accessibility: axe, labels, modal focus, skip link, reflow, reduced motion and mobile targets passed.",
  );
} finally {
  await browser.close();
  if (server) await new Promise((done) => server.close(done));
}
