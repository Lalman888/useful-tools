import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { customAlphabet } from "nanoid";
import { MAX_REQUEST_FILES, REQUESTS_DIR } from "./config.ts";
import { hashPassword, isValidId, verifyPassword } from "./storage.ts";

/**
 * A file request is a link you hand to somebody so they can send files to you.
 *
 * It is the mirror image of a share link, and the security model is inverted
 * with it: a share link lets the holder *read* one file, so the link is the
 * secret. A request link lets the holder *write*, which anyone you send it to
 * can pass on, so it carries hard limits instead — an expiry, a file count, and
 * a switch to close it. Reading what arrives needs the owner token, which never
 * leaves the creator's browser.
 */

const nanoid = customAlphabet("0123456789abcdefghijkmnpqrstuvwxyz", 16);

export type Submission = {
  fileId: string;
  name: string;
  size: number;
  submitter: string;
  receivedAt: string;
};

export type FileRequest = {
  id: string;
  title: string;
  note: string;
  createdAt: string;
  expiresAt: string | null;
  maxFiles: number;
  passwordHash: string | null;
  ownerToken: string;
  closed: boolean;
  submissions: Submission[];
};

function dirFor(id: string): string {
  if (!isValidId(id)) throw new Error("Invalid request id");
  return path.join(REQUESTS_DIR, id);
}

function metaPath(id: string): string {
  return path.join(dirFor(id), "request.json");
}

async function write(request: FileRequest): Promise<void> {
  const target = metaPath(request.id);
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(request, null, 2));
  await fsp.rename(tmp, target); // atomic; a reader never sees a partial file
}

export async function readRequest(id: string): Promise<FileRequest | null> {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(await fsp.readFile(metaPath(id), "utf8")) as FileRequest;
  } catch {
    return null;
  }
}

export type CreateRequestInput = {
  title: string;
  note: string;
  expiresInHours: number | null;
  maxFiles: number | null;
  password: string | null;
};

export async function createRequest(input: CreateRequestInput): Promise<FileRequest> {
  const id = nanoid();
  await fsp.mkdir(dirFor(id), { recursive: true });

  const request: FileRequest = {
    id,
    title: input.title.slice(0, 120),
    note: input.note.slice(0, 2000),
    createdAt: new Date().toISOString(),
    // Null and 0 both mean "never expires", matching the share links.
    expiresAt:
      input.expiresInHours && input.expiresInHours > 0
        ? new Date(Date.now() + input.expiresInHours * 3600_000).toISOString()
        : null,
    maxFiles: Math.min(
      MAX_REQUEST_FILES,
      Math.max(1, input.maxFiles ?? MAX_REQUEST_FILES)
    ),
    passwordHash: input.password ? hashPassword(input.password) : null,
    ownerToken: crypto.randomBytes(24).toString("base64url"),
    closed: false,
    submissions: [],
  };
  await write(request);
  return request;
}

export function isRequestExpired(request: FileRequest): boolean {
  return Boolean(request.expiresAt && Date.parse(request.expiresAt) <= Date.now());
}

/** Whether the request will currently accept another file. */
export function isOpen(request: FileRequest): boolean {
  return (
    !request.closed &&
    !isRequestExpired(request) &&
    request.submissions.length < request.maxFiles
  );
}

export function verifyRequestPassword(request: FileRequest, password: string): boolean {
  if (!request.passwordHash) return true;
  return verifyPassword(password, request.passwordHash);
}

export function ownsRequest(request: FileRequest, token: string): boolean {
  const expected = Buffer.from(request.ownerToken);
  const actual = Buffer.from(token);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/**
 * Records a completed upload against its request. Re-reads and rewrites rather
 * than mutating a cached copy, because two people can be uploading at once.
 */
export async function addSubmission(
  id: string,
  submission: Submission
): Promise<FileRequest | null> {
  const request = await readRequest(id);
  if (!request) return null;
  if (request.submissions.some((entry) => entry.fileId === submission.fileId)) {
    return request; // already recorded; completing twice must not duplicate
  }
  const updated: FileRequest = {
    ...request,
    submissions: [...request.submissions, submission],
  };
  await write(updated);
  return updated;
}

export async function setClosed(id: string, closed: boolean): Promise<FileRequest | null> {
  const request = await readRequest(id);
  if (!request) return null;
  const updated = { ...request, closed };
  await write(updated);
  return updated;
}

export async function deleteRequest(id: string): Promise<boolean> {
  if (!isValidId(id)) return false;
  try {
    await fsp.rm(dirFor(id), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** What the person receiving the link is allowed to know about it. */
export function publicView(request: FileRequest) {
  return {
    id: request.id,
    title: request.title,
    note: request.note,
    protected: Boolean(request.passwordHash),
    open: isOpen(request),
    closed: request.closed,
    expired: isRequestExpired(request),
    expiresAt: request.expiresAt,
    // A count, never the list: who else sent what is not theirs to see.
    remaining: Math.max(0, request.maxFiles - request.submissions.length),
  };
}

/**
 * Whether a token is the owner token of a given request.
 *
 * Files that arrive through a request are gated on this rather than on holding
 * the file id, so one sender cannot read another sender's file by guessing or
 * being handed its link.
 */
export async function ownerTokenAllows(
  requestId: string,
  token: string | null | undefined
): Promise<boolean> {
  if (!token) return false;
  const request = await readRequest(requestId);
  if (!request) return false;
  return ownsRequest(request, token);
}
