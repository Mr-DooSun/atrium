// The Paseo host id (daemon serverId) of the daemon this plugin runs in. Agent and workspace refs
// carry the same id as `hostId`, so the client can tell this daemon's sessions from other hosts'.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

/** The part of a handler's `context.paseo` this module uses. */
export type HostLister = Pick<PluginHandlerContext["paseo"], "hosts">;

const LIST_TIMEOUT_MS = 3_000;
// Both sources answer fast or fail fast, so a failure is asked about again soon.
const RETRY_MS = 30_000;
let known: string | null = null;
let pending: Promise<string | null> | null = null;
let failedAt = -Infinity;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 && id.length <= 256 && !/\s/.test(id) ? id : null;
}

async function fromDaemon(paseo: HostLister | undefined): Promise<string | null> {
  if (!paseo) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LIST_TIMEOUT_MS);
  });
  try {
    // The daemon that serves this plugin names itself; nothing here can pick another daemon.
    const directory = await Promise.race([paseo.hosts.list(), timeout]);
    return clean(directory?.self?.serverId);
  } catch {
    // Daemons without connected hosts reject with unsupported_capability.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fromHomeFile(): Promise<string | null> {
  // Only the home Paseo names for this plugin. Guessing ~/.paseo could read another daemon's id
  // (a daemon started with --home elsewhere), and a wrong id puts badges on the wrong sessions.
  const home = process.env.PASEO_HOME;
  if (!home) return null;
  return readFile(join(home, "server-id"), "utf8").then(clean, () => null);
}

/**
 * This daemon's host id: `paseo.hosts.list().self.serverId` first, then `$PASEO_HOME/server-id`
 * when Paseo set PASEO_HOME. Null when neither answers; asked again after 30 seconds. A found id
 * is kept for the life of the process (a daemon's id does not change while it runs).
 */
export function ownHostId(paseo?: HostLister): Promise<string | null> {
  if (known) return Promise.resolve(known);
  if (pending) return pending;
  if (performance.now() - failedAt < RETRY_MS) return Promise.resolve(null);
  pending = (async () => (await fromDaemon(paseo)) ?? (await fromHomeFile()))()
    .catch(() => null)
    .then((id) => {
      pending = null;
      if (id) known = id;
      else failedAt = performance.now();
      return id;
    });
  return pending;
}

/** For tests: forget the id so the next call looks it up again. */
export function clearOwnHostId(): void {
  known = null;
  pending = null;
  failedAt = -Infinity;
}
