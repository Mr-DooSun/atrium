import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// The orchestrator-owned helper uses a bundler-style import that Node's strip-types loader cannot resolve.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./exec" && context.parentURL?.endsWith("/server/core/run-profile.ts")) {
      return nextResolve("./exec.ts", context);
    }
    return nextResolve(specifier, context);
  },
});
const { codexAdapter, parseAuth, parseMcpList } = await import("../server/adapters/codex/index.ts");
hooks.deregister();
import type { McpAddInput } from "../shared/toolbox/types.ts";
import type { ExecResult } from "../server/core/exec.ts";

const status = (code: number, stderr: string): ExecResult =>
  ({ code, stderr, stdout: "", timedOut: false, spawnError: null, truncated: false });

test("maps Codex auth status without returning its API key fragment or errors", () => {
  assert.equal(parseAuth(status(0, "Logged in using ChatGPT\n")).method, "ChatGPT");
  assert.deepEqual(parseAuth(status(0, "API key configured - fixture-key-tail")), {
    state: "logged_in", method: "API key", account: null, detail: null,
  });
  assert.equal(parseAuth(status(1, "Not logged in")).state, "logged_out");
  assert.equal(parseAuth(status(1, "failed to load config")).state, "unknown");
  assert.equal(parseAuth({ ...status(1, ""), code: null, spawnError: "spawn codex ENOENT" }).state, "not_installed");
});

test("uses configured MCP and OAuth states without returning env, headers, argv or URL secrets", () => {
  const servers = parseMcpList(JSON.stringify([
    { name: "local", enabled: true, auth_status: "unsupported",
      transport: { type: "stdio", command: "echo", args: ["fixture-secret"], env: { KEY: "fixture-secret" } } },
    { name: "off", enabled: false, auth_status: "not_logged_in",
      transport: { type: "stdio", command: "echo" } },
    { name: "remote", enabled: true, auth_status: "not_logged_in",
      transport: { type: "streamable_http", url: "https://user:fixture-secret@example.com/mcp?key=fixture-secret",
        http_headers: { Authorization: "fixture-secret" } } },
    { name: "authenticated", enabled: true, auth_status: "oauth",
      transport: { type: "streamable_http", url: "https://example.com/mcp" } },
  ]));
  assert.deepEqual(servers.map(({ status }) => status), ["unknown", "disabled", "needs_auth", "unknown"]);
  assert.equal(servers[0].target, "echo");
  assert.equal(servers[2].target, "https://example.com/mcp");
  assert.ok(!JSON.stringify(servers).includes("fixture-secret"));
});

test("runs the selected profile and redacts MCP add previews and results", async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "toolbox-codex-fixture-")));
  t.after(() => rm(dir, { recursive: true }));
  const command = join(dir, "codex-fixture");
  const userHome = await realpath(homedir());
  await writeFile(command, `#!/usr/bin/env node
const assert = require("node:assert/strict");
assert.equal(process.env.CODEX_HOME, ${JSON.stringify(dir)});
assert.equal(process.argv[2], "--profile-fixture");
const args = process.argv.slice(3);
if (args[0] === "login") {
  assert.deepEqual(args, ["login", "status"]);
  assert.equal(process.cwd(), ${JSON.stringify(userHome)});
  console.error("Logged in using ChatGPT");
} else if (args.join(" ") === "mcp list --json") {
  assert.equal(process.cwd(), ${JSON.stringify(userHome)});
  console.log("[]");
} else {
  assert.equal(process.cwd(), ${JSON.stringify(dir)});
  if (args[2] === "failing") {
    console.error(JSON.stringify({ error: { message: "Invalid configuration for -y with KEY=fixture-secret" } }));
    process.exit(1);
  }
  assert.deepEqual(args, ["mcp", "add", "example", "--env", "KEY=fixture-secret", "--env", "SHORT=xyz", "--", "echo", "-y", "1234"]);
  console.log("Added global MCP server 'example'.");
  console.log("do not relay fixture-secret");
}
`);
  await chmod(command, 0o700);
  const profile = { id: "codex-test", command, args: ["--profile-fixture"], configHome: dir, env: { CODEX_HOME: dir } };
  const input: McpAddInput = {
    name: "example", scope: null, transport: "stdio", target: "echo",
    args: ["-y", "1234"], env: { KEY: "fixture-secret", SHORT: "xyz" }, headers: {},
  };

  assert.equal((await codexAdapter.auth(profile)).method, "ChatGPT");
  assert.deepEqual(await codexAdapter.listMcp(profile, null), []);
  const preview = await codexAdapter.previewMcpAdd(profile, dir, input);
  const result = await codexAdapter.addMcp(profile, dir, input);
  assert.equal(result.ok, true);
  assert.equal(result.needsReload, true);
  assert.deepEqual(result.command, preview.command);
  assert.ok(result.command.includes("KEY=<redacted>"));
  assert.ok(result.command.includes("SHORT=xyz"));
  assert.deepEqual(result.command.slice(-2), ["-y", "<redacted>"]);
  assert.equal(result.command[1], "--profile-fixture");
  assert.match(preview.warnings.join(" "), /process arguments/);
  const failed = await codexAdapter.addMcp(profile, dir, { ...input, name: "failing" });
  assert.equal(failed.error, "Invalid configuration for -y with KEY=<redacted>");
  assert.ok(!JSON.stringify(result).includes("fixture-secret"));
  const http = await codexAdapter.previewMcpAdd(profile, dir, {
    ...input, transport: "http", target: "https://example.com/mcp?token=fixture-secret", args: [], env: {},
  });
  assert.equal(http.supported, false);
  assert.deepEqual(http.command.slice(2), ["mcp", "add", "example", "--url", "https://example.com/mcp"]);
  const blocked = await codexAdapter.addMcp(profile, dir, {
    ...input, transport: "http", target: "https://example.com/mcp", args: [], env: {},
  });
  assert.match(blocked.error, /Run the displayed command in a terminal/);
  assert.equal(blocked.needsReload, false);
  assert.equal((await codexAdapter.previewMcpAdd(profile, dir, { ...input, transport: "sse" })).supported, false);
  assert.equal((await codexAdapter.loginMcp(profile, dir, "example")).ok, false);
});

