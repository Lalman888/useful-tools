"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type CellValue = string | number | boolean | null;

const ROW_HEIGHT = 33;
const OVERSCAN = 12;
const ROW_NUMBER_WIDTH = 60;

/**
 * Estimates a column width from the widest value in a sample of rows. Measuring
 * every cell would be exact but costs a layout pass per column on sheets that
 * can run to tens of thousands of rows.
 */
function estimateWidths(columns: string[], rows: CellValue[][]): number[] {
  const sample = rows.slice(0, 200);
  return columns.map((heading, index) => {
    let widest = heading.length;
    for (const row of sample) {
      const value = row[index];
      if (value === null || value === undefined) continue;
      const length = String(value).length;
      if (length > widest) widest = length;
    }
    // ~7.2px per character at the grid's font size, plus cell padding.
    return Math.min(420, Math.max(96, Math.round(widest * 7.2) + 26));
  });
}

function formatCell(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

/** Right-align columns whose sampled values are consistently numeric. */
function detectNumericColumns(columns: string[], rows: CellValue[][]): boolean[] {
  const sample = rows.slice(0, 200);
  return columns.map((_, index) => {
    let numeric = 0;
    let seen = 0;
    for (const row of sample) {
      const value = row[index];
      if (value === null || value === undefined || value === "") continue;
      seen++;
      if (typeof value === "number") {
        numeric++;
      } else if (typeof value === "string" && /^-?[\d,]+(\.\d+)?%?$/.test(value.trim())) {
        numeric++;
      }
    }
    return seen > 0 && numeric / seen > 0.8;
  });
}

export type SortState = { column: number; direction: "asc" | "desc" } | null;

export function DataGrid({
  columns,
  rows,
  sort,
  onSortChange,
}: {
  columns: string[];
  rows: CellValue[][];
  sort: SortState;
  onSortChange: (sort: SortState) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const widths = useMemo(() => estimateWidths(columns, rows), [columns, rows]);
  const numeric = useMemo(() => detectNumericColumns(columns, rows), [columns, rows]);
  const totalWidth = useMemo(
    () => widths.reduce((sum, width) => sum + width, ROW_NUMBER_WIDTH),
    [widths]
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Reset the scroll position when the underlying data changes, otherwise a
  // shorter sheet leaves the viewport stranded past its last row.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [columns, rows]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const last = Math.min(rows.length, first + visibleCount);
  const visible = rows.slice(first, last);

  const toggleSort = (index: number) => {
    if (!sort || sort.column !== index) return onSortChange({ column: index, direction: "asc" });
    if (sort.direction === "asc") return onSortChange({ column: index, direction: "desc" });
    onSortChange(null);
  };

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="relative h-full overflow-auto bg-white"
    >
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        {/* Header sits above the rows and stays put while the body scrolls. */}
        <div
          className="sticky top-0 z-20 flex border-b border-slate-300 bg-slate-50"
          style={{ height: ROW_HEIGHT }}
        >
          <div
            className="sticky left-0 z-30 shrink-0 border-r border-slate-200 bg-slate-50"
            style={{ width: ROW_NUMBER_WIDTH }}
          />
          {columns.map((column, index) => {
            const active = sort?.column === index;
            return (
              <button
                key={index}
                type="button"
                onClick={() => toggleSort(index)}
                title={`Sort by ${column}`}
                className="flex shrink-0 items-center gap-1 border-r border-slate-200 px-3 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                style={{ width: widths[index] }}
              >
                <span className="truncate">{column}</span>
                <span
                  className={active ? "text-slate-900" : "text-slate-300"}
                  aria-hidden="true"
                >
                  {active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Spacer preserves the full scroll height while only a window renders. */}
        <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
          <div style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
            {visible.map((row, offset) => {
              const rowIndex = first + offset;
              return (
                <div
                  key={rowIndex}
                  className="flex border-b border-slate-100 text-sm hover:bg-sky-50/60"
                  style={{ height: ROW_HEIGHT }}
                >
                  <div
                    className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-slate-50/95 px-2 text-right text-xs leading-8 text-slate-400 tnum"
                    style={{ width: ROW_NUMBER_WIDTH }}
                  >
                    {rowIndex + 1}
                  </div>
                  {columns.map((_, columnIndex) => (
                    <div
                      key={columnIndex}
                      title={formatCell(row[columnIndex])}
                      className={
                        "shrink-0 truncate border-r border-slate-100 px-3 leading-8 text-slate-800" +
                        (numeric[columnIndex] ? " text-right tnum" : "")
                      }
                      style={{ width: widths[columnIndex] }}
                    >
                      {formatCell(row[columnIndex])}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {rows.length === 0 && (
        <div className="absolute inset-x-0 top-24 text-center text-sm text-slate-500">
          No rows match this search.
        </div>
      )}
    </div>
  );
}
