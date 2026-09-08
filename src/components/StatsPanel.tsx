"use client";

import { useMemo } from "react";
import { computeStats, type CellValue } from "@/lib/sheetOps";
import { Button } from "./ui";

function compact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000 || (abs < 0.001 && abs > 0)) return value.toExponential(3);
  // Keep a sensible number of decimals without printing 14 of them.
  return Number(value.toFixed(4)).toLocaleString();
}

export function StatsPanel({
  column,
  columnName,
  rows,
  onClose,
}: {
  column: number;
  columnName: string;
  rows: CellValue[][];
  onClose: () => void;
}) {
  // Computed over the rows currently shown, so the profile always describes
  // what the filters have left rather than the whole sheet.
  const stats = useMemo(() => computeStats(rows, column), [rows, column]);

  const rowsOf: Array<[string, string]> = [
    ["Rows", stats.total.toLocaleString()],
    ["Filled", stats.filled.toLocaleString()],
    ["Empty", stats.empty.toLocaleString()],
    ["Distinct", stats.distinct.toLocaleString()],
  ];
  if (stats.numeric) {
    rowsOf.push(
      ["Min", compact(stats.min ?? Number.NaN)],
      ["Max", compact(stats.max ?? Number.NaN)],
      ["Mean", compact(stats.mean ?? Number.NaN)],
      ["Sum", compact(stats.sum ?? Number.NaN)]
    );
  }

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{columnName}</p>
          <p className="text-xs text-slate-500">
            {stats.numeric ? "Numeric column" : "Text column"}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close statistics">
          ✕
        </Button>
      </div>

      <dl className="mt-4 space-y-1.5">
        {rowsOf.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-medium text-slate-900 tnum">{value}</dd>
          </div>
        ))}
      </dl>

      {/* A near-unique column has no meaningful mode; listing five values that
          each occur three times is noise rather than information. */}
      {stats.filled > 0 && stats.distinct / stats.filled > 0.9 ? (
        <p className="mt-5 text-xs leading-relaxed text-slate-500">
          Nearly every value in this column is unique
          {stats.numeric ? "" : ", which is what an identifier looks like"}.
        </p>
      ) : (
        stats.top.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Most common
          </p>
          <ul className="space-y-1.5">
            {stats.top.map((entry) => {
              const share = stats.filled > 0 ? (entry.count / stats.filled) * 100 : 0;
              return (
                <li key={entry.value}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate text-slate-700" title={entry.value}>
                      {entry.value || "(blank)"}
                    </span>
                    <span className="shrink-0 text-slate-500 tnum">
                      {entry.count.toLocaleString()} · {share.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-slate-500"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        )
      )}
    </aside>
  );
}
