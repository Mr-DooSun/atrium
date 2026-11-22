import "./helpers/isolated-home.ts";
// Adversarial cases for getWorktreeInfo: default branch detection, odd paths, prunable and locked
// worktrees, inherited GIT_* variables, submodules, path aliases, the LRU bound, and the TTL.
//
// A wrapper `git` on PATH logs every call the module makes (and the GIT_DIR it saw), so tests can
// count Git subprocesses instead of guessing from object identity. Fixtures use the real binary.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { clearWorktreeCache, getWorktreeInfo, type WorktreeInfo } from "../server/core/worktree.ts";
import { registerProject } from "../server/project.ts";
import { projectWorktrees, projectWorktreesInputSchema, projectWorktreesOutputSchema } from "../shared/project-rpc.ts";

const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const savedEnv = { ...process.env };
// Fixture Git: real binary, no user/system config, and none of the variables tests plant.
const fixtureEnv: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
fixtureEnv.GIT_CONFIG_NOSYSTEM = "1";
fixtureEnv.GIT_CONFIG_GLOBAL = "/dev/null";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    realGit,
    [
      "-c", "user.name=Atrium Test",
      "-c", "user.email=test@example.invalid",
      "-c", "commit.gpgsign=false",
      "-c", "protocol.file.allow=always",
      ...args,
    ],
    { cwd, env: fixtureEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).replace(/\n$/, "");
}

function initRepo(path: string, branch = "main", commit = true): void {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", branch);
  if (!commit) return;
  writeFileSync(join(path, "README.md"), "fixture\n");
  git(path, "add", "README.md");
  git(path, "commit", "-q", "-m", "initial");
}

function asGit(info: WorktreeInfo): Extract<WorktreeInfo, { kind: "git" }> {
  assert.equal(info.kind, "git", `expected a git worktree, got ${JSON.stringify(info)}`);
  return info as Extract<WorktreeInfo, { kind: "git" }>;
}

let root: string;
let fakeBin: string;
let logFile: string;
let sleepFile: string;
let failFile: string;

interface GitCall {
  args: string;
  gitDir: string;
  workTree: string;
  indexFile: string;
}

function calls(): GitCall[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((line) => {
    const [args, gitDir, workTree, indexFile] = line.split("\t");
    return { args, gitDir, workTree, indexFile };
  });
}
function resetCalls(): void {
  writeFileSync(logFile, "");
}

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "atrium-worktree-edge-")));
  fakeBin = join(root, "bin");
  mkdirSync(fakeBin);
  logFile = join(root, "git-calls.log");
  sleepFile = join(root, "git-sleep");
  failFile = join(root, "git-fail");
  // ATRIUM_* names survive the module's GIT_* scrubbing. The sleep file holds a pattern: calls whose
  // arguments contain it hang until the module's timeout kills them. While the fail file exists,
  // every call answers "not a git repository" without starting the real Git (cheap bulk lookups).
  writeFileSync(
    join(fakeBin, "git"),
    [
      "#!/bin/sh",
      'printf "%s\\t%s\\t%s\\t%s\\n" "$*" "${GIT_DIR-<unset>}" "${GIT_WORK_TREE-<unset>}" "${GIT_INDEX_FILE-<unset>}" >> "$ATRIUM_FAKE_LOG"',
      'if [ -f "$ATRIUM_FAKE_FAIL" ]; then echo "fatal: not a git repository" >&2; exit 128; fi',
      'if [ -f "$ATRIUM_FAKE_SLEEP" ]; then',
      '  case "$*" in *"$(cat "$ATRIUM_FAKE_SLEEP")"*) sleep 30 ;; esac',
      "fi",
      'exec "$ATRIUM_REAL_GIT" "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(join(fakeBin, "git"), 0o755);
  process.env.PATH = `${fakeBin}:${process.env.PATH ?? ""}`;
  process.env.ATRIUM_FAKE_LOG = logFile;
  process.env.ATRIUM_FAKE_SLEEP = sleepFile;
  process.env.ATRIUM_FAKE_FAIL = failFile;
  process.env.ATRIUM_REAL_GIT = realGit;
  // The module's Git calls use the user's config otherwise; keep them hermetic.
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
});

