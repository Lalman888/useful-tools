import { NextResponse } from "next/server";
import { completeUpload } from "@/lib/storage";
import { addSubmission } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const meta = await completeUpload(id);
  if (!meta) return NextResponse.json({ error: "Upload not found." }, { status: 404 });

  // Recorded here rather than by the client: if the sender closes the tab the
  // moment the last chunk lands, the file must still show up for the owner.
  if (meta.requestId) {
    await addSubmission(meta.requestId, {
      fileId: meta.id,
      name: meta.name,
      size: meta.size,
      submitter: meta.submitter ?? "Anonymous",
      receivedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    id: meta.id,
    name: meta.name,
    size: meta.size,
    type: meta.type,
    expiresAt: meta.expiresAt,
  });
}
