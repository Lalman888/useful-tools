export type CellValue = string | number | boolean | null;

export type SortRule = { column: number; direction: "asc" | "desc" };

/** One filter per column, keyed by column index. Absent means unfiltered. */
export type Filters = Record<number, string>;

/* --------------------------------- values --------------------------------- */

export function isBlank(value: CellValue): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Reads a cell as a number, tolerating the thousands separators, currency
 * symbols, percentages and parenthesised negatives that real spreadsheets are
 * full of. Returns NaN when the cell is not a number.
 */
export function toNumber(value: CellValue): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;

  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;

  const negative = /^\(.*\)$/.test(trimmed);
  // Only recognised currency symbols are stripped. Removing any leading
  // non-digit would turn an identifier like "abc007" into the number 7 and
  // quietly corrupt sorting and column statistics.
  const cleaned = trimmed
    .replace(/^\((.*)\)$/, "$1")
    .replace(/[,\s]/g, "")
    .replace(/^[$\u20ac\u00a3\u00a5\u20b9\u00a2\u20bd\u20a9]/, "")
    .replace(/[$\u20ac\u00a3\u00a5\u20b9\u00a2\u20bd\u20a9]$/, "")
    .replace(/%$/, "");
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleaned)) return Number.NaN;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return negative ? -parsed : parsed;
}

export function formatCell(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

/* -------------------------------- filtering -------------------------------- */

const OPERATOR_RE = /^(>=|<=|!=|>|<|=)\s*(.+)$/;

/**
 * A column filter is a substring match by default. Prefixing it with a
 * comparison operator switches to a numeric or lexical comparison, which is
 * what people reach for on a numeric column ( ">1000" ).
 */
function matchesFilter(value: CellValue, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  if (trimmed === "*empty") return isBlank(value);
  if (trimmed === "*filled") return !isBlank(value);

  const operator = OPERATOR_RE.exec(trimmed);
  if (operator) {
    const [, op, operandRaw] = operator;
    const operand = toNumber(operandRaw);
    const cell = toNumber(value);
    if (Number.isFinite(operand) && Number.isFinite(cell)) {
      switch (op) {
        case ">":
          return cell > operand;
        case ">=":
          return cell >= operand;
        case "<":
          return cell < operand;
        case "<=":
          return cell <= operand;
        case "=":
          return cell === operand;
        case "!=":
          return cell !== operand;
      }
    }
    // Not numeric on both sides: fall back to comparing the text.
    const text = formatCell(value).toLowerCase();
    const needle = operandRaw.trim().toLowerCase();
    if (op === "=") return text === needle;
    if (op === "!=") return text !== needle;
    return false;
  }

  return formatCell(value).toLowerCase().includes(trimmed.toLowerCase());
}

export function applyFilters(
  rows: CellValue[][],
  filters: Filters,
  search: string
): CellValue[][] {
  const active = Object.entries(filters).filter(([, query]) => query.trim() !== "");
  const needle = search.trim().toLowerCase();
  if (active.length === 0 && !needle) return rows;

  return rows.filter((row) => {
    if (needle) {
      const hit = row.some((cell) => formatCell(cell).toLowerCase().includes(needle));
      if (!hit) return false;
    }
    for (const [index, query] of active) {
      if (!matchesFilter(row[Number(index)] ?? null, query)) return false;
    }
    return true;
  });
}

/* --------------------------------- sorting --------------------------------- */

function compareCells(a: CellValue, b: CellValue): number {
  // Blanks sort last regardless of direction, so an empty cell never displaces
  // real data at the top of the column.
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;

  const aNumber = toNumber(a);
  const bNumber = toNumber(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;

  return formatCell(a).localeCompare(formatCell(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function applySort(rows: CellValue[][], rules: SortRule[]): CellValue[][] {
  if (rules.length === 0) return rows;
  // Copy: the caller's array is reused across renders.
  return [...rows].sort((left, right) => {
    for (const rule of rules) {
      const blankAware = compareCells(left[rule.column] ?? null, right[rule.column] ?? null);
      if (blankAware !== 0) {
        // Blanks keep their "last" position in both directions.
        const leftBlank = isBlank(left[rule.column] ?? null);
        const rightBlank = isBlank(right[rule.column] ?? null);
        if (leftBlank || rightBlank) return blankAware;
        return rule.direction === "asc" ? blankAware : -blankAware;
      }
    }
    return 0;
  });
}

/** Cycles a column through ascending, descending and unsorted. */
export function toggleSort(rules: SortRule[], column: number, additive: boolean): SortRule[] {
  const existing = rules.find((rule) => rule.column === column);
  const others = additive ? rules.filter((rule) => rule.column !== column) : [];

  if (!existing) return [...others, { column, direction: "asc" }];
  if (existing.direction === "asc") return [...others, { column, direction: "desc" }];
  return others;
}

/* ------------------------------- column stats ------------------------------ */

export type ColumnStats = {
  total: number;
  filled: number;
  empty: number;
  distinct: number;
  numeric: boolean;
  min?: number;
  max?: number;
  mean?: number;
  sum?: number;
  /** Most frequent values, for a categorical column. */
  top: Array<{ value: string; count: number }>;
};

export function computeStats(rows: CellValue[][], column: number): ColumnStats {
  const counts = new Map<string, number>();
  let filled = 0;
  let numericCount = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const value = row[column] ?? null;
    if (isBlank(value)) continue;
    filled++;

    const text = formatCell(value);
    counts.set(text, (counts.get(text) ?? 0) + 1);

    const asNumber = toNumber(value);
    if (Number.isFinite(asNumber)) {
      numericCount++;
      sum += asNumber;
      if (asNumber < min) min = asNumber;
      if (asNumber > max) max = asNumber;
    }
  }

  // A column counts as numeric when nearly all of its filled cells parse as
  // numbers; a stray "n/a" should not turn a measure into a category.
  const numeric = filled > 0 && numericCount / filled > 0.8;

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));

  return {
    total: rows.length,
    filled,
    empty: rows.length - filled,
    distinct: counts.size,
    numeric,
    ...(numeric && numericCount > 0
      ? { min, max, sum, mean: sum / numericCount }
      : {}),
    top,
  };
}

/** Right-align columns whose sampled values are consistently numeric. */
export function detectNumericColumns(
  columnCount: number,
  rows: CellValue[][]
): boolean[] {
  const sample = rows.slice(0, 200);
  const result: boolean[] = [];
  for (let index = 0; index < columnCount; index++) {
    let numeric = 0;
    let seen = 0;
    for (const row of sample) {
      const value = row[index] ?? null;
      if (isBlank(value)) continue;
      seen++;
      if (Number.isFinite(toNumber(value))) numeric++;
    }
    result.push(seen > 0 && numeric / seen > 0.8);
  }
  return result;
}

/* --------------------------------- export ---------------------------------- */

export function toCsv(columns: string[], rows: CellValue[][]): string {
  const escape = (value: string): string =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines = [columns.map(escape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((_, index) => escape(formatCell(row[index] ?? null))).join(","));
  }
  return lines.join("\n");
}
