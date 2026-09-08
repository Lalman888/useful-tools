"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatCell,
  type CellValue,
  type Filters,
  type SortRule,
} from "@/lib/sheetOps";
import { cx } from "./ui";

const ROW_HEIGHT = 33;
const HEADER_HEIGHT = 34;
const FILTER_HEIGHT = 32;
const OVERSCAN = 12;
const ROW_NUMBER_WIDTH = 60;
const MIN_WIDTH = 70;
const MAX_WIDTH = 640;

/**
 * Estimates a column width from the widest value in a sample of rows.
 * Measuring every cell would be exact but costs a layout pass per column on
 * sheets that run to tens of thousands of rows.
 */
export function estimateWidths(columns: string[], rows: CellValue[][]): number[] {
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

export type DataGridProps = {
  columns: string[];
  rows: CellValue[][];
  numeric: boolean[];
  sort: SortRule[];
  filters: Filters;
  pinned: number[];
  widths: number[];
  showFilters: boolean;
  activeStatsColumn: number | null;
  onSort: (column: number, additive: boolean) => void;
  onFilter: (column: number, query: string) => void;
  onTogglePin: (column: number) => void;
  onResize: (column: number, width: number) => void;
  onStats: (column: number | null) => void;
};

export function DataGrid({
  columns,
  rows,
  numeric,
  sort,
  filters,
  pinned,
  widths,
  showFilters,
  activeStatsColumn,
  onSort,
  onFilter,
  onTogglePin,
  onResize,
  onStats,
}: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  // Pinned columns are drawn first and stay put horizontally; the rest follow
  // in their original order.
  const order = useMemo(() => {
    const pinnedSet = new Set(pinned);
    return [...pinned, ...columns.map((_, index) => index).filter((i) => !pinnedSet.has(i))];
  }, [pinned, columns]);

  /** Left offset of each pinned column, so they stack rather than overlap. */
  const stickyLeft = useMemo(() => {
    const offsets = new Map<number, number>();
    let left = ROW_NUMBER_WIDTH;
    for (const index of pinned) {
      offsets.set(index, left);
      left += widths[index] ?? 120;
    }
    return offsets;
  }, [pinned, widths]);

  const totalWidth = useMemo(
    () => order.reduce((sum, index) => sum + (widths[index] ?? 120), ROW_NUMBER_WIDTH),
    [order, widths]
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  // A shorter result set would otherwise leave the viewport stranded past the
  // last row.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [rows]);

  useEffect(() => {
    if (menuFor === null) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  /* --------------------------- column resizing --------------------------- */

  const dragging = useRef<{ column: number; startX: number; startWidth: number } | null>(null);

  const beginResize = useCallback(
    (event: React.PointerEvent, column: number) => {
      event.preventDefault();
      event.stopPropagation();
      dragging.current = {
        column,
        startX: event.clientX,
        startWidth: widths[column] ?? 120,
      };

      const move = (moveEvent: PointerEvent) => {
        const drag = dragging.current;
        if (!drag) return;
        const next = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, drag.startWidth + (moveEvent.clientX - drag.startX))
        );
        onResize(drag.column, next);
      };
      const up = () => {
        dragging.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [widths, onResize]
  );

  /* ------------------------------ virtualising ---------------------------- */

  const chromeHeight = HEADER_HEIGHT + (showFilters ? FILTER_HEIGHT : 0);
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const last = Math.min(rows.length, first + visibleCount);
  const visible = rows.slice(first, last);

  const sortIndex = (column: number) => sort.findIndex((rule) => rule.column === column);

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="relative h-full overflow-auto bg-white"
    >
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        {/* ------------------------------ header ----------------------------- */}
        <div
          className="sticky top-0 z-30 flex border-b border-slate-300 bg-slate-50"
          style={{ height: HEADER_HEIGHT }}
        >
          <div
            className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-slate-50"
            style={{ width: ROW_NUMBER_WIDTH }}
          />
          {order.map((index) => {
            const position = sortIndex(index);
            const rule = position >= 0 ? sort[position] : null;
            const isPinned = stickyLeft.has(index);
            return (
              <div
                key={index}
                className={cx(
                  "group relative flex shrink-0 items-center border-r border-slate-200 bg-slate-50",
                  isPinned && "sticky z-10 shadow-[2px_0_0_rgba(15,23,42,0.06)]"
                )}
                style={{
                  width: widths[index],
                  ...(isPinned ? { left: stickyLeft.get(index) } : {}),
                }}
              >
                <button
                  type="button"
                  onClick={(event) => onSort(index, event.shiftKey)}
                  title={`${columns[index]} — click to sort, shift-click to add to the sort`}
                  className="flex min-w-0 flex-1 items-center gap-1 px-2.5 text-left text-xs font-semibold text-slate-700 transition hover:text-slate-900"
                >
                  <span className="truncate">{columns[index]}</span>
                  <span
                    className={cx("shrink-0", rule ? "text-slate-900" : "text-slate-300")}
                    aria-hidden="true"
                  >
                    {rule ? (rule.direction === "asc" ? "↑" : "↓") : "↕"}
                  </span>
                  {sort.length > 1 && position >= 0 && (
                    <span className="shrink-0 text-[10px] font-normal text-slate-500 tnum">
                      {position + 1}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  aria-label={`Options for ${columns[index]}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuFor((current) => (current === index ? null : index));
                  }}
                  // Absolutely placed so it never steals width from the label,
                  // which was truncating short headings like "region".
                  className="absolute right-0.5 z-10 rounded bg-slate-50 px-1 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-700"
                >
                  ⋯
                </button>

                {menuFor === index && (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    className="absolute top-full right-0 z-50 mt-0.5 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onTogglePin(index);
                        setMenuFor(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                    >
                      {isPinned ? "Unpin column" : "Pin to the left"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onStats(activeStatsColumn === index ? null : index);
                        setMenuFor(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Column statistics
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onResize(index, estimateWidths([columns[index]], rows.map((row) => [row[index]]))[0]);
                        setMenuFor(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Fit to contents
                    </button>
                  </div>
                )}

                {/* Drag handle for resizing. */}
                <div
                  onPointerDown={(event) => beginResize(event, index)}
                  onDoubleClick={() =>
                    onResize(index, estimateWidths([columns[index]], rows.map((row) => [row[index]]))[0])
                  }
                  className="absolute top-0 -right-1 z-20 h-full w-2 cursor-col-resize hover:bg-sky-400/40"
                  aria-hidden="true"
                />
              </div>
            );
          })}
        </div>

        {/* ------------------------------ filters ---------------------------- */}
        {showFilters && (
          <div
            className="sticky z-20 flex border-b border-slate-200 bg-white"
            style={{ top: HEADER_HEIGHT, height: FILTER_HEIGHT }}
          >
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-white px-2 text-[10px] leading-8 text-slate-400"
              style={{ width: ROW_NUMBER_WIDTH }}
            >
              filter
            </div>
            {order.map((index) => {
              const isPinned = stickyLeft.has(index);
              return (
                <div
                  key={index}
                  className={cx(
                    "shrink-0 border-r border-slate-200 bg-white p-1",
                    isPinned && "sticky z-10"
                  )}
                  style={{
                    width: widths[index],
                    ...(isPinned ? { left: stickyLeft.get(index) } : {}),
                  }}
                >
                  <input
                    value={filters[index] ?? ""}
                    onChange={(event) => onFilter(index, event.target.value)}
                    placeholder="contains, >10, *empty"
                    className="h-full w-full rounded border border-slate-200 px-1.5 text-xs text-slate-800 placeholder:text-slate-300 focus:border-slate-400 focus:outline-none"
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* -------------------------------- rows ----------------------------- */}
        <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
          <div style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
            {visible.map((row, offset) => {
              const rowIndex = first + offset;
              return (
                <div
                  key={rowIndex}
                  className="group/row flex border-b border-slate-100 text-sm"
                  style={{ height: ROW_HEIGHT }}
                >
                  <div
                    className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-slate-50/95 px-2 text-right text-xs leading-8 text-slate-400 tnum group-hover/row:bg-sky-50"
                    style={{ width: ROW_NUMBER_WIDTH }}
                  >
                    {rowIndex + 1}
                  </div>
                  {order.map((index) => {
                    const isPinned = stickyLeft.has(index);
                    return (
                      <div
                        key={index}
                        title={formatCell(row[index] ?? null)}
                        className={cx(
                          "shrink-0 truncate border-r border-slate-100 px-3 leading-8 text-slate-800 group-hover/row:bg-sky-50/60",
                          numeric[index] && "text-right tnum",
                          isPinned && "sticky z-[5] bg-white"
                        )}
                        style={{
                          width: widths[index],
                          ...(isPinned ? { left: stickyLeft.get(index) } : {}),
                        }}
                      >
                        {formatCell(row[index] ?? null)}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {rows.length === 0 && (
        <div
          className="absolute inset-x-0 text-center text-sm text-slate-500"
          style={{ top: chromeHeight + 60 }}
        >
          No rows match the current filters.
        </div>
      )}
    </div>
  );
}
