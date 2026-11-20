// Pane layout state for the panes screen, kept pure (no React, no React Native) so it can be
// unit tested with node:test. A pane is one agent's chat; panes sit in one row, in order.

/** Just what the layout needs from an AgentRef. */
export interface PaneRef {
  readonly kind: "agent";
  readonly key: string;
  readonly hostId: string;
  readonly id: string;
}

/** Where an agent sits in its family: its parent's key, null for a root. */
export type ParentOf = (key: string) => string | null | undefined;

// ── Order operations ───────────────────────────────────────────────────

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, Math.trunc(index)));
}

/** Drops later duplicates (same key), keeping the first. */
export function dedupePanes<P extends PaneRef>(panes: readonly P[]): P[] {
  const seen = new Set<string>();
  const out: P[] = [];
  for (const pane of panes) {
    if (seen.has(pane.key)) continue;
    seen.add(pane.key);
    out.push(pane);
  }
  return out;
}

/**
 * Inserts `added` at `index` (end when omitted). Panes already open move to the new spot rather
 * than appearing twice. `index` counts positions in the list before the insert.
 */
export function addPanes<P extends PaneRef>(panes: readonly P[], added: readonly P[], index?: number): P[] {
  const incoming = dedupePanes(added);
  if (incoming.length === 0) return [...panes];
  const keys = new Set(incoming.map((p) => p.key));
  const at = clampIndex(index, panes.length);
  // Shift the insertion point left for every moved pane that sat before it.
  let shift = 0;
  for (let i = 0; i < at; i++) if (keys.has(panes[i].key)) shift++;
  const rest = panes.filter((p) => !keys.has(p.key));
  const pos = at - shift;
  return [...rest.slice(0, pos), ...incoming, ...rest.slice(pos)];
}

export function addPane<P extends PaneRef>(panes: readonly P[], pane: P, index?: number): P[] {
  return addPanes(panes, [pane], index);
}

export function removePane<P extends PaneRef>(panes: readonly P[], key: string): P[] {
  return panes.filter((p) => p.key !== key);
}

/** Moves the pane to `toIndex` in the resulting list (clamped). No-op when it is not open. */
export function movePane<P extends PaneRef>(panes: readonly P[], key: string, toIndex: number): P[] {
  const from = panes.findIndex((p) => p.key === key);
  if (from < 0) return [...panes];
  const rest = panes.filter((_, i) => i !== from);
  const to = clampIndex(toIndex, rest.length);
  return [...rest.slice(0, to), panes[from], ...rest.slice(to)];
}

// ── Families ───────────────────────────────────────────────────────────

/** The topmost ancestor reachable through `parentOf`; the key itself for a root. Cycle-safe. */
export function rootOf(key: string, parentOf: ParentOf): string {
  let cur = key;
  const seen = new Set<string>([cur]);
  for (;;) {
    const parent = parentOf(cur);
    if (!parent || seen.has(parent)) return cur;
    seen.add(parent);
    cur = parent;
  }
}

/** The nearest ancestor that is in `present`, or null. Cycle-safe. */
export function nearestPresentAncestor(key: string, parentOf: ParentOf, present: ReadonlySet<string>): string | null {
  const seen = new Set<string>([key]);
  let cur = parentOf(key);
  while (cur && !seen.has(cur)) {
    if (present.has(cur)) return cur;
    seen.add(cur);
    cur = parentOf(cur);
  }
  return null;
}

export interface PaneGroup<P extends PaneRef> {
  /** The family's root agent key (it may itself not be open). */
  rootKey: string;
  /** Parent before children, depth-first; siblings keep their relative order. */
  panes: P[];
  /** Depth of each pane relative to the nearest open ancestor chain (0 = top of this group). */
  depths: number[];
}

/**
 * Groups panes by family (same root) and orders each family depth-first, parent before
 * children. A family sits where its first pane was; siblings keep their relative order.
 */
export function groupByFamily<P extends PaneRef>(panes: readonly P[], parentOf: ParentOf): PaneGroup<P>[] {
  const list = dedupePanes(panes);
  const present = new Set(list.map((p) => p.key));
  const order = new Map(list.map((p, i) => [p.key, i]));
  const byKey = new Map(list.map((p) => [p.key, p]));

  const groups = new Map<string, P[]>();
  for (const pane of list) {
    const root = rootOf(pane.key, parentOf);
    const members = groups.get(root);
    if (members) members.push(pane);
    else groups.set(root, [pane]);
  }

  const out: PaneGroup<P>[] = [];
  for (const [rootKey, members] of groups) {
    const children = new Map<string | null, string[]>();
    for (const m of members) {
      const parent = nearestPresentAncestor(m.key, parentOf, present);
      const list = children.get(parent);
      if (list) list.push(m.key);
      else children.set(parent, [m.key]);
    }
    for (const list of children.values()) list.sort((a, b) => order.get(a)! - order.get(b)!);
    const ordered: P[] = [];
    const depths: number[] = [];
    const visit = (key: string, depth: number) => {
      ordered.push(byKey.get(key)!);
      depths.push(depth);
      for (const child of children.get(key) ?? []) visit(child, depth + 1);
    };
    for (const top of children.get(null) ?? []) visit(top, 0);
    out.push({ rootKey, panes: ordered, depths });
  }
  return out;
}

