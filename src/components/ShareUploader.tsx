"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadFile, type UploadSettings } from "@/lib/uploadClient";
import { Alert, Button, Checkbox, Field, Spinner, TextInput, cx, inputClass } from "./ui";

type Status = "queued" | "uploading" | "done" | "error" | "cancelled";

type Item = {
  key: string;
  file: File;
  status: Status;
  uploaded: number;
  bytesPerSecond: number;
  id?: string;
  deleteToken?: string;
  error?: string;
};

const EXPIRY_CHOICES = [
  { label: "1 hour", value: 1 },
  { label: "24 hours", value: 24 },
  { label: "7 days", value: 168 },
  { label: "30 days", value: 720 },
  { label: "Never", value: 0 },
];

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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m left`;
  return `${(seconds / 3600).toFixed(1)}h left`;
}

/** Remembers delete tokens locally so the uploader can revoke their own links. */
function rememberUpload(id: string, name: string, deleteToken: string): void {
  try {
    const key = "useful-tools:uploads";
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown[];
    existing.unshift({ id, name, deleteToken, at: Date.now() });
    localStorage.setItem(key, JSON.stringify(existing.slice(0, 50)));
  } catch {
    /* storage may be unavailable; the link still works */
  }
}

export function ShareUploader() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [expiryHours, setExpiryHours] = useState(168);
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [limitDownloads, setLimitDownloads] = useState(false);
  const [maxDownloads, setMaxDownloads] = useState(5);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    const map = controllers.current;
    return () => {
      for (const controller of map.values()) controller.abort();
    };
  }, []);

  const update = useCallback((key: string, patch: Partial<Item>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item))
    );
  }, []);

  const start = useCallback(
    async (item: Item, settings: UploadSettings) => {
      const controller = new AbortController();
      controllers.current.set(item.key, controller);
      update(item.key, { status: "uploading", uploaded: 0 });

      try {
        const result = await uploadFile(
          item.file,
          settings,
          (progress) =>
            update(item.key, {
              uploaded: progress.uploaded,
              bytesPerSecond: progress.bytesPerSecond,
            }),
          controller.signal
        );
        rememberUpload(result.id, item.file.name, result.deleteToken);
        update(item.key, {
          status: "done",
          uploaded: item.file.size,
          id: result.id,
          deleteToken: result.deleteToken,
        });
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
    [update]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const settings: UploadSettings = {
        expiresInHours: expiryHours > 0 ? expiryHours : null,
        maxDownloads: limitDownloads ? maxDownloads : null,
        password: usePassword && password ? password : null,
      };

      const created: Item[] = Array.from(files).map((file, index) => ({
        key: `${Date.now()}-${index}-${file.name}`,
        file,
        status: "queued",
        uploaded: 0,
        bytesPerSecond: 0,
      }));

      setItems((current) => [...created, ...current]);
      // Sequential: one large file at a time keeps the progress readings honest
      // and avoids competing for the same upstream bandwidth.
      void created.reduce(
        (chain, item) => chain.then(() => start(item, settings)),
        Promise.resolve()
      );
    },
    [expiryHours, limitDownloads, maxDownloads, password, usePassword, start]
  );

  const copy = async (id: string) => {
    const link = `${origin}/f/${id}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(id);
      setTimeout(() => setCopied((current) => (current === id ? null : current)), 1800);
    } catch {
      /* clipboard blocked; the link is on screen to copy by hand */
    }
  };

  const busy = items.some((item) => item.status === "uploading");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
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
            Any file type. Uploads are sent in chunks and pick up where they left off if
            the connection drops.
          </p>
          <Button variant="primary" className="mt-5" onClick={() => inputRef.current?.click()}>
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

        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((item) => {
              const percent =
                item.file.size > 0 ? Math.round((item.uploaded / item.file.size) * 100) : 0;
              const remaining =
                item.bytesPerSecond > 0
                  ? (item.file.size - item.uploaded) / item.bytesPerSecond
                  : 0;
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
                        {item.status === "uploading" && (
                          <>
                            {" · "}
                            {percent}%
                            {item.bytesPerSecond > 0 &&
                              ` · ${formatBytes(item.bytesPerSecond)}/s · ${formatDuration(remaining)}`}
                          </>
                        )}
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

                  {item.status === "done" && item.id && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <input
                        readOnly
                        value={`${origin}/f/${item.id}`}
                        onFocus={(event) => event.target.select()}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-700"
                      />
                      <Button size="sm" onClick={() => copy(item.id!)}>
                        {copied === item.id ? "Copied" : "Copy"}
                      </Button>
                      <a
                        href={`/f/${item.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        Open
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
          Link settings
        </h2>
        {busy && (
          <Alert tone="info">
            Settings apply to files added from now on; uploads in flight keep the settings
            they started with.
          </Alert>
        )}

        <Field label="Expires after">
          <select
            value={expiryHours}
            onChange={(event) => setExpiryHours(Number(event.target.value))}
            className={inputClass}
          >
            {EXPIRY_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </Field>

        <div>
          <Checkbox
            label="Require a password"
            checked={usePassword}
            onChange={setUsePassword}
          />
          {usePassword && (
            <TextInput
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              className="mt-2"
            />
          )}
        </div>

        <div>
          <Checkbox
            label="Limit downloads"
            checked={limitDownloads}
            onChange={setLimitDownloads}
          />
          {limitDownloads && (
            <TextInput
              type="number"
              min={1}
              value={maxDownloads}
              onChange={(event) => setMaxDownloads(Number(event.target.value))}
              className="mt-2"
            />
          )}
        </div>

        <p className="border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500">
          Files are held on this server&rsquo;s disk. There is no per-file size limit in the
          application, so the practical ceiling is free space on the volume.
        </p>
      </aside>
    </div>
  );
}
