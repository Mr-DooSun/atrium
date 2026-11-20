// Input validation for user-typed plugin sources (server/core/source.ts) and the
// antigravity adapter that relies on it. No network, no real installs.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  checkGitRef,
  checkGitRemote,
  checkLocalDir,
  checkMarketplaceSource,
  checkName,
  checkNpm,
  checkSubPath,
  safeHttpsUrl,
} from "../server/core/source.ts";
import { antigravityAdapter } from "../server/adapters/antigravity/index.ts";

const rejected = (result: { ok: boolean }) => assert.equal(result.ok, false, JSON.stringify(result));

test("git remotes: option-like values, credentials, non-https, query and fragment are rejected", () => {
  for (const [value, reason] of [
    ["-uhttps://github.com/a/b", /must not start with "-"/],
    ["--upload-pack=touch /tmp/x", /must not start with "-"/],
    ["https://user:secret@github.com/a/b", /credentials/],
    ["https://token@github.com/a/b", /credentials/],
    ["http://github.com/a/b", /https/],
    ["ssh://git@github.com/a/b", /https/],
    ["file:///etc", /https/],
    ["https://github.com/a/b?token=abc", /query or fragment/],
    ["https://github.com/a/b#main", /query or fragment/],
    ["git@github.com:a/../b", /invalid/],
    ["git@github.com:a/-b", /invalid/],
    ["", /empty/],
    ["https://github.com/a\nb", /control/],
  ] as const) {
    const result = checkGitRemote(value);
    assert.equal(result.ok, false, value);
    if (!result.ok) assert.match(result.error, reason, value);
  }
});

test("git remotes: owner/repo, https and scp forms are accepted with a credential-free display", () => {
  assert.deepEqual(checkGitRemote("example/kit"), { ok: true, value: { remote: "example/kit", display: "https://github.com/example/kit" } });
  assert.deepEqual(checkGitRemote("https://github.com/example/kit/"),
    { ok: true, value: { remote: "https://github.com/example/kit", display: "https://github.com/example/kit" } });
  const scp = checkGitRemote("git@github.com:example/kit.git");
  assert.ok(scp.ok);
  assert.equal(scp.value.display, "ssh://github.com/example/kit");
});

test("git refs and sub-paths cannot become options or escape the source", () => {
  assert.deepEqual(checkGitRef(null), { ok: true, value: null });
  assert.deepEqual(checkGitRef(" v1.2.0 "), { ok: true, value: "v1.2.0" });
  for (const ref of ["--upload-pack=x", "main..evil", "refs/heads/x.lock", "dir/", "a b", "@{-1}"]) rejected(checkGitRef(ref));

  assert.deepEqual(checkSubPath("."), { ok: true, value: null });
  assert.deepEqual(checkSubPath("./plugins/first/"), { ok: true, value: "plugins/first" });
  for (const path of ["../outside", "plugins/../../x", "/etc", "a//b", "-x", "plugins/-rf", "a\u0000b", "a;b"]) rejected(checkSubPath(path));
});

test("npm names and versions: bad names and ranges are rejected, exact versions pin", () => {
  for (const name of ["Bad_Name", "../evil", "-rf", "@scope", "@/x", "a b", "http://x", ".hidden", "x".repeat(215)]) rejected(checkNpm(name));
  rejected(checkNpm("pkg", "^1.0.0"));
  rejected(checkNpm("pkg@1.0.0", "1.0.0"));
  assert.deepEqual(checkNpm("@example/tool", "1.2.3"), { ok: true, value: { name: "@example/tool", version: "1.2.3", pinned: true } });
  assert.deepEqual(checkNpm("npm:@example/tool@next"), { ok: true, value: { name: "@example/tool", version: "next", pinned: false } });
  assert.deepEqual(checkNpm("tool"), { ok: true, value: { name: "tool", version: null, pinned: false } });
});

