import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultBatchSelection,
  pruneBatchSelection,
  toggleAllBatchSelection,
  toggleBatchItemSelection,
} from "../lib/batch-selection.ts";

const IDS = ["a", "b", "c", "d", "e", "f", "g"];

test("preselects the ordered batch maximum", () => {
  assert.deepEqual([...defaultBatchSelection(IDS, 5)], IDS.slice(0, 5));
});

test("allows several individual selections without exceeding the cap", () => {
  let selection = new Set(["a"]);
  selection = toggleBatchItemSelection(selection, "c", 5);
  selection = toggleBatchItemSelection(selection, "e", 5);
  selection = toggleBatchItemSelection(selection, "f", 5);
  selection = toggleBatchItemSelection(selection, "g", 5);
  assert.deepEqual([...selection], ["a", "c", "e", "f", "g"]);

  selection = toggleBatchItemSelection(selection, "b", 5);
  assert.deepEqual([...selection], ["a", "c", "e", "f", "g"]);
});

test("select all fills remaining slots, preserves choices, then clears", () => {
  const partial = new Set(["g", "c"]);
  const full = toggleAllBatchSelection(IDS, partial, 5);
  assert.deepEqual([...full], ["g", "c", "a", "b", "d"]);
  assert.deepEqual([...toggleAllBatchSelection(IDS, full, 5)], []);
});

test("prunes stale selections and honors a reduced cap", () => {
  assert.deepEqual(
    [...pruneBatchSelection(IDS, new Set(["missing", "g", "c", "a"]), 2)],
    ["g", "c"],
  );
});
