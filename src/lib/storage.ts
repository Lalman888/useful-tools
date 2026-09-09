import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { customAlphabet } from "nanoid";
import { DATA_DIR, FILES_DIR, REQUESTS_DIR } from "./config.ts";

/** Unambiguous alphabet: no look-alike characters, so ids survive being read aloud. */
const ID_ALPHABET = "0123456789abcdefghijkmnpqrstuvwxyz";
const ID_LENGTH = 16;
const nanoid = customAlphabet(ID_ALPHABET, ID_LENGTH);

export type FileMeta = {
  id: string;
  name: string;
  size: number;
  type: string;
  createdAt: string;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloads: number;
  passwordHash: string | null;
  deleteToken: string;
  complete: boolean;
  /** Set when the file arrived through a request link rather than an upload. */
  requestId?: string;
  /** Name the sender gave, when they arrived through a request. */
  submitter?: string;
};

// Built from the alphabet itself: a hand-written character class silently
// rejected valid ids once already.
const ID_RE = new RegExp(`^[${ID_ALPHABET}]{${ID_LENGTH}}$`);

/** Guards every filesystem path we build from a caller-supplied id. */
export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function dirFor(id: string): string {
  if (!isValidId(id)) throw new Error("Invalid file id");
  return path.join(FILES_DIR, id);
}

export function blobPath(id: string): string {
  return path.join(dirFor(id), "blob");
}

function metaPath(id: string): string {
  return path.join(dirFor(id), "meta.json");
}

/** Control characters and DEL, which have no business in a display name. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Strips directory components and control characters from a client-supplied
 * filename. The result is only ever used as a display name and in
 * Content-Disposition, never as a path on disk.
 */
export function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(CONTROL_CHARS, "").trim();
  return cleaned.slice(0, 255) || "file";
}

async function writeMeta(meta: FileMeta): Promise<void> {
  const target = metaPath(meta.id);
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(meta, null, 2));
  await fsp.rename(tmp, target); // atomic swap; readers never see a partial file
}

export async function readMeta(id: string): Promise<FileMeta | null> {
  if (!isValidId(id)) return null;
  try {
    const raw = await fsp.readFile(metaPath(id), "utf8");
    return JSON.parse(raw) as FileMeta;
  } catch {
    return null;
  }
}

export type CreateUploadInput = {
  name: string;
  size: number;
  type: string;
  expiresInHours: number | null;
  maxDownloads: number | null;
  password: string | null;
  requestId?: string;
  submitter?: string;
};

export async function createUpload(input: CreateUploadInput): Promise<FileMeta> {
  const id = nanoid();
  await fsp.mkdir(dirFor(id), { recursive: true });
  await fsp.writeFile(blobPath(id), ""); // start the blob so resume offsets work

  const meta: FileMeta = {
    id,
    name: sanitizeName(input.name),
    size: input.size,
    type: input.type || "application/octet-stream",
    createdAt: new Date().toISOString(),
    expiresAt:
      input.expiresInHours && input.expiresInHours > 0
        ? new Date(Date.now() + input.expiresInHours * 3600_000).toISOString()
        : null,
    maxDownloads:
      input.maxDownloads && input.maxDownloads > 0 ? input.maxDownloads : null,
    downloads: 0,
    passwordHash: input.password ? hashPassword(input.password) : null,
    deleteToken: crypto.randomBytes(24).toString("base64url"),
    complete: false,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.submitter ? { submitter: sanitizeName(input.submitter) } : {}),
  };
  await writeMeta(meta);
  return meta;
}

/** Bytes already persisted, so an interrupted upload can resume where it stopped. */
export async function uploadedBytes(id: string): Promise<number> {
  try {
    const stat = await fsp.stat(blobPath(id));
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * Writes one chunk at an explicit `offset`. Positioning the write (rather than
 * appending blindly) makes a retried chunk idempotent instead of duplicating
 * bytes into the blob.
 */
export async function writeChunk(
  id: string,
  offset: number,
  body: ReadableStream<Uint8Array>
): Promise<number> {
  const handle = await fsp.open(blobPath(id), "r+");
  let position = offset;
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      await handle.write(value, 0, value.length, position);
      position += value.length;
    }
  } finally {
    await handle.close();
  }
  return position;
}

export async function completeUpload(id: string): Promise<FileMeta | null> {
  const meta = await readMeta(id);
  if (!meta) return null;
  const actual = await uploadedBytes(id);
  const updated: FileMeta = { ...meta, size: actual, complete: true };
  await writeMeta(updated);
  return updated;
}

export async function recordDownload(id: string): Promise<void> {
  const meta = await readMeta(id);
  if (!meta) return;
  await writeMeta({ ...meta, downloads: meta.downloads + 1 });
}

export async function deleteFile(id: string): Promise<boolean> {
  if (!isValidId(id)) return false;
  try {
    await fsp.rm(dirFor(id), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function isExpired(meta: FileMeta): boolean {
  if (meta.expiresAt && Date.parse(meta.expiresAt) <= Date.now()) return true;
  if (meta.maxDownloads !== null && meta.downloads >= meta.maxDownloads) return true;
  return false;
}

/* ------------------------------- passwords ------------------------------- */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 32);
  return `${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

/** Constant-time compare for secrets handed back to us by a client. */
export function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltPart, hashPart] = stored.split(":");
  if (!saltPart || !hashPart) return false;
  const salt = Buffer.from(saltPart, "base64url");
  const expected = Buffer.from(hashPart, "base64url");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/* --------------------------------- sweeps -------------------------------- */

/** Deletes everything past its expiry or download cap. Safe to call repeatedly. */
export async function sweepExpired(): Promise<number> {
  let removed = 0;
  let ids: string[];
  try {
    ids = await fsp.readdir(FILES_DIR);
  } catch {
    return 0;
  }
  for (const id of ids) {
    if (!isValidId(id)) continue;
    const meta = await readMeta(id);
    if (!meta) continue;
    if (isExpired(meta)) {
      if (await deleteFile(id)) removed++;
    }
  }
  return removed;
}

let storageState: { writable: boolean; reason: string } | null = null;

/**
 * Creates the data directory, reporting failure rather than throwing.
 *
 * On a serverless host the application directory is read-only and there is no
 * durable disk at all, so this legitimately fails. It must never take the
 * process down with it: the viewer and the PDF exporter do not touch storage
 * and have to keep working.
 */
export function ensureDirs(): { writable: boolean; reason: string } {
  if (storageState) return storageState;
  try {
    fs.mkdirSync(FILES_DIR, { recursive: true });
    fs.mkdirSync(REQUESTS_DIR, { recursive: true });
    // Creating the directory is not proof we can write into it.
    const probe = path.join(FILES_DIR, ".write-probe");
    fs.writeFileSync(probe, "");
    fs.rmSync(probe, { force: true });
    storageState = { writable: true, reason: "" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    storageState = {
      writable: false,
      reason: `${DATA_DIR} is not writable (${code})`,
    };
  }
  return storageState;
}

/** Whether file sharing can work in this deployment. */
export function storageAvailable(): boolean {
  return ensureDirs().writable;
}
