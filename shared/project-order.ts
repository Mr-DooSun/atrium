// The sidebar's own project order, set by hand. Kept on the daemon so every client shows the same
// order. Projects are named by root folder: a project removed and added again keeps its place.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const Order = z.array(z.string().min(1)).max(1000);

export const getProjectOrder = defineRpc({
  name: "project.order.get",
  input: z.object({}),
  output: z.object({ order: Order }),
});

export const setProjectOrder = defineRpc({
  name: "project.order.set",
  input: z.object({ order: Order }),
  output: z.object({ order: Order }),
});

/**
 * Items in the saved order. Items the saved order does not name yet (a project added since) come
 * first, in their default order, so a new project is seen. An empty saved order is the default.
 */
export function applyOrder<T>(items: readonly T[], saved: readonly string[], keyOf: (item: T) => string): T[] {
  if (saved.length === 0) return [...items];
  const rank = new Map<string, number>();
  saved.forEach((key, i) => {
    if (!rank.has(key)) rank.set(key, i);
  });
  const fresh = items.filter((item) => !rank.has(keyOf(item)));
  const placed = items
    .filter((item) => rank.has(keyOf(item)))
    .sort((a, b) => rank.get(keyOf(a))! - rank.get(keyOf(b))!);
  return [...fresh, ...placed];
}

/**
 * The order to save after moving `key` one place up (-1) or down (+1) among the shown keys.
 * Saved keys not shown now (a project removed for the moment) stay at the end, so they keep a
 * place if they come back.
 */
export function move(shown: readonly string[], saved: readonly string[], key: string, delta: -1 | 1): string[] {
  const list = [...new Set(shown)];
  const from = list.indexOf(key);
  const to = from + delta;
  if (from >= 0 && to >= 0 && to < list.length) [list[from], list[to]] = [list[to], list[from]];
  const kept = new Set(list);
  return [...list, ...saved.filter((k) => !kept.has(k) && kept.add(k))];
}
