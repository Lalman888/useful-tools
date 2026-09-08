import MarkdownItFactory, { type MarkdownIt, type Token } from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js";
import katex from "katex";

export type Heading = { level: number; text: string; slug: string };

export type RenderedMarkdown = {
  html: string;
  headings: Heading[];
  /** Whether any math was rendered, so the caller can skip embedding math fonts. */
  hasMath: boolean;
  /** Title inferred from the first level-1 heading, if the user gave none. */
  inferredTitle: string | null;
};

/* ---------------------------------- math ---------------------------------- */

function renderMath(expression: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      output: "html",
      strict: false,
    });
  } catch {
    // A malformed expression should never take the whole document down.
    const escaped = expression.replace(/[&<>]/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"
    );
    return `<code class="math-error">${escaped}</code>`;
  }
}

/**
 * Adds `$inline$` and `$$block$$` math. Written as a small local plugin rather
 * than pulling in an unmaintained katex bridge package.
 */
function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("escape", "math_inline", (state, silent) => {
    const start = state.pos;
    if (state.src[start] !== "$") return false;
    if (state.src[start + 1] === "$") return false; // let the block rule take it

    // A lone "$" (e.g. a price) must not open math.
    const end = state.src.indexOf("$", start + 1);
    if (end === -1) return false;
    const content = state.src.slice(start + 1, end);
    if (!content.trim() || /^\s|\s$/.test(content)) return false;
    if (/\n/.test(content)) return false;

    if (!silent) {
      const token = state.push("math_inline", "", 0);
      token.content = content;
    }
    state.pos = end + 1;
    return true;
  });

  md.block.ruler.before("fence", "math_block", (state, startLine, endLine, silent) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    const maxPos = state.eMarks[startLine];
    if (state.src.slice(startPos, startPos + 2) !== "$$") return false;
    if (silent) return true;

    let line = startLine;
    let found = false;
    let content = state.src.slice(startPos + 2, maxPos);
    if (content.trim().endsWith("$$")) {
      content = content.trim().slice(0, -2);
      found = true;
    }
    while (!found && ++line < endLine) {
      const from = state.bMarks[line] + state.tShift[line];
      const to = state.eMarks[line];
      const text = state.src.slice(from, to);
      if (text.trim().endsWith("$$")) {
        content += "\n" + text.trim().slice(0, -2);
        found = true;
      } else {
        content += "\n" + text;
      }
    }
    if (!found) return false;

    const token = state.push("math_block", "", 0);
    token.content = content.trim();
    state.line = line + 1;
    return true;
  });

  md.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${renderMath(tokens[idx].content, true)}</div>`;
}

/* -------------------------------- page breaks ------------------------------ */

/**
 * Treats a lone `\pagebreak` or an `<!-- pagebreak -->` comment as a hard page
 * break in the PDF, which is the one layout control a long document really needs.
 */
function pageBreakPlugin(md: MarkdownIt): void {
  const BREAK_RE = /^(\\pagebreak|\\newpage|<!--\s*pagebreak\s*-->)\s*$/;
  md.block.ruler.before("paragraph", "page_break", (state, startLine, _endLine, silent) => {
    const from = state.bMarks[startLine] + state.tShift[startLine];
    const to = state.eMarks[startLine];
    if (!BREAK_RE.test(state.src.slice(from, to).trim())) return false;
    if (silent) return true;
    state.push("page_break", "", 0);
    state.line = startLine + 1;
    return true;
  });
  md.renderer.rules.page_break = () => '<div class="page-break"></div>\n';
}

/* --------------------------------- engine --------------------------------- */

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\wÀ-￿\- ]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

function createEngine(): MarkdownIt {
  const md = new MarkdownItFactory({
    // Inline HTML is allowed because real documents rely on it (<br>, <img>,
    // alignment wrappers). It is safe here because the PDF renderer loads the
    // page with JavaScript disabled and blocks every non-http(s)/data request,
    // so scripts and event handlers are inert and cannot reach local files.
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight(code, language) {
      if (language && hljs.getLanguage(language)) {
        try {
          return hljs.highlight(code, { language, ignoreIllegals: true }).value;
        } catch {
          /* fall through to auto-detection */
        }
      }
      try {
        return hljs.highlightAuto(code).value;
      } catch {
        return "";
      }
    },
  });

  md.use(footnote);
  md.use(taskLists, { label: true, labelAfter: true });
  md.use(mathPlugin);
  md.use(pageBreakPlugin);
  md.use(anchor, {
    level: [1, 2, 3, 4],
    slugify,
  });

  return md;
}

const engine = createEngine();

/** Pulls the heading outline out of the token stream so we can build a real TOC. */
function collectHeadings(tokens: Token[]): Heading[] {
  const headings: Heading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open") continue;
    const level = Number(token.tag.slice(1));
    if (level > 4) continue;
    const inline = tokens[i + 1];
    const text = inline?.content?.trim() ?? "";
    const idAttr = token.attrGet("id");
    const slug = idAttr === null ? slugify(text) : String(idAttr);
    if (text) headings.push({ level, text, slug });
  }
  return headings;
}

export function renderMarkdown(source: string): RenderedMarkdown {
  const env = {};
  const tokens = engine.parse(source, env);
  const html = engine.renderer.render(tokens, engine.options, env);
  const headings = collectHeadings(tokens);
  const inferredTitle = headings.find((h) => h.level === 1)?.text ?? null;
  return { html, headings, inferredTitle, hasMath: html.includes('class="katex') };
}