test("local directories must be absolute, existing directories", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "atrium-source-"));
  t.after(() => rm(dir, { recursive: true }));
  await writeFile(join(dir, "file.txt"), "x");
  const relative = await checkLocalDir("relative/dir");
  assert.equal(relative.ok, false);
  if (!relative.ok) assert.match(relative.error, /absolute/);
  const missing = await checkLocalDir(join(dir, "missing"));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /does not exist/);
  rejected(await checkLocalDir(join(dir, "file.txt")));
  rejected(await checkLocalDir("-" + dir));
  const ok = await checkLocalDir(join(dir, "sub", ".."));
  assert.ok(ok.ok);
});

test("marketplace sources: owner/repo, https URL or absolute path only", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "atrium-market-"));
  t.after(() => rm(dir, { recursive: true }));
  const manifest = join(dir, "marketplace.json");
  await writeFile(manifest, "{}");
  assert.ok((await checkMarketplaceSource("example/market")).ok);
  assert.ok((await checkMarketplaceSource("https://example.com/market.json")).ok);
  assert.ok((await checkMarketplaceSource(dir)).ok);
  assert.ok((await checkMarketplaceSource(manifest)).ok);
  for (const value of [
    "http://example.com/market.json",
    "https://user:pw@example.com/market.json",
    "https://example.com/market.json#x",
    "relative/path/market",
    "./market",
    "../market",
    "-market",
    join(dir, "missing"),
    "ftp://example.com/market",
  ]) rejected(await checkMarketplaceSource(value));
});

test("names for remove/update follow the CLI name rule", () => {
  for (const name of ["demo", "claude-plugins-official", "a.b_c-1"]) assert.ok(checkName(name).ok, name);
  for (const name of ["-rf", "../x", "a b", "owner/repo", "a@b", ".hidden", "x".repeat(129)]) rejected(checkName(name));
});

test("safeHttpsUrl keeps only credential-free https URLs", () => {
  assert.equal(safeHttpsUrl("https://example.com/icon.png"), "https://example.com/icon.png");
  for (const value of ["http://example.com/i.png", "javascript:alert(1)", "data:image/png;base64,AA", "https://u:p@example.com/i.png", 5, null])
    assert.equal(safeHttpsUrl(value), null);
});

test("antigravity direct install rejects invalid sources before running anything", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "atrium-agy-"));
  t.after(() => rm(dir, { recursive: true }));
  const profile = { command: "/example/agy-not-run", args: [], env: {}, id: "agy", configHome: null };
  for (const [source, reason] of [
    [{ kind: "git", value: "-https://github.com/a/b" }, /must not start with "-"/],
    [{ kind: "git", value: "https://u:p@github.com/a/b" }, /credentials/],
    [{ kind: "git", value: "http://github.com/a/b" }, /https/],
    [{ kind: "git", value: "https://github.com/a/b?x=1" }, /query or fragment/],
    [{ kind: "git", value: "https://gitlab.com/a/b" }, /GitHub/],
    [{ kind: "git", value: "git@github.com:a/b" }, /https/],
    [{ kind: "git", value: "example/kit", ref: "main" }, /only a repository/],
    [{ kind: "local", value: "relative" }, /absolute/],
    [{ kind: "local", value: join(dir, "missing") }, /does not exist/],
    [{ kind: "npm", value: "pkg" }, /cannot install/],
  ] as const) {
    const plan = await antigravityAdapter.previewSource!(profile, source);
    assert.equal(plan.supported, false, JSON.stringify(source));
    assert.deepEqual(plan.command, []);
    assert.match(plan.warnings[0], reason, JSON.stringify(source));
    const result = await antigravityAdapter.installSource!(profile, source);
    assert.equal(result.ok, false);
    assert.deepEqual(result.command, []);
  }
  const ok = await antigravityAdapter.previewSource!(profile, { kind: "git", value: "example/kit" });
  assert.equal(ok.supported, true);
  assert.deepEqual(ok.command.slice(-3), ["plugin", "install", "https://github.com/example/kit"]);
  const local = await antigravityAdapter.previewSource!(profile, { kind: "local", value: dir });
  assert.equal(local.supported, true);
});
