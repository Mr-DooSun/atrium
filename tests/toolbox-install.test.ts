// Toolbox RPC handlers for direct installs, scopes and the catalog, driven through
// registerToolbox with a fake server. The paseo CLI is a fixture script; fetch is mocked.
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerToolbox } from "../server/toolbox.ts";
import {
  listCatalog,
  previewPluginAction,
  previewSourceInstall,
  runPluginAction,
  runSourceInstall,
} from "../shared/toolbox/rpc.ts";
import type { ActionPreview, CommandResult, PluginSourceInput } from "../shared/toolbox/types.ts";

type Handler = (input: unknown, ctx: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>();
registerToolbox({
  handle(contract: { name: string }, handler: Handler) {
    handlers.set(contract.name, handler);
  },
} as unknown as PluginServerContext);

// Paseo never needs a profile; a profile lookup would fail loudly on this empty API.
const ctx = { paseo: {} };
const call = <T>(contract: { name: string }, input: unknown): Promise<T> => {
  const handler = handlers.get(contract.name);
  assert.ok(handler, `${contract.name} is registered`);
  return handler(input, ctx) as Promise<T>;
};

const preview = (source: PluginSourceInput, ecosystem = "paseo", profileId: string | null = null) =>
  call<ActionPreview>(previewSourceInstall, { ecosystem, profileId, cwd: null, source });
const install = (source: PluginSourceInput, ecosystem = "paseo", profileId: string | null = null) =>
  call<CommandResult>(runSourceInstall, { ecosystem, profileId, cwd: null, source });

const commitA = "a".repeat(40);
const commitB = "b".repeat(40);

let dir = "";
let log = "";
const saved = { bin: process.env.PASEO_BIN, home: process.env.PASEO_HOME };
const realFetch = globalThis.fetch;
let fetchCalls: string[] = [];

const registry = {
  plugins: [
    { id: "example/alpha", name: "Alpha", categories: ["utils"], installs: 5, updatedAt: "2026-01-01T00:00:00Z",
      artifact: { kind: "git", remote: "https://github.com/example/alpha.git", commit: commitA } },
    { id: "example/bravo", name: "Bravo", categories: ["themes"],
      artifact: { kind: "git", remote: "https://github.com/example/bravo.git", commit: commitA } },
    { id: "example/charlie", name: "Charlie", categories: ["utils", "ai"], installs: 50, updatedAt: "not a date",
      artifact: { kind: "git", remote: "https://github.com/example/charlie.git", commit: commitA } },
    { id: "example/delta", name: "Delta", categories: ["themes"], installs: 5, updatedAt: "2026-06-01T00:00:00Z",
      artifact: { kind: "npm", package: "@example/delta", version: "1.0.0" } },
    { id: "example/echo", name: "Echo", installs: 0, updatedAt: "2025-01-01T00:00:00Z",
      artifact: { kind: "npm", package: "@example/echo", version: "1.0.0" } },
  ],
};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "atrium-toolbox-install-"));
  log = join(dir, "calls.log");
  const command = join(dir, "paseo-fixture");
  process.env.PASEO_BIN = command;
  delete process.env.PASEO_HOME;
  await writeFile(command, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const text = args.join(" ");
if (text === "plugin ls --json") console.log("[]");
else if (args[0] === "plugin" && args[1] === "add") console.log("{}");
else process.exitCode = 2;
`);
  await chmod(command, 0o700);
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
    fetchCalls.push(String(url));
    if (String(url) === "https://plugins.paseo.sh/index.json") return new Response(JSON.stringify(registry));
    throw new Error(`unexpected fetch ${String(url)}`);
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  if (saved.bin === undefined) delete process.env.PASEO_BIN;
  else process.env.PASEO_BIN = saved.bin;
  if (saved.home === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = saved.home;
  await rm(dir, { recursive: true });
});

const calls = async (): Promise<string[][]> =>
  (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));

describe("previewSourceInstall rejects bad input with the reason in warnings[0]", () => {
  const cases: [PluginSourceInput, RegExp][] = [
    [{ kind: "git", value: "-uhttps://github.com/a/b", ref: commitA }, /must not start with "-"/],
    [{ kind: "git", value: "https://user:pw@github.com/a/b", ref: commitA }, /credentials/],
    [{ kind: "git", value: "http://github.com/a/b", ref: commitA }, /https/],
    [{ kind: "git", value: "https://github.com/a/b?token=secret", ref: commitA }, /query or fragment/],
    [{ kind: "git", value: "https://github.com/a/b#frag", ref: commitA }, /query or fragment/],
    [{ kind: "git", value: "git@github.com:a/b", ref: commitA }, /https Git URL/],
    [{ kind: "git", value: "example/kit", ref: "--upload-pack=x" }, /ref is invalid/],
    [{ kind: "git", value: "example/kit", ref: commitA, path: "../outside" }, /relative path/],
    [{ kind: "npm", value: "Bad_Name", version: "1.0.0" }, /npm package name/],
    [{ kind: "npm", value: "../evil", version: "1.0.0" }, /npm package name/],
    [{ kind: "npm", value: "pkg", version: "^1.0.0" }, /exact version or a dist-tag/],
    [{ kind: "local", value: "relative/dir" }, /absolute/],
    [{ kind: "local", value: "/definitely/not/here/atrium" }, /does not exist/],
    [{ kind: "marketplace", value: "example/market", plugin: "x" }, /cannot be installed from a marketplace source/],
  ];
  for (const [source, reason] of cases) {
    test(`${source.kind}: ${source.value} ${source.ref ?? source.version ?? source.path ?? ""}`, async () => {
      const plan = await preview(source);
      assert.equal(plan.supported, false);
      assert.deepEqual(plan.command, []);
      assert.match(plan.warnings[0], reason);
      assert.doesNotMatch(plan.warnings[0], /secret|pw@/);
    });
  }

  test("nothing was executed or fetched for rejected input", async () => {
    assert.deepEqual((await calls()).filter((args) => args[1] === "add"), []);
    assert.deepEqual(fetchCalls.filter((url) => url.includes("npmjs")), []);
  });
});

describe("scopes and source kinds are checked server-side", () => {
  test("paseo has no scopes: plugin actions with scope=user are rejected", async () => {
    const input = { ecosystem: "paseo", profileId: null, cwd: null, action: "install", pluginId: "example/alpha", marketplace: null, scope: "user" };
    await assert.rejects(call(previewPluginAction, input), /Scope "user" is not available for paseo/);
    await assert.rejects(call(runPluginAction, input), /Scope "user" is not available for paseo/);
  });

  test("source installs with a disallowed scope or kind never reach the adapter", async () => {
    const scoped = await preview({ kind: "local", value: dir, scope: "user" });
    assert.equal(scoped.supported, false);
    assert.match(scoped.warnings[0], /Scope "user" is not available for paseo/);
    const run = await install({ kind: "local", value: dir, scope: "user" });
    assert.equal(run.ok, false);
    assert.match(run.error ?? "", /Scope "user"/);
    // Checked before any profile lookup: these would otherwise fail with "Unknown profile".
    const claudeGit = await preview({ kind: "git", value: "example/kit" }, "claude", "missing");
    assert.match(claudeGit.warnings[0], /claude plugins cannot be installed from a git source/);
    const claudeScope = await preview({ kind: "marketplace", value: "example/market", plugin: "x", scope: "global" }, "claude", "missing");
    assert.match(claudeScope.warnings[0], /Scope "global" is not available for claude/);
    const codex = await install({ kind: "npm", value: "pkg" }, "codex", "missing");
    assert.equal(codex.ok, false);
    assert.match(codex.error ?? "", /codex plugins cannot be installed from a npm source/);
  });
});

describe("paseo pinned direct install", () => {
  test("install without a preview fails and runs nothing", async () => {
    const result = await install({ kind: "git", value: "example/never-previewed", ref: commitA });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /preview/);
    assert.equal((await calls()).some((args) => args.join(" ").includes("never-previewed")), false);
  });

  test("the preview pins the commit; changed input fails; the same preview works once", async () => {
    const source: PluginSourceInput = { kind: "git", value: "example/pinned", ref: commitA, path: "plugins/one" };
    const plan = await preview(source);
    assert.equal(plan.supported, true, plan.warnings.join("; "));
    assert.ok(plan.command.includes(`${commitA}^{commit}`));
    assert.match(plan.source ?? "", new RegExp(commitA));

    for (const changed of [
      { ...source, ref: commitB },
      { ...source, path: "plugins/two" },
      { ...source, value: "example/other" },
      { ...source, kind: "npm" as const },
    ]) {
      const result = await install(changed);
      assert.equal(result.ok, false, JSON.stringify(changed));
      assert.match(result.error ?? "", /preview/);
    }

    const first = await install(source);
    assert.equal(first.ok, true, first.error ?? "");
    const added = (await calls()).filter((args) => args[1] === "add");
    assert.deepEqual(added.at(-1), ["plugin", "add", "git:https://github.com/example/pinned", "--ref", `${commitA}^{commit}`, "--path", "plugins/one", "--json"]);

    const second = await install(source);
    assert.equal(second.ok, false);
    assert.match(second.error ?? "", /preview/);
    assert.equal((await calls()).filter((args) => args[1] === "add").length, added.length);
  });

  test("a preview expires after 10 minutes", async (t) => {
    const source: PluginSourceInput = { kind: "npm", value: "@example/expiring", version: "1.2.3" };
    const plan = await preview(source);
    assert.equal(plan.supported, true, plan.warnings.join("; "));
    const now = Date.now();
    t.mock.method(Date, "now", () => now + 10 * 60_000 + 1);
    const result = await install(source);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /preview/);
  });

  test("a local directory install is single use as well", async () => {
    const source: PluginSourceInput = { kind: "local", value: dir };
    assert.equal((await preview(source)).supported, true);
    assert.equal((await install(source)).ok, true);
    assert.equal((await install(source)).ok, false);
  });
});

describe("catalog sorting and categories", () => {
  type Page = { plugins: { id: string }[]; total: number; categories?: string[]; error: string | null };
  const list = (extra: object) =>
    call<Page>(listCatalog, { ecosystem: "paseo", profileId: null, cwd: null, query: "", offset: 0, limit: 50, ...extra });
  const ids = (page: Page) => page.plugins.map((p) => p.id.replace("example/", ""));

  test("installs: highest first, missing values last, ties by name", async () => {
    const page = await list({ sort: "installs" });
    assert.equal(page.error, null);
    assert.deepEqual(ids(page), ["charlie", "alpha", "delta", "echo", "bravo"]);
  });

  test("updated: newest first, missing or unparseable dates last", async () => {
    assert.deepEqual(ids(await list({ sort: "updated" })), ["delta", "alpha", "echo", "bravo", "charlie"]);
  });

  test("name is the default order", async () => {
    assert.deepEqual(ids(await list({})), ["alpha", "bravo", "charlie", "delta", "echo"]);
  });

  test("a category filter narrows plugins and total but categories come from the unfiltered set", async () => {
    const all = await list({});
    const page = await list({ category: "utils", sort: "installs" });
    assert.deepEqual(ids(page), ["charlie", "alpha"]);
    assert.equal(page.total, 2);
    assert.deepEqual(page.categories, ["ai", "themes", "utils"]);
    assert.deepEqual(page.categories, all.categories);
  });
});
