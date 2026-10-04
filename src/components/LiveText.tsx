"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { triggerDownload } from "@/lib/xlsxExport";
import { safeFilename } from "@/lib/filename";
import {
  openTextSocket,
  sendJson,
  shareUrl,
  type HostMessage,
} from "@/lib/textShareClient";
import { forgetShare, readShare, rememberShare } from "@/lib/textShareHistory";
import { VerbatimText } from "./VerbatimText";
import { Alert, Button, Checkbox, Field, Spinner, cx } from "./ui";

/**
 * Shows pasted text back exactly as it was pasted.
 *
 * Nothing here parses, formats or highlights the content: it goes into the page
 * as a React text node inside a <pre>, so every space, tab, blank line and
 * stray character survives and no markup in it is ever interpreted. The page's
 * own colours are the only thing that differs from the source.
 */

const SAMPLE = `# paste anything — it comes back byte for byte

DATABASE_URL=postgres://user:pass@localhost:5432/app
REDIS_URL=redis://localhost:6379
    INDENTED=preserved exactly
STRIPE_KEY=sk_live_51H8xQ2abcdefghijklmnop

  trailing spaces, tabs	and	blank lines all survive
`;

/** Lines shaped like `KEY=value`, `KEY: value` or `export KEY=value`. */
const ASSIGNMENT = /^(\s*(?:export\s+)?[A-Za-z_][\w.-]*\s*[:=]\s*)(.*)$/;

function maskAssignments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const match = line.match(ASSIGNMENT);
      if (!match) return line;
      const [, key, value] = match;
      const trimmed = value.trim();
      if (!trimmed) return line;
      // Keep the length visible so the shape of the file is unchanged, and keep
      // any quotes, so a masked line still reads as the line it replaced.
      const quote = /^(['"]).*\1$/.test(trimmed) ? trimmed[0] : "";
      const inner = quote ? trimmed.slice(1, -1) : trimmed;
      return `${key}${quote}${"•".repeat(Math.min(inner.length, 32))}${quote}`;
    })
    .join("\n");
}

