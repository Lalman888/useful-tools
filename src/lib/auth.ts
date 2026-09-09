import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./config";

const SECRET_FILE = path.join(DATA_DIR, ".secret");

let cachedSecret: Buffer | null = null;

/**
 * Server secret used to sign access cookies. Generated on first use and kept
 * on disk so tokens stay valid across restarts. Set SHARE_SECRET to manage it
 * yourself (required if you run more than one instance).
 */
export function getSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  if (process.env.SHARE_SECRET) {
    cachedSecret = Buffer.from(process.env.SHARE_SECRET, "utf8");
    return cachedSecret;
  }
  try {
    cachedSecret = fs.readFileSync(SECRET_FILE);
  } catch {
    const generated = crypto.randomBytes(32);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    cachedSecret = generated;
  }
  return cachedSecret;
}

export function accessCookieName(id: string): string {
  return `ut_access_${id}`;
}

/** A request link's unlock cookie, kept distinct from a share link's. */
export function requestCookieName(id: string): string {
  return `ut_request_${id}`;
}

/** Reads one cookie out of a raw Cookie header. */
export function cookieFrom(header: string | null, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

export function signAccess(id: string): string {
  return crypto.createHmac("sha256", getSecret()).update(`access:${id}`).digest("base64url");
}

export function verifyAccess(id: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(signAccess(id));
  const actual = Buffer.from(token);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
