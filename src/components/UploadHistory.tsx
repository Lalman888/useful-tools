"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  forgetUpload,
  readUploads,
  type UploadRecord,
} from "@/lib/uploadHistory";
import { Alert, Button, Spinner, cx } from "./ui";

type Live = {
  size?: number;
  type?: string;
  downloads?: number;
  maxDownloads?: number | null;
  expiresAt?: string | null;
  protected?: boolean;
};

type Row = UploadRecord & {
  /** "gone" covers expired, download-capped and manually deleted alike. */
  state: "checking" | "live" | "gone";
  live?: Live;
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

function formatWhen(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function UploadHistory() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    const records = readUploads();
    setRows(records.map((record) => ({ ...record, state: "checking" as const })));

    // Ask the server what actually still exists, so the list reflects
    // expiries and download caps rather than what we hoped was there.
    const checked = await Promise.all(
      records.map(async (record): Promise<Row> => {
        try {
          const response = await fetch(`/api/files/${record.id}/meta`);
          if (!response.ok) return { ...record, state: "gone" };
          const live = (await response.json()) as Live;
          return { ...record, state: "live", live };
        } catch {
          // A network failure is not proof the file is gone; leave it listed.
          return { ...record, state: "live" };
        }
      })
    );
    setRows(checked);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${origin}/f/${id}`);
      setCopied(id);
      setTimeout(() => setCopied((current) => (current === id ? null : current)), 1800);
    } catch {
      /* clipboard blocked; the link is on screen */
    }
  };

  const revoke = async (row: Row) => {
    setBusy(row.id);
    try {
      await fetch(`/api/files/${row.id}?token=${encodeURIComponent(row.deleteToken)}`, {
        method: "DELETE",
      });
    } catch {
      /* fall through: re-checking below shows whether it went */
    } finally {
      forgetUpload(row.id);
      setBusy(null);
      void load();
    }
  };

  const forget = (row: Row) => {
    forgetUpload(row.id);
    setRows((current) => current?.filter((entry) => entry.id !== row.id) ?? null);
  };

  const clearGone = () => {
    for (const row of rows ?? []) if (row.state === "gone") forgetUpload(row.id);
    void load();
  };

  if (rows === null) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-sm text-slate-600">
        <Spinner /> Loading…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
        <p className="text-sm font-medium text-slate-900">No links from this browser yet</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
          Links you create are listed here so you can copy or revoke them. The record is
          kept in this browser only — the server has no way to tie a link back to you — so
          it will not appear on your other devices.
        </p>
        <Link
          href="/share"
          className="mt-5 inline-block rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Share a file
        </Link>
      </div>
    );
  }

  const goneCount = rows.filter((row) => row.state === "gone").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 tnum">
          {rows.length} link{rows.length === 1 ? "" : "s"} from this browser
          {goneCount > 0 && ` · ${goneCount} no longer available`}
        </p>
        <div className="flex gap-2">
          {goneCount > 0 && (
            <Button size="sm" onClick={clearGone}>
              Clear {goneCount} expired
            </Button>
          )}
          <Button size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      <ul className="space-y-2">
        {rows.map((row) => {
          const expires = row.live?.expiresAt ? new Date(row.live.expiresAt) : null;
          const gone = row.state === "gone";
          return (
            <li
              key={row.id}
              className={cx(
                "rounded-xl border bg-white px-4 py-3",
                gone ? "border-slate-200 opacity-60" : "border-slate-200"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{row.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500 tnum">
                    {gone ? (
                      "No longer available — expired, revoked, or past its download limit"
                    ) : (
                      <>
                        {row.live?.size !== undefined && `${formatBytes(row.live.size)} · `}
                        Created {formatWhen(row.at)}
                        {row.live?.downloads !== undefined &&
                          ` · ${row.live.downloads} download${row.live.downloads === 1 ? "" : "s"}`}
                        {row.live?.maxDownloads != null &&
                          ` of ${row.live.maxDownloads}`}
                        {row.live?.protected && " · password"}
                        {expires && ` · expires ${expires.toLocaleDateString()}`}
                      </>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  {gone ? (
                    <Button size="sm" variant="ghost" onClick={() => forget(row)}>
                      Remove
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => copy(row.id)}>
                        {copied === row.id ? "Copied" : "Copy link"}
                      </Button>
                      <a
                        href={`/f/${row.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                      >
                        Open
                      </a>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy === row.id}
                        onClick={() => revoke(row)}
                      >
                        {busy === row.id ? <Spinner /> : null} Revoke
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {!gone && (
                <input
                  readOnly
                  value={`${origin}/f/${row.id}`}
                  onFocus={(event) => event.target.select()}
                  className="mt-2.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-700"
                />
              )}
            </li>
          );
        })}
      </ul>

      <Alert tone="info">
        Revoking deletes the file from the server immediately and cannot be undone. This
        list lives in this browser, so clearing site data loses the ability to revoke
        these links.
      </Alert>
    </div>
  );
}