after(() => {
  clearWorktreeCache();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  clearWorktreeCache();
  resetCalls();
  rmSync(sleepFile, { force: true });
  rmSync(failFile, { force: true });
});

describe("defaultBranch", () => {
  test("origin/HEAD wins over a local main, and linked worktrees share it", async () => {
    const seed = join(root, "seed-develop");
    initRepo(seed, "develop");
    const bare = join(root, "origin-develop.git");
    git(root, "init", "-q", "--bare", "-b", "develop", bare);
    git(seed, "push", "-q", bare, "develop");
    const clone = join(root, "clone-develop");
    git(root, "clone", "-q", bare, clone);
    assert.equal(git(clone, "symbolic-ref", "refs/remotes/origin/HEAD"), "refs/remotes/origin/develop");
    git(clone, "branch", "main"); // a local main must not override the remote default
    const linked = join(root, "clone-develop-wt");
    git(clone, "worktree", "add", "-q", "-b", "topic", linked);

    const info = asGit(await getWorktreeInfo(clone));
    assert.equal(info.branch, "develop");
    assert.equal(info.defaultBranch, "develop");
    const linkedInfo = asGit(await getWorktreeInfo(linked));
    assert.equal(linkedInfo.isMain, false);
    assert.equal(linkedInfo.defaultBranch, "develop");
  });

  test("origin/HEAD naming a branch with slashes keeps the whole name", async () => {
    const repo = join(root, "slashed-head");
    initRepo(repo);
    git(repo, "update-ref", "refs/remotes/origin/release/2026", "HEAD");
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/release/2026");
    assert.equal(asGit(await getWorktreeInfo(repo)).defaultBranch, "release/2026");
  });

  test("an origin without origin/HEAD falls back to a local main", async () => {
    const repo = join(root, "no-origin-head");
    initRepo(repo);
    git(repo, "update-ref", "refs/remotes/origin/develop", "HEAD");
    assert.equal(asGit(await getWorktreeInfo(repo)).defaultBranch, "main");
  });

  test("origin/HEAD that is not symbolic falls back to local branches", async () => {
    const repo = join(root, "plain-origin-head");
    initRepo(repo, "master");
    git(repo, "update-ref", "--no-deref", "refs/remotes/origin/HEAD", "HEAD");
    assert.equal(asGit(await getWorktreeInfo(repo)).defaultBranch, "master");
  });

  test("master only, and main beats master when both exist", async () => {
    const masterOnly = join(root, "master-only");
    initRepo(masterOnly, "master");
    git(masterOnly, "checkout", "-q", "-b", "feature");
    const info = asGit(await getWorktreeInfo(masterOnly));
    assert.equal(info.branch, "feature");
    assert.equal(info.defaultBranch, "master");

    const both = join(root, "main-and-master");
    initRepo(both, "master");
    git(both, "branch", "main");
    assert.equal(asGit(await getWorktreeInfo(both)).defaultBranch, "main");
  });

  test("no origin, no main or master: null; an unborn main is not a default either", async () => {
    const trunk = join(root, "trunk-only");
    initRepo(trunk, "trunk");
    const info = asGit(await getWorktreeInfo(trunk));
    assert.equal(info.branch, "trunk");
    assert.equal(info.defaultBranch, null);

    const unborn = join(root, "unborn-main");
    initRepo(unborn, "main", false);
    const unbornInfo = asGit(await getWorktreeInfo(unborn));
    assert.equal(unbornInfo.branch, "main");
    assert.equal(unbornInfo.defaultBranch, null);
  });

  test("a branch named like the remote prefix does not confuse the fallback", async () => {
    const repo = join(root, "tricky-names");
    initRepo(repo, "trunk");
    git(repo, "branch", "main-old");
    git(repo, "branch", "mainline");
    git(repo, "branch", "origin/main"); // a local branch literally called origin/main
    assert.equal(asGit(await getWorktreeInfo(repo)).defaultBranch, null);
  });
});

