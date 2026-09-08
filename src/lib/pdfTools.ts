/**
 * Page-level PDF operations, run in the browser with pdf-lib. Keeping them
 * client-side means a document never leaves the machine and no upload limit
 * applies.
 */

export class PdfToolError extends Error {}

/**
 * Parses a page selection like "1-3, 7, 10-" into zero-based page indices.
 * Numbers are one-based and inclusive, as they are in every print dialog.
 */
export function parsePageRange(input: string, pageCount: number): number[] {
  const trimmed = input.trim();
  if (!trimmed) throw new PdfToolError("Enter which pages you want, for example 1-3, 7.");

  const indices = new Set<number>();

  for (const partRaw of trimmed.split(",")) {
    const part = partRaw.trim();
    if (!part) continue;

    const range = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (range) {
      const [, fromRaw, toRaw] = range;
      if (!fromRaw && !toRaw) throw new PdfToolError(`"${part}" is not a page range.`);
      const from = fromRaw ? Number(fromRaw) : 1;
      const to = toRaw ? Number(toRaw) : pageCount;
      if (from < 1 || to < 1) throw new PdfToolError("Page numbers start at 1.");
      if (from > pageCount || to > pageCount) {
        throw new PdfToolError(
          `This document has ${pageCount} page${pageCount === 1 ? "" : "s"}, so "${part}" is out of range.`
        );
      }
      if (from > to) throw new PdfToolError(`"${part}" runs backwards.`);
      for (let page = from; page <= to; page++) indices.add(page - 1);
      continue;
    }

    if (!/^\d+$/.test(part)) throw new PdfToolError(`"${part}" is not a page number.`);
    const page = Number(part);
    if (page < 1) throw new PdfToolError("Page numbers start at 1.");
    if (page > pageCount) {
      throw new PdfToolError(
        `This document has ${pageCount} page${pageCount === 1 ? "" : "s"}, so page ${page} does not exist.`
      );
    }
    indices.add(page - 1);
  }

  if (indices.size === 0) throw new PdfToolError("That selection matches no pages.");
  return [...indices].sort((a, b) => a - b);
}

/** Turns "#1f4e79" into the 0-1 components pdf-lib expects. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return { r: 0.5, g: 0.5, b: 0.5 };
  const value = parseInt(match[1], 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

async function loadLib() {
  return import("pdf-lib");
}

async function open(bytes: ArrayBuffer, name: string) {
  const { PDFDocument } = await loadLib();
  try {
    // Many real documents carry an owner password with no user password;
    // those open fine and should not be rejected.
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (error) {
    throw new PdfToolError(
      `Could not read "${name}". It may be corrupt or password-protected. (${
        error instanceof Error ? error.message : "unknown error"
      })`
    );
  }
}

export type SourceFile = { name: string; bytes: ArrayBuffer };

export async function pageCountOf(file: SourceFile): Promise<number> {
  const document = await open(file.bytes, file.name);
  return document.getPageCount();
}

export async function mergePdfs(files: SourceFile[]): Promise<Uint8Array> {
  if (files.length < 2) throw new PdfToolError("Choose at least two PDFs to merge.");
  const { PDFDocument } = await loadLib();
  const merged = await PDFDocument.create();

  for (const file of files) {
    const source = await open(file.bytes, file.name);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  merged.setProducer("useful-tools");
  merged.setCreator("useful-tools");
  return merged.save();
}

export async function extractPages(
  file: SourceFile,
  selection: string
): Promise<{ bytes: Uint8Array; count: number }> {
  const { PDFDocument } = await loadLib();
  const source = await open(file.bytes, file.name);
  const indices = parsePageRange(selection, source.getPageCount());

  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, indices);
  for (const page of pages) output.addPage(page);

  output.setProducer("useful-tools");
  return { bytes: await output.save(), count: indices.length };
}

export async function rotatePages(
  file: SourceFile,
  selection: string,
  turn: number
): Promise<Uint8Array> {
  const { degrees } = await loadLib();
  const document = await open(file.bytes, file.name);
  const indices = parsePageRange(selection, document.getPageCount());

  for (const index of indices) {
    const page = document.getPage(index);
    // Rotation is cumulative: add to whatever the page already carries.
    const current = page.getRotation().angle;
    page.setRotation(degrees((((current + turn) % 360) + 360) % 360));
  }
  return document.save();
}

export type WatermarkOptions = {
  text: string;
  size: number;
  opacity: number;
  color: string;
  /** Degrees anticlockwise; 45 reads as a classic diagonal stamp. */
  angle: number;
};

export async function watermarkPdf(
  file: SourceFile,
  selection: string,
  options: WatermarkOptions
): Promise<Uint8Array> {
  if (!options.text.trim()) throw new PdfToolError("Enter the watermark text.");

  const { StandardFonts, degrees, rgb } = await loadLib();
  const document = await open(file.bytes, file.name);
  const indices = parsePageRange(selection, document.getPageCount());
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  const { r, g, b } = hexToRgb(options.color);

  for (const index of indices) {
    const page = document.getPage(index);
    const { width, height } = page.getSize();
    const radians = (options.angle * Math.PI) / 180;

    // Shrink the stamp if it would run off the page, so a long word on a small
    // page still lands inside the trim rather than half in the margin.
    const diagonal = Math.hypot(width, height);
    let size = options.size;
    let textWidth = font.widthOfTextAtSize(options.text, size);
    if (textWidth > diagonal * 0.9) {
      size = size * ((diagonal * 0.9) / textWidth);
      textWidth = font.widthOfTextAtSize(options.text, size);
    }
    // Cap height is a good stand-in for the optical height of upper-case text.
    const textHeight = size * 0.7;

    // drawText positions the baseline start, and rotation pivots there. The
    // visual centre sits at start + (w/2)(cos, sin) + (h/2)(-sin, cos), so
    // subtract both terms to land that centre on the middle of the page.
    page.drawText(options.text, {
      x: width / 2 - (textWidth / 2) * Math.cos(radians) + (textHeight / 2) * Math.sin(radians),
      y: height / 2 - (textWidth / 2) * Math.sin(radians) - (textHeight / 2) * Math.cos(radians),
      size,
      font,
      color: rgb(r, g, b),
      opacity: options.opacity,
      rotate: degrees(options.angle),
    });
  }

  return document.save();
}
