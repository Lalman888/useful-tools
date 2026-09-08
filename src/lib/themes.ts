export type ThemeId = "report" | "modern" | "academic" | "technical";

export type ThemeInfo = {
  id: ThemeId;
  name: string;
  description: string;
  accent: string;
};

export const THEMES: ThemeInfo[] = [
  {
    id: "report",
    name: "Report",
    description:
      "Serif body with sans headings and numbered sections. The default for business and consulting documents.",
    accent: "#1f4e79",
  },
  {
    id: "modern",
    name: "Modern",
    description:
      "All-sans, generous whitespace, hairline rules. Reads well for product docs, briefs and proposals.",
    accent: "#0f766e",
  },
  {
    id: "academic",
    name: "Academic",
    description:
      "Justified serif with hyphenation and formal section numbering. For papers and long-form research.",
    accent: "#7c2d12",
  },
  {
    id: "technical",
    name: "Technical",
    description:
      "Compact sans with emphasised code, dense tables and tight leading. Built for engineering documentation.",
    accent: "#4338ca",
  },
];

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

/** Metric-compatible stacks chosen from fonts that ship with common Linux images. */
const SERIF = `"Charter", "Bitstream Charter", "Liberation Serif", "Times New Roman", "DejaVu Serif", Georgia, serif`;
const SANS = `"Inter", "Liberation Sans", "Helvetica Neue", Helvetica, "DejaVu Sans", Arial, sans-serif`;
const MONO = `"JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono", "SFMono-Regular", Consolas, monospace`;

export type ThemeOptions = {
  accent: string;
  baseFontSize: number;
  numberHeadings: boolean;
  justify: boolean;
};

