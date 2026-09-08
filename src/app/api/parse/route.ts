import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { parseWorkbook, UnsupportedFormatError } from "@/lib/spreadsheet";
import { MAX_PARSE_BYTES, formatBytes } from "@/lib/config";
import { sanitizeName } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Parses a spreadsheet the user opened locally, without adding it to the share
 * store. The bytes land in a temp file, are read once, and are deleted before
 * the response is sent.
 */
export async function POST(request: Request) {
  const name = sanitizeName(
    new URL(request.url).searchParams.get("name") ?? "upload.csv"
  );

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_PARSE_BYTES) {
    return NextResponse.json(
      {
        error: `That file is ${formatBytes(declaredLength)}. The preview limit is ${formatBytes(
          MAX_PARSE_BYTES
        )}.`,
      },
      { status: 413 }
    );
  }
  if (!request.body) {
    return NextResponse.json({ error: "Empty request body." }, { status: 400 });
  }

  const tempPath = path.join(
    os.tmpdir(),
    `ut-parse-${crypto.randomBytes(8).toString("hex")}${path.extname(name)}`
  );

  try {
    await pipeline(
      Readable.fromWeb(request.body as never),
      fs.createWriteStream(tempPath)
    );

    const stat = await fsp.stat(tempPath);
    if (stat.size > MAX_PARSE_BYTES) {
      return NextResponse.json(
        { error: `That file exceeds the ${formatBytes(MAX_PARSE_BYTES)} preview limit.` },
        { status: 413 }
      );
    }

    const workbook = await parseWorkbook(tempPath, name);
    return NextResponse.json(workbook);
  } catch (error) {
    if (error instanceof UnsupportedFormatError) {
      return NextResponse.json({ error: error.message }, { status: 415 });
    }
    console.error("parse failed", error);
    return NextResponse.json(
      { error: "Could not read that file as a spreadsheet." },
      { status: 500 }
    );
  } finally {
    await fsp.rm(tempPath, { force: true });
  }
}
