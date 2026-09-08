import { NextResponse } from "next/server";
import { readMeta, uploadedBytes, writeChunk } from "@/lib/storage";
import { MAX_FILE_SIZE } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports how many bytes are already stored so an interrupted upload can pick
 * up where it left off instead of starting over.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const meta = await readMeta(id);
  if (!meta) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  return NextResponse.json({ id, offset: await uploadedBytes(id), complete: meta.complete });
}

/**
 * Receives one chunk. The body is streamed straight to disk, so memory use is
 * flat no matter how large the file is.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const offset = Number(url.searchParams.get("offset") ?? "0");

  const meta = await readMeta(id);
  if (!meta) return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  if (meta.complete) {
    return NextResponse.json({ error: "This upload is already finalised." }, { status: 409 });
  }
  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "Invalid offset." }, { status: 400 });
  }

  const current = await uploadedBytes(id);
  if (offset > current) {
    // Writing past the end would leave a hole of zero bytes in the middle.
    return NextResponse.json(
      { error: "Offset is beyond the stored data.", offset: current },
      { status: 409 }
    );
  }
  if (!request.body) {
    return NextResponse.json({ error: "Empty request body." }, { status: 400 });
  }

  const written = await writeChunk(id, offset, request.body as ReadableStream<Uint8Array>);

  if (MAX_FILE_SIZE > 0 && written > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds the configured limit." }, { status: 413 });
  }

  return NextResponse.json({ id, offset: written });
}
