import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addServerToConfig,
  authFromSignals,
  buildMcpEntry,
  mcpServersFromConfig,
  parseMcpConfig,
  parsePluginList,
  redactUrl,
  removeServerFromConfig,
  validPluginRef,
} from "../server/adapters/antigravity/parse.ts";

const JSON_LIST = JSON.stringify([
  { name: "firebase", enabled: true, version: "1.0.3", source: "antigravity-plugins-official", path: "/home/user/.gemini/config/plugins/firebase", skills: ["a", "b"], agents: ["firebase"] },
  { name: "gcalendar", enabled: false, version: "0.0.7", source: "antigravity-plugins-official", path: "/p/gcalendar", skills: ["gcalendar"] },
]);

test("parsePluginList: documented JSON", () => {
  const list = parsePluginList(JSON_LIST);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "firebase");
  assert.equal(list[0].enabled, true);
  assert.equal(list[0].version, "1.0.3");
  assert.equal(list[0].marketplace, "antigravity-plugins-official");
  assert.equal(list[0].description, "2 skills, 1 agents");
  assert.equal(list[1].enabled, false);
});

test("parsePluginList: documented text fallback", () => {
  const text = `Installed plugins:
- firebase (enabled, 1.0.3)
    Source:     antigravity-plugins-official
    Components: 13 skills, 1 agent
- flutter (disabled, 1.0.6)
    Source:     antigravity-plugins-official
    Components: 25 skills, 1 MCP server
garbage line
`;
  const list = parsePluginList(text);
  assert.deepEqual(list.map((p) => [p.id, p.enabled, p.version]), [["firebase", true, "1.0.3"], ["flutter", false, "1.0.6"]]);
  assert.equal(list[1].description, "25 skills, 1 MCP server");
  assert.equal(list[0].marketplace, "antigravity-plugins-official");
});

test("parsePluginList: empty / junk", () => {
  assert.deepEqual(parsePluginList(""), []);
  assert.deepEqual(parsePluginList("[not json"), []);
  assert.deepEqual(parsePluginList("[{\"x\":1}]"), []);
});

test("mcpServersFromConfig: never leaks env/headers, redacts URL query", () => {
  const { config } = parseMcpConfig(JSON.stringify({
    mcpServers: {
      sqlite: { command: "node", args: ["s.js"], env: { SECRET: "hunter2" } },
      remote: { serverUrl: "https://u:p@api.example.com/mcp/?token=abc", headers: { Authorization: "Bearer zzz" } },
      off: { command: "x", disabled: true },
    },
  }));
  const servers = mcpServersFromConfig(config, "user");
  assert.equal(servers.length, 3);
  assert.equal(servers[0].target, "node");
  assert.equal(servers[1].transport, "http");
  assert.equal(servers[1].target, "https://api.example.com/mcp/");
  assert.equal(servers[2].status, "disabled");
  const blob = JSON.stringify(servers);
  assert.ok(!blob.includes("hunter2") && !blob.includes("zzz") && !blob.includes("abc"));
});

test("parseMcpConfig: missing ok, invalid flagged", () => {
  assert.deepEqual(parseMcpConfig(null), { config: {}, error: null });
  assert.ok(parseMcpConfig("{oops").error);
  assert.ok(parseMcpConfig("[1]").error);
});

test("buildMcpEntry: documented shapes, sse refused", () => {
  const base = { name: "n", scope: null, args: [], env: {}, headers: {} };
  assert.deepEqual(buildMcpEntry({ ...base, transport: "stdio", target: "node", args: ["a"], env: { K: "v" } }), { ok: true, entry: { command: "node", args: ["a"], env: { K: "v" } } });
  assert.deepEqual(buildMcpEntry({ ...base, transport: "http", target: "https://x/mcp", headers: { A: "b" } }), { ok: true, entry: { serverUrl: "https://x/mcp", headers: { A: "b" } } });
  assert.equal(buildMcpEntry({ ...base, transport: "sse", target: "https://x" }).ok, false);
});

test("add/remove server preserve other keys, refuse duplicates", () => {
  const start = { other: 1, mcpServers: { a: { command: "x" } } };
  const added = addServerToConfig(start, "b", { command: "y" });
  assert.ok(added.ok);
  if (added.ok) {
    assert.equal(added.config.other, 1);
    assert.deepEqual(Object.keys(added.config.mcpServers as object), ["a", "b"]);
  }
  assert.equal(addServerToConfig(start, "a", {}).ok, false);
  assert.ok(addServerToConfig({}, "a", { command: "x" }).ok);
  const removed = removeServerFromConfig(start, "a");
  assert.ok(removed.ok);
  assert.equal(removeServerFromConfig(start, "zzz").ok, false);
  assert.equal(removeServerFromConfig({}, "a").ok, false);
  assert.deepEqual(start, { other: 1, mcpServers: { a: { command: "x" } } });
});

test("authFromSignals", () => {
  assert.equal(authFromSignals(null, {}).state, "unknown");
  assert.equal(authFromSignals('{"modelProvider":"gemini"}', {}).state, "unknown");
  assert.equal(authFromSignals('{"modelProvider":"gemini"}', { GEMINI_API_KEY: "k" }).method, "api_key");
  assert.equal(authFromSignals(null, { GEMINI_API_KEY: "k" }).state, "unknown");
  assert.equal(authFromSignals("{bad", { AGY_ADC_AUTH: "true" }).method, "adc");
  assert.ok(!JSON.stringify(authFromSignals('{"modelProvider":"gemini"}', { GEMINI_API_KEY: "sekret" })).includes("sekret"));
});

test("redactUrl / validPluginRef", () => {
  assert.equal(redactUrl("not a url?x=1"), "not a url");
  assert.ok(validPluginRef("firebase") && validPluginRef("https://github.com/o/r") && validPluginRef("/tmp/p"));
  assert.ok(!validPluginRef("--help") && !validPluginRef("") && !validPluginRef("a b"));
});
