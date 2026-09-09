import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, Page } from "puppeteer-core";
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFDict } from "pdf-lib";
import { diagramPlaceholder, renderMarkdown, type Heading } from "./markdown";
import { renderDiagrams } from "./mermaidRender";
import { DEFAULT_PDF_OPTIONS, type MermaidTheme, type PdfOptions, type PaperSize } from "./pdfTypes";

export { DEFAULT_PDF_OPTIONS };
export type { PdfOptions, PaperSize, MermaidTheme };
import { buildThemeCss, highlightStyleFor, type ThemeId } from "./themes";
import { findPackageAsset, readPackageAsset } from "./packageAssets";

/* ------------------------------ browser setup ----------------------------- */

const CANDIDATE_PATHS = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH
    ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium")
    : undefined,
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((p): p is string => Boolean(p));

/**
 * Chrome installed by `@puppeteer/browsers` rather than by the system package
 * manager, as on a host with no Chromium on its image. It lands in a directory
 * named after its exact version, so the path cannot be written down by hand
 * without breaking at the next Chrome release — find the newest build instead.
 */
function downloadedChromeCandidates(): string[] {
  const cache =
    process.env.PUPPETEER_CACHE_DIR ?? path.join(os.homedir(), ".cache", "puppeteer");

  // Relative to a version directory. The headless shell is a smaller build with
  // fewer shared-library dependencies, and prints PDFs just as well.
  const layouts: Array<[browser: string, executable: string]> = [
    ["chrome-headless-shell", "chrome-headless-shell-linux64/chrome-headless-shell"],
    ["chrome", "chrome-linux64/chrome"],
    ["chrome", "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
    ["chrome", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
  ];

  const found: Array<{ version: number[]; executable: string }> = [];
  for (const [browser, executable] of layouts) {
    let versions: string[];
    try {
      versions = fs.readdirSync(/* turbopackIgnore: true */ path.join(cache, browser));
    } catch {
      continue; // no such browser in the cache
    }
    for (const version of versions) {
      found.push({
        // "linux-140.0.7339.16" sorts as a string in the wrong order once the
        // major number gains a digit, so compare the numbers themselves.
        version: (version.split("-").pop() ?? "").split(".").map(Number),
        executable: path.join(cache, browser, version, executable),
      });
    }
  }

  found.sort((a, b) => {
    for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
      const difference = (b.version[i] ?? 0) - (a.version[i] ?? 0);
      if (difference) return difference;
    }
    return 0;
  });
  return found.map((build) => build.executable);
}

function findChrome(): string {
  for (const candidate of [...CANDIDATE_PATHS, ...downloadedChromeCandidates()]) {
    try {
      if (fs.statSync(/* turbopackIgnore: true */ candidate).isFile()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    "No Chromium executable found. Install Chrome/Chromium and set CHROME_PATH to its " +
      "location, or run `npx @puppeteer/browsers install chrome-headless-shell@stable` " +
      "and set PUPPETEER_CACHE_DIR to where it was written."
  );
}

/**
 * True on Vercel, Lambda and similar. There is no Chrome on the image, and the
 * only writable directory is /tmp, so the browser has to be supplied by a
 * package that unpacks itself there.
 */
function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.FUNCTION_TARGET
  );
}

type LaunchConfig = { executablePath: string; args: string[] };

/**
 * The serverless Chromium build ships only Open Sans, so a serif theme would
 * silently print in sans and code in a proportional face. Point fontconfig at
 * a directory we control and fill it with the bundled Liberation faces.
 *
 * This deliberately does not rely on the Chromium package's own font handling,
 * which only runs under a real Lambda and gave no way to add faces to it.
 */
function prepareFonts(): void {
  const fontDir = path.join(os.tmpdir(), "useful-tools-fonts");
  try {
    fs.mkdirSync(fontDir, { recursive: true });

    const source = path.join(process.cwd(), "assets", "fonts");
    let installed = 0;
    for (const file of fs.readdirSync(source)) {
      if (!file.endsWith(".ttf")) continue;
      const destination = path.join(fontDir, file);
      if (!fs.existsSync(destination)) fs.copyFileSync(path.join(source, file), destination);
      installed++;
    }

    // fontconfig reads its configuration from FONTCONFIG_PATH/fonts.conf, so the
    // file has to name every directory worth scanning, ours included.
    fs.writeFileSync(
      path.join(fontDir, "fonts.conf"),
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDir}</dir>
  <dir>${path.join(os.tmpdir(), "fonts")}</dir>
  <dir>/var/task/fonts</dir>
  <cachedir>${path.join(os.tmpdir(), "fonts-cache")}</cachedir>
</fontconfig>
`
    );

    // Set before the Chromium package runs: it only fills this in if unset.
    process.env.FONTCONFIG_PATH = fontDir;
    if (installed === 0) console.warn("[pdf] no bundled fonts found in assets/fonts");
  } catch (error) {
    // Not fatal: Chromium falls back to whatever it can find.
    console.warn("[pdf] could not prepare fonts", error);
  }
}

async function launchConfig(): Promise<LaunchConfig> {
  if (isServerless()) {
    prepareFonts();
    const chromium = (await import("@sparticuz/chromium")).default;
    return {
      executablePath: await chromium.executablePath(),
      args: chromium.args,
    };
  }
  return {
    executablePath: findChrome(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none", // consistent glyph metrics in PDF output
    ],
  };
}

let browserPromise: Promise<Browser> | null = null;

/**
 * One long-lived browser shared by every render. Launching Chromium costs
 * several hundred milliseconds, which would otherwise be paid on every export.
 * On serverless the process is short-lived anyway, so this amounts to one
 * launch per warm instance.
 */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = await import("puppeteer-core");
      const config = await launchConfig();
      const browser = await puppeteer.launch({
        executablePath: config.executablePath,
        args: config.args,
        headless: true,
      });
      // If Chromium dies, drop the handle so the next render relaunches.
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    })().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (pending) {
    const browser = await pending.catch(() => null);
    await browser?.close().catch(() => undefined);
  }
}

/* ------------------------------ vendored CSS ------------------------------ */

const highlightCssCache = new Map<string, string>();
let katexCssCache: string | null = null;

function highlightCss(theme: ThemeId): string {
  const asset = highlightStyleFor(theme);
  let css = highlightCssCache.get(asset);
  if (css === undefined) {
    css = readPackageAsset(asset);
    highlightCssCache.set(asset, css);
  }
  return css;
}

/**
 * KaTeX positions glyphs using the metrics of its own fonts, so without them
 * the layout of a formula collapses. Inline the woff2 faces as data URIs: the
 * renderer is not allowed to fetch anything, and this keeps exports identical
 * on machines with no network and no maths fonts installed.
 */
function katexCss(): string {
  if (katexCssCache !== null) return katexCssCache;

  const cssPath = findPackageAsset("katex/dist/katex.min.css");
  if (!cssPath) {
    katexCssCache = readPackageAsset("katex/dist/katex.min.css"); // logs the warning
    return katexCssCache;
  }

  const css = fs.readFileSync(/* turbopackIgnore: true */ cssPath, "utf8");
  const fontsDir = path.join(path.dirname(cssPath), "fonts");

  // Each @font-face lists woff2, woff and ttf. Keep only the woff2, inlined.
  // The stylesheet is minified, so a declaration ends at "}" with no semicolon.
  katexCssCache = css.replace(/src:[^;}]+/g, (declaration) => {
    const match = declaration.match(/url\(fonts\/([\w-]+\.woff2)\)/);
    if (!match) return declaration;
    try {
      const fontPath = path.join(/* turbopackIgnore: true */ fontsDir, match[1]);
      const data = fs.readFileSync(/* turbopackIgnore: true */ fontPath).toString("base64");
      return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
    } catch {
      return declaration;
    }
  });
  return katexCssCache;
}

/* -------------------------------- documents ------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tocHtml(headings: Heading[], pages: Map<string, number> | null): string {
  if (headings.length === 0) return "";
  const items = headings
    .map((heading) => {
      const page = pages?.get(heading.slug);
      return `<li class="toc-l${heading.level}"><a href="#${heading.slug}" data-slug="${heading.slug}"><span class="toc-text">${escapeHtml(
        heading.text
      )}</span><span class="toc-dots"></span><span class="toc-page">${
        page ?? ""
      }</span></a></li>`;
    })
    .join("\n");
  return `<nav class="toc"><h2>Contents</h2><ol>${items}</ol></nav>`;
}

function coverHtml(options: PdfOptions, fallbackTitle: string | null): string {
  const title = options.title || fallbackTitle || "Untitled document";
  const meta: Array<[string, string]> = [];
  if (options.author) meta.push(["Author", options.author]);
  if (options.dateLabel) meta.push(["Date", options.dateLabel]);
  const metaHtml = meta.length
    ? `<dl class="cover-meta">${meta
        .map(
          ([label, value]) =>
            `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
        )
        .join("")}</dl>`
    : "";
  const logo = options.logo
    ? `<img class="cover-logo" src="${escapeHtml(options.logo)}" alt="" style="width:${options.logoWidth}mm">`
    : "";

  return `<section class="cover">
  ${logo}
  <div class="cover-rule"></div>
  <h1 class="cover-title">${escapeHtml(title)}</h1>
  ${options.subtitle ? `<p class="cover-subtitle">${escapeHtml(options.subtitle)}</p>` : ""}
  ${metaHtml}
</section>`;
}

function documentShell(
  options: PdfOptions,
  bodyHtml: string,
  needsMath: boolean,
  extraCss = ""
): string {
  const css = buildThemeCss(options.theme, {
    accent: options.accent,
    baseFontSize: options.baseFontSize,
    numberHeadings: options.numberHeadings,
    justify: options.justify,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.title || "Document")}</title>
<style>${highlightCss(options.theme)}</style>
${needsMath ? `<style>${katexCss()}</style>` : ""}
<style>${css}</style>
${extraCss ? `<style>${extraCss}</style>` : ""}
</head>
<body>${bodyHtml}</body>
</html>`;
}

/** Swaps each diagram placeholder for the SVG rendered from its source. */
function insertDiagrams(html: string, rendered: string[]): string {
  let result = html;
  rendered.forEach((svg, index) => {
    result = result.replace(diagramPlaceholder(index), svg);
  });
  return result;
}

/* --------------------------------- preview -------------------------------- */

/**
 * Splits the document into the same pieces the PDF is built from and wraps
 * them in page-shaped sheets. The preview shares the theme stylesheet with the
 * exporter, so what the editor shows is what the PDF prints — apart from
 * pagination, which only Chromium's print layout can decide.
 */
export type PreviewLayout = "page" | "reading";

export async function renderPreviewDocument(
  options: PdfOptions,
  layout: PreviewLayout = "page"
): Promise<string> {
  const rendered = renderMarkdown(options.markdown);
  // Only drop the opening heading when the cover is actually using it. With an
  // explicit title — or several files, where the first heading is chapter one
  // rather than the document title — removing it loses a real section.
  const dropTitle =
    options.includeCover && options.dropFirstHeading && options.title.trim() === "";
  const firstH1 = rendered.headings.find((heading) => heading.level === 1);
  const withoutTitle = dropTitle
    ? rendered.html.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/, "")
    : rendered.html;

  // Diagrams are cached by source, so an unchanged one costs nothing on the
  // next keystroke.
  const contentHtml =
    rendered.diagrams.length > 0
      ? insertDiagrams(
          withoutTitle,
          await renderDiagrams(await getBrowser(), rendered.diagrams, options.mermaidTheme)
        )
      : withoutTitle;

  const tocHeadings = rendered.headings.filter((heading) => {
    if (heading.level > options.tocDepth) return false;
    if (dropTitle && heading === firstH1) return false;
    return true;
  });

  const size = PAPER_SIZES[options.paper];

  // "page" simulates sheets of paper, so the editor shows what will print.
  // "reading" drops the paper entirely for someone who just wants to read the
  // document on screen.
  const previewCss =
    layout === "reading"
      ? `
html { background: #fff; }
body { padding: 0; }
.reading {
  max-width: 44rem;
  margin: 0 auto;
  padding: 3rem 1.5rem 6rem;
}
/* A page break has no meaning outside paper; mark it as a section divider. */
.page-break {
  height: 0;
  border-top: 1px dashed #cbd5e1;
  margin: 2.5em 0;
}
.toc { break-after: auto; }
`
      : `
html { background: #eceff3; }
body { padding: 20px 16px 40px; }
.sheet {
  width: ${size.width};
  min-height: 120mm;
  margin: 0 auto 20px;
  padding: ${options.margin}mm;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12), 0 8px 24px rgba(15, 23, 42, 0.08);
  border-radius: 2px;
}
.sheet--cover { min-height: ${size.height}; display: flex; flex-direction: column; }
.sheet--cover .cover { flex: 1; }
/* Page breaks mean nothing in a continuous preview; show them as a rule. */
.page-break {
  height: 0;
  border-top: 1px dashed #cbd5e1;
  margin: 1.6em 0;
}
.toc { break-after: auto; }
`;

  const inner = `${options.includeToc ? tocHtml(tocHeadings, null) : ""}<main class="doc">${contentHtml}</main>`;

  const body =
    layout === "reading"
      ? `${
          options.includeCover
            ? `<div class="reading">${coverHtml(options, rendered.inferredTitle)}</div>`
            : ""
        }<div class="reading">${inner}</div>`
      : [
          options.includeCover
            ? `<div class="sheet sheet--cover">${coverHtml(options, rendered.inferredTitle)}</div>`
            : "",
          `<div class="sheet">${inner}</div>`,
        ].join("");

  return documentShell(options, body, rendered.hasMath, previewCss);
}

/* -------------------------------- rendering ------------------------------- */

const PAPER_SIZES: Record<PaperSize, { width: string; height: string }> = {
  A4: { width: "210mm", height: "297mm" },
  Letter: { width: "8.5in", height: "11in" },
  Legal: { width: "8.5in", height: "14in" },
  A3: { width: "297mm", height: "420mm" },
};

/**
 * Loads HTML into a locked-down page: no JavaScript, and every request that
 * is not the document itself or an inline data URI is blocked. That stops a
 * pasted document from reaching the filesystem or an internal network host.
 */
async function loadPage(browser: Browser, html: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      void request.continue();
      return;
    }
    if (url.startsWith("data:") || url.startsWith("https://") || url.startsWith("http://")) {
      void request.continue();
      return;
    }
    void request.abort();
  });
  await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
  await page.emulateMediaType("print");
  return page;
}

function chromeFooter(options: PdfOptions): string {
  const style =
    "font-family: -apple-system, 'Liberation Sans', Arial, sans-serif; font-size: 8pt; color: #6b7280; width: 100%; padding: 0 14mm; display: flex; justify-content: space-between; align-items: center;";
  const left = options.footerText ? escapeHtml(options.footerText) : "";
  const right = options.pageNumbers
    ? '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>'
    : "";
  return `<div style="${style}"><span>${left}</span>${right}</div>`;
}

function chromeHeader(options: PdfOptions): string {
  const style =
    "font-family: -apple-system, 'Liberation Sans', Arial, sans-serif; font-size: 8pt; color: #9ca3af; width: 100%; padding: 0 14mm; display: flex; align-items: center; justify-content: space-between;";
  const mark =
    options.logoInHeader && options.logo
      ? `<img src="${escapeHtml(options.logo)}" alt="" style="height: 6mm; opacity: 0.75;">`
      : "<span></span>";
  return `<div style="${style}">${mark}<span>${escapeHtml(options.headerText)}</span></div>`;
}

async function printPdf(
  page: Page,
  options: PdfOptions,
  withChrome: boolean
): Promise<Uint8Array> {
  const size = PAPER_SIZES[options.paper];
  const showChrome =
    withChrome &&
    Boolean(
      options.headerText ||
        options.footerText ||
        options.pageNumbers ||
        (options.logoInHeader && options.logo)
    );
  const verticalMargin = showChrome
    ? `${Math.max(options.margin, 16)}mm`
    : `${options.margin}mm`;

  return page.pdf({
    width: size.width,
    height: size.height,
    printBackground: true,
    displayHeaderFooter: showChrome,
    headerTemplate: showChrome ? chromeHeader(options) : "<span></span>",
    footerTemplate: showChrome ? chromeFooter(options) : "<span></span>",
    margin: {
      top: verticalMargin,
      bottom: verticalMargin,
      left: `${options.margin}mm`,
      right: `${options.margin}mm`,
    },
    preferCSSPageSize: false,
  });
}

/* --------------------------- named destinations ---------------------------- */

type Destination = { page: number; x: number | null; y: number | null; z: number | null };

function numberOrNull(value: unknown): number | null {
  const asNumber = (value as { asNumber?: () => number })?.asNumber;
  if (typeof asNumber === "function") {
    const n = asNumber.call(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Chromium records every `id` in the document as a named destination in the
 * catalogue's `/Dests` dictionary, each pointing at a page and a position.
 * Reading that map tells us exactly which printed page a heading landed on —
 * true page numbers for the contents list rather than an estimate.
 */
async function readDestinations(pdfBytes: Uint8Array): Promise<Map<string, Destination>> {
  const result = new Map<string, Destination>();
  try {
    const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    const dests = pdf.context.lookup(pdf.catalog.get(PDFName.of("Dests")));
    if (!(dests instanceof PDFDict)) return result;

    const pageNumberByRef = new Map<string, number>();
    pdf.getPages().forEach((page, index) => pageNumberByRef.set(page.ref.toString(), index + 1));

    for (const key of dests.keys()) {
      const value = pdf.context.lookup(dests.get(key));
      // A destination is either the array itself or a dictionary wrapping it in /D.
      const array =
        value instanceof PDFArray
          ? value
          : value instanceof PDFDict
            ? pdf.context.lookup(value.get(PDFName.of("D")))
            : null;
      if (!(array instanceof PDFArray) || array.size() === 0) continue;

      const target = array.get(0);
      if (!(target instanceof PDFRef)) continue;
      const page = pageNumberByRef.get(target.toString());
      if (!page) continue;

      // Keys arrive as PDF names, i.e. "/my-heading".
      const name = String(key).replace(/^\//, "");
      result.set(name, {
        page,
        x: array.size() > 2 ? numberOrNull(array.get(2)) : null,
        y: array.size() > 3 ? numberOrNull(array.get(3)) : null,
        z: array.size() > 4 ? numberOrNull(array.get(4)) : null,
      });
    }
  } catch {
    /* an unreadable destination table only costs us page numbers */
  }
  return result;
}

/**
 * `copyPages` carries link annotations across but not the catalogue's `/Dests`
 * table, which would leave every internal link pointing at a name that no
 * longer resolves. Rewrite each one as an explicit page reference instead.
 */
function relinkDestinations(
  merged: PDFDocument,
  destinations: Map<string, Destination>,
  pageOffset: number
): void {
  const pages = merged.getPages();
  for (const page of pages) {
    const annots = merged.context.lookup(page.node.get(PDFName.of("Annots")));
    if (!(annots instanceof PDFArray)) continue;

    for (let i = 0; i < annots.size(); i++) {
      const annot = merged.context.lookup(annots.get(i));
      if (!(annot instanceof PDFDict)) continue;
      const dest = annot.get(PDFName.of("Dest"));
      if (!(dest instanceof PDFName)) continue;

      const name = dest.asString().replace(/^\//, "");
      const target = destinations.get(name);
      if (!target) continue;

      const targetPage = pages[pageOffset + target.page - 1];
      if (!targetPage) continue;

      annot.set(
        PDFName.of("Dest"),
        merged.context.obj([targetPage.ref, PDFName.of("XYZ"), target.x, target.y, target.z])
      );
    }
  }
}

/* ---------------------------------- entry --------------------------------- */

export type PdfResult = {
  bytes: Uint8Array;
  pageCount: number;
  title: string;
};

export async function markdownToPdf(options: PdfOptions): Promise<PdfResult> {
  const rendered = renderMarkdown(options.markdown);
  const { headings, inferredTitle, hasMath } = rendered;
  const browser = await getBrowser();
  const title = options.title || inferredTitle || "Document";

  // With a cover page the opening H1 is the document title twice over, so it
  // is dropped from the body along with its entry in the contents.
  // Only drop the opening heading when the cover is actually using it. With an
  // explicit title — or several files, where the first heading is chapter one
  // rather than the document title — removing it loses a real section.
  const dropTitle =
    options.includeCover && options.dropFirstHeading && options.title.trim() === "";
  const firstH1 = headings.find((heading) => heading.level === 1);
  const withoutTitle = dropTitle
    ? rendered.html.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/, "")
    : rendered.html;
  const contentHtml =
    rendered.diagrams.length > 0
      ? insertDiagrams(
          withoutTitle,
          await renderDiagrams(browser, rendered.diagrams, options.mermaidTheme)
        )
      : withoutTitle;

  const tocHeadings = headings.filter((heading) => {
    if (heading.level > options.tocDepth) return false;
    if (dropTitle && heading === firstH1) return false;
    return true;
  });

  const buildBody = (pages: Map<string, number> | null): string =>
    `${options.includeToc ? tocHtml(tocHeadings, pages) : ""}<main class="doc">${contentHtml}</main>`;

  const renderBody = async (pages: Map<string, number> | null): Promise<Uint8Array> => {
    const page = await loadPage(
      browser,
      documentShell(options, buildBody(pages), hasMath)
    );
    try {
      return await printPdf(page, options, true);
    } finally {
      await page.close();
    }
  };

  let bodyBytes = await renderBody(null);
  let destinations = await readDestinations(bodyBytes);

  // Second pass: now that we know which page each heading landed on, redraw the
  // contents list with real page numbers. The numbers sit in a fixed right-hand
  // column with tabular figures, so adding them cannot change pagination.
  if (options.includeToc && tocHeadings.length > 0) {
    const pageNumbers = new Map<string, number>();
    for (const heading of tocHeadings) {
      const destination = destinations.get(heading.slug);
      if (destination) pageNumbers.set(heading.slug, destination.page);
    }
    if (pageNumbers.size > 0) {
      bodyBytes = await renderBody(pageNumbers);
      destinations = await readDestinations(bodyBytes);
    }
  }

  let finalDoc: PDFDocument;
  if (options.includeCover) {
    // The cover is printed separately so it carries no header, footer or page
    // number, then merged in front — the way a bound report is put together.
    const coverPage = await loadPage(
      browser,
      documentShell(options, coverHtml(options, inferredTitle), false)
    );
    let coverBytes: Uint8Array;
    try {
      coverBytes = await printPdf(coverPage, options, false);
    } finally {
      await coverPage.close();
    }

    finalDoc = await PDFDocument.create();
    const coverDoc = await PDFDocument.load(coverBytes);
    const bodyDoc = await PDFDocument.load(bodyBytes);
    // A cover is one page by definition; drop anything that overflowed onto a second.
    const copiedCover = await finalDoc.copyPages(coverDoc, [0]);
    copiedCover.forEach((page) => finalDoc.addPage(page));
    const copiedBody = await finalDoc.copyPages(bodyDoc, bodyDoc.getPageIndices());
    copiedBody.forEach((page) => finalDoc.addPage(page));
    relinkDestinations(finalDoc, destinations, copiedCover.length);
  } else {
    finalDoc = await PDFDocument.load(bodyBytes, { updateMetadata: false });
  }

  finalDoc.setTitle(title);
  if (options.author) finalDoc.setAuthor(options.author);
  finalDoc.setCreator("useful-tools");
  finalDoc.setProducer("useful-tools");
  const bytes = await finalDoc.save();

  return { bytes, pageCount: finalDoc.getPageCount(), title };
}
