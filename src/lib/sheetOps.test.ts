import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFilters,
  applySort,
  computeStats,
  toCsv,
  toNumber,
  toggleSort,
  type CellValue,
} from "./sheetOps.ts";

const rows: CellValue[][] = [
  ["a", 10, "x"],
  ["b", 2, ""],
  ["c", null, "y"],
  ["d", 30, "x"],
];

test("toNumber reads the shapes real spreadsheets contain", () => {
  assert.equal(toNumber("1234"), 1234);
  assert.equal(toNumber("1,234.5"), 1234.5);
  assert.equal(toNumber("$1,200"), 1200);
  assert.equal(toNumber("23%"), 23);
  assert.equal(toNumber("(500)"), -500, "parenthesised negatives");
  assert.ok(Number.isNaN(toNumber("n/a")));
  assert.ok(Number.isNaN(toNumber("")));
});

test("toNumber does not mistake an identifier for a number", () => {
  // A greedy currency strip once turned this into 7, which corrupted both
  // sorting and column statistics on ID columns.
  assert.ok(Number.isNaN(toNumber("abc007")));
  assert.ok(Number.isNaN(toNumber("SKU-12")));
});

test("column filters match by substring, and by operator when given one", () => {
  assert.deepEqual(applyFilters(rows, { 0: "a" }, "").map((r) => r[0]), ["a"]);
  assert.deepEqual(applyFilters(rows, { 1: ">5" }, "").map((r) => r[0]), ["a", "d"]);
  assert.deepEqual(applyFilters(rows, { 1: "<=10" }, "").map((r) => r[0]), ["a", "b"]);
  assert.deepEqual(applyFilters(rows, { 2: "*empty" }, "").map((r) => r[0]), ["b"]);
  assert.deepEqual(applyFilters(rows, { 2: "*filled" }, "").map((r) => r[0]), ["a", "c", "d"]);
});

test("the global search looks across every column", () => {
  assert.deepEqual(applyFilters(rows, {}, "y").map((r) => r[0]), ["c"]);
  assert.equal(applyFilters(rows, {}, "nothing here").length, 0);
});

test("sorting keeps blanks last in both directions", () => {
  assert.deepEqual(
    applySort(rows, [{ column: 1, direction: "asc" }]).map((r) => r[0]),
    ["b", "a", "d", "c"]
  );
  assert.deepEqual(
    applySort(rows, [{ column: 1, direction: "desc" }]).map((r) => r[0]),
    ["d", "a", "b", "c"]
  );
});

test("sorting falls through to the next rule on a tie", () => {
  const data: CellValue[][] = [
    ["x", 1],
    ["y", 1],
    ["x", 2],
  ];
  assert.deepEqual(
    applySort(data, [
      { column: 0, direction: "asc" },
      { column: 1, direction: "desc" },
    ]).map((r) => r.join("")),
    ["x2", "x1", "y1"]
  );
});

test("a column cycles ascending, descending, unsorted", () => {
  let rules = toggleSort([], 1, false);
  assert.deepEqual(rules, [{ column: 1, direction: "asc" }]);
  rules = toggleSort(rules, 1, false);
  assert.deepEqual(rules, [{ column: 1, direction: "desc" }]);
  rules = toggleSort(rules, 1, false);
  assert.deepEqual(rules, []);
});

test("an additive toggle keeps existing rules, a plain one replaces them", () => {
  assert.equal(toggleSort([{ column: 0, direction: "asc" }], 1, true).length, 2);
  assert.equal(toggleSort([{ column: 0, direction: "asc" }], 1, false).length, 1);
});

test("stats describe a numeric column", () => {
  const stats = computeStats(rows, 1);
  assert.equal(stats.numeric, true);
  assert.equal(stats.min, 2);
  assert.equal(stats.max, 30);
  assert.equal(stats.mean, 14);
  assert.equal(stats.empty, 1);
});

test("stats describe a categorical column", () => {
  const stats = computeStats(rows, 2);
  assert.equal(stats.numeric, false);
  assert.equal(stats.distinct, 2);
  assert.deepEqual(stats.top[0], { value: "x", count: 2 });
});

test("csv export escapes quotes and separators", () => {
  assert.equal(toCsv(["a"], [['he said "hi"']]), 'a\n"he said ""hi"""');
  assert.equal(toCsv(["a"], [["x,y"]]), 'a\n"x,y"');
  assert.equal(toCsv(["a"], [["line\nbreak"]]), 'a\n"line\nbreak"');
});
