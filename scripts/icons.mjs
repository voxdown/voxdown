// Draws the PNG icons from assets/icon.svg: node scripts/icons.mjs
//   packages/vscode/images/icon.png  256×256, the VS Code extension's icon
//   assets/avatar.png                512×512 and square to the edges, for the GitHub and npm organizations
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = join(import.meta.dirname, "..");
const icon = readFileSync(join(root, "assets", "icon.svg"), "utf8");
const square = icon.replace(/ rx="[^"]*"/, "");

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [svg, size, out] of [
  [icon, 256, "packages/vscode/images/icon.png"],
  [square, 512, "assets/avatar.png"],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: join(root, out), omitBackground: true });
  console.log(`${out}: ${size}×${size}`);
}
await browser.close();
