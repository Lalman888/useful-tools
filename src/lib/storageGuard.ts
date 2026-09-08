import { NextResponse } from "next/server";
import { ensureDirs } from "./storage";

/**
 * Sharing needs a durable, writable disk. On a serverless host there is none,
 * so say so plainly instead of failing with a filesystem error the caller
 * cannot interpret.
 */
export function storageUnavailableResponse(): NextResponse | null {
  const storage = ensureDirs();
  if (storage.writable) return null;
  return NextResponse.json(
    {
      error:
        "File sharing is not available on this deployment: it needs a writable, persistent disk, " +
        "which serverless hosting does not provide. The data viewer and Markdown to PDF still work.",
      code: "storage_unavailable",
    },
    { status: 503 }
  );
}
