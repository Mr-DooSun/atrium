import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOrder, dropIndex, move, orderTree, placeAt } from "../shared/project-order.ts";
import type { TreeNode } from "../shared/tree.ts";

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

test("placeAt moves a key to an index among the others", () => {
  assert.deepEqual(placeAt(["a", "b", "c", "d"], [], "a", 2), ["b", "c", "a", "d"]);
  assert.deepEqual(placeAt(["a", "b", "c"], [], "c", 0), ["c", "a", "b"]);
  assert.deepEqual(placeAt(["a", "b", "c"], ["gone"], "a", 9), ["b", "c", "a", "gone"]);
});

test("dropIndex counts the other blocks whose middle is above the dragged middle", () => {
  const blocks = [
    { key: "a", y: 0, height: 40 },
    { key: "b", y: 40, height: 100 },
    { key: "c", y: 140, height: 40 },
  ];
  assert.equal(dropIndex(blocks, "a", 0), 0);
  assert.equal(dropIndex(blocks, "a", 80), 1); // middle 100 passes b's middle 90
  assert.equal(dropIndex(blocks, "a", 200), 2);
  assert.equal(dropIndex(blocks, "c", -100), 1); // middle 60 is under a, above b
  assert.equal(dropIndex(blocks, "x", 0), -1);
});

test("applyOrder can put unplaced items last", () => {
  assert.deepEqual(applyOrder(["a", "new", "b"], ["b", "a"], id, "last"), ["b", "a", "new"]);
});

const agent = (key: string, children: TreeNode[] = []): TreeNode => ({ kind: "agent", key, ownsWorkspace: true, parentWorktree: null, children });
const keys = (nodes: readonly TreeNode[]): unknown[] =>
  nodes.map((n) => (n.children.length ? [n.key, keys(n.children)] : n.key));

test("orderTree orders every depth by its parent's saved order", () => {
  const roots = [agent("new"), agent("r1", [agent("c1"), agent("c2", [agent("g1"), agent("g2")]), agent("c3")]), agent("r2")];
  const ordered = orderTree(roots, "project:/p", {
    "project:/p": ["r2", "r1"],
    r1: ["c2", "c1"],
    c2: ["g2", "g1"],
  });
  // New top rows first, new children last.
  assert.deepEqual(keys(ordered), ["new", "r2", ["r1", [["c2", ["g2", "g1"]], "c1", "c3"]]]);
});

test("orderTree with nothing saved keeps the tree", () => {
  const roots = [agent("a", [agent("b")]), agent("c")];
  assert.deepEqual(keys(orderTree(roots, "project:/p", {})), keys(roots));
});
