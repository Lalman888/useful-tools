"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { DataGrid, type CellValue, type SortState } from "./DataGrid";
import { Alert, Button, Spinner, cx } from "./ui";

type Sheet = {
  name: string;
  columns: string[];
  rows: CellValue[][];
  rowCount: number;
  truncated: boolean;
};

type Workbook = {
  sourceName: string;
  format: string;
  sheets: Sheet[];
  notices: string[];
};

const CSV_EXTENSIONS = [".csv", ".tsv", ".txt"];

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}

/** Column labels for a sheet with no usable header row: A, B, C ... */
function columnLabel(index: number): string {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/**
 * Delimited text is parsed in the browser: it keeps the file on the user's
 * machine and skips a round trip. Workbooks need the server, which has the
 * streaming Excel reader.
 */
function parseDelimitedLocally(file: File): Promise<Workbook> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      worker: true, // keeps the main thread responsive on big files
      complete: (result) => {
        const rows = result.data as CellValue[][];
        const headerRow = (rows.shift() ?? []) as CellValue[];
        const width = rows.reduce((max, row) => Math.max(max, row.length), headerRow.length);
        const columns = Array.from({ length: width }, (_, index) => {
          const raw = headerRow[index];
          const text = raw === null || raw === undefined ? "" : String(raw).trim();
          return text || columnLabel(index);
        });
        resolve({
          sourceName: file.name,
          format: extensionOf(file.name) === ".tsv" ? "tsv" : "csv",
          notices: [],
          sheets: [
            {
              name: extensionOf(file.name) === ".tsv" ? "TSV" : "CSV",
              columns,
              rows,
              rowCount: rows.length,
              truncated: false,
            },
          ],
        });
      },
      error: (error) => reject(error),
    });
  });
}

async function parseOnServer(file: File): Promise<Workbook> {
  const response = await fetch(`/api/parse?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    body: file,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Could not read that file.");
  return payload as Workbook;
}

function toCsv(sheet: Sheet): string {
  const escape = (value: CellValue): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [sheet.columns.map((column) => escape(column)).join(",")];
  for (const row of sheet.rows) {
    lines.push(sheet.columns.map((_, index) => escape(row[index] ?? null)).join(","));
  }
  return lines.join("\n");
}

export function SheetViewer({
  fileId,
  fileName,
}: {
  /** When set, the viewer loads an already-shared file instead of a local one. */
  fileId?: string;
  fileName?: string;
}) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [loading, setLoading] = useState(Boolean(fileId));
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filtering every keystroke is wasteful on a sheet with tens of thousands of
  // rows, so the query settles first.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 180);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/files/${fileId}/sheet`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not read that file.");
        return payload as Workbook;
      })
      .then((data) => {
        if (cancelled) return;
        setWorkbook(data);
        setActiveSheet(0);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const openFile = useCallback(async (file: File) => {
    setError(null);
    setLoading(true);
    setWorkbook(null);
    setSort(null);
    setQuery("");
    try {
      const local = CSV_EXTENSIONS.includes(extensionOf(file.name));
      const parsed = local ? await parseDelimitedLocally(file) : await parseOnServer(file);
      setWorkbook(parsed);
      setActiveSheet(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setLoading(false);
    }
  }, []);

  const sheet = workbook?.sheets[activeSheet] ?? null;

  const rows = useMemo(() => {
    if (!sheet) return [];
    let result = sheet.rows;

    if (debouncedQuery.trim()) {
      const needle = debouncedQuery.trim().toLowerCase();
      result = result.filter((row) =>
        row.some((cell) => cell !== null && String(cell).toLowerCase().includes(needle))
      );
    }

    if (sort) {
      const { column, direction } = sort;
      const factor = direction === "asc" ? 1 : -1;
      // Copy first: the workbook's rows are reused across sorts and searches.
      result = [...result].sort((a, b) => {
        const left = a[column];
        const right = b[column];
        if (left === null || left === undefined || left === "") return 1;
        if (right === null || right === undefined || right === "") return -1;
        const leftNumber = typeof left === "number" ? left : Number(String(left).replace(/,/g, ""));
        const rightNumber =
          typeof right === "number" ? right : Number(String(right).replace(/,/g, ""));
        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
          return (leftNumber - rightNumber) * factor;
        }
        return String(left).localeCompare(String(right), undefined, { numeric: true }) * factor;
      });
    }
    return result;
  }, [sheet, debouncedQuery, sort]);

  const download = () => {
    if (!sheet || !workbook) return;
    const blob = new Blob([toCsv({ ...sheet, rows })], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${workbook.sourceName.replace(/\.[^.]+$/, "")}-${sheet.name}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!workbook && !loading) {
    return (
      <div className="mx-auto max-w-2xl">
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void openFile(file);
          }}
          className={cx(
            "rounded-xl border-2 border-dashed p-12 text-center transition",
            dragging ? "border-slate-900 bg-slate-100" : "border-slate-300 bg-white"
          )}
        >
          <p className="text-sm font-medium text-slate-900">
            Drop a spreadsheet here, or choose one
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            .csv and .tsv are read in your browser and never uploaded. .xlsx and .xlsm are
            parsed on the server and deleted straight afterwards.
          </p>
          <Button
            variant="primary"
            className="mt-5"
            onClick={() => inputRef.current?.click()}
          >
            Choose a file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xlsm"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openFile(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-24 text-sm text-slate-600">
        <Spinner />
        Reading {fileName ?? "file"}…
      </div>
    );
  }

  if (!workbook || !sheet) {
    return <Alert>{error ?? "Nothing to show."}</Alert>;
  }

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{workbook.sourceName}</p>
          <p className="text-xs text-slate-500 tnum">
            {rows.length.toLocaleString()}
            {rows.length !== sheet.rowCount && ` of ${sheet.rowCount.toLocaleString()}`} rows ·{" "}
            {sheet.columns.length} columns
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search all cells…"
          className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:outline-none"
        />
        <Button size="sm" onClick={download}>
          Export CSV
        </Button>
        {!fileId && (
          <Button size="sm" variant="ghost" onClick={() => setWorkbook(null)}>
            Open another
          </Button>
        )}
      </div>

      {workbook.notices.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          {workbook.notices.join(" ")}
        </div>
      )}

      {workbook.sheets.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 py-1.5">
          {workbook.sheets.map((candidate, index) => (
            <button
              key={candidate.name + index}
              type="button"
              onClick={() => {
                setActiveSheet(index);
                setSort(null);
              }}
              className={cx(
                "rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition",
                index === activeSheet
                  ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300"
                  : "text-slate-600 hover:bg-slate-200/60"
              )}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <DataGrid columns={sheet.columns} rows={rows} sort={sort} onSortChange={setSort} />
      </div>
    </div>
  );
}
