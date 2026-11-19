import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOrder, move } from "../shared/project-order.ts";

const id = (s: string) => s;

test("no saved order keeps the default order", () => {
  assert.deepEqual(applyOrder(["b", "a", "c"], [], id), ["b", "a", "c"]);
});

test("saved order wins; projects it does not name come first", () => {
  assert.deepEqual(applyOrder(["new", "a", "b", "c"], ["c", "a", "b"], id), ["new", "c", "a", "b"]);
});

test("saved keys no longer shown are skipped", () => {
  assert.deepEqual(applyOrder(["a", "b"], ["gone", "b", "a"], id), ["b", "a"]);
});

test("move swaps with the neighbour and keeps hidden saved keys at the end", () => {
  assert.deepEqual(move(["a", "b", "c"], ["a", "gone", "b", "c"], "b", -1), ["b", "a", "c", "gone"]);
  assert.deepEqual(move(["a", "b", "c"], [], "b", 1), ["a", "c", "b"]);
});

test("move past either end changes nothing", () => {
  assert.deepEqual(move(["a", "b"], [], "a", -1), ["a", "b"]);
  assert.deepEqual(move(["a", "b"], [], "b", 1), ["a", "b"]);
});

test("first move from the default order saves the whole shown order", () => {
  const shown = applyOrder(["x", "y", "z"], [], id);
  const saved = move(shown, [], "z", -1);
  assert.deepEqual(saved, ["x", "z", "y"]);
  assert.deepEqual(applyOrder(["x", "y", "z"], saved, id), ["x", "z", "y"]);
});