test("maps Codex marketplace listing and prepares only supported plugin commands", async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "toolbox-codex-plugin-fixture-")));
  t.after(() => rm(dir, { recursive: true }));
  const command = join(dir, "codex-fixture");
  const userHome = await realpath(homedir());
  const installed = { pluginId: "file-reader@test", name: "File reader", marketplaceName: "test", installed: true,
    version: "1.0.0", enabled: true, source: { source: "local", path: "/tmp/file-reader" } };
  const available = { pluginId: "calendar@test", name: "Calendar", marketplaceName: "test", installed: false,
    version: "2.0.0", enabled: false, source: { source: "git", url: "https://example.com/org/calendar.git" } };
  await writeFile(command, `#!/usr/bin/env node
const assert = require("node:assert/strict");
assert.equal(process.env.CODEX_HOME, ${JSON.stringify(dir)});
const cmd = process.argv.slice(2).join(" ");
switch (cmd) {
  case "plugin list --json":
    assert.equal(process.cwd(), ${JSON.stringify(dir)});
    console.log(JSON.stringify({ installed: [${JSON.stringify(installed)}] }));
    break;
  case "plugin list --json --available":
    assert.equal(process.cwd(), ${JSON.stringify(userHome)});
    console.log(JSON.stringify({ installed: [${JSON.stringify(installed)}], available: [${JSON.stringify(available)}] }));
    break;
  case "plugin marketplace list --json": console.log(JSON.stringify({ marketplaces: [
    { name: "test", root: "/tmp/market", marketplaceSource: { sourceType: "git", source: "https://example.com/market.git" } }
  ] })); break;
  default: process.exitCode = 2;
}
`);
  await chmod(command, 0o700);
  const profile = { id: "test", command, args: [], env: { CODEX_HOME: dir }, configHome: dir };
  assert.equal((await codexAdapter.listInstalled(profile, dir))[0].enabled, null);
  const catalog = await codexAdapter.listCatalog(profile, " calendar ");
  assert.deepEqual(catalog.plugins.map(({ id, source, installed }) => ({ id, source, installed })),
    [{ id: "calendar@test", source: "https://example.com/org/calendar.git", installed: false }]);
  assert.equal(catalog.marketplaces[0].pluginCount, 2);
  assert.deepEqual((await codexAdapter.previewAction(profile, "install", "calendar", "test")).command,
    [command, "plugin", "add", "calendar@test", "--json"]);
  assert.equal((await codexAdapter.previewAction(profile, "disable", "calendar@test", "test")).supported, false);
  assert.equal((await codexAdapter.runAction(profile, "enable", "calendar@test", "test")).ok, false);
});