describe("paths", () => {
  let main: string;
  before(() => {
    main = join(root, "한글 저장소");
    initRepo(main);
  });

  test("Korean names, inner spaces, and a trailing space survive NUL parsing", async () => {
    const linked = join(root, "작업 트리 ");
    git(main, "worktree", "add", "-q", "-b", "기능/한글 브랜치".replace(" ", "-"), linked);
    const info = asGit(await getWorktreeInfo(linked));
    assert.equal(info.worktreePath, realpathSync(linked));
    assert.ok(info.worktreePath.endsWith(" "), "the trailing space is kept");
    assert.equal(info.mainWorktreePath, realpathSync(main));
    assert.equal(info.isMain, false);
    assert.equal(info.branch, "기능/한글-브랜치");
    assert.equal(asGit(await getWorktreeInfo(main)).isMain, true);
  });

  test("a directory name containing a newline still resolves", async () => {
    const linked = join(root, "line\nbreak");
    git(main, "worktree", "add", "-q", "-b", "newline", linked);
    const info = asGit(await getWorktreeInfo(linked));
    assert.equal(info.worktreePath, realpathSync(linked));
    assert.equal(info.isMain, false);
    assert.equal(info.branch, "newline");
  });

  test("a directory name ending in a newline keeps it", async () => {
    const linked = join(root, "ends-in-newline\n");
    git(main, "worktree", "add", "-q", "-b", "trailing-newline", linked);
    const info = asGit(await getWorktreeInfo(linked));
    assert.equal(info.worktreePath, realpathSync(linked));
    assert.equal(info.isMain, false);
  });

  test("NFD and case-variant spellings resolve to the same cached entry (macOS)", { skip: process.platform !== "darwin" }, async () => {
    const first = asGit(await getWorktreeInfo(main));
    resetCalls();
    const nfd = main.normalize("NFD");
    assert.notEqual(nfd, main);
    assert.equal(await getWorktreeInfo(nfd), first);
    const upper = main.replace(/^\/private\/var\//, "/PRIVATE/VAR/");
    assert.notEqual(upper, main);
    assert.equal(await getWorktreeInfo(upper), first);
    assert.equal(calls().length, 0, "aliases are served from the cache");
  });

  test("the .git directory itself is not a worktree", async () => {
    assert.deepEqual(await getWorktreeInfo(join(main, ".git")), { kind: "none" });
  });
});

describe("prunable and locked worktrees", () => {
  let main: string;
  let gone: string;
  let alive: string;
  let locked: string;
  before(() => {
    main = join(root, "prune-main");
    initRepo(main);
    gone = join(root, "prune-gone");
    alive = join(root, "prune-alive");
    locked = join(root, "prune-locked");
    git(main, "worktree", "add", "-q", "-b", "gone", gone);
    git(main, "worktree", "add", "-q", "-b", "alive", alive);
    git(main, "worktree", "add", "-q", "-b", "locked", locked);
    git(main, "worktree", "lock", "--reason", "on a\nremovable drive", locked);
    rmSync(gone, { recursive: true, force: true });
    assert.match(git(main, "worktree", "list", "--porcelain"), /prunable/);
  });

  test("the main worktree is unaffected by a prunable entry", async () => {
    const info = asGit(await getWorktreeInfo(main));
    assert.equal(info.isMain, true);
    assert.equal(info.branch, "main");
  });

  test("a live worktree listed after a prunable one still resolves", async () => {
    const info = asGit(await getWorktreeInfo(alive));
    assert.equal(info.isMain, false);
    assert.equal(info.branch, "alive");
    assert.equal(info.mainWorktreePath, realpathSync(main));
  });

  test("a locked worktree (reason with a newline) resolves normally", async () => {
    const info = asGit(await getWorktreeInfo(locked));
    assert.equal(info.isMain, false);
    assert.equal(info.branch, "locked");
    assert.equal(info.detached, false);
  });

  test("a plain directory recreated at a prunable path is not that worktree", async () => {
    const reborn = join(root, "prune-reborn");
    git(main, "worktree", "add", "-q", "-b", "reborn", reborn);
    rmSync(reborn, { recursive: true, force: true });
    mkdirSync(reborn);
    assert.deepEqual(await getWorktreeInfo(reborn), { kind: "none" });
  });
});

describe("inherited Git environment", () => {
  const planted = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_CEILING_DIRECTORIES"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(planted.map((key) => [key, process.env[key]]));
  });
  const restore = () => {
    for (const key of planted) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };

  test("a bogus GIT_DIR, GIT_WORK_TREE, and GIT_INDEX_FILE are not passed to Git", async () => {
    const repo = join(root, "env-repo");
    initRepo(repo);
    git(repo, "checkout", "-q", "-b", "env-branch");
    try {
      process.env.GIT_DIR = join(root, "no-such-git-dir");
      process.env.GIT_WORK_TREE = "/";
      process.env.GIT_INDEX_FILE = join(root, "no-such-index");
      process.env.GIT_CEILING_DIRECTORIES = root;
      const info = asGit(await getWorktreeInfo(repo));
      assert.equal(info.branch, "env-branch");
      assert.equal(info.worktreePath, realpathSync(repo));
    } finally {
      restore();
    }
    const seen = calls();
    assert.ok(seen.length > 0);
    for (const call of seen) {
      assert.equal(call.gitDir, "<unset>", call.args);
      assert.equal(call.workTree, "<unset>", call.args);
      assert.equal(call.indexFile, "<unset>", call.args);
    }
  });

  test("a GIT_DIR naming a different real repository does not leak its answer", async () => {
    const other = join(root, "env-other");
    initRepo(other, "other-default");
    const repo = join(root, "env-target");
    initRepo(repo);
    try {
      process.env.GIT_DIR = join(other, ".git");
      process.env.GIT_COMMON_DIR = join(other, ".git");
      const info = asGit(await getWorktreeInfo(repo));
      assert.equal(info.branch, "main");
      assert.equal(info.worktreePath, realpathSync(repo));
      assert.equal(info.defaultBranch, "main");
    } finally {
      restore();
    }
  });
});

