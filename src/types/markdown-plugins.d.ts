// These markdown-it plugins ship no type definitions of their own, and
// markdown-it v15 no longer exports Plugin* helper types.
declare module "markdown-it-footnote" {
  import type { MarkdownIt } from "markdown-it";
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}

declare module "markdown-it-task-lists" {
  import type { MarkdownIt } from "markdown-it";
  const plugin: (
    md: MarkdownIt,
    options?: { enabled?: boolean; label?: boolean; labelAfter?: boolean }
  ) => void;
  export default plugin;
}
