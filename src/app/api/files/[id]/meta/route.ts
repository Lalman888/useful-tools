import { NextResponse } from "next/server";
import { deleteFile, isExpired, readMeta } from "@/lib/storage";
import { isSpreadsheet } from "@/lib/spreadsheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const meta = await readMeta(id);
  if (!meta || !meta.complete) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  if (isExpired(meta)) {
    await deleteFile(id);
    return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  }

  // Deliberately omits passwordHash and deleteToken.
  return NextResponse.json({
    id: meta.id,
    name: meta.name,
    size: meta.size,
    type: meta.type,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    downloads: meta.downloads,
    maxDownloads: meta.maxDownloads,
    protected: Boolean(meta.passwordHash),
    previewable: isSpreadsheet(meta.name),
  });
}