describe("submodules and separate Git directories", () => {
  test("a cwd inside a submodule reports the submodule checkout as its own main worktree", async () => {
    const upstream = join(root, "sub-upstream");
    initRepo(upstream);
    const superRepo = join(root, "super");
    initRepo(superRepo);
    git(superRepo, "submodule", "add", "-q", upstream, "vendor/lib");
    git(superRepo, "commit", "-q", "-m", "add submodule");
    const sub = join(superRepo, "vendor", "lib");
    mkdirSync(join(sub, "nested"));

    const info = asGit(await getWorktreeInfo(join(sub, "nested")));
    assert.equal(info.worktreePath, realpathSync(sub));
    assert.equal(info.mainWorktreePath, realpathSync(sub));
    assert.equal(info.isMain, true);
    assert.equal(info.branch, "main");
    assert.equal(info.defaultBranch, "main"); // the submodule's origin/HEAD

    const superInfo = asGit(await getWorktreeInfo(superRepo));
    assert.equal(superInfo.worktreePath, realpathSync(superRepo));
  });

  test("main checkout of a --separate-git-dir repository", async () => {
    const work = join(root, "sep-work");
    git(root, "init", "-q", "-b", "main", "--separate-git-dir", join(root, "sep.git"), work);
    writeFileSync(join(work, "f"), "x");
    git(work, "add", "f");
    git(work, "commit", "-q", "-m", "i");
    const info = asGit(await getWorktreeInfo(work));
    assert.equal(info.isMain, true);
    assert.equal(info.worktreePath, realpathSync(work));
    assert.equal(info.mainWorktreePath, realpathSync(work));
  });

  // Git lists a --separate-git-dir repository's Git directory, not its checkout, as the primary
  // worktree, and mainWorktreePath repeats what Git reports. Kept on purpose: the sidebar never
  // reads mainWorktreePath, and everything it does read (worktreePath, isMain, branch) is right.
  test("linked worktree of a --separate-git-dir repository: mainWorktreePath is what Git lists", async () => {
    const work = join(root, "sep2-work");
    const gitDir = join(root, "sep2.git");
    git(root, "init", "-q", "-b", "main", "--separate-git-dir", gitDir, work);
    writeFileSync(join(work, "f"), "x");
    git(work, "add", "f");
    git(work, "commit", "-q", "-m", "i");
    const linked = join(root, "sep2-linked");
    git(work, "worktree", "add", "-q", "-b", "lw", linked);
    const info = asGit(await getWorktreeInfo(linked));
    assert.equal(info.worktreePath, realpathSync(linked));
    assert.equal(info.isMain, false);
    assert.equal(info.branch, "lw");
    assert.equal(info.mainWorktreePath, realpathSync(gitDir));
  });
});

