import { NextResponse } from "next/server";
import { renderPreviewDocument } from "@/lib/pdf";
import { parsePdfOptions } from "@/lib/pdfOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the document as a standalone HTML page for the editor's preview
 * pane. It shares the theme stylesheet with the PDF exporter, so the two
 * cannot drift apart.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = parsePdfOptions(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  return new NextResponse(await renderPreviewDocument(parsed.options), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
