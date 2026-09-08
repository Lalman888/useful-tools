import { NextResponse } from "next/server";
import { deleteFile, isExpired, readMeta } from "@/lib/storage";
import { isSpreadsheet } from "@/lib/spreadsheet";
import { accessCookieName, verifyAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const meta = await readMeta(id);
  if (!meta || !meta.complete) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  if (isExpired(meta)) {
    await deleteFile(id);
    return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  }

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === accessCookieName(id))?.[1];
  const unlocked = !meta.passwordHash || verifyAccess(id, cookie);

  // Behind a password, withhold even the file name until it is given: the
  // name alone can be the sensitive part.
  if (!unlocked) {
    return NextResponse.json({ id: meta.id, protected: true, unlocked: false });
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
    unlocked: true,
    previewable: isSpreadsheet(meta.name),
  });
}
