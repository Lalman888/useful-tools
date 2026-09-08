import { NextResponse } from "next/server";
import { blobPath, isExpired, readMeta } from "@/lib/storage";
import { accessCookieName, verifyAccess } from "@/lib/auth";
import { parseWorkbook, UnsupportedFormatError } from "@/lib/spreadsheet";
import { MAX_PARSE_BYTES, formatBytes } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Parses a stored CSV/Excel file into the JSON shape the table viewer renders. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const meta = await readMeta(id);
  if (!meta || !meta.complete || isExpired(meta)) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  if (meta.passwordHash) {
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find(([key]) => key === accessCookieName(id))?.[1];
    if (!verifyAccess(id, cookie)) {
      return NextResponse.json({ error: "Password required." }, { status: 401 });
    }
  }
  if (meta.size > MAX_PARSE_BYTES) {
    return NextResponse.json(
      {
        error: `This file is ${formatBytes(meta.size)}, larger than the ${formatBytes(
          MAX_PARSE_BYTES
        )} preview limit. Download it to open locally.`,
      },
      { status: 413 }
    );
  }

  try {
    const workbook = await parseWorkbook(blobPath(id), meta.name);
    return NextResponse.json(workbook);
  } catch (error) {
    if (error instanceof UnsupportedFormatError) {
      return NextResponse.json({ error: error.message }, { status: 415 });
    }
    console.error("sheet parse failed", error);
    return NextResponse.json({ error: "Could not read this spreadsheet." }, { status: 500 });
  }
}
