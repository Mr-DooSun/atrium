import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, type TreeInput, type TreeNode } from "../shared/tree.ts";

function input(spec: {
  workspaces: Array<[key: string, project: string, parentAgent?: string]>;
  agents: Array<[key: string, workspace: string, parent?: string]>;
}): TreeInput {
  return {
    workspaces: spec.workspaces.map(([key]) => key),
    agents: spec.agents.map(([key]) => key),
    workspaceProject: new Map(spec.workspaces.map(([key, project]) => [key, project])),
    workspaceParentAgent: new Map(spec.workspaces.map(([key, , parent]) => [key, parent ?? null])),
    agentWorkspace: new Map(spec.agents.map(([key, workspace]) => [key, workspace])),
    agentParent: new Map(spec.agents.map(([key, , parent]) => [key, parent ?? null])),
  };
}

// Compact shape: "w:key" / "a:key" with children.
function shape(nodes: readonly TreeNode[]): unknown[] {
  return nodes.map((node) => {
    const label = `${node.kind === "workspace" ? "w" : "a"}:${node.key}`;
    return node.children.length ? { [label]: shape(node.children) } : label;
  });
}

test("current archon data: all four workers are direct children of the orchestrator", () => {
  const tree = buildTree(
    input({
      workspaces: [
        ["paseo-q", "archon"],
        ["gemini", "archon"],
        ["spawn", "archon"],
        ["study", "archon"],
      ],
      agents: [
        ["me", "paseo-q"],
        ["orch", "spawn"],
        ["claude1", "gemini", "orch"],
        ["codex1", "gemini", "orch"],
        ["claude2", "spawn", "orch"],
        ["codex2", "spawn", "orch"],
        ["s", "study"],
      ],
    }),
  );
  // The worktree is not a level: codex1/claude1 sit beside codex2/claude2.
  assert.deepEqual(shape(tree[0].roots), [
    "w:paseo-q",
    { "w:spawn": ["a:claude1", "a:codex1", "a:claude2", "a:codex2"] },
    "w:study",
  ]);
  const spawn = tree[0].roots[1];
  assert.equal(spawn.kind === "workspace" && spawn.agentKey, "orch");
  // The worktree's diff is drawn once: on its first agent only.
  const owns = Object.fromEntries(
    spawn.children.map((n) => [n.key, n.kind === "agent" && n.ownsWorkspace]),
  );
  assert.deepEqual(owns, { claude1: true, codex1: false, claude2: false, codex2: false });
});

test("siblings sharing a worktree are drawn together", () => {
  const tree = buildTree(
    input({
      workspaces: [
        ["main", "p"],
        ["wt", "p"],
      ],
      agents: [
        ["orch", "main"],
        ["x1", "wt", "orch"],
        ["m1", "main", "orch"],
        ["x2", "wt", "orch"],
        ["m2", "main", "orch"],
      ],
    }),
  );
  assert.deepEqual(shape(tree[0].roots), [{ "w:main": ["a:x1", "a:x2", "a:m1", "a:m2"] }]);
});

test("depth follows parentage only, at any depth and across workspaces", () => {
  const tree = buildTree(
    input({
      workspaces: [
        ["w0", "p"],
        ["w1", "p"],
        ["w2", "p"],
      ],
      agents: [
        ["a0", "w0"],
        ["a1", "w1", "a0"],
        ["a2", "w1", "a1"],
        ["a3", "w2", "a2"],
        ["a4", "w0", "a3"],
      ],
    }),
  );
  assert.deepEqual(shape(tree[0].roots), [
    { "w:w0": [{ "a:a1": [{ "a:a2": [{ "a:a3": ["a:a4"] }] }] }] },
  ]);
});

test("workspace with several root agents lists them; unknown parent counts as root", () => {
  const tree = buildTree(
    input({
      workspaces: [["w", "p"]],
      agents: [
        ["x", "w"],
        ["y", "w", "gone"],
      ],
    }),
  );
  assert.deepEqual(shape(tree[0].roots), [{ "w:w": ["a:x", "a:y"] }]);
});

test("empty workspace created by an agent sits under that agent", () => {
  const tree = buildTree(
    input({
      workspaces: [
        ["w0", "p"],
        ["fresh", "p", "a0"],
        ["loose", "p"],
      ],
      agents: [["a0", "w0"]],
    }),
  );
  assert.deepEqual(shape(tree[0].roots), [{ "w:w0": ["w:fresh"] }, "w:loose"]);
});

test("parent cycles do not hide agents", () => {
  const tree = buildTree(
    input({
      workspaces: [["w", "p"]],
      agents: [
        ["a", "w", "b"],
        ["b", "w", "a"],
      ],
    }),
  );
  const text = JSON.stringify(shape(tree[0].roots));
  assert.ok(text.includes("a:a") || text.includes('"w:w"'), text);
  assert.ok(text.includes("b"), text);
});

test("a child started from another project's session is a root of its own project", () => {
  const tree = buildTree(
    input({
      workspaces: [
        ["archonWs", "archon"],
        ["pluginWs", "plugin"],
      ],
      agents: [
        ["orch", "archonWs"],
        ["handoff", "pluginWs", "orch"],
        ["worker", "pluginWs", "handoff"],
      ],
    }),
  );
  const byProject = Object.fromEntries(tree.map((p) => [p.projectKey, shape(p.roots)]));
  assert.deepEqual(byProject, {
    archon: ["w:archonWs"],
    plugin: [{ "w:pluginWs": ["a:worker"] }],
  });
});