describe("aliases share one lookup", () => {
  let repo: string;
  let link: string;
  before(() => {
    repo = join(root, "alias-repo");
    initRepo(repo);
    link = join(root, "alias-link");
    symlinkSync(repo, link);
  });

  test("a symlink and the real path started together run Git for one lookup only", async () => {
    const viaLink = getWorktreeInfo(link);
    const viaReal = getWorktreeInfo(repo);
    const viaDot = getWorktreeInfo(`${link}/.`);
    assert.equal(viaLink, viaReal);
    assert.equal(viaLink, viaDot);
    const info = asGit(await viaLink);
    assert.equal(info.worktreePath, realpathSync(repo));
    const single = calls().length;
    // rev-parse, worktree list, symbolic-ref origin/HEAD, for-each-ref.
    assert.equal(single, 4, calls().map((c) => c.args).join("\n"));
    clearWorktreeCache();
    resetCalls();
    await getWorktreeInfo(repo);
    assert.equal(calls().length, single, "one lookup costs the same with or without aliases");
  });

  test("cached aliases (trailing slash, /., //, symlink) start no Git process", async () => {
    const info = await getWorktreeInfo(repo);
    resetCalls();
    for (const alias of [`${repo}/`, `${repo}/.`, `${repo}//`, link, `${link}/`, join(repo, "..", "alias-repo")]) {
      assert.equal(await getWorktreeInfo(alias), info, alias);
    }
    assert.equal(calls().length, 0);
  });

  test("the RPC echoes each alias as sent, with one Git lookup behind them", async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    registerProject({
      handle(contract: { name: string }, handler: (input: unknown) => Promise<unknown>) {
        handlers.set(contract.name, handler);
      },
    } as unknown as PluginServerContext);
    const handler = handlers.get(projectWorktrees.name);
    assert.ok(handler);
    const cwds = [link, `${repo}/`, `${repo}/.`, repo, "__proto__", "constructor", "toString"];
    const output = projectWorktreesOutputSchema.parse(await handler(projectWorktreesInputSchema.parse({ cwds })));
    assert.deepEqual(Object.keys(output.worktrees).sort(), [...cwds].sort());
    for (const alias of [link, `${repo}/`, `${repo}/.`]) assert.deepEqual(output.worktrees[alias], output.worktrees[repo]);
    assert.equal(asGit(output.worktrees[repo]).worktreePath, realpathSync(repo));
    assert.ok(Object.hasOwn(output.worktrees, "__proto__"));
    assert.deepEqual(output.worktrees["__proto__"], { kind: "none" });
    assert.deepEqual(output.worktrees.constructor, { kind: "none" });
    assert.equal(calls().filter((c) => c.args.includes("rev-parse --show-toplevel")).length, 1);
  });
});

