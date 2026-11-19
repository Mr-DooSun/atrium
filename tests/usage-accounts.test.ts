import { test } from "node:test";
import assert from "node:assert/strict";
import { detectClaudeAccounts, parseAccountIdentity } from "../server/usage/accounts.ts";

const home = "/home/u";
const cwd = "/work";

function prof(id: string, kind: string, configHome?: string, env?: Record<string, string>, label = id) {
  return { profile: { id, label, kind }, runtime: { configHome, env } } as never;
}
function files(map: Record<string, unknown>) {
  const reads: string[] = [];
  const readFile = async (file: string) => {
    reads.push(file);
    if (!(file in map)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const v = map[file];
    return typeof v === "string" ? v : JSON.stringify(v);
  };
  return { readFile, reads };
}
const base = { home, cwd, env: {} as NodeJS.ProcessEnv, realpath: async (d: string) => d };

test("default ~/.claude plus custom claude profiles produce separate accounts", async () => {
  const { readFile } = files({
    "/home/u/.claude.json": { oauthAccount: { emailAddress: "a@x.com", organizationName: "Org", subscriptionType: "max" } },
    "/tmp/pb1/.claude.json": { oauthAccount: { emailAddress: "b@x.com" } },
  });
  const accounts = await detectClaudeAccounts([
    prof("claude", "claude"),
    prof("claude-pb1", "claude", "/tmp/pb1"),
    prof("claude-pb5", "claude", undefined, { CLAUDE_CONFIG_DIR: "/tmp/pb5" }),
  ], { ...base, readFile });
  assert.deepEqual(accounts.map((a) => a.configHome), ["/home/u/.claude", "/tmp/pb1", "/tmp/pb5"]);
  assert.deepEqual(accounts[0].identity, { email: "a@x.com", organization: "Org", subscriptionType: "max" });
  assert.equal(accounts[1].identity?.email, "b@x.com");
  assert.equal(accounts[2].identity, undefined);
  assert.deepEqual(accounts.map((a) => a.profileIds), [["claude"], ["claude-pb1"], ["claude-pb5"]]);
});

test("non-claude kinds are ignored", async () => {
  const accounts = await detectClaudeAccounts([prof("codex", "codex", "/tmp/c"), prof("agy", "antigravity")], base);
  assert.deepEqual(accounts, []);
});

test("profiles sharing a dir dedupe (trailing slash, ~, relative, default)", async () => {
  const accounts = await detectClaudeAccounts([
    prof("a", "claude", "/tmp/shared"),
    prof("b", "claude", "/tmp/shared/"),
    prof("c", "claude", undefined, { CLAUDE_CONFIG_DIR: "/tmp/shared" }),
    prof("d", "claude", "~/.claude"),
    prof("e", "claude"),
    prof("f", "claude", "~"),
    prof("g", "claude", "rel/dir"),
    prof("h", "claude", "/work/rel/dir"),
  ], base);
  assert.deepEqual(accounts.map((a) => [a.configHome, a.profileIds]), [
    ["/tmp/shared", ["a", "b", "c"]],
    ["/home/u/.claude", ["d", "e"]],
    ["/home/u", ["f"]],
    ["/work/rel/dir", ["g", "h"]],
  ]);
  assert.equal(accounts[0].label, "a");
});

test("profiles sharing a dir via symlink dedupe using realpath", async () => {
  const real: Record<string, string> = { "/tmp/link": "/tmp/real" };
  const accounts = await detectClaudeAccounts([
    prof("a", "claude", "/tmp/real"),
    prof("b", "claude", "/tmp/link"),
  ], { ...base, realpath: async (d) => real[d] ?? d });
  assert.equal(accounts.length, 1);
  assert.deepEqual(accounts[0].profileIds, ["a", "b"]);
});

test("realpath failure falls back to the configured path", async () => {
  const accounts = await detectClaudeAccounts([prof("a", "claude", "/nope"), prof("b", "claude", "/nope")],
    { ...base, realpath: async () => { throw new Error("ENOENT"); } });
  assert.equal(accounts.length, 1);
  assert.deepEqual(accounts[0].profileIds, ["a", "b"]);
});

test("missing or malformed .claude.json yields no identity and does not throw", async () => {
  const { readFile } = files({
    "/tmp/m/.claude.json": "{not json",
    "/tmp/n/.claude.json": "[]",
    "/tmp/o/.claude.json": { oauthAccount: { emailAddress: "   " } },
  });
  const accounts = await detectClaudeAccounts([
    prof("missing", "claude", "/tmp/none"),
    prof("bad", "claude", "/tmp/m"),
    prof("arr", "claude", "/tmp/n"),
    prof("blank", "claude", "/tmp/o"),
  ], { ...base, readFile });
  assert.equal(accounts.length, 4);
  for (const a of accounts) assert.equal(a.identity, undefined);
});

test("default account falls back to ~/.claude.json only when no config dir is set", async () => {
  const { readFile, reads } = files({ "/home/u/.claude.json": { oauthAccount: { emailAddress: "g@x.com" } } });
  const [def] = await detectClaudeAccounts([prof("claude", "claude")], { ...base, readFile });
  assert.equal(def.identity?.email, "g@x.com");
  reads.length = 0;
  const [custom] = await detectClaudeAccounts([prof("c", "claude", "/tmp/c")], { ...base, readFile });
  assert.equal(custom.identity, undefined);
  assert.ok(!reads.includes("/home/u/.claude.json"));
});

test("external authentication marks account nonLocalOAuth and skips identity", async () => {
  const { readFile, reads } = files({ "/tmp/x/.claude.json": { oauthAccount: { emailAddress: "x@x.com" } } });
  const [a] = await detectClaudeAccounts([prof("x", "claude", "/tmp/x", { ANTHROPIC_API_KEY: "k" })], { ...base, readFile });
  assert.equal(a.nonLocalOAuth, true);
  assert.equal(a.identity, undefined);
  assert.equal(reads.length, 0);
  const [b] = await detectClaudeAccounts([prof("x", "claude", "/tmp/x", { CLAUDE_CODE_USE_BEDROCK: "1" })], base);
  assert.equal(b.nonLocalOAuth, true);
  const [c] = await detectClaudeAccounts([prof("x", "claude", "/tmp/x", { ANTHROPIC_BASE_URL: "https://api.anthropic.com/" })], base);
  assert.equal(c.nonLocalOAuth, false);
});

test("a local-oauth profile replaces a non-local one sharing the dir", async () => {
  const accounts = await detectClaudeAccounts([
    prof("ext", "claude", "/tmp/s", { ANTHROPIC_API_KEY: "k" }),
    prof("loc", "claude", "/tmp/s"),
  ], base);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].nonLocalOAuth, false);
  assert.deepEqual(accounts[0].profileIds, ["ext", "loc"]);
});

test("parseAccountIdentity variants", () => {
  assert.equal(parseAccountIdentity(null), undefined);
  assert.equal(parseAccountIdentity({}), undefined);
  assert.equal(parseAccountIdentity({ oauthAccount: "x" }), undefined);
  assert.deepEqual(parseAccountIdentity({ oauthAccount: { email: " e@x.com ", organizationUuid: "u1", planDisplayName: "Pro" } }),
    { email: "e@x.com", organization: "u1", subscriptionType: "Pro" });
  assert.deepEqual(parseAccountIdentity({ oauthAccount: { emailAddress: "a", seatTier: "t" } }),
    { email: "a", organization: undefined, subscriptionType: "t" });
});
