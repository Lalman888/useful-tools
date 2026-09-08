import { NextResponse } from "next/server";
import { isExpired, readMeta, verifyPassword } from "@/lib/storage";
import { accessCookieName, signAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Exchanges the share password for a signed, httpOnly cookie scoped to this
 * one file, so the password itself never travels again after the first check.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const meta = await readMeta(id);
  if (!meta || isExpired(meta)) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  if (!meta.passwordHash) return NextResponse.json({ ok: true });

  let password = "";
  try {
    password = String(((await request.json()) as { password?: unknown }).password ?? "");
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!verifyPassword(password, meta.passwordHash)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(accessCookieName(id), signAccess(id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
