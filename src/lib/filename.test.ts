import test from "node:test";
import assert from "node:assert/strict";
import { safeFilename, suggestFilename } from "./filename.ts";

test("an ordinary name just gains the extension", () => {
  assert.equal(safeFilename("Quarterly report", ".pdf"), "Quarterly report.pdf");
  assert.equal(safeFilename("notes", "txt"), "notes.txt");
});

test("typing the extension does not double it", () => {
  assert.equal(safeFilename("report.pdf", ".pdf"), "report.pdf");
  assert.equal(safeFilename("report.PDF", ".pdf"), "report.pdf");
  assert.equal(safeFilename("report.pdf.pdf", ".pdf"), "report.pdf.pdf");
});

test("a different extension is left alone, because it may be part of the name", () => {
  assert.equal(safeFilename("config.env", ".txt"), "config.env.txt");
});

test("characters a filesystem would reject are dropped", () => {
  assert.equal(safeFilename('a<b>c:d"e|f?g*h', ".pdf"), "abcdefgh.pdf");
  assert.equal(safeFilename("2024/25 budget", ".pdf"), "25 budget.pdf");
});

test("a pasted path contributes only its last segment", () => {
  assert.equal(safeFilename("/etc/passwd", ".txt"), "passwd.txt");
  assert.equal(safeFilename("..\\..\\windows\\system32", ".txt"), "system32.txt");
  assert.equal(safeFilename("../../secret", ".txt"), "secret.txt");
});

test("whitespace is collapsed and trimmed", () => {
  assert.equal(safeFilename("  spaced   out  ", ".pdf"), "spaced out.pdf");
  assert.equal(safeFilename("line\nbreak\tin\rit", ".pdf"), "line break in it.pdf");
});

test("trailing dots and spaces go, because Windows would drop them silently", () => {
  assert.equal(safeFilename("version 1.", ".pdf"), "version 1.pdf");
  assert.equal(safeFilename("draft ...", ".pdf"), "draft.pdf");
});

test("an empty or unusable name falls back", () => {
  assert.equal(safeFilename("", ".pdf"), "document.pdf");
  assert.equal(safeFilename("   ", ".pdf"), "document.pdf");
  assert.equal(safeFilename("///", ".pdf"), "document.pdf");
  assert.equal(safeFilename(".pdf", ".pdf"), "document.pdf");
  assert.equal(safeFilename("", ".pdf", "merged"), "merged.pdf");
});

test("Windows device names are refused even with an extension", () => {
  assert.equal(safeFilename("nul", ".pdf"), "document.pdf");
  assert.equal(safeFilename("CON", ".pdf"), "document.pdf");
  assert.equal(safeFilename("com1", ".pdf"), "document.pdf");
  // Only the exact name is reserved; a longer one containing it is fine.
  assert.equal(safeFilename("console", ".pdf"), "console.pdf");
});

test("a very long name is truncated but keeps its extension", () => {
  const result = safeFilename("x".repeat(400), ".pdf");
  assert.equal(result.endsWith(".pdf"), true);
  assert.ok(result.length <= 205, `got ${result.length}`);
});

test("non-latin names survive", () => {
  assert.equal(safeFilename("बजट रिपोर्ट", ".pdf"), "बजट रिपोर्ट.pdf");
  assert.equal(safeFilename("報告書", ".pdf"), "報告書.pdf");
});

test("a suggestion strips the source file's own extension", () => {
  assert.equal(suggestFilename("contract.docx", ".md"), "contract.md");
  assert.equal(suggestFilename("notes.txt", ".pdf"), "notes.pdf");
  assert.equal(suggestFilename("My Report", ".pdf"), "My Report.pdf");
  // A dot inside the name is not an extension.
  assert.equal(suggestFilename("v1.2 plan", ".pdf"), "v1.2 plan.pdf");
});

test("an empty extension cleans the name without appending a dot", () => {
  assert.equal(safeFilename("Quarterly report", ""), "Quarterly report");
  assert.equal(safeFilename("a/b/c", ""), "c");
  assert.equal(safeFilename("", ""), "document");
  assert.equal(suggestFilename("contract.docx", ""), "contract");
  assert.equal(suggestFilename("report.pdf", ""), "report");
});
