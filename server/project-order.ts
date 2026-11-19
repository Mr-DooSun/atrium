import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getProjectOrder, setProjectOrder } from "../shared/project-order";

/** Beside the daemon's own data, so a second daemon home keeps its own order. */
const FILE = join(process.env.PASEO_HOME ?? join(homedir(), ".paseo"), "nested-agents", "project-order.json");

async function read(): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(await readFile(FILE, "utf8"));
    const order = (value as { order?: unknown })?.order;
    return Array.isArray(order) ? order.filter((k): k is string => typeof k === "string" && k.length > 0) : [];
  } catch {
    // No file yet, or a broken one: the default order.
    return [];
  }
}

let writes = 0;

export function registerProjectOrder(server: PluginServerContext) {
  server.handle(getProjectOrder, async () => ({ order: await read() }));
  server.handle(setProjectOrder, async ({ order }) => {
    await mkdir(dirname(FILE), { recursive: true });
    // Written whole, then renamed over, so a crash never leaves half a file.
    const tmp = `${FILE}.${process.pid}.${++writes}.tmp`;
    await writeFile(tmp, JSON.stringify({ order }, null, 2));
    await rename(tmp, FILE);
    return { order };
  });
}
