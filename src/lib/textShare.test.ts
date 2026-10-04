import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await fsp.mkdtemp(path.join(os.tmpdir(), "useful-tools-text-"));
process.env.DATA_DIR = root;

const {
  clampText,
  createSession,
  deleteSession,
  isExpired,
  ownsSession,
  publicView,
  readSession,
  setClosed,
  updateText,
} = await import("./textShare.ts");

test("a new session is empty, open, and readable back", async () => {
  const session = await createSession();
  assert.equal(session.text, "");
  assert.equal(session.closed, false);
  const loaded = await readSession(session.id);
  assert.equal(loaded?.editToken, session.editToken);
});

test("the public view never carries the edit token", async () => {
  const session = await createSession();
  const view = publicView(session);
  assert.equal("editToken" in view, false);
  assert.equal(view.live, true);
});

test("only the edit token writes", async () => {
  const session = await createSession();
  assert.equal(await updateText(session.id, "wrong", "x"), null);
  assert.equal(await updateText(session.id, "", "x"), null);
  const ok = await updateText(session.id, session.editToken, "hello");
  assert.equal(ok?.text, "hello");
});

test("one session's token does not open another", async () => {
  const mine = await createSession();
  const theirs = await createSession();
  assert.equal(ownsSession(theirs, mine.editToken), false);
  assert.equal(await updateText(theirs.id, mine.editToken, "x"), null);
  assert.equal(await deleteSession(theirs.id, mine.editToken), false);
});

test("a token of a different length is rejected rather than throwing", async () => {
  const session = await createSession();
  assert.equal(ownsSession(session, "short"), false);
  assert.equal(ownsSession(session, `${session.editToken}x`), false);
  assert.equal(ownsSession(session, session.editToken), true);
});

test("text is capped, on whole characters", async () => {
  const capped = clampText("x".repeat(300_000));
  assert.ok(Buffer.byteLength(capped, "utf8") <= 128 * 1024);
  // Multi-byte characters must not be cut in half.
  const emoji = clampText("🔑".repeat(100_000));
  assert.ok(Buffer.byteLength(emoji, "utf8") <= 128 * 1024);
  assert.equal(emoji.includes("�"), false, "a character was cut mid-codepoint");
  assert.ok([...emoji].every((char) => char === "🔑"));
});

test("short text is returned untouched", () => {
  assert.equal(clampText("hello"), "hello");
  assert.equal(clampText(""), "");
});

test("a closed session stops serving its text", async () => {
  const session = await createSession();
  await updateText(session.id, session.editToken, "secret");
  const closed = await setClosed(session.id, session.editToken, true);
  const view = publicView(closed!);
  assert.equal(view.text, "", "a closed session still handed out its text");
  assert.equal(view.live, false);
});

test("an elapsed expiry stops serving the text too", async () => {
  const session = await createSession();
  await updateText(session.id, session.editToken, "secret");
  const stale = {
    ...(await readSession(session.id))!,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  };
  assert.equal(isExpired(stale), true);
  assert.equal(publicView(stale).text, "");
});

test("zero hours means it never expires", async () => {
  assert.equal((await createSession(0)).expiresAt, null);
  assert.notEqual((await createSession(1)).expiresAt, null);
});

test("deleting removes the session for good", async () => {
  const session = await createSession();
  assert.equal(await deleteSession(session.id, session.editToken), true);
  assert.equal(await readSession(session.id), null);
});

test("an id that is not an id reads as missing rather than escaping the directory", async () => {
  assert.equal(await readSession("../../etc/passwd"), null);
  assert.equal(await readSession(""), null);
  assert.equal(await updateText("../../etc", "t", "x"), null);
});

test.after(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});
