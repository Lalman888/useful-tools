import { NextResponse } from "next/server";
import {
  deleteRequest,
  ownsRequest,
  publicView,
  readRequest,
  setClosed,
} from "@/lib/requests";
import { deleteFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** What the recipient sees: the ask, and whether it is still open. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const found = await readRequest(id);
  if (!found) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  return NextResponse.json(publicView(found));
}

/** Owner only: close or reopen. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const found = await readRequest(id);
  if (!found) return NextResponse.json({ error: "Request not found." }, { status: 404 });

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!ownsRequest(found, token)) {
    return NextResponse.json({ error: "Not your request." }, { status: 403 });
  }

  let closed = true;
  try {
    closed = Boolean(((await request.json()) as { closed?: unknown }).closed);
  } catch {
    /* default to closing, which is the safe direction */
  }
  const updated = await setClosed(id, closed);
  return NextResponse.json({ closed: updated?.closed ?? closed });
}

/** Owner only: delete the request and everything sent to it. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const found = await readRequest(id);
  if (!found) return NextResponse.json({ error: "Request not found." }, { status: 404 });

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!ownsRequest(found, token)) {
    return NextResponse.json({ error: "Not your request." }, { status: 403 });
  }

  // The files belong to the request; leaving them behind would orphan bytes
  // nobody can reach or delete.
  for (const submission of found.submissions) {
    await deleteFile(submission.fileId);
  }
  await deleteRequest(id);
  return NextResponse.json({ deleted: true });
}
