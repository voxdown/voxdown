// Screenshots a page for review: node scripts/screenshot.mjs <url> <out.png> [width] [height] [--full] [--dark]
import { chromium } from "playwright";

const [url, out, width = "1280", height = "900", ...flags] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node scripts/screenshot.mjs <url> <out.png> [width] [height] [--full] [--dark]");
  process.exit(1);
}
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
  colorScheme: flags.includes("--dark") ? "dark" : "light",
  deviceScaleFactor: 1,
});
await page.goto(url, { waitUntil: "networkidle" });
await page.screenshot({ path: out, fullPage: flags.includes("--full") });
await browser.close();
