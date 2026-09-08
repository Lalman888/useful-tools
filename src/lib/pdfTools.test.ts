import test from "node:test";
import assert from "node:assert/strict";
import { hexToRgb, parsePageRange, PdfToolError } from "./pdfTools.ts";

test("parses single pages and ranges into zero-based indices", () => {
  assert.deepEqual(parsePageRange("1", 10), [0]);
  assert.deepEqual(parsePageRange("1-3", 10), [0, 1, 2]);
  assert.deepEqual(parsePageRange("1-3, 7", 10), [0, 1, 2, 6]);
  assert.deepEqual(parsePageRange(" 2 , 4 ", 10), [1, 3]);
});

test("an open-ended range runs to the end, or from the start", () => {
  assert.deepEqual(parsePageRange("8-", 10), [7, 8, 9]);
  assert.deepEqual(parsePageRange("-3", 10), [0, 1, 2]);
});

test("overlapping selections are deduplicated and ordered", () => {
  assert.deepEqual(parsePageRange("3,1-2,3", 10), [0, 1, 2]);
  assert.deepEqual(parsePageRange("5,2", 10), [1, 4]);
});

test("out-of-range and malformed selections are rejected clearly", () => {
  assert.throws(() => parsePageRange("11", 10), PdfToolError);
  assert.throws(() => parsePageRange("0", 10), PdfToolError);
  assert.throws(() => parsePageRange("3-1", 10), PdfToolError);
  assert.throws(() => parsePageRange("abc", 10), PdfToolError);
  assert.throws(() => parsePageRange("", 10), PdfToolError);
  assert.throws(() => parsePageRange("-", 10), PdfToolError);
});

test("the page-count message names the real limit", () => {
  assert.throws(
    () => parsePageRange("4", 3),
    /This document has 3 pages, so page 4 does not exist\./
  );
});

test("hex colours convert to 0-1 components", () => {
  assert.deepEqual(hexToRgb("#ffffff"), { r: 1, g: 1, b: 1 });
  assert.deepEqual(hexToRgb("#000000"), { r: 0, g: 0, b: 0 });
  const mid = hexToRgb("#804020");
  assert.ok(Math.abs(mid.r - 128 / 255) < 1e-9);
  assert.ok(Math.abs(mid.g - 64 / 255) < 1e-9);
  assert.ok(Math.abs(mid.b - 32 / 255) < 1e-9);
  // An unparseable colour falls back to grey rather than throwing.
  assert.deepEqual(hexToRgb("nonsense"), { r: 0.5, g: 0.5, b: 0.5 });
});
