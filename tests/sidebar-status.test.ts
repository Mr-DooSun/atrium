import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { join } from "node:path";
import ts from "typescript";

// Node cannot parse React Native's Flow sources. Compile the actual module and stub its UI-only imports.
const source = readFileSync(join(process.cwd(), "client/marks.tsx"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports: typeof import("../client/marks.tsx") = {} as never;
runInNewContext(js, { exports, require: () => ({}), Object });
const { agentBucket, isAgentTurnActive, mostUrgent } = exports;

test("permission waiting has priority over active status and propagates to folded marks", () => {
  const permission = { status: "running", requiresAttention: true, attentionReason: "permission" } as const;
  const bucket = agentBucket(permission);
  assert.equal(bucket, "needs_input");
  assert.equal(mostUrgent("running", bucket, "attention"), "needs_input");
  assert.equal([permission].filter((agent) => agentBucket(agent) === "running").length, 0);
  assert.equal(isAgentTurnActive(permission.status), true); // active turn remains ineligible for archive
  assert.equal(agentBucket({ ...permission, status: "error" }), "failed");
  assert.equal(agentBucket({ ...permission, requiresAttention: false }), "running");
  const subagent = { ...permission, requiresAttention: false };
  assert.equal(agentBucket(subagent, true), "needs_input");
  assert.equal(mostUrgent("running", agentBucket(subagent, true)), "needs_input");
  assert.equal(agentBucket(subagent, false), "running");
  assert.equal(isAgentTurnActive("initializing"), true);
  assert.equal(isAgentTurnActive("idle"), false);
});
