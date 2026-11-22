import { access, copyFile, link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getProjectOrder, setNodeOrder, setProjectOrder } from "../shared/project-order";
import { hiddenProjectKey, hiddenProjectSchema, type HiddenProject } from "../shared/project-rpc";

/** Beside the daemon's own data, so a second daemon home keeps its own order. */
const HOME_DIR = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
const FILE = join(HOME_DIR, "atrium", "project-order.json");
const LEGACY_FILE = join(HOME_DIR, "nested-agents", "project-order.json");

interface Stored {
  order: string[];
  nodes: Record<string, string[]>;
  hiddenProjects: HiddenProject[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((k): k is string => typeof k === "string" && k.length > 0) : [];

let migration: Promise<void> | undefined;

async function migrateOrder(): Promise<void> {
  try {
    await access(FILE);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temp = `${FILE}.${process.pid}.migration.tmp`;
  try {
    await access(LEGACY_FILE);
    await mkdir(dirname(FILE), { recursive: true });
    await copyFile(LEGACY_FILE, temp);
    // Publish the complete copy only if the destination is still absent.
    await link(temp, FILE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "EEXIST") throw error;
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function read(): Promise<Stored> {
  migration ??= migrateOrder().catch((error: unknown) => {
    migration = undefined;
    throw error;
  });
  await migration;
  try {
    const value = JSON.parse(await readFile(FILE, "utf8")) as { order?: unknown; nodes?: unknown; hiddenProjects?: unknown };
    const nodes: Record<string, string[]> = {};
    if (value.nodes && typeof value.nodes === "object") {
      for (const [group, list] of Object.entries(value.nodes)) {
        const keys = strings(list);
        if (keys.length > 0) nodes[group] = keys;
      }
    }
    const hidden = new Map<string, HiddenProject>();
    for (const entry of Array.isArray(value.hiddenProjects) ? value.hiddenProjects : []) {
      const parsed = hiddenProjectSchema.safeParse(entry);
      if (parsed.success) hidden.set(hiddenProjectKey(parsed.data.hostId, parsed.data.projectId), parsed.data);
    }
    return { order: strings(value.order), nodes, hiddenProjects: [...hidden.values()] };
  } catch {
    // No file yet, or a broken one: the default order.
    return { order: [], nodes: {}, hiddenProjects: [] };
  }
}

let writes = 0;
async function write(stored: Stored) {
  await mkdir(dirname(FILE), { recursive: true });
  // Written whole, then renamed over, so a crash never leaves half a file.
  const tmp = `${FILE}.${process.pid}.${++writes}.tmp`;
  await writeFile(tmp, JSON.stringify(stored, null, 2));
  await rename(tmp, FILE);
}

// Changes run one at a time: each reads the file, changes one part, and writes it back.
let queue: Promise<unknown> = Promise.resolve();
function update(change: (stored: Stored) => void): Promise<Stored> {
  const next = queue.then(async () => {
    const stored = await read();
    change(stored);
    await write(stored);
    return stored;
  });
  queue = next.catch(() => {});
  return next;
}

/** Stores any project's host namespace in this daemon's view preferences, using the order write queue. */
export async function setProjectHidden(hostId: string, projectId: string, hidden: boolean): Promise<HiddenProject[]> {
  const key = hiddenProjectKey(hostId, projectId);
  const stored = await update((stored) => {
    stored.hiddenProjects = stored.hiddenProjects.filter((entry) => hiddenProjectKey(entry.hostId, entry.projectId) !== key);
    if (hidden) stored.hiddenProjects.push({ hostId, projectId });
  });
  return stored.hiddenProjects;
}

export function registerProjectOrder(server: PluginServerContext) {
  server.handle(getProjectOrder, async () => read());
  server.handle(setProjectOrder, async ({ order }) => {
    await update((stored) => {
      stored.order = order;
    });
    return { order };
  });
  server.handle(setNodeOrder, async ({ group, order }) => {
    await update((stored) => {
      if (order.length > 0) stored.nodes[group] = order;
      else delete stored.nodes[group];
    });
    return { ok: true as const };
  });
}
