// Toolbox RPC handlers for direct installs and scopes of the managed ecosystems (Claude Code, Codex,
// Antigravity), driven through registerToolbox with a fake server. Paseo's native refusal is in paseo-native.test.ts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerToolbox } from "../server/toolbox.ts";
import { previewSourceInstall, runSourceInstall } from "../shared/toolbox/rpc.ts";
import type { ActionPreview, CommandResult, PluginSourceInput } from "../shared/toolbox/types.ts";

type Handler = (input: unknown, ctx: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>();
registerToolbox({ handle(contract: { name: string }, h: Handler) { handlers.set(contract.name, h); } } as unknown as PluginServerContext);

// A profile lookup would touch this empty API and fail loudly; the checks below must run first.
const ctx = { paseo: new Proxy({}, { get() { throw new Error("profile lookup reached"); } }) };
const call = <T>(contract: { name: string }, input: unknown): Promise<T> => handlers.get(contract.name)!(input, ctx) as Promise<T>;
const preview = (source: PluginSourceInput, ecosystem: string) =>
  call<ActionPreview>(previewSourceInstall, { ecosystem, profileId: "missing", cwd: null, source });
const install = (source: PluginSourceInput, ecosystem: string) =>
  call<CommandResult>(runSourceInstall, { ecosystem, profileId: "missing", cwd: null, source });

describe("scopes and source kinds are checked server-side before any profile lookup", () => {
  test("Claude Code accepts only marketplace sources and its own scopes", async () => {
    const git = await preview({ kind: "git", value: "example/kit" }, "claude");
    assert.equal(git.supported, false);
    assert.match(git.warnings[0], /claude plugins cannot be installed from a git source/);
    const scoped = await preview({ kind: "marketplace", value: "example/market", plugin: "x", scope: "global" }, "claude");
    assert.match(scoped.warnings[0], /Scope "global" is not available for claude/);
    const run = await install({ kind: "local", value: "/tmp" }, "claude");
    assert.equal(run.ok, false);
    assert.match(run.error ?? "", /claude plugins cannot be installed from a local source/);
  });

  test("Codex takes no direct sources", async () => {
    const codex = await install({ kind: "npm", value: "pkg" }, "codex");
    assert.equal(codex.ok, false);
    assert.match(codex.error ?? "", /codex plugins cannot be installed from a npm source/);
    assert.deepEqual(codex.command, []);
  });
});
