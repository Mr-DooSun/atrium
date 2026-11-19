import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getProjectOrder, setNodeOrder, setProjectOrder } from "../shared/project-order";

/** Beside the daemon's own data, so a second daemon home keeps its own order. */
const FILE = join(process.env.PASEO_HOME ?? join(homedir(), ".paseo"), "nested-agents", "project-order.json");

interface Stored {
  order: string[];
  nodes: Record<string, string[]>;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((k): k is string => typeof k === "string" && k.length > 0) : [];

async function read(): Promise<Stored> {
  try {
    const value = JSON.parse(await readFile(FILE, "utf8")) as { order?: unknown; nodes?: unknown };
    const nodes: Record<string, string[]> = {};
    if (value.nodes && typeof value.nodes === "object") {
      for (const [group, list] of Object.entries(value.nodes)) {
        const keys = strings(list);
        if (keys.length > 0) nodes[group] = keys;
      }
    }
    return { order: strings(value.order), nodes };
  } catch {
    // No file yet, or a broken one: the default order.
    return { order: [], nodes: {} };
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
