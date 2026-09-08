import { NextResponse } from "next/server";
import { markdownToPdf, DEFAULT_PDF_OPTIONS, type PdfOptions, type PaperSize } from "@/lib/pdf";
import { isThemeId } from "@/lib/themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PAPERS: PaperSize[] = ["A4", "Letter", "Legal", "A3"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Markdown large enough to be a denial-of-service rather than a document. */
const MAX_MARKDOWN_CHARS = 2_000_000;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function str(value: unknown, max = 300): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  if (!markdown.trim()) {
    return NextResponse.json({ error: "There is nothing to convert." }, { status: 400 });
  }
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    return NextResponse.json(
      { error: "That document is too large to convert in one pass." },
      { status: 413 }
    );
  }

  const themeRaw = str(body.theme, 30);
  const paperRaw = str(body.paper, 10) as PaperSize;
  const accentRaw = str(body.accent, 7);

  const options: PdfOptions = {
    ...DEFAULT_PDF_OPTIONS,
    markdown,
    theme: isThemeId(themeRaw) ? themeRaw : DEFAULT_PDF_OPTIONS.theme,
    paper: PAPERS.includes(paperRaw) ? paperRaw : DEFAULT_PDF_OPTIONS.paper,
    accent: HEX_COLOR.test(accentRaw) ? accentRaw : DEFAULT_PDF_OPTIONS.accent,
    baseFontSize: clamp(Number(body.baseFontSize), 8, 16, DEFAULT_PDF_OPTIONS.baseFontSize),
    margin: clamp(Number(body.margin), 8, 40, DEFAULT_PDF_OPTIONS.margin),
    numberHeadings: Boolean(body.numberHeadings),
    justify: Boolean(body.justify),
    includeCover: Boolean(body.includeCover),
    includeToc: Boolean(body.includeToc),
    tocDepth: clamp(Number(body.tocDepth), 1, 4, DEFAULT_PDF_OPTIONS.tocDepth),
    dropFirstHeading:
      body.dropFirstHeading === undefined ? true : Boolean(body.dropFirstHeading),
    pageNumbers: body.pageNumbers === undefined ? true : Boolean(body.pageNumbers),
    title: str(body.title),
    subtitle: str(body.subtitle),
    author: str(body.author),
    dateLabel: str(body.dateLabel, 60),
    headerText: str(body.headerText, 120),
    footerText: str(body.footerText, 120),
  };

  try {
    const result = await markdownToPdf(options);
    const filename = `${result.title.replace(/[^\w\s.-]/g, "").trim() || "document"}.pdf`;
    return new NextResponse(result.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(result.bytes.byteLength),
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-Page-Count": String(result.pageCount),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("pdf render failed", error);
    const message =
      error instanceof Error && error.message.includes("Chromium")
        ? error.message
        : "Could not render this document to PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