/** The panes in family order, flattened: what the screen lays out. */
export function arrangeByFamily<P extends PaneRef>(panes: readonly P[], parentOf: ParentOf): P[] {
  return groupByFamily(panes, parentOf).flatMap((g) => g.panes);
}

/**
 * Every descendant of `key` among `all` (e.g. every known agent), depth-first, parent before
 * children. Used for "add the whole family".
 */
export function descendantsOf<P extends PaneRef>(key: string, all: readonly P[], parentOf: ParentOf): P[] {
  const kids = new Map<string, P[]>();
  for (const a of all) {
    const parent = parentOf(a.key);
    if (!parent) continue;
    const list = kids.get(parent);
    if (list) list.push(a);
    else kids.set(parent, [a]);
  }
  const out: P[] = [];
  const seen = new Set<string>([key]);
  const visit = (k: string) => {
    for (const child of kids.get(k) ?? []) {
      if (seen.has(child.key)) continue;
      seen.add(child.key);
      out.push(child);
      visit(child.key);
    }
  };
  visit(key);
  return out;
}

// ── Geometry & virtualization ──────────────────────────────────────────

/** Left edge of each pane in content coordinates, plus the total content width. */
export function paneOffsets(widths: readonly number[], gap: number): { offsets: number[]; total: number } {
  const offsets: number[] = [];
  let x = 0;
  for (let i = 0; i < widths.length; i++) {
    offsets.push(x);
    x += widths[i] + (i < widths.length - 1 ? gap : 0);
  }
  return { offsets, total: x };
}

export interface VisibleRange {
  /** First index to mount (inclusive). */
  start: number;
  /** One past the last index to mount. start === end means nothing. */
  end: number;
}

/**
 * Which panes intersect the viewport `[scrollX, scrollX + viewportWidth)`, widened by `overscan`
 * panes on each side. Only these mount and subscribe.
 */
export function visibleRange(
  widths: readonly number[],
  gap: number,
  scrollX: number,
  viewportWidth: number,
  overscan = 1,
): VisibleRange {
  const n = widths.length;
  if (n === 0 || viewportWidth <= 0) return { start: 0, end: Math.min(n, Math.max(0, overscan)) };
  const { offsets } = paneOffsets(widths, gap);
  const left = Math.max(0, scrollX);
  const right = left + viewportWidth;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    const a = offsets[i];
    const b = a + widths[i];
    if (b > left && a < right) {
      if (first < 0) first = i;
      last = i;
    } else if (a >= right) break;
  }
  if (first < 0) {
    // Scrolled past the end: show the tail.
    first = n - 1;
    last = n - 1;
  }
  return { start: Math.max(0, first - overscan), end: Math.min(n, last + 1 + overscan) };
}

/**
 * Where a drop at content x lands: the index of the gap nearest x (0 = before the first pane,
 * n = after the last).
 */
export function insertionIndex(widths: readonly number[], gap: number, contentX: number): number {
  const { offsets } = paneOffsets(widths, gap);
  for (let i = 0; i < widths.length; i++) {
    if (contentX < offsets[i] + widths[i] / 2) return i;
  }
  return widths.length;
}

/**
 * Pane width for a viewport: fit as many columns of at least `min` as the width allows, never
 * wider than `max`. On narrow screens one pane fills the viewport.
 */
export function paneWidth(viewportWidth: number, gap: number, min = 360, max = 560): number {
  if (viewportWidth <= 0) return min;
  if (viewportWidth < min) return viewportWidth;
  const columns = Math.max(1, Math.floor((viewportWidth + gap) / (min + gap)));
  return Math.min(max, Math.floor((viewportWidth - gap * (columns - 1)) / columns));
}

// ── Persistence ────────────────────────────────────────────────────────

/** Persisted form: a JSON list of `[hostId, agentId, key]`, in pane order. */
export function serializePanes(panes: readonly PaneRef[]): string {
  return JSON.stringify(dedupePanes(panes).map((p) => [p.hostId, p.id, p.key]));
}

export function parsePanes(text: string | null | undefined): PaneRef[] {
  if (!text) return [];
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    const out: PaneRef[] = [];
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 3) continue;
      const [hostId, id, key] = entry;
      if (typeof hostId !== "string" || typeof id !== "string" || typeof key !== "string" || !key) continue;
      out.push({ kind: "agent", hostId, id, key });
    }
    return dedupePanes(out);
  } catch {
    return [];
  }
}

/** Agent ids for the timeline subscription: unique, stable order, at most `max`. */
export function subscriptionIds(panes: readonly PaneRef[], max = 64): string[] {
  return [...new Set(panes.map((p) => p.id))].sort().slice(0, max);
}

/**
 * Moves a whole family block one step left (delta -1) or right (+1) past its neighbour family.
 * `panes` should already be in family order.
 */
export function moveGroup<P extends PaneRef>(panes: readonly P[], parentOf: ParentOf, rootKey: string, delta: -1 | 1): P[] {
  const groups = groupByFamily(panes, parentOf);
  const at = groups.findIndex((g) => g.rootKey === rootKey);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= groups.length) return groups.flatMap((g) => g.panes);
  [groups[at], groups[to]] = [groups[to], groups[at]];
  return groups.flatMap((g) => g.panes);
}
