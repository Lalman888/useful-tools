import { DEFAULT_PDF_OPTIONS, type PdfOptions, type PaperSize } from "./pdf";
import { isThemeId } from "./themes";

const PAPERS: PaperSize[] = ["A4", "Letter", "Legal", "A3"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Markdown large enough to be a denial-of-service rather than a document. */
export const MAX_MARKDOWN_CHARS = 2_000_000;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function str(value: unknown, max = 300): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export type ParseResult =
  | { ok: true; options: PdfOptions }
  | { ok: false; error: string; status: number };

/**
 * Turns an untrusted JSON body into fully-populated render options. Every
 * field falls back to a default rather than rejecting the request, so a stale
 * client cannot break the exporter.
 */
export function parsePdfOptions(body: Record<string, unknown>): ParseResult {
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  if (!markdown.trim()) {
    return { ok: false, error: "There is nothing to convert.", status: 400 };
  }
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    return {
      ok: false,
      error: "That document is too large to convert in one pass.",
      status: 413,
    };
  }

  const themeRaw = str(body.theme, 30);
  const paperRaw = str(body.paper, 10) as PaperSize;
  const accentRaw = str(body.accent, 7);

  return {
    ok: true,
    options: {
      ...DEFAULT_PDF_OPTIONS,
      markdown,
      theme: isThemeId(themeRaw) ? themeRaw : DEFAULT_PDF_OPTIONS.theme,
      paper: PAPERS.includes(paperRaw) ? paperRaw : DEFAULT_PDF_OPTIONS.paper,
      accent: HEX_COLOR.test(accentRaw) ? accentRaw : DEFAULT_PDF_OPTIONS.accent,
      baseFontSize: clamp(Number(body.baseFontSize), 8, 16, DEFAULT_PDF_OPTIONS.baseFontSize),
      margin: clamp(Number(body.margin), 8, 40, DEFAULT_PDF_OPTIONS.margin),
      tocDepth: clamp(Number(body.tocDepth), 1, 4, DEFAULT_PDF_OPTIONS.tocDepth),
      numberHeadings: Boolean(body.numberHeadings),
      justify: Boolean(body.justify),
      includeCover: Boolean(body.includeCover),
      includeToc: Boolean(body.includeToc),
      dropFirstHeading:
        body.dropFirstHeading === undefined ? true : Boolean(body.dropFirstHeading),
      pageNumbers: body.pageNumbers === undefined ? true : Boolean(body.pageNumbers),
      title: str(body.title),
      subtitle: str(body.subtitle),
      author: str(body.author),
      dateLabel: str(body.dateLabel, 60),
      headerText: str(body.headerText, 120),
      footerText: str(body.footerText, 120),
    },
  };
}
