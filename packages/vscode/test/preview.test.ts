import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, makeNonce, previewPage, renderView } from "../src/preview";

const page = (body = "<p>story</p>") =>
  previewPage({
    body,
    view: "script",
    cspSource: "https://example.vscode-cdn.net",
    nonce: "abc123",
    base: "https://example.vscode-cdn.net/stories/",
    light: false,
  });

describe("the preview", () => {
  it("renders the script view and the book view", () => {
    const text = "@Gerald (yawning) “I’m tired,” said the dragon. [snores]";
    const script = renderView(text, "script");
    const book = renderView(text, "book");
    expect(script).toContain("vxd-script");
    expect(script).toContain("yawning");
    expect(book).toContain("vxd-book");
    expect(book).not.toContain("yawning");
  });

  it("escapes what the story says", () => {
    const html = renderView(
      "@Gerald “<script>alert(1)</script>” <img src=x onerror=alert(1)>",
      "script",
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("allows one script, with the page's nonce, and nothing else to load but images", () => {
    const policy = contentSecurityPolicy("https://example.vscode-cdn.net", "abc123");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'nonce-abc123'");
    expect(policy).toMatch(/style-src https:\/\/example\.vscode-cdn\.net 'unsafe-inline'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    const html = page();
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script nonce="abc123">');
    expect(html).toContain(`content="${policy.replaceAll("'", "&#39;")}"`);
  });

  it("puts the story between the view switch and the script", () => {
    const html = page("<article>tale</article>");
    expect(html.indexOf('data-view="script" aria-pressed="true"')).toBeGreaterThan(0);
    expect(html).toContain('data-view="book" aria-pressed="false"');
    expect(html).toContain('<main id="story" data-vxd-theme="dark">\n<article>tale</article>');
    expect(html).toContain('<base href="https://example.vscode-cdn.net/stories/">');
  });

  it("makes nonces of 32 letters and digits", () => {
    let next = 0;
    const nonce = makeNonce((bytes) => bytes.map(() => next++));
    expect(nonce).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(nonce.startsWith("ABC")).toBe(true);
  });
});