/** Shared print scaffolding: pagination behaviour, tables, code, figures. */
function baseCss(options: ThemeOptions): string {
  return `
:root {
  --accent: ${options.accent};
  --ink: #14181f;
  --muted: #5b6472;
  --hairline: #dfe3e8;
  --surface: #f6f8fa;
}

* { box-sizing: border-box; }

html {
  font-size: ${options.baseFontSize}pt;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

body {
  margin: 0;
  color: var(--ink);
  line-height: 1.62;
  font-kerning: normal;
  font-variant-ligatures: common-ligatures;
  text-rendering: optimizeLegibility;
}

/* --- pagination -------------------------------------------------------- */

p, li, blockquote { orphans: 3; widows: 3; }

h1, h2, h3, h4, h5, h6 {
  break-after: avoid-page;
  break-inside: avoid-page;
  margin-top: 1.6em;
  margin-bottom: 0.5em;
  line-height: 1.25;
}
h1 { margin-top: 0; }

/* Keep a heading welded to the paragraph beneath it. */
h1 + *, h2 + *, h3 + *, h4 + * { break-before: avoid-page; }

figure, pre, table, blockquote { break-inside: avoid; }
tr, img { break-inside: avoid; }
thead { display: table-header-group; }
tfoot { display: table-footer-group; }

.page-break { break-after: page; height: 0; }

/* --- body copy --------------------------------------------------------- */

p { margin: 0 0 0.85em; }

a {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 0.5pt solid color-mix(in srgb, var(--accent) 35%, transparent);
}

strong { font-weight: 650; }

ul, ol { margin: 0 0 0.9em; padding-left: 1.5em; }
li { margin-bottom: 0.3em; }
li > ul, li > ol { margin-top: 0.3em; margin-bottom: 0.2em; }

/* Task lists read as checkboxes, not bullets. */
.contains-task-list { list-style: none; padding-left: 1.1em; }
.task-list-item { position: relative; }
.task-list-item input { margin-right: 0.5em; }

blockquote {
  margin: 1.2em 0;
  padding: 0.15em 0 0.15em 1.1em;
  border-left: 2.5pt solid var(--accent);
  color: var(--muted);
}
blockquote p:last-child { margin-bottom: 0; }

hr {
  border: 0;
  border-top: 0.75pt solid var(--hairline);
  margin: 2em 0;
}

/* --- tables ------------------------------------------------------------ */

table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.3em 0;
  font-size: 0.92em;
}
th, td {
  padding: 0.5em 0.7em;
  text-align: left;
  vertical-align: top;
  border-bottom: 0.5pt solid var(--hairline);
}
thead th {
  border-bottom: 1pt solid var(--accent);
  font-weight: 650;
  white-space: nowrap;
}
tbody tr:nth-child(even) { background: color-mix(in srgb, var(--surface) 70%, transparent); }

/* --- code -------------------------------------------------------------- */

code, kbd, samp {
  font-family: ${MONO};
  font-size: 0.86em;
}

:not(pre) > code {
  background: var(--surface);
  border: 0.5pt solid var(--hairline);
  border-radius: 3pt;
  padding: 0.08em 0.32em;
}

pre {
  background: var(--surface);
  border: 0.5pt solid var(--hairline);
  border-radius: 4pt;
  padding: 0.85em 1em;
  margin: 1.2em 0;
  overflow: visible;
  white-space: pre-wrap;   /* long lines wrap instead of being clipped by the page */
  word-wrap: break-word;
  line-height: 1.5;
}
pre code {
  background: none;
  border: 0;
  padding: 0;
  font-size: 0.82em;
}

/* --- media ------------------------------------------------------------- */

img { max-width: 100%; height: auto; display: block; margin: 1.2em auto; }
figure { margin: 1.4em 0; }
figcaption {
  font-size: 0.85em;
  color: var(--muted);
  text-align: center;
  margin-top: 0.5em;
}

/* --- math -------------------------------------------------------------- */

.math-block { margin: 1.2em 0; text-align: center; break-inside: avoid; }
.math-error { color: #b91c1c; }

/* --- footnotes --------------------------------------------------------- */

.footnotes {
  margin-top: 2.5em;
  padding-top: 1em;
  border-top: 0.5pt solid var(--hairline);
  font-size: 0.85em;
  color: var(--muted);
}
.footnotes ol { padding-left: 1.2em; }
.footnote-backref { border: 0; }

/* --- cover ------------------------------------------------------------- */

.cover {
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  padding: 0;
}
.cover-rule {
  width: 68pt;
  height: 4pt;
  background: var(--accent);
  margin-bottom: 2em;
}
.cover-title {
  font-size: 2.9em;
  line-height: 1.12;
  margin: 0 0 0.35em;
  letter-spacing: -0.015em;
}
.cover-subtitle {
  font-size: 1.25em;
  color: var(--muted);
  font-weight: 400;
  margin: 0 0 2.5em;
  line-height: 1.4;
}
.cover-meta {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 2.5em;
  padding-top: 1em;
  border-top: 0.5pt solid var(--hairline);
  font-size: 0.9em;
}
.cover-meta div { display: flex; flex-direction: column; gap: 0.25em; }
.cover-meta dt {
  font-size: 0.72em;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--muted);
  font-weight: 600;
}
.cover-meta dd { margin: 0; font-weight: 500; }

/* --- table of contents -------------------------------------------------- */

.toc { break-after: page; }
.toc h2 {
  margin-top: 0;
  font-size: 1.4em;
  padding-bottom: 0.4em;
  border-bottom: 1pt solid var(--accent);
}
.toc ol { list-style: none; padding: 0; margin: 1.2em 0 0; counter-reset: none; }
.toc li { margin: 0; }
.toc a {
  display: flex;
  align-items: baseline;
  gap: 0.5em;
  border: 0;
  color: var(--ink);
  text-decoration: none;
  padding: 0.34em 0;
}
/* Leader dots between the entry and its page number. */
.toc .toc-text { flex: 0 1 auto; }
.toc .toc-dots {
  flex: 1 1 auto;
  margin: 0 0.55em;
  border-bottom: 0.75pt dotted color-mix(in srgb, var(--muted) 45%, transparent);
  transform: translateY(-0.3em);
  min-width: 1.5em;
}
.toc .toc-page { flex: 0 0 auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.toc .toc-l1 > a { font-weight: 620; padding-top: 0.7em; }
.toc .toc-l2 > a { padding-left: 1.2em; }
.toc .toc-l3 > a { padding-left: 2.4em; font-size: 0.94em; color: var(--muted); }
.toc .toc-l4 > a { padding-left: 3.6em; font-size: 0.9em; color: var(--muted); }
`;
}

