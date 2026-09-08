"use client";

import { useCallback, useEffect, useState } from "react";
import { SheetViewer } from "./SheetViewer";
import { Alert, Button, Spinner, TextInput } from "./ui";

type Meta = {
  id: string;
  name?: string;
  size?: number;
  type?: string;
  createdAt?: string;
  expiresAt?: string | null;
  downloads?: number;
  maxDownloads?: number | null;
  protected: boolean;
  unlocked: boolean;
  previewable?: boolean;
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

const INLINE_PREVIEW = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export function FileLanding({ id }: { id: string }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/files/${id}/meta`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "File not found.");
      setMeta(payload as Meta);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "File not found.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setUnlocking(true);
    setError(null);
    try {
      const response = await fetch(`/api/files/${id}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Incorrect password.");
      setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect password.");
    } finally {
      setUnlocking(false);
    }
  };

  if (loading && !meta) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-600">
        <Spinner /> Loading…
      </div>
    );
  }

  if (error && !meta) {
    return (
      <div className="mx-auto max-w-lg">
        <Alert>{error}</Alert>
      </div>
    );
  }

  if (meta && !meta.unlocked) {
    return (
      <form onSubmit={unlock} className="mx-auto max-w-sm space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">This file is protected</h2>
          <p className="mt-1.5 text-sm text-slate-600">
            Enter the password you were given to see and download it.
          </p>
          <TextInput
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoFocus
            className="mt-4"
          />
          {error && (
            <p className="mt-2 text-xs text-red-700" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="mt-4 w-full"
            disabled={unlocking || !password}
          >
            {unlocking ? <Spinner /> : null} Unlock
          </Button>
        </div>
      </form>
    );
  }

  if (!meta?.name) return null;

  const canPreviewInline = meta.type ? INLINE_PREVIEW.has(meta.type) : false;
  const expires = meta.expiresAt ? new Date(meta.expiresAt) : null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-slate-900">{meta.name}</h1>
            <p className="mt-1 text-sm text-slate-600 tnum">
              {formatBytes(meta.size ?? 0)}
              {meta.type ? ` · ${meta.type}` : ""}
              {typeof meta.downloads === "number" && ` · ${meta.downloads} downloads`}
            </p>
            {expires && (
              <p className="mt-0.5 text-xs text-slate-500">
                Link expires {expires.toLocaleString()}
              </p>
            )}
            {meta.maxDownloads != null && (
              <p className="mt-0.5 text-xs text-slate-500 tnum">
                {Math.max(0, meta.maxDownloads - (meta.downloads ?? 0))} downloads remaining
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {(meta.previewable || canPreviewInline) && (
              <Button onClick={() => setShowPreview((current) => !current)}>
                {showPreview ? "Hide preview" : "Preview"}
              </Button>
            )}
            <Button variant="primary" onClick={() => window.location.assign(`/api/files/${id}`)}>
              Download
            </Button>
          </div>
        </div>
      </div>

      {showPreview && meta.previewable && (
        <SheetViewer fileId={id} fileName={meta.name} />
      )}

      {showPreview && !meta.previewable && canPreviewInline && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {meta.type === "application/pdf" ? (
            <iframe
              title={meta.name}
              src={`/api/files/${id}?inline=1`}
              className="h-[calc(100vh-18rem)] w-full border-0"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/${id}?inline=1`}
              alt={meta.name}
              className="mx-auto max-h-[70vh] w-auto"
            />
          )}
        </div>
      )}
    </div>
  );
}
