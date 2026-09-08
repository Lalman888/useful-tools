import { NextResponse } from "next/server";
import { createUpload, ensureDirs } from "@/lib/storage";
import { CHUNK_SIZE, MAX_FILE_SIZE, DEFAULT_EXPIRY_HOURS } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InitBody = {
  name?: unknown;
  size?: unknown;
  type?: unknown;
  expiresInHours?: unknown;
  maxDownloads?: unknown;
  password?: unknown;
};

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function POST(request: Request) {
  ensureDirs();

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

  const expiresRaw = asNumber(body.expiresInHours);
  const meta = await createUpload({
    name,
    size,
    type: typeof body.type === "string" ? body.type : "",
    expiresInHours: expiresRaw ?? DEFAULT_EXPIRY_HOURS,
    maxDownloads: asNumber(body.maxDownloads),
    password:
      typeof body.password === "string" && body.password.length > 0 ? body.password : null,
  });

  return NextResponse.json({
    id: meta.id,
    chunkSize: CHUNK_SIZE,
    deleteToken: meta.deleteToken,
  });
}
