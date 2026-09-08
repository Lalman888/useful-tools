"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { DataGrid, estimateWidths } from "./DataGrid";
import { StatsPanel } from "./StatsPanel";
import { Alert, Button, Spinner, cx } from "./ui";
import {
  applyFilters,
  applySort,
  detectNumericColumns,
  toCsv,
  toggleSort,
  type CellValue,
  type Filters,
  type SortRule,
} from "@/lib/sheetOps";
import { downloadXlsx, triggerDownload } from "@/lib/xlsxExport";

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
 * machine and skips a round trip. Workbooks go to the server, which has the
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
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [debouncedFilters, setDebouncedFilters] = useState<Filters>({});
  const [sort, setSort] = useState<SortRule[]>([]);
  const [pinned, setPinned] = useState<number[]>([]);
  const [widths, setWidths] = useState<number[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [statsColumn, setStatsColumn] = useState<number | null>(null);
  const [loading, setLoading] = useState(Boolean(fileId));
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filtering on every keystroke is wasteful on a sheet with tens of thousands
  // of rows, so the query settles first.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setDebouncedFilters(filters);
    }, 180);
    return () => clearTimeout(timer);
  }, [search, filters]);

  useEffect(() => {
    if (!exportOpen) return;
    const close = () => setExportOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [exportOpen]);

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

  const resetView = useCallback(() => {
    setFilters({});
    setDebouncedFilters({});
    setSearch("");
    setDebouncedSearch("");
    setSort([]);
    setPinned([]);
    setStatsColumn(null);
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      setWorkbook(null);
      resetView();
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
    },
    [resetView]
  );

  const sheet = workbook?.sheets[activeSheet] ?? null;

  // Column widths are per sheet, and the user can override any of them.
  useEffect(() => {
    if (!sheet) return;
    setWidths(estimateWidths(sheet.columns, sheet.rows));
  }, [sheet]);

  const numeric = useMemo(
    () => (sheet ? detectNumericColumns(sheet.columns.length, sheet.rows) : []),
    [sheet]
  );

  const rows = useMemo(() => {
    if (!sheet) return [];
    return applySort(applyFilters(sheet.rows, debouncedFilters, debouncedSearch), sort);
  }, [sheet, debouncedFilters, debouncedSearch, sort]);

  const activeFilterCount = Object.values(filters).filter((q) => q.trim() !== "").length;

  const baseName = (workbook?.sourceName ?? "sheet").replace(/\.[^.]+$/, "");

  const exportCsv = () => {
    if (!sheet) return;
    triggerDownload(
      new Blob([toCsv(sheet.columns, rows)], { type: "text/csv;charset=utf-8" }),
      `${baseName}-${sheet.name}.csv`
    );
  };

  const exportXlsx = async () => {
    if (!sheet) return;
    setExporting(true);
    setError(null);
    try {
      await downloadXlsx(`${baseName}-${sheet.name}.xlsx`, sheet.name, sheet.columns, rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the workbook.");
    } finally {
      setExporting(false);
    }
  };

  /* ---------------------------------- views --------------------------------- */

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
          <Button variant="primary" className="mt-5" onClick={() => inputRef.current?.click()}>
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
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{workbook.sourceName}</p>
          <p className="text-xs text-slate-500 tnum">
            {rows.length.toLocaleString()}
            {rows.length !== sheet.rowCount && ` of ${sheet.rowCount.toLocaleString()}`} rows ·{" "}
            {sheet.columns.length} columns
            {sort.length > 0 && ` · sorted by ${sort.length}`}
          </p>
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search all cells…"
          className="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:outline-none"
        />

        <Button
          size="sm"
          onClick={() => setShowFilters((current) => !current)}
          className={cx(showFilters && "ring-2 ring-slate-900")}
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </Button>

        <div className="relative">
          <Button
            size="sm"
            disabled={exporting}
            onClick={(event) => {
              event.stopPropagation();
              setExportOpen((current) => !current);
            }}
          >
            {exporting ? <Spinner /> : null} Export
          </Button>
          {exportOpen && (
            <div
              onClick={(event) => event.stopPropagation()}
              className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                onClick={() => {
                  exportCsv();
                  setExportOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
              >
                CSV — this view
              </button>
              <button
                type="button"
                onClick={() => {
                  void exportXlsx();
                  setExportOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
              >
                Excel (.xlsx) — this view
              </button>
              <p className="border-t border-slate-100 px-3 pt-1.5 pb-1 text-[11px] leading-snug text-slate-400">
                Exports the {rows.length.toLocaleString()} rows currently shown, in their
                current order.
              </p>
            </div>
          )}
        </div>

        {(sort.length > 0 || activeFilterCount > 0 || pinned.length > 0) && (
          <Button size="sm" variant="ghost" onClick={resetView}>
            Reset view
          </Button>
        )}
        {!fileId && (
          <Button size="sm" variant="ghost" onClick={() => setWorkbook(null)}>
            Open another
          </Button>
        )}
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          {error}
        </div>
      )}

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
                resetView();
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

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <DataGrid
            columns={sheet.columns}
            rows={rows}
            numeric={numeric}
            sort={sort}
            filters={filters}
            pinned={pinned}
            widths={widths}
            showFilters={showFilters}
            activeStatsColumn={statsColumn}
            onSort={(column, additive) =>
              setSort((current) => toggleSort(current, column, additive))
            }
            onFilter={(column, query) => {
              setFilters((current) => ({ ...current, [column]: query }));
              setShowFilters(true);
            }}
            onTogglePin={(column) =>
              setPinned((current) =>
                current.includes(column)
                  ? current.filter((index) => index !== column)
                  : [...current, column]
              )
            }
            onResize={(column, width) =>
              setWidths((current) => {
                const next = [...current];
                next[column] = width;
                return next;
              })
            }
            onStats={setStatsColumn}
          />
        </div>

        {statsColumn !== null && (
          <StatsPanel
            column={statsColumn}
            columnName={sheet.columns[statsColumn] ?? ""}
            rows={rows}
            onClose={() => setStatsColumn(null)}
          />
        )}
      </div>
    </div>
  );
}
