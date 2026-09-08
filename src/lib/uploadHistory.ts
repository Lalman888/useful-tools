/**
 * A record of the links created from this browser, kept locally.
 *
 * The delete token is the only proof of ownership the server recognises, and
 * it is never stored server-side against a user, so losing this list means
 * losing the ability to revoke a link. It lives in localStorage, which makes
 * the list per-browser by design.
 */
export type UploadRecord = {
  id: string;
  name: string;
  deleteToken: string;
  /** Milliseconds since the epoch, at creation. */
  at: number;
};

const KEY = "useful-tools:uploads";
const LIMIT = 200;

function isRecord(value: unknown): value is UploadRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<UploadRecord>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.deleteToken === "string" &&
    typeof candidate.at === "number"
  );
}

export function readUploads(): UploadRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord);
  } catch {
    // Corrupt entry, private mode, or storage disabled.
    return [];
  }
}

function write(records: UploadRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records.slice(0, LIMIT)));
  } catch {
    /* nothing useful to do; the links themselves still work */
  }
}

export function rememberUpload(record: Omit<UploadRecord, "at">): void {
  const existing = readUploads().filter((entry) => entry.id !== record.id);
  write([{ ...record, at: Date.now() }, ...existing]);
}

/** Drops the local record only; it does not delete anything on the server. */
export function forgetUpload(id: string): void {
  write(readUploads().filter((entry) => entry.id !== id));
}
