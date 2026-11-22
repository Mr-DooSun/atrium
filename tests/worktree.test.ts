import "./helpers/isolated-home.ts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { clearWorktreeCache, getWorktreeInfo, type WorktreeInfo } from "../server/core/worktree.ts";
import { registerProject } from "../server/project.ts";
import {
  MAX_WORKTREE_CWDS,
  projectWorktrees,
  projectWorktreesInputSchema,
  projectWorktreesOutputSchema,
  worktreeInfoSchema,
} from "../shared/project-rpc.ts";

// Keep the user's global and system Git config out of the fixtures.
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Atrium Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function initRepo(path: string, commit = true): void {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", "main");
  if (!commit) return;
  writeFileSync(join(path, "README.md"), "fixture\n");
  git(path, "add", "README.md");
  git(path, "commit", "-q", "-m", "initial");
}

function asGit(info: WorktreeInfo): Extract<WorktreeInfo, { kind: "git" }> {
  assert.equal(info.kind, "git", `expected a git worktree, got ${JSON.stringify(info)}`);
  return info as Extract<WorktreeInfo, { kind: "git" }>;
}

// mkdtemp under os.tmpdir() is /var/... on macOS; Git and realpath answer /private/var/....
let root: string;
let realRoot: string;
let main: string;
let realMain: string;
let featureA: string;
let featureB: string;
let detachedTree: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), "atrium-worktree-"));
  realRoot = realpathSync(root);
  main = join(root, "main repo");
  initRepo(main);
  mkdirSync(join(main, "src", "deep"), { recursive: true });
  realMain = realpathSync(main);
  featureA = join(root, "feature-a");
  featureB = join(root, "feature b");
  detachedTree = join(root, "detached");
  git(main, "worktree", "add", "-q", "-b", "feature/a", featureA);
  git(main, "worktree", "add", "-q", "-b", "feature/b", featureB);
  git(main, "worktree", "add", "-q", "--detach", detachedTree);
});

