import type { CellValue } from "./sheetOps";
import { toNumber } from "./sheetOps";

/**
 * Writes the rows currently on screen to an .xlsx file, in the browser.
 *
 * ExcelJS is imported on demand because its browser bundle is close to a
 * megabyte, and most visits never export a workbook.
 */
export async function downloadXlsx(
  fileName: string,
  sheetName: string,
  columns: string[],
  rows: CellValue[][]
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "useful-tools";
  workbook.created = new Date();
  // Excel rejects a sheet name containing : \ / ? * [ ] or longer than 31 chars.
  const worksheet = workbook.addWorksheet(
    (sheetName || "Sheet1").replace(/[:\\/?*[\]]/g, "-").slice(0, 31)
  );

  worksheet.addRow(columns);
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) {
    worksheet.addRow(
      columns.map((_, index) => {
        const value = row[index] ?? null;
        if (value === null || value === undefined) return null;
        if (typeof value === "number" || typeof value === "boolean") return value;
        // Write anything that reads as a number as a number, so the result is
        // usable in Excel rather than a sheet of text that will not sum.
        const asNumber = toNumber(value);
        return Number.isFinite(asNumber) && String(asNumber) === value.trim()
          ? asNumber
          : value;
      })
    );
  }

  for (let index = 0; index < columns.length; index++) {
    let widest = columns[index].length;
    for (const row of rows.slice(0, 200)) {
      const length = String(row[index] ?? "").length;
      if (length > widest) widest = length;
    }
    worksheet.getColumn(index + 1).width = Math.min(60, Math.max(10, widest + 2));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, fileName);
}

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Revoke late enough that the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
