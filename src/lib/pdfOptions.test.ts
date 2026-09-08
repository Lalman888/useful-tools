import test from "node:test";
import assert from "node:assert/strict";
import { parsePdfOptions } from "./pdfOptions.ts";

const base = { markdown: "# Hello" };

function options(extra: Record<string, unknown>) {
  const result = parsePdfOptions({ ...base, ...extra });
  assert.ok(result.ok, "expected the options to parse");
  return result.options;
}

test("a valid inline image is accepted as the letterhead", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  assert.equal(options({ logo: png }).logo, png);
});

test("a remote or malformed logo is dropped rather than fetched", () => {
  // Allowing a URL would let a document pull in a resource at render time,
  // which the renderer otherwise forbids.
  assert.equal(options({ logo: "https://example.com/logo.png" }).logo, "");
  assert.equal(options({ logo: "data:text/html;base64,PHNjcmlwdD4=" }).logo, "");
  assert.equal(options({ logo: "javascript:alert(1)" }).logo, "");
  assert.equal(options({ logo: 42 }).logo, "");
});

test("an oversized logo is dropped", () => {
  const huge = "data:image/png;base64," + "A".repeat(2_000_001);
  assert.equal(options({ logo: huge }).logo, "");
});

test("numeric options are clamped to their supported range", () => {
  assert.equal(options({ logoWidth: 500 }).logoWidth, 90);
  assert.equal(options({ logoWidth: 1 }).logoWidth, 10);
  assert.equal(options({ baseFontSize: 99 }).baseFontSize, 16);
  assert.equal(options({ tocDepth: 0 }).tocDepth, 1);
});

test("unknown enum values fall back to the default", () => {
  assert.equal(options({ theme: "nonsense" }).theme, "report");
  assert.equal(options({ paper: "A0" }).paper, "A4");
  assert.equal(options({ mermaidTheme: "rainbow" }).mermaidTheme, "neutral");
  assert.equal(options({ accent: "red" }).accent, "#1f4e79");
});

test("an empty document is rejected", () => {
  const result = parsePdfOptions({ markdown: "   " });
  assert.equal(result.ok, false);
});
