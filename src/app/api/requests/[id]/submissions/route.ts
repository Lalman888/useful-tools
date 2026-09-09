import { NextResponse } from "next/server";
import { ownsRequest, readRequest } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Owner only. The recipient of a request link can write to it but must never
 * be able to read what anyone else sent.
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const found = await readRequest(id);
  if (!found) return NextResponse.json({ error: "Request not found." }, { status: 404 });

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!ownsRequest(found, token)) {
    return NextResponse.json({ error: "Not your request." }, { status: 403 });
  }

  return NextResponse.json({
    id: found.id,
    title: found.title,
    note: found.note,
    createdAt: found.createdAt,
    expiresAt: found.expiresAt,
    closed: found.closed,
    maxFiles: found.maxFiles,
    submissions: found.submissions,
  });
}