describe("cache bounds and expiry", () => {
  test("the 513th distinct entry evicts the least recently used one", async (t) => {
    // Hold the clock still: 513 lookups take longer than the 5 s TTL.
    t.mock.method(performance, "now", () => 4_000_000);
    const dirs = Array.from({ length: 513 }, (_, i) => join(root, "lru", String(i)));
    for (const dir of dirs) mkdirSync(dir, { recursive: true });
    // Only the cache bookkeeping is under test: let the fake git fail fast instead of running Git.
    writeFileSync(failFile, "");
    const lookupAll = async (list: string[]) => {
      for (let i = 0; i < list.length; i += 32) await Promise.all(list.slice(i, i + 32).map((d) => getWorktreeInfo(d)));
    };

    // 0, 1, 2 in order, then 3..511 in parallel batches (512 entries), touch 0, then 512:
    // 1 is the oldest and goes. Batches finish in any order, so 1 and 2 are looked up alone.
    await getWorktreeInfo(dirs[0]);
    await getWorktreeInfo(dirs[1]);
    await getWorktreeInfo(dirs[2]);
    await lookupAll(dirs.slice(3, 512));
    resetCalls();
    await getWorktreeInfo(dirs[0]);
    assert.equal(calls().length, 0, "a hit while the cache is full");
    await getWorktreeInfo(dirs[512]);
    resetCalls();
    await getWorktreeInfo(dirs[0]);
    assert.equal(calls().length, 0, "the touched entry survived eviction");
    await getWorktreeInfo(dirs[2]);
    assert.equal(calls().length, 0, "a newer entry survived too");
    await getWorktreeInfo(dirs[1]);
    assert.equal(calls().length, 1, "the least recently used entry was evicted and looked up again");
  });

  test("results expire after five seconds, not before", async (t) => {
    const repo = join(root, "ttl-repo");
    initRepo(repo);
    git(repo, "branch", "other");
    let now = 1_000_000;
    t.mock.method(performance, "now", () => now);
    const first = asGit(await getWorktreeInfo(repo));
    git(repo, "checkout", "-q", "other");
    now += 4_999;
    assert.equal(await getWorktreeInfo(repo), first);
    now += 2;
    assert.equal(asGit(await getWorktreeInfo(repo)).branch, "other");
  });

  test("a timed-out lookup is cached as none for five seconds, then retried", async (t) => {
    const repo = join(root, "timeout-repo");
    initRepo(repo);
    let now = 2_000_000;
    t.mock.method(performance, "now", () => now);
    writeFileSync(sleepFile, "rev-parse --show-toplevel");
    const started = Date.now();
    assert.deepEqual(await getWorktreeInfo(repo), { kind: "none" });
    const waited = Date.now() - started;
    assert.ok(waited >= 1_900 && waited < 6_000, `timed out after ${waited} ms`);
    unlinkSync(sleepFile);

    resetCalls();
    now += 4_000;
    assert.deepEqual(await getWorktreeInfo(repo), { kind: "none" });
    assert.equal(calls().length, 0, "the failure is cached");
    now += 1_001;
    assert.equal(asGit(await getWorktreeInfo(repo)).branch, "main");
  });

  test("a timed-out default-branch probe gives defaultBranch null, then recovers", async (t) => {
    const repo = join(root, "timeout-default");
    initRepo(repo);
    let now = 3_000_000;
    t.mock.method(performance, "now", () => now);
    writeFileSync(sleepFile, "symbolic-ref");
    const info = asGit(await getWorktreeInfo(repo));
    assert.equal(info.branch, "main");
    assert.equal(info.defaultBranch, null);
    unlinkSync(sleepFile);
    now += 5_001;
    assert.equal(asGit(await getWorktreeInfo(repo)).defaultBranch, "main");
  });
});
