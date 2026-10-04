import { NextResponse } from "next/server";
import { createSession } from "@/lib/textShare";
import { storageUnavailableResponse } from "@/lib/storageGuard";
import { DEFAULT_TEXT_EXPIRY_HOURS, MAX_SHARED_TEXT } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Opens a live text session and hands back the token that can write to it. */
export async function POST(request: Request) {
  const unavailable = storageUnavailableResponse();
  if (unavailable) return unavailable;

  let hours: number | null = DEFAULT_TEXT_EXPIRY_HOURS;
  try {
    const body = (await request.json()) as { expiresInHours?: unknown };
    const parsed = Number(body.expiresInHours);
    if (Number.isFinite(parsed) && parsed >= 0) hours = parsed;
  } catch {
    /* no body is fine; the default lifetime applies */
  }

  const session = await createSession(hours);
  return NextResponse.json({
    id: session.id,
    editToken: session.editToken,
    expiresAt: session.expiresAt,
    maxBytes: MAX_SHARED_TEXT,
  });
}
