import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store writes under REQUESTS_DIR, which config reads once at import, so
// the environment has to be set before the module graph is pulled in.
const root = await fsp.mkdtemp(path.join(os.tmpdir(), "useful-tools-requests-"));
process.env.DATA_DIR = root;

const {
  addSubmission,
  createRequest,
  isOpen,
  isRequestExpired,
  ownerTokenAllows,
  ownsRequest,
  publicView,
  readRequest,
  setClosed,
  verifyRequestPassword,
} = await import("./requests.ts");

const base = {
  title: "Signed contract",
  note: "PDF please",
  expiresInHours: 24,
  maxFiles: 2,
  password: null,
};

function submission(fileId: string) {
  return {
    fileId,
    name: `${fileId}.pdf`,
    size: 10,
    submitter: "Sam",
    receivedAt: new Date().toISOString(),
  };
}

test("a new request is open and readable back", async () => {
  const created = await createRequest(base);
  assert.equal(isOpen(created), true);
  const loaded = await readRequest(created.id);
  assert.equal(loaded?.title, "Signed contract");
  assert.equal(loaded?.ownerToken, created.ownerToken);
});

test("the public view never leaks the submissions or the owner token", async () => {
  const created = await createRequest(base);
  await addSubmission(created.id, submission("aaaaaaaaaaaaaaaa"));
  const view = publicView((await readRequest(created.id))!);
  assert.equal("submissions" in view, false);
  assert.equal("ownerToken" in view, false);
  assert.equal("passwordHash" in view, false);
  assert.equal(view.remaining, 1);
});

test("a request closes once it is full", async () => {
  const created = await createRequest(base);
  await addSubmission(created.id, submission("aaaaaaaaaaaaaaaa"));
  await addSubmission(created.id, submission("bbbbbbbbbbbbbbbb"));
  const full = (await readRequest(created.id))!;
  assert.equal(full.submissions.length, 2);
  assert.equal(isOpen(full), false);
});

test("completing the same upload twice records it once", async () => {
  const created = await createRequest(base);
  await addSubmission(created.id, submission("aaaaaaaaaaaaaaaa"));
  await addSubmission(created.id, submission("aaaaaaaaaaaaaaaa"));
  assert.equal((await readRequest(created.id))!.submissions.length, 1);
});

test("closing and reopening flips whether files are accepted", async () => {
  const created = await createRequest(base);
  assert.equal(isOpen((await setClosed(created.id, true))!), false);
  assert.equal(isOpen((await setClosed(created.id, false))!), true);
});

test("an elapsed expiry closes the request", async () => {
  const created = await createRequest(base);
  const elapsed = { ...created, expiresAt: new Date(Date.now() - 1000).toISOString() };
  assert.equal(isRequestExpired(elapsed), true);
  assert.equal(isOpen(elapsed), false);
});

test("an expiry is set an hour ahead when one is asked for", async () => {
  const created = await createRequest({ ...base, expiresInHours: 1 });
  assert.notEqual(created.expiresAt, null);
  assert.equal(isRequestExpired(created), false);
  assert.ok(Date.parse(created.expiresAt!) > Date.now());
});

test("no expiry, and zero hours, both mean the link never expires", async () => {
  assert.equal((await createRequest({ ...base, expiresInHours: null })).expiresAt, null);
  assert.equal((await createRequest({ ...base, expiresInHours: 0 })).expiresAt, null);
});

test("the password is checked against a hash, not stored in the clear", async () => {
  const created = await createRequest({ ...base, password: "correct horse" });
  assert.equal(created.passwordHash?.includes("correct horse"), false);
  assert.equal(verifyRequestPassword(created, "correct horse"), true);
  assert.equal(verifyRequestPassword(created, "wrong"), false);
});

test("a request with no password accepts anyone", async () => {
  const created = await createRequest(base);
  assert.equal(verifyRequestPassword(created, ""), true);
});

test("only the owner token opens a request, at any length", async () => {
  const created = await createRequest(base);
  assert.equal(ownsRequest(created, created.ownerToken), true);
  assert.equal(ownsRequest(created, ""), false);
  assert.equal(ownsRequest(created, "short"), false);
  assert.equal(ownsRequest(created, `${created.ownerToken}x`), false);
  assert.equal(await ownerTokenAllows(created.id, created.ownerToken), true);
  assert.equal(await ownerTokenAllows(created.id, null), false);
  assert.equal(await ownerTokenAllows(created.id, "not-the-token"), false);
});

test("one request's owner token does not open another's", async () => {
  const mine = await createRequest(base);
  const theirs = await createRequest(base);
  assert.equal(await ownerTokenAllows(theirs.id, mine.ownerToken), false);
});

test("an id that is not a valid id reads back as missing rather than escaping the directory", async () => {
  assert.equal(await readRequest("../../etc"), null);
  assert.equal(await readRequest(""), null);
  assert.equal(await ownerTokenAllows("../../etc", "anything"), false);
});

test.after(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});
