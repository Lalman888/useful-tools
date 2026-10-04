/**
 * The live text session this browser is sharing.
 *
 * Only one is kept: the page shares what is on screen, and there is one of
 * those. Held so a reload resumes the same link rather than stranding everyone
 * already watching it on a session nothing is writing to any more.
 */
export type SharedTextRecord = {
  id: string;
  editToken: string;
  at: number;
};

const KEY = "useful-tools:text-share";

export function readShare(): SharedTextRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SharedTextRecord>;
    if (typeof parsed.id !== "string" || typeof parsed.editToken !== "string") return null;
    return { id: parsed.id, editToken: parsed.editToken, at: Number(parsed.at) || 0 };
  } catch {
    return null;
  }
}

export function rememberShare(record: Omit<SharedTextRecord, "at">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...record, at: Date.now() }));
  } catch {
    /* storage disabled; the link is still on screen */
  }
}

export function forgetShare(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing useful to do */
  }
}
