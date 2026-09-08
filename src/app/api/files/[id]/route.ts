import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import {
  blobPath,
  deleteFile,
  isExpired,
  readMeta,
  recordDownload,
  tokensMatch,
} from "@/lib/storage";
import { accessCookieName, verifyAccess } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Types we are willing to render inline in the browser. Everything else is
 * forced to download, so an uploaded .html or .svg can never execute on this
 * origin and steal another user's share links.
 */
const INLINE_SAFE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "text/plain",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "video/mp4",
  "video/webm",
  "video/ogg",
]);

function contentDisposition(name: string, inline: boolean): string {
  const asciiFallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name);
  return `${inline ? "inline" : "attachment"}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const meta = await readMeta(id);
  if (!meta || !meta.complete) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  if (isExpired(meta)) {
    await deleteFile(id);
    return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  }
  if (meta.passwordHash) {
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find(([key]) => key === accessCookieName(id))?.[1];
    if (!verifyAccess(id, cookie)) {
      return NextResponse.json({ error: "Password required." }, { status: 401 });
    }
  }

  const path = blobPath(id);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path);
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const wantsInline = url.searchParams.get("inline") === "1";
  const inline = wantsInline && INLINE_SAFE.has(meta.type);

  const headers = new Headers({
    "Content-Type": inline ? meta.type : "application/octet-stream",
    "Content-Disposition": contentDisposition(meta.name, inline),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });

  // Range support lets browsers seek in audio and video and lets download
  // managers resume, which matters for the large files this tool accepts.
  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match) {
    const [, startRaw, endRaw] = match;
    let start = startRaw ? Number(startRaw) : 0;
    let end = endRaw ? Number(endRaw) : stat.size - 1;
    if (!startRaw && endRaw) {
      // Suffix form: "bytes=-500" means the final 500 bytes.
      start = Math.max(0, stat.size - Number(endRaw));
      end = stat.size - 1;
    }
    if (start >= stat.size || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    end = Math.min(end, stat.size - 1);
    headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = Readable.toWeb(
      fs.createReadStream(path, { start, end })
    ) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, { status: 206, headers });
  }

  headers.set("Content-Length", String(stat.size));
  await recordDownload(id);
  const stream = Readable.toWeb(fs.createReadStream(path)) as ReadableStream<Uint8Array>;
  return new NextResponse(stream, { status: 200, headers });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const meta = await readMeta(id);
  if (!meta) return NextResponse.json({ error: "File not found." }, { status: 404 });

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!tokensMatch(token, meta.deleteToken)) {
    return NextResponse.json({ error: "Invalid delete token." }, { status: 403 });
  }
  await deleteFile(id);
  return NextResponse.json({ deleted: true });
}
