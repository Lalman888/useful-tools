import path from "node:path";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Root directory that holds all uploaded blobs and their metadata. */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const FILES_DIR = path.join(DATA_DIR, "files");

/**
 * Hard ceiling on a single upload, in bytes. `0` means no limit, which is the
 * default: uploads are streamed to disk in chunks, so the only real bound is
 * the free space on the volume you deploy to.
 */
export const MAX_FILE_SIZE = intFromEnv("MAX_FILE_SIZE", 0);

/** Chunk size the browser uploader uses. 8 MiB balances retries against overhead. */
export const CHUNK_SIZE = intFromEnv("CHUNK_SIZE", 8 * 1024 * 1024);

/**
 * Default lifetime for a share link, in hours. `0` means links never expire.
 */
export const DEFAULT_EXPIRY_HOURS = intFromEnv("DEFAULT_EXPIRY_HOURS", 0);

/** Cap on rows returned to the spreadsheet viewer in one response. */
export const MAX_PREVIEW_ROWS = intFromEnv("MAX_PREVIEW_ROWS", 50_000);

/** Cap on bytes we are willing to parse into a spreadsheet preview. */
export const MAX_PARSE_BYTES = intFromEnv("MAX_PARSE_BYTES", 200 * 1024 * 1024);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
