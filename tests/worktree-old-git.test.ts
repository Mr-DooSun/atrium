// Git before 2.36 has no `worktree list -z`. A shim in front of the real Git answers that option
// the way old Git does (unknown switch, exit 129) so the newline fallback is exercised.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearWorktreeCache, getWorktreeInfo, type WorktreeInfo } from "../server/core/worktree.ts";

const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const savedEnv = { ...process.env };
const fixtureEnv: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
fixtureEnv.GIT_CONFIG_NOSYSTEM = "1";
fixtureEnv.GIT_CONFIG_GLOBAL = "/dev/null";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    realGit,
    ["-c", "user.name=Atrium Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, env: fixtureEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}
type GitInfo = Extract<WorktreeInfo, { kind: "git" }>;
function asGit(info: WorktreeInfo): GitInfo {
  assert.equal(info.kind, "git", `expected a git worktree, got ${JSON.stringify(info)}`);
  return info as GitInfo;
}

let root: string;
let logFile: string;
let modeFile: string;
let main: string;
let linked: string;
let detached: string;
let prunable: string;

const calls = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean) : []);
const listCalls = () => calls().filter((c) => c.includes("worktree list"));

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "atrium-old-git-")));
  const bin = join(root, "bin");
  mkdirSync(bin);
  logFile = join(root, "calls.log");
  modeFile = join(root, "mode");
  // mode file absent or "old": -z is an unknown switch, exit 129. "other": same message, exit 1.
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      'echo "$*" >> "$ATRIUM_SHIM_LOG"',
      'for a in "$@"; do',
      '  if [ "$a" = "-z" ]; then',
      "    echo \"error: unknown switch \\`z'\" >&2",
      '    if [ "$(cat "$ATRIUM_SHIM_MODE" 2>/dev/null)" = "other" ]; then exit 1; fi',
      "    exit 129",
      "  fi",
      "done",
      'exec "$ATRIUM_REAL_GIT" "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "git"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  process.env.ATRIUM_SHIM_LOG = logFile;
  process.env.ATRIUM_SHIM_MODE = modeFile;
  process.env.ATRIUM_REAL_GIT = realGit;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";

  main = join(root, "메인 저장소 repo");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, "README.md"), "fixture\n");
  git(main, "add", "README.md");
  git(main, "commit", "-q", "-m", "initial");
  linked = join(root, "연결 워크트리 x");
  detached = join(root, "detached tree");
  prunable = join(root, "gone tree");
  git(main, "worktree", "add", "-q", "-b", "feat/x", linked);
  git(main, "worktree", "add", "-q", "--detach", detached);
  git(main, "worktree", "add", "-q", "-b", "feat/gone", prunable);
  rmSync(prunable, { recursive: true, force: true });
});

after(() => {
  clearWorktreeCache();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  clearWorktreeCache();
  writeFileSync(logFile, "");
  rmSync(modeFile, { force: true });
});

describe("git without worktree list -z", () => {
  test("the main worktree resolves through the newline fallback, in a Korean path with spaces", async () => {
    const info = asGit(await getWorktreeInfo(main));
    assert.equal(info.isMain, true);
    assert.equal(info.branch, "main");
    assert.equal(info.detached, false);
    assert.equal(info.worktreePath, realpathSync(main));
    assert.equal(info.mainWorktreePath, realpathSync(main));
    assert.equal(listCalls().filter((c) => c.includes("-z")).length, 1, "tried -z once");
    assert.equal(listCalls().filter((c) => !c.includes("-z")).length, 1, "then the plain porcelain listing once");
  });

  test("a linked worktree reports its branch and points at the main worktree", async () => {
    const info = asGit(await getWorktreeInfo(linked));
    assert.equal(info.isMain, false);
    assert.equal(info.branch, "feat/x");
    assert.equal(info.detached, false);
    assert.equal(info.worktreePath, realpathSync(linked));
    assert.equal(info.mainWorktreePath, realpathSync(main));
  });

  test("a detached worktree has no branch and detached true", async () => {
    const info = asGit(await getWorktreeInfo(detached));
    assert.equal(info.isMain, false);
    assert.equal(info.branch, null);
    assert.equal(info.detached, true);
    assert.match(info.head ?? "", /^[0-9a-f]{7}$/);
  });

  test("a prunable worktree (directory deleted) does not break the other entries", async () => {
    assert.equal(existsSync(prunable), false);
    assert.equal(asGit(await getWorktreeInfo(main)).branch, "main");
    clearWorktreeCache();
    assert.equal(asGit(await getWorktreeInfo(linked)).branch, "feat/x");
    clearWorktreeCache();
    assert.equal(asGit(await getWorktreeInfo(detached)).detached, true);
    assert.deepEqual(await getWorktreeInfo(prunable), { kind: "none" });
  });

  test("control: -z failing with exit 1 is not retried without it, and the result is none", async () => {
    writeFileSync(modeFile, "other");
    assert.deepEqual(await getWorktreeInfo(main), { kind: "none" });
    assert.equal(listCalls().length, 1, `worktree list ran again: ${JSON.stringify(listCalls())}`);
    assert.ok(listCalls()[0].includes("-z"));
  });
});
