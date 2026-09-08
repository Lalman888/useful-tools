"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BUFFER_HIGH_WATER,
  CHUNK_SIZE,
  createPeerConnection,
  formatBytes,
  signalingUrl,
  waitForDrain,
  type PeerMessage,
} from "@/lib/peer";
import { Alert, Button, Spinner, TextInput, cx } from "./ui";

type Phase =
  | "idle"
  | "waiting" // sender: room open, nobody has joined
  | "connecting" // peers found each other, negotiating
  | "offered" // receiver: metadata arrived, waiting for the user to accept
  | "transferring"
  | "complete"
  | "error";

type Incoming = { name: string; size: number; type: string };

/** True when the browser can stream straight to a file the user picks. */
function canStreamToDisk(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

type SaveTarget = {
  write: (chunk: ArrayBuffer) => Promise<void>;
  finish: () => Promise<void>;
  /** Set when the transfer had to be buffered in memory instead. */
  blobParts?: BlobPart[];
};

export function PeerTransfer({ initialCode }: { initialCode?: string }) {
  const [mode, setMode] = useState<"send" | "receive">(initialCode ? "receive" : "send");
  const [phase, setPhase] = useState<Phase>("idle");
  const [code, setCode] = useState(initialCode ?? "");
  const [joinCode, setJoinCode] = useState(initialCode ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [transferred, setTransferred] = useState(0);
  const [rate, setRate] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedBlobUrl, setSavedBlobUrl] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const fileRef = useRef<File | null>(null);
  const targetRef = useRef<SaveTarget | null>(null);
  const receivedRef = useRef(0);
  // The data-channel and socket handlers are installed once and then outlive
  // several renders, so anything they read must come from a ref rather than a
  // captured state value.
  const incomingRef = useRef<Incoming | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const startedRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const teardown = useCallback(() => {
    channelRef.current?.close();
    peerRef.current?.close();
    socketRef.current?.close();
    channelRef.current = null;
    peerRef.current = null;
    socketRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const fail = useCallback((message: string) => {
    setError(message);
    setPhase("error");
  }, []);

  const send = (message: unknown) => socketRef.current?.send(JSON.stringify(message));

  /* ----------------------------- sending side ----------------------------- */

  const pushFile = useCallback(async (channel: RTCDataChannel) => {
    const source = fileRef.current;
    if (!source) return;

    setPhase("transferring");
    startedRef.current = Date.now();
    let offset = 0;

    try {
      while (offset < source.size) {
        const slice = source.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();

        if (channel.readyState !== "open") throw new Error("The connection closed.");
        if (channel.bufferedAmount >= BUFFER_HIGH_WATER) await waitForDrain(channel);

        channel.send(buffer);
        offset += buffer.byteLength;

        setTransferred(offset);
        const elapsed = (Date.now() - startedRef.current) / 1000;
        if (elapsed > 0) setRate(offset / elapsed);
      }

      channel.send(JSON.stringify({ kind: "done" } satisfies PeerMessage));
      setPhase("complete");
    } catch (err) {
      fail(err instanceof Error ? err.message : "The transfer failed.");
    }
  }, [fail]);

  /* ---------------------------- receiving side ---------------------------- */

  const handleChunk = useCallback(
    async (data: ArrayBuffer) => {
      const target = targetRef.current;
      if (!target) return;
      await target.write(data);
      receivedRef.current += data.byteLength;
      setTransferred(receivedRef.current);
      const elapsed = (Date.now() - startedRef.current) / 1000;
      if (elapsed > 0) setRate(receivedRef.current / elapsed);
    },
    []
  );

  const finishReceiving = useCallback(async () => {
    const target = targetRef.current;
    if (!target) return;
    await target.finish();
    const meta = incomingRef.current;
    if (target.blobParts) {
      const blob = new Blob(target.blobParts, {
        type: meta?.type || "application/octet-stream",
      });
      setSavedBlobUrl(URL.createObjectURL(blob));
    }
    setPhase("complete");
  }, []);

  const attachReceiver = useCallback(
    (channel: RTCDataChannel) => {
      channel.binaryType = "arraybuffer";
      // Chunks must be written in the order they arrive, so each message is
      // queued behind the previous write.
      let queue: Promise<void> = Promise.resolve();

      channel.onmessage = (event) => {
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data) as PeerMessage;
          if (message.kind === "meta") {
            const meta = { name: message.name, size: message.size, type: message.type };
            incomingRef.current = meta;
            setIncoming(meta);
            setPhase("offered");
          } else if (message.kind === "done") {
            queue = queue.then(finishReceiving);
          }
          return;
        }
        queue = queue.then(() => handleChunk(event.data as ArrayBuffer));
      };
      channel.onerror = () => fail("The peer connection failed.");
    },
    [fail, finishReceiving, handleChunk]
  );

  const acceptTransfer = async () => {
    const meta = incomingRef.current;
    if (!meta) return;
    try {
      if (canStreamToDisk()) {
        // Streaming to a real file keeps memory flat, so the size of the
        // transfer is not bounded by the tab's heap.
        const picker = (
          window as unknown as {
            showSaveFilePicker: (options: unknown) => Promise<FileSystemFileHandle>;
          }
        ).showSaveFilePicker;
        const handle = await picker({ suggestedName: meta.name });
        const writable = await handle.createWritable();
        targetRef.current = {
          write: (chunk) => writable.write(chunk),
          finish: () => writable.close(),
        };
      } else {
        const parts: BlobPart[] = [];
        targetRef.current = {
          write: async (chunk) => {
            parts.push(chunk);
          },
          finish: async () => undefined,
          blobParts: parts,
        };
      }
    } catch {
      // The user dismissed the save dialog; fall back to buffering in memory.
      const parts: BlobPart[] = [];
      targetRef.current = {
        write: async (chunk) => {
          parts.push(chunk);
        },
        finish: async () => undefined,
        blobParts: parts,
      };
    }

    receivedRef.current = 0;
    startedRef.current = Date.now();
    setTransferred(0);
    setPhase("transferring");
    channelRef.current?.send(JSON.stringify({ kind: "accept" } satisfies PeerMessage));
  };

  /* ------------------------------- signalling ------------------------------ */

  const openSocket = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(signalingUrl());
      socket.onopen = () => resolve(socket);
      socket.onerror = () => reject(new Error("Could not reach the signalling server."));
      socketRef.current = socket;
    });
  }, []);

  const attachPeerHandlers = useCallback(
    (peer: RTCPeerConnection) => {
      peer.onicecandidate = (event) => {
        if (event.candidate) send({ type: "signal", payload: { candidate: event.candidate } });
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed") {
          fail("Could not open a direct connection. A firewall may be blocking it.");
        }
      };
    },
    [fail]
  );

  const startSending = async () => {
    if (!file) return;
    fileRef.current = file;
    setError(null);
    setTransferred(0);

    try {
      const socket = await openSocket();
      send({ type: "create" });

      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "created") {
          setCode(message.code);
          setPhase("waiting");
          return;
        }
        if (message.type === "error") return fail(message.error);

        if (message.type === "peer-joined") {
          setPhase("connecting");
          const peer = createPeerConnection();
          peerRef.current = peer;
          attachPeerHandlers(peer);

          const channel = peer.createDataChannel("file", { ordered: true });
          channel.binaryType = "arraybuffer";
          channelRef.current = channel;

          channel.onopen = () => {
            channel.send(
              JSON.stringify({
                kind: "meta",
                name: file.name,
                size: file.size,
                type: file.type,
              } satisfies PeerMessage)
            );
          };
          channel.onmessage = (channelEvent) => {
            if (typeof channelEvent.data !== "string") return;
            const reply = JSON.parse(channelEvent.data) as PeerMessage;
            if (reply.kind === "accept") void pushFile(channel);
            if (reply.kind === "decline") fail("The other side declined the transfer.");
          };

          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          send({ type: "signal", payload: { sdp: peer.localDescription } });
          return;
        }

        if (message.type === "signal" && peerRef.current) {
          const { sdp, candidate } = message.payload;
          if (sdp) await peerRef.current.setRemoteDescription(sdp);
          if (candidate) await peerRef.current.addIceCandidate(candidate).catch(() => undefined);
        }
        if (message.type === "peer-left" && phaseRef.current !== "complete") {
          fail("The other side disconnected.");
        }
      };
    } catch (err) {
      fail(err instanceof Error ? err.message : "Could not start the transfer.");
    }
  };

  const startReceiving = async () => {
    setError(null);
    setPhase("connecting");
    try {
      const socket = await openSocket();
      send({ type: "join", code: joinCode.trim().toUpperCase() });

      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "error") return fail(message.error);
        if (message.type === "joined") return;

        if (message.type === "signal") {
          const { sdp, candidate } = message.payload;

          if (sdp?.type === "offer") {
            const peer = createPeerConnection();
            peerRef.current = peer;
            attachPeerHandlers(peer);
            peer.ondatachannel = (channelEvent) => {
              channelRef.current = channelEvent.channel;
              attachReceiver(channelEvent.channel);
            };
            await peer.setRemoteDescription(sdp);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            send({ type: "signal", payload: { sdp: peer.localDescription } });
            return;
          }
          if (candidate && peerRef.current) {
            await peerRef.current.addIceCandidate(candidate).catch(() => undefined);
          }
        }
        if (message.type === "peer-left" && phaseRef.current !== "complete") {
          fail("The other side disconnected.");
        }
      };
    } catch (err) {
      fail(err instanceof Error ? err.message : "Could not join that transfer.");
    }
  };

  /* --------------------------------- render -------------------------------- */

  const total = mode === "send" ? (file?.size ?? 0) : (incoming?.size ?? 0);
  const percent = total > 0 ? Math.round((transferred / total) * 100) : 0;
  const shareLink = code ? `${origin}/p2p?code=${code}` : "";

  const reset = () => {
    teardown();
    setPhase("idle");
    setCode("");
    setFile(null);
    setIncoming(null);
    incomingRef.current = null;
    setTransferred(0);
    setRate(0);
    setError(null);
    setSavedBlobUrl(null);
    targetRef.current = null;
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {phase === "idle" && (
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(["send", "receive"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cx(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition",
                mode === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
              )}
            >
              {value === "send" ? "Send a file" : "Receive a file"}
            </button>
          ))}
        </div>
      )}

      {error && <Alert>{error}</Alert>}

      {/* ------------------------------ sending ----------------------------- */}
      {mode === "send" && phase === "idle" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
                <p className="text-xs text-slate-500 tnum">{formatBytes(file.size)}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
                Change
              </Button>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm font-medium text-slate-900">Pick a file to send</p>
              <p className="mt-1.5 text-xs text-slate-500">
                It goes straight to the other browser over an encrypted connection. Nothing
                is uploaded here, so there is no size limit at all.
              </p>
              <Button variant="primary" className="mt-4" onClick={() => inputRef.current?.click()}>
                Choose a file
              </Button>
            </div>
          )}
          {file && (
            <Button variant="primary" className="mt-4 w-full" onClick={startSending}>
              Create a transfer link
            </Button>
          )}
        </div>
      )}

      {mode === "send" && phase === "waiting" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Share this code
          </p>
          <p className="mt-2 font-mono text-4xl font-semibold tracking-[0.2em] text-slate-900">
            {code}
          </p>
          <div className="mt-5 flex items-center gap-2">
            <input
              readOnly
              value={shareLink}
              onFocus={(event) => event.target.select()}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-700"
            />
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  /* clipboard blocked; the link is on screen */
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-600">
            <Spinner className="text-slate-400" /> Waiting for the other side to join…
          </p>
          <p className="mt-2 text-xs text-slate-500">Keep this tab open until it finishes.</p>
        </div>
      )}

      {/* ----------------------------- receiving ---------------------------- */}
      {mode === "receive" && phase === "idle" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-medium text-slate-900">Enter the transfer code</p>
          <p className="mt-1.5 text-xs text-slate-500">
            Ask the sender for the six-character code shown on their screen.
          </p>
          <TextInput
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="mt-4 text-center font-mono text-lg tracking-[0.25em]"
          />
          <Button
            variant="primary"
            className="mt-4 w-full"
            onClick={startReceiving}
            disabled={joinCode.trim().length < 6}
          >
            Connect
          </Button>
        </div>
      )}

      {phase === "connecting" && (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-12 text-sm text-slate-600">
          <Spinner /> Opening a direct connection…
        </div>
      )}

      {phase === "offered" && incoming && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm text-slate-600">The sender is offering</p>
          <p className="mt-1 truncate text-base font-semibold text-slate-900">{incoming.name}</p>
          <p className="text-xs text-slate-500 tnum">{formatBytes(incoming.size)}</p>
          {!canStreamToDisk() && (
            <p className="mt-3 text-xs text-amber-800">
              This browser buffers the file in memory before saving. For very large files,
              use a browser that supports saving directly to disk, such as Chrome or Edge.
            </p>
          )}
          <div className="mt-5 flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                channelRef.current?.send(JSON.stringify({ kind: "decline" } satisfies PeerMessage));
                reset();
              }}
            >
              Decline
            </Button>
            <Button variant="primary" className="flex-1" onClick={acceptTransfer}>
              Accept and save
            </Button>
          </div>
        </div>
      )}

      {phase === "transferring" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-slate-900">
              {mode === "send" ? "Sending" : "Receiving"}
            </p>
            <p className="text-xs text-slate-500 tnum">
              {formatBytes(transferred)} of {formatBytes(total)}
              {rate > 0 && ` · ${formatBytes(rate)}/s`}
            </p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-900 transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {phase === "complete" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <p className="text-sm font-semibold text-emerald-900">Transfer complete</p>
          {savedBlobUrl && incoming && (
            <a
              href={savedBlobUrl}
              download={incoming.name}
              className="mt-3 inline-block rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Save {incoming.name}
            </a>
          )}
          <div className="mt-4">
            <Button onClick={reset}>Start another</Button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="text-center">
          <Button onClick={reset}>Try again</Button>
        </div>
      )}
    </div>
  );
}
