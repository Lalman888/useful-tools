import { NextResponse } from "next/server";
import { createRequest } from "@/lib/requests";
import { storageUnavailableResponse } from "@/lib/storageGuard";
import { DEFAULT_REQUEST_EXPIRY_HOURS, MAX_REQUEST_FILES } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function POST(request: Request) {
  const unavailable = storageUnavailableResponse();
  if (unavailable) return unavailable;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json(
      { error: "Give the request a title, so the person sending files knows what you need." },
      { status: 400 }
    );
  }

  const expiry = asNumber(body.expiresInHours);
  const created = await createRequest({
    title,
    note: typeof body.note === "string" ? body.note : "",
    expiresInHours: expiry === null ? DEFAULT_REQUEST_EXPIRY_HOURS : expiry,
    maxFiles: asNumber(body.maxFiles),
    password:
      typeof body.password === "string" && body.password.length > 0 ? body.password : null,
  });

  return NextResponse.json({
    id: created.id,
    ownerToken: created.ownerToken,
    maxFiles: created.maxFiles,
    limit: MAX_REQUEST_FILES,
    expiresAt: created.expiresAt,
  });
}
