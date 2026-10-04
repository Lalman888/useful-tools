"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  POLL_INTERVAL_MS,
  openTextSocket,
  sendJson,
  type WatchMessage,
} from "@/lib/textShareClient";
import { VerbatimText } from "./VerbatimText";
import { Alert, Button, Checkbox, Spinner, cx } from "./ui";

type Snapshot = {
  text: string;
  closed: boolean;
  expired: boolean;
  live: boolean;
};

type Connection = "connecting" | "live" | "polling" | "ended" | "missing";

export function LiveTextViewer({ id }: { id: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<Connection>("connecting");
  const [sharerPresent, setSharerPresent] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [numbers, setNumbers] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [copied, setCopied] = useState(false);
  const [controls, setControls] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Read inside callbacks that outlive the render they were created in.
  const stateRef = useRef<Connection>("connecting");
  stateRef.current = state;

  const loadSnapshot = useCallback(async (): Promise<Snapshot | null> => {
    try {
      const response = await fetch(`/api/text/${id}`, { cache: "no-store" });
      if (response.status === 404) {
        setState("missing");
        return null;
      }
      if (!response.ok) return null;
      return (await response.json()) as Snapshot;
    } catch {
      return null;
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    const startPolling = () => {
      if (cancelled || pollRef.current) return;
      setState((current) => (current === "missing" ? current : "polling"));
      pollRef.current = setInterval(async () => {
        const snapshot = await loadSnapshot();
        if (cancelled || !snapshot) return;
        setText(snapshot.text);
        if (!snapshot.live) setState("ended");
      }, POLL_INTERVAL_MS);
    };

    void (async () => {
      // The snapshot first: it is one request and it puts something on screen
      // immediately, rather than leaving the page blank while the socket opens.
      const snapshot = await loadSnapshot();
      if (cancelled) return;
      if (snapshot) {
        setText(snapshot.text);
        if (!snapshot.live) {
          setState("ended");
          return;
        }
      }

      try {
        const socket = await openTextSocket();
        if (cancelled) {
          socket.close();
          return;
        }
        socketRef.current = socket;
        socket.onmessage = (event) => {
          let message: WatchMessage;
          try {
            message = JSON.parse(String(event.data)) as WatchMessage;
          } catch {
            return;
          }
          if (message.type === "text") {
            setText(message.text);
            setSharerPresent(message.live);
            setState("live");
          } else if (message.type === "host-left") {
            setSharerPresent(false);
          } else if (message.type === "stopped") {
            setText("");
            setState("ended");
          } else if (message.type === "error") {
            setState("missing");
          }
        };
        socket.onclose = () => {
          socketRef.current = null;
          // Only fall back if the session has not simply finished.
          if (!cancelled && stateRef.current !== "ended" && stateRef.current !== "missing") {
            startPolling();
          }
        };
        sendJson(socket, { type: "watch", id });
        setState("live");
      } catch {
        // No socket on this deployment, or it is being blocked. The link still
        // works, a few seconds behind.
        startPolling();
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        sendJson(socket, { type: "bye" });
        socket.close();
      }
    };
  }, [id, loadSnapshot]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; the text is on screen to copy by hand */
    }
  };

  if (state === "missing") {
    return (
      <Alert>
        This link is not valid. It may have been stopped by whoever shared it, or
        it may have expired.
      </Alert>
    );
  }

  const ended = state === "ended";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
          <span
            aria-hidden
            className={cx(
              "inline-block h-2 w-2 rounded-full",
              ended
                ? "bg-slate-300"
                : sharerPresent || state === "live"
                  ? "animate-pulse bg-emerald-500"
                  : "bg-amber-400"
            )}
          />
          {ended
            ? "Sharing has ended"
            : state === "connecting"
              ? "Connecting"
              : sharerPresent
                ? "Live"
                : state === "polling"
                  ? "Checking every few seconds"
                  : "Waiting for the sharer"}
        </span>

        {state === "connecting" && <Spinner className="text-slate-400" />}

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={copy} disabled={!text}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setControls((c) => !c)}>
            {controls ? "Hide display options" : "Display options"}
          </Button>
        </div>
      </div>

      {controls && (
        <div className="flex flex-wrap items-center gap-6 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Text size
            <input
              type="range"
              min={11}
              max={28}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
              className="accent-slate-900"
            />
            <span className="w-10 text-xs text-slate-500 tnum">{fontSize}px</span>
          </label>
          <Checkbox label="Wrap long lines" checked={wrap} onChange={setWrap} />
          <Checkbox label="Line numbers" checked={numbers} onChange={setNumbers} />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {text ? (
          <VerbatimText text={text} wrap={wrap} numbers={numbers} fontSize={fontSize} />
        ) : (
          <p className="px-4 py-12 text-center text-sm text-slate-500">
            {ended
              ? "The text is no longer being shared."
              : "Nothing has been typed yet. Whatever the sharer types will appear here."}
          </p>
        )}
      </div>

      {!ended && sharerPresent === false && state !== "connecting" && text && (
        <Alert tone="info">
          Showing the last text that was sent. It will update by itself when the
          sharer is back.
        </Alert>
      )}
    </div>
  );
}
