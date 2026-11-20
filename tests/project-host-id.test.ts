import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { clearOwnHostId } from "../server/core/host-id.ts";
import { clearWorktreeCache } from "../server/core/worktree.ts";
import { registerProject } from "../server/project.ts";
import {
  projectWorktrees,
  projectWorktreesInputSchema,
  projectWorktreesOutputSchema,
  worktreeKey,
} from "../shared/project-rpc.ts";

describe("project-rpc host id contract", () => {
  test("output without hostId parses to hostId null", () => {
    assert.deepEqual(projectWorktreesOutputSchema.parse({ worktrees: {} }), { hostId: null, worktrees: {} });
  });
  test("a non-empty hostId is kept, null is allowed, the empty string is rejected", () => {
    assert.equal(projectWorktreesOutputSchema.parse({ hostId: "srv_a", worktrees: {} }).hostId, "srv_a");
    assert.equal(projectWorktreesOutputSchema.parse({ hostId: null, worktrees: {} }).hostId, null);
    assert.equal(projectWorktreesOutputSchema.safeParse({ hostId: "", worktrees: {} }).success, false);
    assert.equal(projectWorktreesOutputSchema.safeParse({ hostId: 3, worktrees: {} }).success, false);
  });
  test("worktreeKey separates the same path on different hosts, and is stable for the same pair", () => {
    assert.notEqual(worktreeKey("h1", "/a"), worktreeKey("h2", "/a"));
    assert.equal(worktreeKey("h1", "/a"), worktreeKey("h1", "/a"));
    assert.notEqual(worktreeKey("h1", "/a"), worktreeKey("h1", "/b"));
    assert.notEqual(worktreeKey("h", "1/a"), worktreeKey("h1", "/a"), "the boundary cannot be shifted");
  });
});

describe("project.worktrees handler and the host id", () => {
  const savedEnv = { ...process.env };
  let root: string;
  let home: string;
  let repo: string;
  let handler: (input: unknown, context?: unknown) => Promise<unknown>;
  const call = async (cwds: string[], context?: unknown) =>
    projectWorktreesOutputSchema.parse(await handler(projectWorktreesInputSchema.parse({ cwds }), context));
  const lister = (impl: () => Promise<unknown>) => {
    const l = { calls: 0, hosts: { list: () => (l.calls++, impl()) } };
    return l;
  };

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "atrium-project-host-")));
    home = join(root, "home");
    mkdirSync(home);
    process.env.PASEO_HOME = home;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    repo = join(root, "repo");
    mkdirSync(repo);
    const g = (...a: string[]) =>
      execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd: repo, stdio: "ignore" });
    g("init", "-q", "-b", "main");
    writeFileSync(join(repo, "f"), "x");
    g("add", "f");
    g("commit", "-q", "-m", "i");
    const handlers = new Map<string, (input: unknown, context?: unknown) => Promise<unknown>>();
    registerProject({
      handle(contract: { name: string }, h: (input: unknown, context?: unknown) => Promise<unknown>) {
        handlers.set(contract.name, h);
      },
    } as unknown as PluginServerContext);
    handler = handlers.get(projectWorktrees.name)!;
    assert.ok(handler);
  });
  beforeEach(() => {
    clearOwnHostId();
    clearWorktreeCache();
    rmSync(join(home, "server-id"), { force: true });
  });
  after(() => {
    clearOwnHostId();
    clearWorktreeCache();
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    rmSync(root, { recursive: true, force: true });
  });

  test("the response carries the host id from the context's paseo, next to real worktrees", async () => {
    const paseo = lister(async () => ({ self: { serverId: "srv_d" } }));
    const out = await call([repo], { paseo });
    assert.equal(out.hostId, "srv_d");
    assert.equal(out.worktrees[repo].kind, "git");
  });

  test("without a context the handler does not throw; the PASEO_HOME file is used, else hostId is null", async () => {
    assert.equal((await call([repo])).hostId, null);
    clearOwnHostId();
    writeFileSync(join(home, "server-id"), "srv_f\n");
    assert.equal((await call([repo])).hostId, "srv_f");
  });

  test("a list that never answers delays the first call by about 3s at most; the next call is fast and does not ask again", async () => {
    const paseo = lister(() => new Promise(() => {}));
    const t0 = performance.now();
    const first = await call([repo], { paseo });
    const firstMs = performance.now() - t0;
    assert.equal(first.hostId, null);
    assert.equal(first.worktrees[repo].kind, "git");
    assert.ok(firstMs < 6000, `first call took ${Math.round(firstMs)}ms`);
    assert.equal(paseo.calls, 1);

    // No folders: the time is the host id lookup alone, not Git subprocesses under suite load.
    const t1 = performance.now();
    const second = await call([], { paseo });
    const secondMs = performance.now() - t1;
    assert.equal(second.hostId, null);
    assert.deepEqual(second.worktrees, {});
    assert.ok(secondMs < 100, `second call took ${Math.round(secondMs)}ms`);
    assert.equal(paseo.calls, 1, "list was not asked again");
  });
});