/** Automatic 1. / 1.1 / 1.1.1 numbering, opt-in per document. */
function numberingCss(): string {
  return `
.doc { counter-reset: h2 h3 h4; }
.doc h2 { counter-increment: h2; counter-reset: h3 h4; }
.doc h3 { counter-increment: h3; counter-reset: h4; }
.doc h4 { counter-increment: h4; }
.doc h2::before { content: counter(h2) ".\\00a0\\00a0"; color: var(--accent); }
.doc h3::before { content: counter(h2) "." counter(h3) ".\\00a0\\00a0"; color: var(--accent); }
.doc h4::before { content: counter(h2) "." counter(h3) "." counter(h4) ".\\00a0\\00a0"; color: var(--accent); }
`;
}

const THEME_CSS: Record<ThemeId, string> = {
  report: `
body { font-family: ${SERIF}; }
h1, h2, h3, h4, h5, h6, .cover-title, .toc h2 { font-family: ${SANS}; font-weight: 650; letter-spacing: -0.011em; }
h1 { font-size: 1.95em; }
h2 { font-size: 1.42em; padding-bottom: 0.28em; border-bottom: 0.75pt solid var(--hairline); }
h3 { font-size: 1.14em; }
h4 { font-size: 1em; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.86em; }
.cover-subtitle { font-family: ${SERIF}; font-style: italic; }
`,
  modern: `
body { font-family: ${SANS}; }
h1, h2, h3, h4, h5, h6, .cover-title, .toc h2 { font-family: ${SANS}; font-weight: 680; letter-spacing: -0.02em; }
h1 { font-size: 2em; }
h1::after {
  content: "";
  display: block;
  width: 42pt;
  height: 3pt;
  background: var(--accent);
  margin-top: 0.45em;
}
h2 { font-size: 1.38em; }
h3 { font-size: 1.1em; }
h4 { font-size: 0.95em; color: var(--muted); }
blockquote {
  border-left: 0;
  background: var(--surface);
  border-radius: 4pt;
  padding: 0.9em 1.1em;
}
th, td { padding: 0.55em 0.75em; }
thead th { background: var(--surface); border-bottom: 0.75pt solid var(--hairline); }
tbody tr:nth-child(even) { background: transparent; }
`,
  academic: `
body { font-family: ${SERIF}; line-height: 1.55; }
h1, h2, h3, h4, h5, h6, .cover-title, .toc h2 { font-family: ${SERIF}; font-weight: 700; }
h1 { font-size: 1.8em; text-align: center; }
h2 { font-size: 1.28em; }
h3 { font-size: 1.08em; }
h4 { font-size: 1em; font-style: italic; font-weight: 600; }
.doc p { text-indent: 0; }
/* Indent successive paragraphs the way a typeset paper does. */
.doc p + p { text-indent: 1.4em; margin-top: -0.85em; }
.cover-title { text-align: left; }
table { font-size: 0.88em; }
`,
  technical: `
body { font-family: ${SANS}; line-height: 1.55; }
h1, h2, h3, h4, h5, h6, .cover-title, .toc h2 { font-family: ${SANS}; font-weight: 660; letter-spacing: -0.015em; }
h1 { font-size: 1.85em; }
h2 { font-size: 1.3em; padding-bottom: 0.25em; border-bottom: 0.75pt solid var(--hairline); }
h3 { font-size: 1.06em; }
h4 { font-size: 0.94em; font-family: ${MONO}; color: var(--accent); }
:not(pre) > code { color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, white); border-color: color-mix(in srgb, var(--accent) 18%, transparent); }
pre { background: #1e232b; border-color: #1e232b; color: #e6edf3; }
table { font-size: 0.86em; }
th, td { padding: 0.4em 0.6em; }
`,
};

export function buildThemeCss(theme: ThemeId, options: ThemeOptions): string {
  return [
    baseCss(options),
    THEME_CSS[theme],
    options.numberHeadings ? numberingCss() : "",
    options.justify ? `.doc p { text-align: justify; hyphens: auto; }` : "",
  ].join("\n");
}