export function LiveText({ canShare }: { canShare: boolean }) {
  const [text, setText] = useState("");
  const [wrap, setWrap] = useState(true);
  const [numbers, setNumbers] = useState(false);
  const [mask, setMask] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [editing, setEditing] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saveAs, setSaveAs] = useState("");
  const [restored, setRestored] = useState(false);

  // Sharing
  const [share, setShare] = useState<{ id: string; editToken: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [watchers, setWatchers] = useState(0);
  const [connected, setConnected] = useState(false);
  const [shareError, setShareError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  // What was last pushed, so an unchanged render does not re-send.
  const sentRef = useRef<string | null>(null);

  // Kept per-browser only. Reloading the page mid-conversation and losing what
  // you were showing somebody would be the worst moment for it to vanish.
  useEffect(() => {
    try {
      setText(localStorage.getItem("useful-tools:livetext") ?? "");
    } catch {
      /* storage disabled or private mode */
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem("useful-tools:livetext", text);
    } catch {
      /* nothing useful to do; the text is still on screen */
    }
  }, [text, restored]);

  const shown = useMemo(() => (mask ? maskAssignments(text) : text), [mask, text]);

  const stats = useMemo(
    () => ({
      lines: text ? text.split("\n").length : 0,
      characters: text.length,
      // Not the same as the character count once anything non-ASCII is in there,
      // which is exactly when a length limit somewhere else starts biting.
      bytes: new TextEncoder().encode(text).length,
    }),
    [text]
  );

  /* ------------------------------ sharing ------------------------------ */

  // Reconnects to the session this browser was already sharing, so a reload
  // does not strand everybody watching the link on a session nobody writes to.
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    const existing = readShare();
    if (existing) setShare({ id: existing.id, editToken: existing.editToken });
  }, []);

  useEffect(() => {
    if (!share) return;
    let cancelled = false;

    void (async () => {
      try {
        const socket = await openTextSocket();
        if (cancelled) {
          socket.close();
          return;
        }
        socketRef.current = socket;
        socket.onmessage = (event) => {
          let message: HostMessage;
          try {
            message = JSON.parse(String(event.data)) as HostMessage;
          } catch {
            return;
          }
          if (message.type === "hosting") {
            setConnected(true);
            setWatchers(message.watchers);
            setShareError("");
          } else if (message.type === "watchers") {
            setWatchers(message.count);
          } else if (message.type === "taken-over") {
            setShareError("This link is now being shared from another tab.");
          } else if (message.type === "error") {
            // The session is gone — expired, or stopped from somewhere else.
            setShareError(message.error);
            setConnected(false);
            forgetShare();
            setShare(null);
          }
        };
        socket.onclose = () => {
          socketRef.current = null;
          if (!cancelled) setConnected(false);
        };
        sendJson(socket, { type: "host", id: share.id, token: share.editToken });
        // Whatever is on screen now is the truth; push it immediately rather
        // than waiting for the next keystroke.
        sentRef.current = null;
      } catch {
        if (!cancelled) {
          setConnected(false);
          setShareError(
            "Live updates are not available on this deployment, so viewers will " +
              "see the text refresh every few seconds instead."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, [share]);

  // Push what is on screen. `shown`, not `text`: if values are hidden, the
  // masked version is what is being shown and so what is shared — the raw
  // secrets must not leave this browser.
  useEffect(() => {
    if (!share) return;
    if (sentRef.current === shown) return;

    const timer = setTimeout(() => {
      sentRef.current = shown;
      sendJson(socketRef.current, { type: "update", text: shown });
      // And a snapshot, so somebody opening the link later — or reloading —
      // gets the current text rather than an empty page.
      void fetch(`/api/text/${share.id}?token=${encodeURIComponent(share.editToken)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: shown }),
      }).catch(() => {
        /* the live stream is unaffected; the snapshot catches up next time */
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [share, shown]);

  const startSharing = useCallback(async () => {
    setStarting(true);
    setShareError("");
    try {
      const response = await fetch("/api/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        id?: string;
        editToken?: string;
        error?: string;
      };
      if (!response.ok || !payload.id || !payload.editToken) {
        throw new Error(payload.error ?? "Could not start sharing.");
      }
      rememberShare({ id: payload.id, editToken: payload.editToken });
      sentRef.current = null;
      setShare({ id: payload.id, editToken: payload.editToken });
    } catch (caught) {
      setShareError(caught instanceof Error ? caught.message : "Could not start sharing.");
    } finally {
      setStarting(false);
    }
  }, []);

  const stopSharing = useCallback(async () => {
    const current = share;
    if (!current) return;
    sendJson(socketRef.current, { type: "stop" });
    setShare(null);
    setConnected(false);
    setWatchers(0);
    forgetShare();
    // Delete rather than just closing: the text was only ever on the server to
    // serve this link, so when the link goes, so should it.
    await fetch(`/api/text/${current.id}?token=${encodeURIComponent(current.editToken)}`, {
      method: "DELETE",
    }).catch(() => {
      /* the link is already unreachable from this browser */
    });
  }, [share]);

  const copyLink = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(shareUrl(share.id));
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      /* clipboard blocked; the link is on screen */
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; the text is on screen to copy by hand */
    }
  };

  const download = () => {
    triggerDownload(
      new Blob([shown], { type: "text/plain;charset=utf-8" }),
      safeFilename(saveAs, ".txt", "pasted-text")
    );
  };

  const empty = !text;

  const sharing = share !== null;
  // window is not there during the server render, so this is filled in after
  // mount rather than read inline.
  const shareLink = origin && share ? `${origin}/t/${share.id}` : "";

  return (
    <div className="space-y-4">
      {/* ------------------------------- share ------------------------------- */}
      <div
        className={cx(
          "rounded-xl border px-4 py-3",
          sharing ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"
        )}
      >
        {!sharing ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">Share this text live</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {canShare
                  ? "Send someone the link and they see what you type, as you type it."
                  : "Needs a server with a disk, which this deployment does not have."}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={startSharing}
              disabled={!canShare || starting}
            >
              {starting && <Spinner />}
              Start sharing
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <span
                  aria-hidden
                  className={cx(
                    "inline-block h-2 w-2 rounded-full",
                    connected ? "animate-pulse bg-emerald-500" : "bg-amber-400"
                  )}
                />
                {connected ? "Sharing live" : "Sharing"}
              </span>
              <span className="text-xs text-slate-600 tnum">
                {watchers === 0
                  ? "nobody watching yet"
                  : `${watchers} ${watchers === 1 ? "person" : "people"} watching`}
              </span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={stopSharing}>
                Stop sharing
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareLink}
                onFocus={(event) => event.target.select()}
                aria-label="Link to share"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-700"
              />
              <Button size="sm" onClick={copyLink}>
                {linkCopied ? "Copied" : "Copy link"}
              </Button>
              <a
                href={shareLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
              >
                Open
              </a>
            </div>

            <p className="text-xs leading-relaxed text-slate-600">
              Anyone with this link can read the text, so treat the link as the
              secret.{" "}
              {mask
                ? "Values are hidden, and what you are sharing is the masked version — the real values stay in this browser."
                : "They see exactly what is on your screen."}
            </p>
          </div>
        )}

        {shareError && (
          <div className="mt-2.5">
            <Alert tone="warn">{shareError}</Alert>
          </div>
        )}
      </div>

      {/* ------------------------------ toolbar ------------------------------ */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <Button size="sm" onClick={() => setEditing((current) => !current)}>
          {editing ? "Hide the box" : "Edit text"}
        </Button>
        <Button size="sm" onClick={copy} disabled={empty}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" onClick={download} disabled={empty}>
          Download
        </Button>
        <input
          value={saveAs}
          onChange={(event) => setSaveAs(event.target.value)}
          placeholder="pasted-text.txt"
          spellCheck={false}
          aria-label="File name for the download"
          className="w-40 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:outline-none"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setText("")}
          disabled={empty}
        >
          Clear
        </Button>
        {empty && (
          <Button size="sm" variant="ghost" onClick={() => setText(SAMPLE)}>
            Use a sample
          </Button>
        )}
        <span className="ml-auto text-xs text-slate-500 tnum">
          {stats.lines.toLocaleString()} lines · {stats.characters.toLocaleString()} chars ·{" "}
          {stats.bytes.toLocaleString()} bytes
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-4">
          {editing && (
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              placeholder="Paste anything here — an .env file, a config block, a log, a key."
              className="h-52 w-full resize-y rounded-xl border border-slate-300 bg-white p-3.5 font-mono text-[13px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:outline-none"
            />
          )}

          {/* ------------------------------ output ----------------------------- */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
              <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
                {mask ? "Shown with values hidden" : "Exactly as pasted"}
              </h2>
              {!wrap && (
                <span className="text-xs text-slate-400">scrolls sideways</span>
              )}
            </div>
            {empty ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                Whatever you paste appears here, character for character.
              </p>
            ) : (
              <VerbatimText
                text={shown}
                wrap={wrap}
                numbers={numbers}
                fontSize={fontSize}
              />
            )}
          </div>
        </div>

        {/* ------------------------------ controls ----------------------------- */}
        <aside className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Display
          </h2>

          <Field label={`Text size — ${fontSize}px`}>
            <input
              type="range"
              min={11}
              max={28}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
              className="w-full accent-slate-900"
            />
          </Field>

          <Checkbox
            label="Wrap long lines"
            checked={wrap}
            onChange={setWrap}
            hint="Off shows them full length, scrolling sideways."
          />
          <Checkbox label="Line numbers" checked={numbers} onChange={setNumbers} />
          <Checkbox
            label="Hide values"
            checked={mask}
            onChange={setMask}
            hint="Masks the right-hand side of KEY=value lines, so you can show the shape of an .env without showing the secrets."
          />

          <p className="border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500">
            Nothing is uploaded and nothing is sent anywhere. The text stays in
            this browser, and is kept here if you reload.
          </p>
        </aside>
      </div>

      {mask && (
        <Alert tone="warn">
          Hiding values changes what is shown, and what Copy and Download
          produce. Turn it off to get the text back exactly as you pasted it.
        </Alert>
      )}
    </div>
  );
}
