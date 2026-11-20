// Call getWorktreeInfo(absoluteCwd) for a session directory. The result can be
// cached for five seconds. Call clearWorktreeCache() before a test needs a fresh lookup.
import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { WorktreeInfo } from "../../shared/project-rpc.ts";
import { checkedCwd } from "./cwd.ts";
import { failure, run } from "./exec.ts";

export type { WorktreeInfo } from "../../shared/project-rpc.ts";

const CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 512;
const GIT_TIMEOUT_MS = 2_000;
const WORKTREE_PREFIX = "worktree ";
const BRANCH_PREFIX = "branch refs/heads/";
const HEAD_PREFIX = "HEAD ";
const ORIGIN_PREFIX = "refs/remotes/origin/";
const GIT_CONFIG_ENV = new Set(["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM"]);
const gitLineEnding = process.platform === "win32" ? /\r?\n$/ : /\n$/;
const cached = new Map<string, { info: WorktreeInfo; expiresAt: number }>();
const inFlight = new Map<string, Promise<WorktreeInfo>>();

function git(cwd: string, ...args: string[]) {
  // Discover the repository from cwd even when the daemon was launched by Git or a hook.
  const env = Object.fromEntries(Object.keys(process.env)
    .filter((key) => key.startsWith("GIT_") && !GIT_CONFIG_ENV.has(key))
    .map((key) => [key, undefined]));
  return run("git", ["-C", cwd, ...args], { timeoutMs: GIT_TIMEOUT_MS, env });
}

async function canonicalGitPath(value: string): Promise<string | null> {
  if (!isAbsolute(value)) return null;
  // The primary worktree can be unavailable while a linked worktree is still in use.
  return realpath(value).catch(() => resolve(value));
}

async function findDefaultBranch(cwd: string): Promise<string | null> {
  const remote = await git(cwd, "symbolic-ref", "--quiet", `${ORIGIN_PREFIX}HEAD`);
  if (failure(remote) === null) {
    const target = remote.stdout.replace(gitLineEnding, "");
    if (target.startsWith(ORIGIN_PREFIX)) return target.slice(ORIGIN_PREFIX.length) || null;
  } else if (remote.timedOut || remote.spawnError || remote.truncated || remote.code === null) {
    return null;
  }

  const main = "refs/heads/main";
  const master = "refs/heads/master";
  const local = await git(cwd, "for-each-ref", "--format=%(refname)", main, master);
  if (failure(local) !== null) return null;
  const refs = new Set(local.stdout.split(/\r?\n/));
  if (refs.has(main)) return "main";
  if (refs.has(master)) return "master";
  return null;
}

/** `git worktree list --porcelain` as entries of fields, or null when Git fails. */
async function listWorktrees(cwd: string): Promise<string[][] | null> {
  // NUL delimiters preserve newlines and whitespace in paths.
  const nul = await git(cwd, "worktree", "list", "--porcelain", "-z");
  if (failure(nul) === null) return nul.stdout.split("\0\0").filter(Boolean).map((entry) => entry.split("\0"));
  // Git before 2.36 (Ubuntu 22.04 ships 2.34) has no -z and exits 129 for the unknown option.
  // Its newline output is right for every path without a newline in it.
  if (nul.code !== 129) return null;
  const lines = await git(cwd, "worktree", "list", "--porcelain");
  if (failure(lines) !== null) return null;
  return lines.stdout.split(/\r?\n\r?\n/).filter(Boolean).map((entry) => entry.split(/\r?\n/));
}

async function inspectWorktree(cwd: string): Promise<WorktreeInfo> {
  const topLevel = await git(cwd, "rev-parse", "--show-toplevel");
  if (failure(topLevel) !== null) return { kind: "none" };
  const worktreePath = await canonicalGitPath(topLevel.stdout.replace(gitLineEnding, ""));
  if (worktreePath === null) return { kind: "none" };

  const entries = await listWorktrees(cwd);
  if (entries === null) return { kind: "none" };

  // Git emits the primary entry first.
  const [mainEntry] = entries;
  if (!mainEntry?.[0].startsWith(WORKTREE_PREFIX)) return { kind: "none" };
  const mainPath = await canonicalGitPath(mainEntry[0].slice(WORKTREE_PREFIX.length));
  let current = mainPath === worktreePath ? mainEntry : undefined;

  if (!current) {
    for (const entry of entries.slice(1)) {
      if (!entry[0].startsWith(WORKTREE_PREFIX)) continue;
      if (entry.some((field) => field === "prunable" || field.startsWith("prunable "))) continue;
      const path = await canonicalGitPath(entry[0].slice(WORKTREE_PREFIX.length));
      if (path === worktreePath) {
        current = entry;
        break;
      }
    }
  }

  if (!current) {
    // For a separate Git directory, Git can list that directory as the primary path.
    const gitDir = await git(cwd, "rev-parse", "--absolute-git-dir");
    if (failure(gitDir) !== null) return { kind: "none" };
    const gitPath = await canonicalGitPath(gitDir.stdout.replace(gitLineEnding, ""));
    if (gitPath === null || gitPath !== mainPath) return { kind: "none" };
    current = mainEntry;
  }

  if (current.includes("bare")) return { kind: "none" };
  const isMain = current === mainEntry;
  const mainWorktreePath = isMain ? worktreePath : mainPath;
  if (mainWorktreePath === null) return { kind: "none" };

  const branch = current.find((field) => field.startsWith(BRANCH_PREFIX));
  const detached = current.includes("detached");
  const objectId = current.find((field) => field.startsWith(HEAD_PREFIX))?.slice(HEAD_PREFIX.length);
  if ((!branch && !detached) || !objectId) return { kind: "none" };

  return {
    kind: "git",
    worktreePath,
    mainWorktreePath,
    isMain,
    branch: detached ? null : (branch?.slice(BRANCH_PREFIX.length) ?? null),
    defaultBranch: await findDefaultBranch(cwd),
    head: /^0+$/.test(objectId) ? null : objectId.slice(0, 7),
    detached,
  };
}

export function getWorktreeInfo(cwd: string): Promise<WorktreeInfo> {
  let key: string;
  try {
    const directory = checkedCwd(cwd);
    if (directory === null) return Promise.resolve({ kind: "none" });
    key = realpathSync.native(directory);
  } catch {
    return Promise.resolve({ kind: "none" });
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const previous = cached.get(key);
  cached.delete(key);
  if (previous && previous.expiresAt > performance.now()) {
    cached.set(key, previous);
    return Promise.resolve(previous.info);
  }

  const lookup = inspectWorktree(key)
    .catch((): WorktreeInfo => ({ kind: "none" }))
    .then((info) => {
      // Clearing the cache also invalidates lookups that were already running.
      if (inFlight.get(key) === lookup) {
        inFlight.delete(key);
        cached.set(key, { info, expiresAt: performance.now() + CACHE_TTL_MS });
        if (cached.size > MAX_CACHE_ENTRIES) {
          const oldest = cached.keys().next();
          if (!oldest.done) cached.delete(oldest.value);
        }
      }
      return info;
    });
  inFlight.set(key, lookup);
  return lookup;
}

export function clearWorktreeCache(): void {
  cached.clear();
  inFlight.clear();
}
