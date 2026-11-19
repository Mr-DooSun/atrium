import { homedir } from "node:os";
import assert from "node:assert/strict";
import test from "node:test";
import { filterCatalog, parseAuth, parseMcpList, failureReason, parseCatalog, parseInstalled } from "../server/adapters/claude/parsers.ts";
import { claudeAdapter } from "../server/adapters/claude/index.ts";

test("auth status exposes only the account fields", () => {
  const auth = { loggedIn: false, authMethod: "none", apiProvider: "firstParty", loginExpiresAt: null };
  assert.equal(parseAuth(JSON.stringify(auth)).state, "logged_out");
  assert.deepEqual(parseAuth(JSON.stringify({ ...auth, loggedIn: true, authMethod: "claude.ai",
    email: "user@example.com", extra: "ignored" })), {
    state: "logged_in", method: "claude.ai", account: "user@example.com", detail: null,
  });
});

test("health listing preserves names and reports transport when present", () => {
  const rows = parseMcpList(`Checking MCP server health…

plugin:example:tools: echo fixture - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed
ready: echo - ✔ Connected
remote: https://example.com (HTTP) - ⚠ Needs authentication
review: echo - ⏸ Pending approval
inactive: echo - ○ Disabled`);
  assert.deepEqual(rows.map(r => r.status), ["failed", "connected", "needs_auth", "pending", "disabled"]);
  assert.equal(rows[0].name, "plugin:example:tools");
  assert.equal(rows[2].transport, "http");
});

test("catalog merges installed entries and filters independently of marketplace counts", () => {
  const installed = [{ id: "one@demo", enabled: false, version: "1.0", scope: "user", installPath: "/sample/one" }];
  const available = [{ pluginId: "two@demo", marketplaceName: "demo", name: "two", description: "Sample search",
    source: { source: "git-subdir", url: "https://example.com/repo.git", path: "two" } }];
  const markets = [{ name: "demo", source: "github", repo: "sample/demo" }];
  assert.equal(parseInstalled(installed)[0].enabled, false);
  const parsed = parseCatalog({ installed, available }, markets);
  const catalog = filterCatalog(parsed, "SeArCh");
  assert.deepEqual(catalog.plugins.map(p => [p.id, p.installed, p.source]), [["two@demo", false, available[0].source.url]]);
  assert.deepEqual(catalog.marketplaces, [{ name: "demo", source: "sample/demo", pluginCount: 2 }]);
  assert.equal(filterCatalog(parsed, "one").plugins[0].installed, true);
});

const profile = { command: "/example/claude", args: ["--wrapper"], env: {}, id: "profile", configHome: null };

test("previews use profile executable and keep option-like identifiers positional", async () => {
  const add = await claudeAdapter.previewMcpAdd(profile, null, { name: "--help", scope: "user", transport: "http",
    target: "https://example.com/mcp", args: [], env: {}, headers: { Authorization: "sample" } });
  assert.deepEqual(add.command, [profile.command, ...profile.args, "mcp", "add-json", "-s", "user", "--", "--help", "-"]);
  assert.deepEqual(add.warnings, ["Authorization=***"]);
  assert.deepEqual((await claudeAdapter.previewAction(profile, "disable", "--all", "demo")).command,
    [profile.command, ...profile.args, "plugin", "disable", "--json", "--", "--all@demo"]);
  assert.equal((await claudeAdapter.loginMcp(profile, null, "remote")).ok, false);
});

test("project mutations require the agent directory, including the default local scope", async () => {
  for (const scope of ["local", "project", null]) {
    const input = { name: "example", scope, transport: "stdio" as const, target: "echo", args: [], env: {}, headers: {} };
    const plan = await claudeAdapter.previewMcpAdd(profile, null, input);
    assert.equal(plan.supported, false);
    assert.match(plan.warnings[0], /프로젝트/);
    assert.equal((await claudeAdapter.addMcp(profile, null, input)).error, plan.warnings[0]);
    if (scope) assert.equal((await claudeAdapter.removeMcp(profile, null, input.name, scope)).error, plan.warnings[0]);
    const scoped = await claudeAdapter.previewMcpAdd(profile, "/example", input);
    assert.equal(scoped.supported, true);
    assert.ok(scoped.warnings.includes("project: /example"));
  }
});

test("plugin operations preserve leading arguments and use the requested project directory", async () => {
  const script = `
    const args = process.argv.slice(1);
    if (args.includes("--available")) {
      console.log(JSON.stringify({installed: [], available: [{pluginId: "a@demo", name: "a", marketplaceName: "demo", source: "sample/repo"}]}));
    } else if (args.includes("marketplace")) {
      console.log("[]");
    } else if (args.includes("list")) {
      console.log(JSON.stringify([{id: "a@demo", installPath: process.cwd()}]));
    } else {
      console.log("Progress");
      console.log(JSON.stringify({error: {message: "Rejected in " + process.cwd()}}));
      process.exitCode = 1;
    }`;
  const p = { ...profile, command: process.execPath, args: ["-e", script, "--"] };
  const [plugin] = await claudeAdapter.listInstalled(p, "/");
  assert.equal(plugin.source, "/");
  const plan = await claudeAdapter.previewAction(p, "disable", "a", "demo", "/");
  assert.equal(plan.source, "sample/repo");
  const result = await claudeAdapter.runAction(p, "disable", "a", "demo", "/");
  assert.deepEqual(result.command, plan.command);
  assert.equal(result.error, "Rejected in /");
  assert.equal(failureReason("", "Rejected sample-secret", ["sample-secret"]), "Rejected ***");
});

test("missing cwd defaults to the home directory and unscoped removal targets user", async () => {
  const script = `console.log(JSON.stringify({error: process.cwd() + " rejected -y sample-secret"})); process.exitCode = 1;`;
  const p = { ...profile, command: process.execPath, args: ["-e", script, "--"], env: { FLAG: "-y", SAMPLE: "sample-secret" } };
  const expected = homedir() + " rejected -y ***";
  const remove = await claudeAdapter.removeMcp(p, null, "fixture", null);
  assert.deepEqual(remove.command.slice(1 + p.args.length), ["mcp", "remove", "-s", "user", "--", "fixture"]);
  assert.equal(remove.error, expected);
  assert.equal((await claudeAdapter.auth(p)).detail, expected);
  await assert.rejects(claudeAdapter.listInstalled(p, null), { message: expected });
  await assert.rejects(claudeAdapter.listMcp(p, null), { message: expected });
});
