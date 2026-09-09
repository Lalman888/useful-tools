/**
 * The file requests created from this browser.
 *
 * The owner token is the only thing that can read what people send to a
 * request, and the server never ties it to an account, so this list is the
 * whole of your access to it. Like the upload history it lives in
 * localStorage, which makes it per-browser by design — clear the browser and
 * the files become unreachable, which is the point of not holding accounts.
 */
export type RequestRecord = {
  id: string;
  title: string;
  ownerToken: string;
  /** Milliseconds since the epoch, at creation. */
  at: number;
};

const KEY = "useful-tools:requests";
const LIMIT = 100;

function isRecord(value: unknown): value is RequestRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RequestRecord>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.ownerToken === "string" &&
    typeof candidate.at === "number"
  );
}

export function readRequests(): RequestRecord[] {
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

function write(records: RequestRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records.slice(0, LIMIT)));
  } catch {
    /* nothing useful to do; the request itself still works */
  }
}

export function rememberRequest(record: Omit<RequestRecord, "at">): void {
  const existing = readRequests().filter((entry) => entry.id !== record.id);
  write([{ ...record, at: Date.now() }, ...existing]);
}

/** Drops the local record only; it does not delete anything on the server. */
export function forgetRequest(id: string): void {
  write(readRequests().filter((entry) => entry.id !== id));
}
