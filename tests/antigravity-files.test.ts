import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityAdapter } from "../server/adapters/antigravity/index.ts";
import { writeFileSafely } from "../server/adapters/antigravity/files.ts";

async function temp(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "agy-test-")));
}
const input = (name: string, scope: string) => ({ name, scope, transport: "stdio" as const, target: "node", args: [], env: {}, headers: {} });
const runtime = (home: string) => ({ id: "antigravity", command: "agy-not-installed", args: [], env: { HOME: home }, configHome: null });

test("planted <target>.* symlinks are never followed", async () => {
  const dir = await temp();
  const victim = join(dir, "victim.txt");
  await writeFile(victim, "keep");
  const target = join(dir, "mcp_config.json");
  await symlink(victim, `${target}.paseo-tmp`);
  await symlink(victim, `${target}.tmp`);
  await writeFileSafely(target, "{}\n");
  assert.equal(await readFile(victim, "utf8"), "keep");
  assert.equal(await readFile(target, "utf8"), "{}\n");
  assert.equal((await stat(target)).mode & 0o777, 0o600);
});

test("existing mode is preserved", async () => {
  const dir = await temp();
  const target = join(dir, "c.json");
  await writeFile(target, "{}");
  await chmod(target, 0o640);
  await writeFileSafely(target, '{"a":1}');
  assert.equal((await stat(target)).mode & 0o777, 0o640);
});

test("temp file removed after a forced failure", async () => {
  const dir = await temp();
  const target = join(dir, "isdir");
  await mkdir(target); // rename onto a directory fails
  await assert.rejects(writeFileSafely(target, "x"));
  assert.deepEqual(await readdir(dir), ["isdir"]);
});

test("project config symlinked outside cwd is refused", async () => {
  const home = await temp();
  const cwd = await temp();
  const outside = await temp();
  const outFile = join(outside, "mcp_config.json");
  await writeFile(outFile, "{}");
  await mkdir(join(cwd, ".agents"));
  await symlink(outFile, join(cwd, ".agents", "mcp_config.json"));
  const result = await antigravityAdapter.addMcp(runtime(home), cwd, input("a", "project"));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /outside the project/);
  assert.equal(await readFile(outFile, "utf8"), "{}");
});

test("project .agents dir symlinked outside cwd is refused", async () => {
  const home = await temp();
  const cwd = await temp();
  const outside = await temp();
  await symlink(outside, join(cwd, ".agents"));
  const result = await antigravityAdapter.addMcp(runtime(home), cwd, input("a", "project"));
  assert.equal(result.ok, false);
  assert.deepEqual(await readdir(outside), []);
});

test("project add/remove works and concurrent adds are serialized", async () => {
  const home = await temp();
  const cwd = await temp();
  const rt = runtime(home);
  const results = await Promise.all(["a", "b", "c", "d"].map((n) => antigravityAdapter.addMcp(rt, cwd, input(n, "project"))));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  const file = join(cwd, ".agents", "mcp_config.json");
  assert.deepEqual(Object.keys(JSON.parse(await readFile(file, "utf8")).mcpServers).sort(), ["a", "b", "c", "d"]);
  assert.ok((await antigravityAdapter.removeMcp(rt, cwd, "a", "project")).ok);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(file, "utf8")).mcpServers).sort(), ["b", "c", "d"]);
});

test("remove with both candidates resolving to one file completes", async () => {
  const home = await temp();
  const userFile = join(home, ".gemini", "config", "mcp_config.json");
  await mkdir(join(home, ".gemini", "config"), { recursive: true });
  await writeFile(userFile, JSON.stringify({ mcpServers: { x: { command: "n" } } }));
  await mkdir(join(home, ".agents"));
  await symlink(userFile, join(home, ".agents", "mcp_config.json")); // cwd == HOME, same real file
  const result = await Promise.race([
    antigravityAdapter.removeMcp(runtime(home), home, "x", null),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("deadlock")), 5000)),
  ]);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(JSON.parse(await readFile(userFile, "utf8")).mcpServers, {});
});
