"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadFile } from "@/lib/uploadClient";
import { Alert, Button, Field, Spinner, TextInput, cx } from "./ui";

type PublicRequest = {
  id: string;
  title: string;
  note: string;
  protected: boolean;
  open: boolean;
  closed: boolean;
  expired: boolean;
  expiresAt: string | null;
  remaining: number;
};

type Status = "queued" | "uploading" | "done" | "error" | "cancelled";

type Item = {
  key: string;
  file: File;
  status: Status;
  uploaded: number;
  bytesPerSecond: number;
  error?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function RequestDropbox({ id }: { id: string }) {
  const [detail, setDetail] = useState<PublicRequest | null>(null);
  const [loadError, setLoadError] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const [submitter, setSubmitter] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>());
  // Read inside the upload callback, which would otherwise close over the name
  // as it was when the drop handler was created.
  const submitterRef = useRef("");

  useEffect(() => {
    submitterRef.current = submitter;
  }, [submitter]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/requests/${id}`);
      if (!response.ok) {
        setLoadError("This request link is not valid. Ask whoever sent it for a new one.");
        return;
      }
      const payload = (await response.json()) as PublicRequest;
      setDetail(payload);
      setUnlocked((current) => current || !payload.protected);
    } catch {
      setLoadError("Could not reach the server. Check your connection and try again.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const map = controllers.current;
    return () => {
      for (const controller of map.values()) controller.abort();
    };
  }, []);

  const unlock = async () => {
    setUnlocking(true);
    setUnlockError("");
    try {
      const response = await fetch(`/api/requests/${id}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setUnlockError("That password is not right.");
        return;
      }
      setUnlocked(true);
      setPassword("");
    } catch {
      setUnlockError("Could not reach the server.");
    } finally {
      setUnlocking(false);
    }
  };

  const update = useCallback((key: string, patch: Partial<Item>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item))
    );
  }, []);

  const start = useCallback(
    async (item: Item) => {
      const controller = new AbortController();
      controllers.current.set(item.key, controller);
      update(item.key, { status: "uploading", uploaded: 0 });
      try {
        await uploadFile(
          item.file,
          {
            // The owner sets how long files live, not the sender.
            expiresInHours: null,
            maxDownloads: null,
            password: null,
            requestId: id,
            submitter: submitterRef.current.trim() || "Anonymous",
          },
          (progress) =>
            update(item.key, {
              uploaded: progress.uploaded,
              bytesPerSecond: progress.bytesPerSecond,
            }),
          controller.signal
        );
        update(item.key, { status: "done", uploaded: item.file.size });
        await load(); // refresh how many slots are left
      } catch (error) {
        if (controller.signal.aborted) {
          update(item.key, { status: "cancelled" });
        } else {
          update(item.key, {
            status: "error",
            error: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      } finally {
        controllers.current.delete(item.key);
      }
    },
    [id, load, update]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const created: Item[] = Array.from(files).map((file, index) => ({
        key: `${Date.now()}-${index}-${file.name}`,
        file,
        status: "queued",
        uploaded: 0,
        bytesPerSecond: 0,
      }));
      setItems((current) => [...created, ...current]);
      void created.reduce((chain, item) => chain.then(() => start(item)), Promise.resolve());
    },
    [start]
  );

  if (loadError) {
    return <Alert>{loadError}</Alert>;
  }

  if (!detail) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner /> Loading
      </p>
    );
  }

  const sentCount = items.filter((item) => item.status === "done").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {detail.title}
        </h1>
        {detail.note && (
          <p className="mt-2 max-w-2xl text-sm whitespace-pre-wrap text-slate-600">
            {detail.note}
          </p>
        )}
      </div>

      {!detail.open && (
        <Alert tone="warn">
          {detail.expired
            ? "This request has expired and is no longer accepting files."
            : detail.closed
              ? "This request has been closed and is no longer accepting files."
              : "This request has received all the files it was set up to accept."}
        </Alert>
      )}

      {detail.open && detail.protected && !unlocked && (
        <div className="max-w-sm space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <Field label="Password" hint="Whoever sent you this link will have given it to you.">
            <TextInput
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void unlock();
              }}
            />
          </Field>
          {unlockError && <Alert>{unlockError}</Alert>}
          <Button variant="primary" onClick={unlock} disabled={unlocking}>
            {unlocking && <Spinner />}
            Unlock
          </Button>
        </div>
      )}

      {detail.open && unlocked && (
        <>
          <div className="max-w-sm">
            <Field label="Your name" hint="Shown alongside the files so they know who sent them.">
              <TextInput
                value={submitter}
                onChange={(event) => setSubmitter(event.target.value)}
                placeholder="Anonymous"
                maxLength={80}
              />
            </Field>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
            }}
            className={cx(
              "rounded-xl border-2 border-dashed p-10 text-center transition",
              dragging ? "border-slate-900 bg-slate-100" : "border-slate-300 bg-white"
            )}
          >
            <p className="text-sm font-medium text-slate-900">
              Drop files here, or choose them
            </p>
            <p className="mt-1.5 text-xs text-slate-500">
              {detail.remaining} more {detail.remaining === 1 ? "file" : "files"} can be sent.
              Uploads resume by themselves if the connection drops.
            </p>
            <Button
              variant="primary"
              className="mt-5"
              onClick={() => inputRef.current?.click()}
            >
              Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        </>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => {
            const percent =
              item.file.size > 0 ? Math.round((item.uploaded / item.file.size) * 100) : 0;
            return (
              <li
                key={item.key}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {item.file.name}
                    </p>
                    <p className="text-xs text-slate-500 tnum">
                      {formatBytes(item.file.size)}
                      {item.status === "uploading" && ` · ${percent}%`}
                      {item.status === "done" && " · sent"}
                      {item.status === "cancelled" && " · cancelled"}
                    </p>
                  </div>
                  {item.status === "uploading" && (
                    <>
                      <Spinner className="text-slate-400" />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => controllers.current.get(item.key)?.abort()}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                  {item.status === "done" && (
                    <span aria-hidden className="text-sm text-emerald-600">
                      ✓
                    </span>
                  )}
                </div>

                {item.status === "uploading" && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-900 transition-[width] duration-200"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                )}

                {item.status === "error" && (
                  <p className="mt-2 text-xs text-red-700">{item.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {sentCount > 0 && (
        <Alert tone="info">
          {sentCount} {sentCount === 1 ? "file has" : "files have"} been sent. Only the
          person who created this request can open them — not even you can download them
          back from here.
        </Alert>
      )}
    </div>
  );
}
