// The sidebar's own order, set by hand: of projects, and of the sessions under each parent at
// every depth. Kept on the daemon so every client shows the same order. Projects are named by host
// and root folder (`projectOrderKey`), so a project removed and added again keeps its place, and the
// same folder on two hosts is two places; sessions by their entity key.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { TreeNode } from "./tree";

const Order = z.array(z.string().min(1)).max(1000);
/** Parent key → its children's keys in order. A project's own rows go under `rootsGroup(path)`. */
const NodeOrders = z.record(z.string().min(1), Order);
export type NodeOrders = Readonly<Record<string, readonly string[]>>;

export const getProjectOrder = defineRpc({
  name: "project.order.get",
  input: z.object({}),
  output: z.object({ order: Order, nodes: NodeOrders }),
});

/** Sets the order of one parent's children; an empty order goes back to the default. */
export const setNodeOrder = defineRpc({
  name: "project.order.nodes.set",
  input: z.object({ group: z.string().min(1), order: Order }),
  output: z.object({ ok: z.literal(true) }),
});

/** The group a project's top rows are ordered in, by its `projectOrderKey` (or, saved before hosts, its root). */
export const rootsGroup = (projectKey: string) => `project:${projectKey}`;

/**
 * A project's name in the saved order: its host and root folder. Orders saved before hosts were
 * told apart name the root folder alone; `upgradeOrder` and `legacyRoot` read those.
 */
export const projectOrderKey = (hostId: string, rootPath: string) => JSON.stringify([hostId, rootPath]);

/** The root folder of an order key saved before hosts were told apart; null for a host-named key. */
export function legacyRoot(key: string): string | null {
  if (!key.startsWith("[")) return key;
  try {
    const value: unknown = JSON.parse(key);
    if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "string")) return null;
  } catch {
    // A folder whose name starts with "[": a legacy key after all.
  }
  return key;
}

/**
 * The saved project order with each root-only entry (saved before hosts were told apart) replaced
 * by the shown projects in that folder, on every host, in their shown order, where the saved
 * order does not already name them. Root-only entries no shown project matches stay as they are.
 */
export function upgradeOrder(
  saved: readonly string[],
  shown: readonly { key: string; root: string }[],
): string[] {
  const named = new Set(saved);
  const out: string[] = [];
  for (const entry of saved) {
    const root = legacyRoot(entry);
    if (root === null) {
      out.push(entry);
      continue;
    }
    const matches = shown.filter((s) => s.root === root && !named.has(s.key)).map((s) => s.key);
    if (matches.length === 0) out.push(entry);
    for (const key of matches) {
      out.push(key);
      named.add(key);
    }
  }
  return out;
}

/**
 * The node orders for a project whose top rows are grouped under `group`: when nothing is saved
 * there yet, the order saved under its root folder alone (before hosts were told apart) stands in.
 * Its keys name sessions of one host, so it only ever orders that host's rows.
 */
export function nodesFor(nodes: NodeOrders, group: string, legacyGroup: string): NodeOrders {
  if (nodes[group] || !nodes[legacyGroup]) return nodes;
  return { ...nodes, [group]: nodes[legacyGroup] };
}

export const setProjectOrder = defineRpc({
  name: "project.order.set",
  input: z.object({ order: Order }),
  output: z.object({ order: Order }),
});

/**
 * Items in the saved order. Items the saved order does not name yet (added since) come first or
 * last, in their default order, so they are seen where new items appear by default. An empty
 * saved order is the default.
 */
export function applyOrder<T>(
  items: readonly T[],
  saved: readonly string[],
  keyOf: (item: T) => string,
  fresh: "first" | "last" = "first",
): T[] {
  if (saved.length === 0) return [...items];
  const rank = new Map<string, number>();
  saved.forEach((key, i) => {
    if (!rank.has(key)) rank.set(key, i);
  });
  const unplaced = items.filter((item) => !rank.has(keyOf(item)));
  const placed = items
    .filter((item) => rank.has(keyOf(item)))
    .sort((a, b) => rank.get(keyOf(a))! - rank.get(keyOf(b))!);
  return fresh === "first" ? [...unplaced, ...placed] : [...placed, ...unplaced];
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

/** The order to save after putting `key` at `index` among the shown keys (index counts the others). */
export function placeAt(shown: readonly string[], saved: readonly string[], key: string, index: number): string[] {
  const others = [...new Set(shown)].filter((k) => k !== key);
  const list = shown.includes(key)
    ? [...others.slice(0, Math.max(0, index)), key, ...others.slice(Math.max(0, index))]
    : others;
  const kept = new Set(list);
  return [...list, ...saved.filter((k) => !kept.has(k) && kept.add(k))];
}

export interface BlockLayout {
  readonly key: string;
  readonly y: number;
  readonly height: number;
  /** Height of the item's own row (its header), above anything nested under it. */
  readonly head?: number;
}

/**
 * Where a dragged item lands, by its row rather than its whole block: how many of the other items
 * have their row's middle above the dragged row's middle. A long project or session with many rows
 * under it is passed once the pointer passes its row, not its whole block. -1 when the dragged key
 * is not laid out.
 */
export function dropIndex(blocks: readonly BlockLayout[], key: string, dy: number): number {
  const me = blocks.find((b) => b.key === key);
  if (!me) return -1;
  const rowMiddle = (b: BlockLayout) => b.y + (b.head ?? b.height) / 2;
  const pointer = rowMiddle(me) + dy;
  return blocks.filter((b) => b.key !== key && rowMiddle(b) < pointer).length;
}

/**
 * A project's tree in the saved order, at every depth. Top rows are newest first by default, so
 * new ones go first; children are oldest first, so new ones go last.
 */
export function orderTree(roots: readonly TreeNode[], group: string, nodes: NodeOrders): TreeNode[] {
  const sort = (list: readonly TreeNode[], key: string, fresh: "first" | "last"): TreeNode[] =>
    applyOrder(list, nodes[key] ?? [], (n) => n.key, fresh).map((n) =>
      n.children.length === 0 ? n : { ...n, children: sort(n.children, n.key, "last") },
    );
  return sort(roots, group, "first");
}

/**
 * Items split into one run per host, hosts in `hostOrder` (hosts it does not list last), each
 * run keeping the items' own order. Used to show a section per host when there is more than one.
 */
export function sectionByHost<T>(items: readonly T[], hostOf: (item: T) => string | null, hostOrder: readonly string[]): T[] {
  const rank = new Map(hostOrder.map((h, i) => [h, i]));
  const rankOf = (item: T) => rank.get(hostOf(item) ?? "") ?? hostOrder.length;
  return items
    .map((item, i) => ({ item, i }))
    .sort((x, y) => rankOf(x.item) - rankOf(y.item) || x.i - y.i)
    .map(({ item }) => item);
}
