import { NextResponse } from "next/server";
import {
  deleteSession,
  publicView,
  readSession,
  setClosed,
  updateText,
} from "@/lib/textShare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * The snapshot a viewer loads before the live stream reaches them, and what
 * they fall back to polling if the WebSocket cannot be reached at all.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const session = await readSession(id);
  if (!session) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(publicView(session), {
    // A snapshot of something changing by the second must never be cached.
    headers: { "Cache-Control": "no-store" },
  });
}

/** Writes the snapshot. Owner only. */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";

  let text = "";
  try {
    text = String(((await request.json()) as { text?: unknown }).text ?? "");
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const updated = await updateText(id, token, text);
  if (!updated) {
    // One answer for "no such session" and "not your session", so the endpoint
    // cannot be used to discover which ids exist.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ updatedAt: updated.updatedAt, bytes: updated.text.length });
}

/** Stops the share. Owner only. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  let closed = true;
  try {
    closed = Boolean(((await request.json()) as { closed?: unknown }).closed);
  } catch {
    /* default to stopping, which is the safe direction */
  }
  const updated = await setClosed(id, token, closed);
  if (!updated) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ closed: updated.closed });
}

/** Deletes the session and its text. Owner only. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!(await deleteSession(id, token))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
