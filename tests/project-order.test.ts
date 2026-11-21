import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOrder,
  dropIndex,
  legacyRoot,
  move,
  nodesFor,
  orderTree,
  placeAt,
  projectOrderKey,
  upgradeOrder,
} from "../shared/project-order.ts";
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

const agent = (key: string, children: TreeNode[] = []): TreeNode => ({ kind: "agent", key, ownsWorkspace: true, children });
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

test("dropIndex passes a long block once the pointer passes its row", () => {
  // b is a project with many sessions: 400 tall, its header row 40.
  const blocks = [
    { key: "a", y: 0, height: 40, head: 40 },
    { key: "b", y: 40, height: 400, head: 40 },
    { key: "c", y: 440, height: 40, head: 40 },
  ];
  assert.equal(dropIndex(blocks, "a", 30), 0); // row middle 50 is above b's row middle 60
  assert.equal(dropIndex(blocks, "a", 50), 1); // past b's row: lands after b, no need to reach 240
  assert.equal(dropIndex(blocks, "c", -380), 2); // row middle 80: still below b's row
  assert.equal(dropIndex(blocks, "c", -401), 1); // above b's row: lands before b
  assert.equal(dropIndex(blocks, "c", -441), 0); // above a's row
});

test("the same folder on two hosts gets two order keys", () => {
  assert.notEqual(projectOrderKey("local", "/repo"), projectOrderKey("remote", "/repo"));
  assert.equal(legacyRoot(projectOrderKey("local", "/repo")), null);
  assert.equal(legacyRoot("/repo"), "/repo");
  assert.equal(legacyRoot("[odd]/folder"), "[odd]/folder");
});

test("a root-only saved entry stands for that folder on every host, in place", () => {
  const a = projectOrderKey("h1", "/a");
  const b1 = projectOrderKey("h1", "/b");
  const b2 = projectOrderKey("h2", "/b");
  const shown = [
    { key: a, root: "/a" },
    { key: b1, root: "/b" },
    { key: b2, root: "/b" },
  ];
  assert.deepEqual(upgradeOrder(["/b", "/a", "/gone"], shown), [b1, b2, a, "/gone"]);
});

test("host-named entries win over the root-only entry of the same folder", () => {
  const b1 = projectOrderKey("h1", "/b");
  const b2 = projectOrderKey("h2", "/b");
  const shown = [
    { key: b1, root: "/b" },
    { key: b2, root: "/b" },
  ];
  assert.deepEqual(upgradeOrder([b2, "/b"], shown), [b2, b1]);
});

test("two hosts' projects in one folder move apart", () => {
  const b1 = projectOrderKey("h1", "/b");
  const b2 = projectOrderKey("h2", "/b");
  const a = projectOrderKey("h1", "/a");
  const saved = upgradeOrder(["/b", "/a"], [
    { key: a, root: "/a" },
    { key: b1, root: "/b" },
    { key: b2, root: "/b" },
  ]);
  assert.deepEqual(move([b1, b2, a], saved, b2, 1), [b1, a, b2]);
});

test("a project's rows fall back to the order saved under its folder alone", () => {
  const legacy = { "project:/b": ["x", "y"] };
  const group = `project:${projectOrderKey("h1", "/b")}`;
  assert.deepEqual(nodesFor(legacy, group, "project:/b")[group], ["x", "y"]);
  const both = { ...legacy, [group]: ["y"] };
  assert.equal(nodesFor(both, group, "project:/b"), both);
});
