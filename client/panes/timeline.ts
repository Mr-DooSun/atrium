// Per-agent chat rows, folded from `chatTimelines` events and `chatOlder` pages. Pure, so it can
// be unit tested; the screen keeps one of these maps in state.
import type { ChatItem } from "../../shared/chat/rpc";

export interface AgentTimeline {
  epoch: string | null;
  /** Ascending by seq, unique by id. */
  items: ChatItem[];
  hasMore: boolean;
  error: string | null;
}

export type TimelineEvent =
  | { type: "snapshot"; agentId: string; epoch: string; items: ChatItem[]; hasMore: boolean }
  | { type: "append"; agentId: string; epoch: string; items: ChatItem[] }
  | { type: "error"; agentId: string; message: string };

export type Timelines = ReadonlyMap<string, AgentTimeline>;

export const EMPTY_TIMELINE: AgentTimeline = { epoch: null, items: [], hasMore: false, error: null };

/**
 * Merges rows by id and sorts by seq. An incoming row with a known id updates it in place: it
 * takes the incoming content (text, toolName, at, …) but keeps the existing seq, so a tool call
 * whose status update (`tool:${callId}`) arrives with a newer seq doesn't jump to the bottom.
 */
export function mergeItems(base: readonly ChatItem[], incoming: readonly ChatItem[]): ChatItem[] {
  if (incoming.length === 0) return [...base];
  const byId = new Map<string, ChatItem>();
  for (const item of base) byId.set(item.id, item);
  for (const item of incoming) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? { ...item, seq: existing.seq } : item);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export function applyTimelineEvent(state: Timelines, event: TimelineEvent): Map<string, AgentTimeline> {
  const next = new Map(state);
  const prev = state.get(event.agentId) ?? EMPTY_TIMELINE;
  if (event.type === "snapshot") {
    // Same epoch (re-subscribe after scrolling away, or a reconnect): keep cached rows only when
    // the snapshot overlaps them. A reconnect sends just the last `tail`; if that starts after
    // our newest row there may be a hole, so drop the cache. Older rows stay loadable.
    if (prev.epoch === event.epoch && prev.items.length > 0 && overlaps(prev.items, event.items, event.hasMore)) {
      const oldest = event.items[0]?.seq;
      const keepOlder = oldest === undefined ? [] : prev.items.filter((i) => i.seq < oldest);
      next.set(event.agentId, {
        epoch: event.epoch,
        items: mergeItems(keepOlder, event.items),
        hasMore: keepOlder.length > 0 ? prev.hasMore : event.hasMore,
        error: null,
      });
    } else {
      next.set(event.agentId, { epoch: event.epoch, items: mergeItems([], event.items), hasMore: event.hasMore, error: null });
    }
  } else if (event.type === "append") {
    // An append from another epoch means the timeline was reset; wait for its snapshot.
    if (prev.epoch !== null && prev.epoch !== event.epoch) return next;
    next.set(event.agentId, { ...prev, epoch: event.epoch, items: mergeItems(prev.items, event.items), error: null });
  } else {
    next.set(event.agentId, { ...prev, error: event.message });
  }
  return next;
}

/**
 * Whether a same-epoch snapshot can be stitched onto the cached rows without a hole: it reaches
 * back to (or before) our newest cached row, or it is the whole history (`hasMore` false).
 */
export function overlaps(cached: readonly ChatItem[], snapshot: readonly ChatItem[], snapshotHasMore: boolean): boolean {
  if (cached.length === 0 || snapshot.length === 0) return false;
  if (!snapshotHasMore) return true;
  return snapshot[0].seq <= cached[cached.length - 1].seq;
}

/**
 * Adds a page of older rows fetched with `chatOlder`. `chatOlder` carries no epoch, so the page
 * is kept only if the timeline is still the one the request was made against: same epoch, and
 * (when `beforeSeq` is given) its oldest row is still the one the request paged back from.
 * Otherwise a snapshot replaced the rows mid-flight and the page is discarded.
 */
export function applyOlder(
  state: Timelines,
  agentId: string,
  epoch: string | null,
  page: { items: ChatItem[]; hasMore: boolean },
  beforeSeq?: number,
): Map<string, AgentTimeline> {
  const next = new Map(state);
  const prev = state.get(agentId);
  if (!prev || prev.epoch !== epoch) return next;
  if (beforeSeq !== undefined && prev.items[0]?.seq !== beforeSeq) return next;
  next.set(agentId, { ...prev, items: mergeItems(page.items, prev.items), hasMore: page.hasMore });
  return next;
}

/**
 * Rows as shown: a streamed reply arrives as several consecutive assistant rows (one per
 * chunk), so adjacent rows of the same kind among assistant/reasoning are joined into one.
 * The raw rows stay in state; the joined row keeps the first chunk's id and the last's seq.
 */
const JOINED: ReadonlySet<ChatItem["kind"]> = new Set(["assistant", "reasoning"]);
export function displayItems(items: readonly ChatItem[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && JOINED.has(item.kind) && last.kind === item.kind) {
      out[out.length - 1] = { ...last, seq: item.seq, text: last.text + item.text };
    } else {
      out.push(item);
    }
  }
  return out;
}