after(() => {
  clearWorktreeCache();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => clearWorktreeCache());

describe("getWorktreeInfo", () => {
  test("main worktree: branch, short head, and the top level as both paths", async () => {
    const info = asGit(await getWorktreeInfo(main));
    const head = git(main, "rev-parse", "HEAD");
    assert.deepEqual(info, {
      kind: "git",
      worktreePath: realMain,
      mainWorktreePath: realMain,
      isMain: true,
      branch: "main",
      defaultBranch: "main",
      head: head.slice(0, 7),
      detached: false,
    });
    assert.match(info.head ?? "", /^[0-9a-f]{7}$/);
    assert.ok(info.worktreePath.startsWith(realRoot), "paths are realpath-normalized");
  });

  test("a subdirectory cwd reports the top level of its worktree", async () => {
    const info = asGit(await getWorktreeInfo(join(main, "src", "deep")));
    assert.equal(info.worktreePath, realMain);
    assert.equal(info.mainWorktreePath, realMain);
    assert.equal(info.isMain, true);
    assert.equal(info.branch, "main");
  });

  test("linked worktrees each report their own branch and point at the main worktree", async () => {
    const [a, b] = await Promise.all([getWorktreeInfo(featureA), getWorktreeInfo(featureB)]);
    const infoA = asGit(a);
    const infoB = asGit(b);
    assert.equal(infoA.isMain, false);
    assert.equal(infoB.isMain, false);
    assert.equal(infoA.branch, "feature/a");
    assert.equal(infoB.branch, "feature/b");
    assert.equal(infoA.worktreePath, realpathSync(featureA));
    assert.equal(infoB.worktreePath, realpathSync(featureB));
    assert.equal(infoA.mainWorktreePath, realMain);
    assert.equal(infoB.mainWorktreePath, realMain);
    assert.equal(infoA.detached, false);
    assert.match(infoA.head ?? "", /^[0-9a-f]{7}$/);
  });

  test("detached linked worktree: no branch, detached, head present", async () => {
    const info = asGit(await getWorktreeInfo(detachedTree));
    assert.equal(info.isMain, false);
    assert.equal(info.branch, null);
    assert.equal(info.detached, true);
    assert.equal(info.head, git(detachedTree, "rev-parse", "--short=7", "HEAD"));
    assert.equal(info.mainWorktreePath, realMain);
  });

  test("detached main worktree: isMain stays true", async () => {
    const repo = join(root, "detached-main");
    initRepo(repo);
    git(repo, "checkout", "-q", "--detach");
    const info = asGit(await getWorktreeInfo(repo));
    assert.equal(info.isMain, true);
    assert.equal(info.branch, null);
    assert.equal(info.detached, true);
    assert.match(info.head ?? "", /^[0-9a-f]{7}$/);
  });

  test("repository before its first commit: branch known, head null", async () => {
    const repo = join(root, "unborn");
    initRepo(repo, false);
    const info = asGit(await getWorktreeInfo(repo));
    assert.equal(info.head, null);
    assert.equal(info.branch, "main");
    assert.equal(info.isMain, true);
    assert.equal(info.detached, false);
    assert.equal(info.worktreePath, realpathSync(repo));
  });

  test("non-git folder, missing path, relative path, and empty string are kind none", async () => {
    const plain = join(root, "plain");
    mkdirSync(plain);
    const file = join(root, "a-file.txt");
    writeFileSync(file, "x");
    for (const cwd of [plain, join(root, "does-not-exist"), file, "relative/path", ".", ""]) {
      assert.deepEqual(await getWorktreeInfo(cwd), { kind: "none" }, cwd);
    }
  });
});

describe("getWorktreeInfo cache", () => {
  let repo: string;
  before(() => {
    repo = join(root, "cache-repo");
    initRepo(repo);
    git(repo, "branch", "other");
  });
  beforeEach(() => git(repo, "checkout", "-q", "main"));

  test("a cached result is returned until the cache is cleared", async () => {
    const first = asGit(await getWorktreeInfo(repo));
    assert.equal(first.branch, "main");
    git(repo, "checkout", "-q", "other");
    // Well within the 5 s TTL: the very same cached object comes back, not a new lookup.
    const cachedAgain = await getWorktreeInfo(repo);
    assert.equal(cachedAgain, first);
    clearWorktreeCache();
    assert.equal(asGit(await getWorktreeInfo(repo)).branch, "other");
  });

  test("concurrent calls for one cwd share a single lookup", async () => {
    const one = getWorktreeInfo(repo);
    const two = getWorktreeInfo(`${repo}/.`);
    assert.equal(one, two);
    assert.equal(await one, await two);
  });

  test("alternate spellings of one directory share a cached result", async () => {
    const viaSub = asGit(await getWorktreeInfo(`${repo}/.`));
    git(repo, "checkout", "-q", "other");
    assert.equal(await getWorktreeInfo(repo), viaSub);
    assert.equal(await getWorktreeInfo(`${repo}/`), viaSub);
    assert.equal(viaSub.branch, "main");
  });

  test("a lookup still running when the cache is cleared is not stored", async () => {
    const stale = getWorktreeInfo(repo);
    clearWorktreeCache();
    const staleInfo = asGit(await stale);
    git(repo, "checkout", "-q", "other");
    const fresh = await getWorktreeInfo(repo);
    assert.notEqual(fresh, staleInfo);
    assert.equal(asGit(fresh).branch, "other");
  });
});

describe("project.worktrees RPC", () => {
  test("input accepts up to MAX_WORKTREE_CWDS paths and rejects more", () => {
    assert.equal(MAX_WORKTREE_CWDS, 64);
    const paths = (n: number) => Array.from({ length: n }, (_, i) => `/p/${i}`);
    assert.equal(projectWorktreesInputSchema.safeParse({ cwds: [] }).success, true);
    assert.equal(projectWorktreesInputSchema.safeParse({ cwds: paths(64) }).success, true);
    assert.equal(projectWorktreesInputSchema.safeParse({ cwds: paths(65) }).success, false);
    assert.equal(projectWorktreesInputSchema.safeParse({}).success, false);
    assert.equal(projectWorktreesInputSchema.safeParse({ cwds: [1] }).success, false);
  });

  test("worktree schema rejects a git entry missing fields", () => {
    assert.equal(worktreeInfoSchema.safeParse({ kind: "git", worktreePath: "/x" }).success, false);
    assert.equal(worktreeInfoSchema.safeParse({ kind: "other" }).success, false);
  });

  test("the registered handler answers per requested cwd and its output passes the schema", async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const fakeServer = {
      handle(contract: { name: string }, handler: (input: unknown) => Promise<unknown>) {
        handlers.set(contract.name, handler);
      },
    };
    registerProject(fakeServer as unknown as PluginServerContext);
    const handler = handlers.get(projectWorktrees.name);
    assert.ok(handler, "project.worktrees is registered");

    const missing = join(root, "nope");
    const sub = join(main, "src");
    const cwds = [main, featureA, detachedTree, sub, missing, "relative", main];
    const input = projectWorktreesInputSchema.parse({ cwds });
    const output = projectWorktreesOutputSchema.parse(await handler(input));

    // Keys are the strings the client sent (unnormalized, deduplicated).
    assert.deepEqual(Object.keys(output.worktrees).sort(), [...new Set(cwds)].sort());
    assert.equal(asGit(output.worktrees[main]).isMain, true);
    assert.equal(asGit(output.worktrees[featureA]).branch, "feature/a");
    assert.equal(asGit(output.worktrees[detachedTree]).detached, true);
    assert.equal(asGit(output.worktrees[sub]).worktreePath, realMain);
    assert.deepEqual(output.worktrees[missing], { kind: "none" });
    assert.deepEqual(output.worktrees.relative, { kind: "none" });
  });
});
