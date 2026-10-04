import { NextResponse } from "next/server";
import { markdownToPdf } from "@/lib/pdf";
import { parsePdfOptions } from "@/lib/pdfOptions";
import { suggestFilename } from "@/lib/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  try {
    const result = await markdownToPdf(parsed.options);
    // Only reached by a direct POST; the browser download is named client-side.
    // Same helper either way, so the two cannot disagree about the rules.
    const filename = suggestFilename(result.title, ".pdf");
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
