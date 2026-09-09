import { NextResponse } from "next/server";
import { createUpload } from "@/lib/storage";
import { storageUnavailableResponse } from "@/lib/storageGuard";
import { CHUNK_SIZE, MAX_FILE_SIZE, DEFAULT_EXPIRY_HOURS } from "@/lib/config";
import { isOpen, readRequest } from "@/lib/requests";
import { cookieFrom, requestCookieName, verifyAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InitBody = {
  name?: unknown;
  size?: unknown;
  type?: unknown;
  expiresInHours?: unknown;
  maxDownloads?: unknown;
  password?: unknown;
  requestId?: unknown;
  submitter?: unknown;
};

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function POST(request: Request) {
  const unavailable = storageUnavailableResponse();
  if (unavailable) return unavailable;

  let body: InitBody;
  try {
    body = (await request.json()) as InitBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  if (!name.trim()) {
    return NextResponse.json({ error: "A file name is required." }, { status: 400 });
  }

  const size = asNumber(body.size);
  if (size === null) {
    return NextResponse.json({ error: "A valid file size is required." }, { status: 400 });
  }
  // MAX_FILE_SIZE of 0 means "no limit", which is the default.
  if (MAX_FILE_SIZE > 0 && size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `This server accepts files up to ${MAX_FILE_SIZE} bytes.` },
      { status: 413 }
    );
  }

  // An upload aimed at a request link is checked here, before a single byte is
  // accepted, so a closed or full request cannot be used as free storage.
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (requestId) {
    const fileRequest = await readRequest(requestId);
    if (!fileRequest) {
      return NextResponse.json({ error: "This request link no longer exists." }, { status: 404 });
    }
    if (!isOpen(fileRequest)) {
      return NextResponse.json(
        { error: "This request is no longer accepting files." },
        { status: 410 }
      );
    }
    if (fileRequest.passwordHash) {
      const cookie = cookieFrom(request.headers.get("cookie"), requestCookieName(requestId));
      if (!verifyAccess(`request:${requestId}`, cookie)) {
        return NextResponse.json({ error: "Password required." }, { status: 401 });
      }
    }
  }

  const expiresRaw = asNumber(body.expiresInHours);
  const meta = await createUpload({
    name,
    size,
    type: typeof body.type === "string" ? body.type : "",
    expiresInHours: expiresRaw ?? DEFAULT_EXPIRY_HOURS,
    maxDownloads: asNumber(body.maxDownloads),
    password:
      typeof body.password === "string" && body.password.length > 0 ? body.password : null,
    ...(requestId ? { requestId } : {}),
    ...(typeof body.submitter === "string" && body.submitter.trim()
      ? { submitter: body.submitter }
      : {}),
  });

  return NextResponse.json({
    id: meta.id,
    chunkSize: CHUNK_SIZE,
    // Withheld for a submission: the sender is giving the file away, and a
    // delete token would let them pull it back after the owner had seen it.
    ...(requestId ? {} : { deleteToken: meta.deleteToken }),
  });
}
