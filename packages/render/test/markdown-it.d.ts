/** The little of markdown-it the tests use: it ships no types of its own. */
declare module "markdown-it" {
  export default class MarkdownIt {
    constructor(preset?: "commonmark" | "default" | "zero");
    renderInline(source: string): string;
  }
}
