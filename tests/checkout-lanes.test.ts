// The worktree color bar's runs (checkoutLanes): which rows join the row drawn above or below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkoutLanes, type TreeNode } from "../shared/tree.ts";

const agent = (key: string, children: TreeNode[] = []): TreeNode => ({ kind: "agent", key, ownsWorkspace: true, children });

// "j" = joins: [above, below] as a two-letter string, "-" for no.
function joins(roots: TreeNode[], checkouts: Record<string, string>, collapsed: string[] = []) {
  const lanes = checkoutLanes(roots, new Set(collapsed), (key) => checkouts[key] ?? null);
  return Object.fromEntries([...lanes].map(([key, l]) => [key, `${l.joinAbove ? "^" : "-"}${l.joinBelow ? "v" : "-"}`]));
}

// orchestrator (main)
// ├─ auditor (feat)
// │  └─ client (feat)
// ├─ tester (main)
// └─ server (feat)
const team = (suffix: string) =>
  agent(`orch${suffix}`, [agent(`auditor${suffix}`, [agent(`client${suffix}`)]), agent(`tester${suffix}`), agent(`server${suffix}`)]);
const feat = (suffix: string) => ({ [`auditor${suffix}`]: "feat", [`client${suffix}`]: "feat", [`server${suffix}`]: "feat" });

test("a run follows the rows as drawn and breaks at a row in another checkout", () => {
  assert.deepEqual(joins([team("")], feat("")), {
    orch: "--",
    auditor: "-v",
    client: "^-",
    tester: "--",
    server: "--",
  });
});

test("two teams on the same branch: each run starts again after the main-checkout row between", () => {
  const lanes = joins([team("1"), team("2")], { ...feat("1"), ...feat("2") });
  assert.equal(lanes.server1, "--");
  assert.equal(lanes.auditor2, "-v");
  assert.equal(lanes.client2, "^-");
});

test("a sibling after a parent's last child continues that child, not the parent", () => {
  // auditor (feat) > client (main-default: no checkout), then server (feat): client sits between.
  const roots = [agent("orch", [agent("auditor", [agent("client")]), agent("server")])];
  assert.deepEqual(joins(roots, { auditor: "feat", server: "feat" }), { orch: "--", auditor: "--", client: "--", server: "--" });
});

test("a collapsed row hides its children, so the next row joins it directly", () => {
  const roots = [agent("orch", [agent("auditor", [agent("client")]), agent("server")])];
  const lanes = joins(roots, { auditor: "feat", client: "feat", server: "feat" }, ["auditor"]);
  assert.equal(lanes.client, undefined);
  assert.equal(lanes.auditor, "-v");
  assert.equal(lanes.server, "^-");
});

test("different checkouts side by side never join", () => {
  const roots = [agent("a"), agent("b"), agent("c")];
  assert.deepEqual(joins(roots, { a: "x", b: "y", c: "y" }), { a: "--", b: "-v", c: "^-" });
});
