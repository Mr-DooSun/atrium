// Safe file helpers for editing mcp_config.json. Node-only, no adapter imports (testable).
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";

export async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

const locks = new Map<string, Promise<unknown>>();

/** In-process mutex per (real) file so concurrent read-modify-write cycles don't lose entries. */
export async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const key = await canonical(path);
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await next;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/** Locks several files (deduped by realpath, stable order) so the same file is never locked twice. */
export async function withLocks<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
  const keys = [...new Set(await Promise.all(paths.map(canonical)))].sort();
  const nest = (i: number): Promise<T> => (i >= keys.length ? fn() : withLock(keys[i], () => nest(i + 1)));
  return nest(0);
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

export type Target = { ok: true; target: string } | { ok: false; error: string };

/**
 * Real file to read/write for a config path. User scope (`projectRoot` null) follows symlinks.
 * Project scope: the `.agents` dir and the file must resolve inside realpath(projectRoot); the
 * `.agents` dir itself is created (non-recursive) when missing.
 */
export async function resolveTarget(path: string, projectRoot: string | null, create: boolean): Promise<Target> {
  if (projectRoot === null) return { ok: true, target: await canonical(path) };
  const root = await canonical(projectRoot);
  const dir = dirname(path);
  try {
    await lstat(dir);
  } catch {
    if (!create) return { ok: true, target: join(dir, basename(path)) }; // nothing there yet
    await mkdir(dir).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
  }
  const realDir = await canonical(dir);
  if (!inside(root, realDir) || realDir === root) return { ok: false, error: "project .agents directory resolves outside the project; refusing" };
  const file = join(realDir, basename(path));
  const real = await canonical(file);
  if (!inside(root, real)) return { ok: false, error: "project mcp_config.json resolves outside the project; refusing" };
  return { ok: true, target: real };
}

/** Exclusive-create temp file (never follows a planted symlink), mode preserved, always cleaned up. */
export async function writeFileSafely(target: string, text: string): Promise<void> {
  let mode = 0o600;
  try {
    mode = (await stat(target)).mode & 0o777;
  } catch {
    /* new file */
  }
  await mkdir(dirname(target), { recursive: true }).catch(() => undefined);
  const tmp = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    const handle = await open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.chmod(mode);
    } finally {
      await handle.close();
    }
    await rename(tmp, target);
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}
