import { NextResponse } from "next/server";
import { completeUpload } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const meta = await completeUpload(id);
  if (!meta) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  return NextResponse.json({
    id: meta.id,
    name: meta.name,
    size: meta.size,
    type: meta.type,
    expiresAt: meta.expiresAt,
  });
}
