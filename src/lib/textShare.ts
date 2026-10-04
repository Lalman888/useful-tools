import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { customAlphabet } from "nanoid";
import { DEFAULT_TEXT_EXPIRY_HOURS, MAX_SHARED_TEXT, TEXT_DIR } from "./config.ts";
import { isValidId } from "./storage.ts";

/**
 * A live text session: a link you hand someone so they watch your text as you
 * type it.
 *
 * The link is the read secret, as with a share link — anyone holding it sees
 * the text. Writing needs the edit token, which is handed back once at creation
 * and never leaves the sharer's browser.
 *
 * What is on disk is a snapshot, not the live stream. Updates travel between
 * browsers over the WebSocket in server.mjs; this file is what a viewer gets
 * when they open the link before the sharer has typed anything new, and what
 * survives a reload at either end.
 */

const nanoid = customAlphabet("0123456789abcdefghijkmnpqrstuvwxyz", 16);

export type TextSession = {
  id: string;
  text: string;
  editToken: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  closed: boolean;
};

function sessionPath(id: string): string {
  if (!isValidId(id)) throw new Error("Invalid session id");
  return path.join(TEXT_DIR, `${id}.json`);
}

async function write(session: TextSession): Promise<void> {
  const target = sessionPath(session.id);
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(session));
  await fsp.rename(tmp, target); // atomic; a reader never sees a half-written file
}

export async function readSession(id: string): Promise<TextSession | null> {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(await fsp.readFile(sessionPath(id), "utf8")) as TextSession;
  } catch {
    return null;
  }
}

export async function createSession(expiresInHours?: number | null): Promise<TextSession> {
  await fsp.mkdir(TEXT_DIR, { recursive: true });
  const hours = expiresInHours ?? DEFAULT_TEXT_EXPIRY_HOURS;
  const session: TextSession = {
    id: nanoid(),
    text: "",
    editToken: crypto.randomBytes(24).toString("base64url"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Null and 0 both mean "never expires", matching the other links here.
    expiresAt: hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null,
    closed: false,
  };
  await write(session);
  return session;
}

export function isExpired(session: TextSession): boolean {
  return Boolean(session.expiresAt && Date.parse(session.expiresAt) <= Date.now());
}

export function ownsSession(session: TextSession, token: string): boolean {
  const expected = Buffer.from(session.editToken);
  const actual = Buffer.from(token);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Trims to the cap on whole characters, so the text is never cut mid-codepoint. */
export function clampText(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= MAX_SHARED_TEXT) return text;
  let slice = text;
  // Each step drops a proportional chunk rather than one character at a time,
  // which would be O(n) passes over a 128 KB string.
  while (Buffer.byteLength(slice, "utf8") > MAX_SHARED_TEXT) {
    const ratio = MAX_SHARED_TEXT / Buffer.byteLength(slice, "utf8");
    slice = [...slice].slice(0, Math.max(1, Math.floor([...slice].length * ratio))).join("");
  }
  return slice;
}

export async function updateText(
  id: string,
  token: string,
  text: string
): Promise<TextSession | null> {
  const session = await readSession(id);
  if (!session || !ownsSession(session, token)) return null;
  const updated: TextSession = {
    ...session,
    text: clampText(text),
    updatedAt: new Date().toISOString(),
  };
  await write(updated);
  return updated;
}

export async function setClosed(
  id: string,
  token: string,
  closed: boolean
): Promise<TextSession | null> {
  const session = await readSession(id);
  if (!session || !ownsSession(session, token)) return null;
  const updated = { ...session, closed };
  await write(updated);
  return updated;
}

export async function deleteSession(id: string, token: string): Promise<boolean> {
  const session = await readSession(id);
  if (!session || !ownsSession(session, token)) return false;
  await fsp.rm(sessionPath(id), { force: true });
  return true;
}

/** What someone holding the link is allowed to see. */
export function publicView(session: TextSession) {
  const expired = isExpired(session);
  return {
    id: session.id,
    // Withheld once the session is over, so a stale link stops showing content.
    text: expired || session.closed ? "" : session.text,
    updatedAt: session.updatedAt,
    closed: session.closed,
    expired,
    live: !expired && !session.closed,
  };
}
