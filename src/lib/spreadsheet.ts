import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { MAX_PREVIEW_ROWS } from "./config";

export type CellValue = string | number | boolean | null;

export type SheetData = {
  name: string;
  /** Header labels taken from the first row, or generated (A, B, C...) if absent. */
  columns: string[];
  rows: CellValue[][];
  /** Rows actually delivered. `truncated` says whether more exist on disk. */
  rowCount: number;
  truncated: boolean;
};

export type WorkbookData = {
  sourceName: string;
  format: "csv" | "tsv" | "xlsx";
  sheets: SheetData[];
  /** Non-fatal notes worth showing the user (truncation, legacy formats, ...). */
  notices: string[];
};

export class UnsupportedFormatError extends Error {}

const TEXT_FORMATS = new Set([".csv", ".tsv", ".txt"]);
const EXCEL_FORMATS = new Set([".xlsx", ".xlsm"]);
/** Formats ExcelJS cannot read; we tell the user how to convert rather than failing silently. */
const LEGACY_FORMATS = new Set([".xls", ".ods", ".numbers", ".xlsb"]);

export function detectFormat(name: string): "csv" | "tsv" | "xlsx" {
  const ext = path.extname(name).toLowerCase();
  if (EXCEL_FORMATS.has(ext)) return "xlsx";
  if (ext === ".tsv") return "tsv";
  if (TEXT_FORMATS.has(ext)) return "csv";
  if (LEGACY_FORMATS.has(ext)) {
    throw new UnsupportedFormatError(
      `${ext} files are not supported. Open the file in Excel, Numbers or LibreOffice and re-save it as .xlsx or .csv.`
    );
  }
  throw new UnsupportedFormatError(
    `Cannot preview "${name}" as a spreadsheet. Supported: .csv, .tsv, .xlsx, .xlsm.`
  );
}

export function isSpreadsheet(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return TEXT_FORMATS.has(ext) || EXCEL_FORMATS.has(ext);
}

/** Spreadsheet-style column labels: A, B, ... Z, AA, AB, ... */
export function columnLabel(index: number): string {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function makeColumns(headerRow: CellValue[], width: number): string[] {
  const columns: string[] = [];
  for (let i = 0; i < width; i++) {
    const raw = headerRow[i];
    const text = raw === null || raw === undefined ? "" : String(raw).trim();
    columns.push(text || columnLabel(i));
  }
  return columns;
}

/* ---------------------------------- CSV ---------------------------------- */

function parseDelimited(
  filePath: string,
  sourceName: string,
  format: "csv" | "tsv"
): Promise<WorkbookData> {
  return new Promise((resolve, reject) => {
    const rows: CellValue[][] = [];
    let total = 0;
    let truncated = false;
    const notices: string[] = [];

    const stream = fs.createReadStream(filePath, { encoding: "utf8" });

    Papa.parse<string[]>(stream as never, {
      delimiter: format === "tsv" ? "\t" : "",
      skipEmptyLines: "greedy",
      // Everything stays a string: coercing here would mangle ids like "007"
      // and long numbers that exceed IEEE-754 precision.
      dynamicTyping: false,
      step: (result, parser) => {
        total++;
        if (rows.length < MAX_PREVIEW_ROWS + 1) {
          rows.push(result.data as CellValue[]);
        } else if (!truncated) {
          truncated = true;
          parser.abort();
        }
      },
      complete: () => {
        const headerRow = (rows.shift() ?? []) as CellValue[];
        const width = rows.reduce(
          (max, row) => Math.max(max, row.length),
          headerRow.length
        );
        if (truncated) {
          notices.push(
            `Preview limited to the first ${MAX_PREVIEW_ROWS.toLocaleString()} rows. Download the file to see everything.`
          );
        }
        resolve({
          sourceName,
          format,
          notices,
          sheets: [
            {
              name: format === "tsv" ? "TSV" : "CSV",
              columns: makeColumns(headerRow, width),
              rows,
              rowCount: rows.length,
              truncated,
            },
          ],
        });
      },
      error: (err: Error) => reject(err),
    });
  });
}

/* --------------------------------- Excel --------------------------------- */

/**
 * Excel dates arrive as Date objects. Show a plain calendar date when there is
 * no time component, which is what a spreadsheet cell almost always holds.
 */
function formatDate(value: Date): string {
  const iso = value.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
}

/**
 * ExcelJS cell values are a union of primitives and tagged objects (formula
 * results, rich text, hyperlinks, errors). Flatten them to something a table
 * can render.
 */
function cellToPrimitive(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return formatDate(value);

  const obj = value as Record<string, unknown>;
  // Formula cell: prefer the cached result over the formula text.
  if ("result" in obj) return cellToPrimitive(obj.result);
  if ("error" in obj) return String(obj.error);
  if ("text" in obj && typeof obj.text === "string") return obj.text;
  // Rich text: concatenate the runs.
  if (Array.isArray(obj.richText)) {
    return (obj.richText as Array<{ text?: string }>)
      .map((run) => run.text ?? "")
      .join("");
  }
  if ("hyperlink" in obj && typeof obj.hyperlink === "string") return obj.hyperlink;
  return String(value);
}

async function parseExcel(filePath: string, sourceName: string): Promise<WorkbookData> {
  // Imported lazily so the Excel engine is only loaded when a workbook is opened.
  const ExcelJS = (await import("exceljs")).default;

  const sheets: SheetData[] = [];
  const notices: string[] = [];

  // The streaming reader keeps memory flat regardless of workbook size, which
  // matters because uploads here are deliberately uncapped.
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: "emit",
    sharedStrings: "cache",
    styles: "cache",
    hyperlinks: "ignore",
    worksheets: "emit",
  });

  for await (const worksheet of reader) {
    // The streaming reader exposes `name` at runtime but omits it from its types.
    const sheetName = (worksheet as unknown as { name?: string }).name ?? "";
    const rows: CellValue[][] = [];
    let width = 0;
    let truncated = false;

    for await (const row of worksheet) {
      if (rows.length > MAX_PREVIEW_ROWS) {
        truncated = true;
        break;
      }
      const values: CellValue[] = [];
      // ExcelJS row.values is 1-based with a hole at index 0.
      const raw = row.values as unknown[];
      for (let i = 1; i < raw.length; i++) {
        values.push(cellToPrimitive(raw[i]));
      }
      width = Math.max(width, values.length);
      rows.push(values);
    }

    const headerRow = (rows.shift() ?? []) as CellValue[];
    if (truncated) {
      notices.push(
        `Sheet "${sheetName}" was truncated to ${MAX_PREVIEW_ROWS.toLocaleString()} rows for preview.`
      );
    }
    sheets.push({
      name: sheetName || `Sheet ${sheets.length + 1}`,
      columns: makeColumns(headerRow, width),
      rows,
      rowCount: rows.length,
      truncated,
    });
  }

  if (sheets.length === 0) {
    throw new UnsupportedFormatError("This workbook contains no readable sheets.");
  }

  return { sourceName, format: "xlsx", sheets, notices };
}

/* --------------------------------- entry --------------------------------- */

export async function parseWorkbook(
  filePath: string,
  sourceName: string
): Promise<WorkbookData> {
  const format = detectFormat(sourceName);
  if (format === "xlsx") return parseExcel(filePath, sourceName);
  return parseDelimited(filePath, sourceName, format);
}
