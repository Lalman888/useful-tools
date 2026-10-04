import { NextResponse } from "next/server";
import { isExpired, ownsSession, readSession } from "@/lib/textShare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Asked by the WebSocket relay in server.mjs, once, when somebody claims to be
 * the sharer of a session.
 *
 * It exists so the relay needs no notion of where sessions are stored or how a
 * token is checked: this file stays the only thing that knows. The relay is
 * in the same process, so this is a loopback request, not a network hop.
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const session = await readSession(id);
  const ok = Boolean(session && !isExpired(session) && ownsSession(session, token));
  return NextResponse.json(
    { ok, text: ok ? session!.text : "" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
