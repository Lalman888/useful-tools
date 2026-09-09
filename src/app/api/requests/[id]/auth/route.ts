import { NextResponse } from "next/server";
import { readRequest, verifyRequestPassword } from "@/lib/requests";
import { requestCookieName, signAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Exchanges the request password for a signed, httpOnly cookie, so the
 * password itself is sent once rather than with every chunk of every upload.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const found = await readRequest(id);
  if (!found) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (!found.passwordHash) return NextResponse.json({ ok: true });

  let password = "";
  try {
    password = String(((await request.json()) as { password?: unknown }).password ?? "");
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!verifyRequestPassword(found, password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(requestCookieName(id), signAccess(`request:${id}`), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
