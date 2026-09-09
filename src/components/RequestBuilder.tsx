"use client";

import { useCallback, useEffect, useState } from "react";
import { forgetRequest, readRequests, rememberRequest } from "@/lib/requestHistory";
import { Alert, Button, Checkbox, Field, Spinner, TextInput, inputClass } from "./ui";

type Submission = {
  fileId: string;
  name: string;
  size: number;
  submitter: string;
  receivedAt: string;
};

type Detail = {
  title: string;
  note: string;
  expiresAt: string | null;
  closed: boolean;
  maxFiles: number;
  submissions: Submission[];
};

type Row = {
  id: string;
  title: string;
  ownerToken: string;
  at: number;
  state: "checking" | "live" | "gone";
  detail?: Detail;
};

const EXPIRY_CHOICES = [
  { label: "24 hours", value: 24 },
  { label: "7 days", value: 168 },
  { label: "14 days", value: 336 },
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

function formatWhen(value: string | number): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RequestBuilder() {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [expiryHours, setExpiryHours] = useState(336);
  const [maxFiles, setMaxFiles] = useState(10);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const [rows, setRows] = useState<Row[] | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  // The owner token never leaves this browser, so everything the list shows
  // has to be fetched with it rather than read from a session.
  const load = useCallback(async () => {
    const records = readRequests();
    setRows(records.map((record) => ({ ...record, state: "checking" as const })));

    const checked = await Promise.all(
      records.map(async (record): Promise<Row> => {
        try {
          const response = await fetch(
            `/api/requests/${record.id}/submissions?token=${encodeURIComponent(record.ownerToken)}`
          );
          if (response.status === 404) return { ...record, state: "gone" };
          if (!response.ok) return { ...record, state: "live" };
          const detail = (await response.json()) as Detail;
          return { ...record, state: "live", detail };
        } catch {
          // A network failure is not proof the request is gone; leave it listed.
          return { ...record, state: "live" };
        }
      })
    );
    setRows(checked);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!title.trim()) {
      setError("Give the request a title, so the sender knows what you are asking for.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          note,
          expiresInHours: expiryHours > 0 ? expiryHours : 0,
          maxFiles,
          password: usePassword && password ? password : null,
        }),
      });
      const payload = (await response.json()) as { id?: string; ownerToken?: string; error?: string };
      if (!response.ok || !payload.id || !payload.ownerToken) {
        throw new Error(payload.error ?? "Could not create the request.");
      }
      rememberRequest({ id: payload.id, title: title.trim(), ownerToken: payload.ownerToken });
      setTitle("");
      setNote("");
      setPassword("");
      setUsePassword(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the request.");
    } finally {
      setCreating(false);
    }
  };

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${origin}/r/${id}`);
      setCopied(id);
      setTimeout(() => setCopied((current) => (current === id ? null : current)), 1800);
    } catch {
      /* clipboard blocked; the link is on screen to copy by hand */
    }
  };

  const toggleClosed = async (row: Row, closed: boolean) => {
    setBusy(row.id);
    try {
      await fetch(`/api/requests/${row.id}?token=${encodeURIComponent(row.ownerToken)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closed }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: Row) => {
    const count = row.detail?.submissions.length ?? 0;
    const warning =
      count > 0
        ? `Delete this request and the ${count} file${count === 1 ? "" : "s"} sent to it? This cannot be undone.`
        : "Delete this request? The link will stop working.";
    if (!confirm(warning)) return;

    setBusy(row.id);
    try {
      await fetch(`/api/requests/${row.id}?token=${encodeURIComponent(row.ownerToken)}`, {
        method: "DELETE",
      });
      forgetRequest(row.id);
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-10">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <Field
            label="What are you asking for"
            hint="The sender sees this at the top of the page."
          >
            <TextInput
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Signed contract and proof of address"
              maxLength={120}
            />
          </Field>

          <Field label="Instructions" hint="Optional. Formats, deadlines, anything else.">
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="PDF or photos are both fine. Please send them before Friday."
              className={inputClass}
            />
          </Field>

          {error && <Alert>{error}</Alert>}

          <Button variant="primary" onClick={create} disabled={creating}>
            {creating && <Spinner />}
            Create request link
          </Button>
        </div>

        <aside className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Limits
          </h2>

          <Field label="Link expires after">
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

          <Field label="Accept at most">
            <TextInput
              type="number"
              min={1}
              max={25}
              value={maxFiles}
              onChange={(event) => setMaxFiles(Number(event.target.value))}
            />
          </Field>

          <div>
            <Checkbox
              label="Require a password"
              checked={usePassword}
              onChange={setUsePassword}
              hint="Send it separately from the link."
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

          <p className="border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500">
            Anyone with the link can send you files, so it carries limits rather than
            being a secret. Only this browser can see what arrives.
          </p>
        </aside>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Your requests</h2>

        {rows === null && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner /> Loading
          </p>
        )}

        {rows !== null && rows.length === 0 && (
          <Alert tone="info">
            No requests yet. Create one above and send the link to whoever owes you files.
          </Alert>
        )}

        {rows !== null && rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map((row) => {
              const submissions = row.detail?.submissions ?? [];
              return (
                <li
                  key={row.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {row.detail?.title ?? row.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 tnum">
                        Created {formatWhen(row.at)}
                        {row.detail && ` · ${submissions.length} of ${row.detail.maxFiles} received`}
                        {row.detail?.closed && " · closed"}
                        {row.state === "gone" && " · no longer on the server"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {busy === row.id && <Spinner className="text-slate-400" />}
                      {row.state === "live" && row.detail && (
                        <Button
                          size="sm"
                          onClick={() => toggleClosed(row, !row.detail!.closed)}
                          disabled={busy === row.id}
                        >
                          {row.detail.closed ? "Reopen" : "Close"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => remove(row)}
                        disabled={busy === row.id}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  {row.state === "live" && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <input
                        readOnly
                        value={`${origin}/r/${row.id}`}
                        onFocus={(event) => event.target.select()}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-700"
                      />
                      <Button size="sm" onClick={() => copy(row.id)}>
                        {copied === row.id ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  )}

                  {submissions.length > 0 && (
                    <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                      {submissions.map((submission) => (
                        <li
                          key={submission.fileId}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                            {submission.name}
                          </span>
                          <span className="text-xs text-slate-500 tnum">
                            {submission.submitter} · {formatBytes(submission.size)} ·{" "}
                            {formatWhen(submission.receivedAt)}
                          </span>
                          {/* The owner token travels on the link: it is the only
                              thing the server accepts as proof this file is yours. */}
                          <a
                            href={`/api/files/${submission.fileId}?owner=${encodeURIComponent(row.ownerToken)}`}
                            className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                          >
                            Download
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
