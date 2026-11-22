// Per-agent chat rows, folded from `chatTimelines` events and `chatOlder` pages. Pure, so it can
// be unit tested; the screen keeps one of these maps in state.
import { COMPACTED_FALLBACK_TEXT, COMPACTING_FALLBACK_TEXT, PLUGIN_FALLBACK_TEXT, UNKNOWN_FALLBACK_TEXT } from "../../shared/chat/convert";
import type { PluginHostSummary } from "@getpaseo/plugin/client";
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
 * Adds a page of older rows fetched with `chatOlder`. The request is pinned to the epoch it was
 * made against, but a snapshot can still replace the rows while it is in flight, so the page is
 * kept only if the timeline is still that one: same epoch, and (when `beforeSeq` is given) its
 * oldest row is still the one the request paged back from. Otherwise the page is discarded.
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
 * Rows as shown: a reply streamed live arrives as several consecutive assistant rows (one per
 * chunk), so a chunk is joined onto the row before it when both are the same kind among
 * assistant/reasoning. History rows (`projected`) are already whole messages from the daemon:
 * one never absorbs the next, else two separate replies would run together into one paragraph
 * (and their Markdown with it). Rows of different assistant messages (`messageId`) never join.
 * The raw rows stay in state; the joined row keeps the first chunk's id and the last's seq.
 */
const JOINED: ReadonlySet<ChatItem["kind"]> = new Set(["assistant", "reasoning"]);
function continues(last: ChatItem, item: ChatItem): boolean {
  if (!JOINED.has(item.kind) || last.kind !== item.kind || item.projected) return false;
  return !(last.messageId && item.messageId && last.messageId !== item.messageId);
}
export function displayItems(items: readonly ChatItem[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && continues(last, item)) {
      out[out.length - 1] = { ...last, seq: item.seq, text: last.text + item.text };
    } else {
      out.push(item);
    }
  }
  return out;
}

/** Keys `rowWording` asks the translation function for. */
export type RowWordKey = "tool" | "thinking" | "plugin" | "unknownItem" | "compacting" | "compacted" | "toolRunning" | "toolCompleted" | "toolFailed" | "toolCanceled";

/**
 * The label and body a non-message row shows, in the user's language. Structured fields win over
 * `text` (which keeps an English line for older clients): a tool shows its translated state (its
 * name is the label, never repeated), a compaction its translated line, a plugin or unknown item
 * its data under a translated label. A `code` this version doesn't know shows as an unknown item.
 */
export function rowWording(item: ChatItem, t: (key: RowWordKey) => string): { label: string | null; body: string } {
  if (item.kind === "tool") return { label: item.toolName || t("tool"), body: toolStatusText(item.status, t) };
  if (item.kind === "reasoning") return { label: t("thinking"), body: item.text };
  switch (item.code) {
    case undefined:
      // A server from before `code` sent compaction rows as these English lines only.
      if (item.kind === "status" && item.text === COMPACTED_FALLBACK_TEXT) return { label: null, body: t("compacted") };
      if (item.kind === "status" && item.text === COMPACTING_FALLBACK_TEXT) return { label: null, body: t("compacting") };
      return { label: null, body: item.text };
    case "compacting":
    case "compacted":
      return { label: null, body: t(item.code) };
    case "plugin":
      return { label: t("plugin"), body: item.text === PLUGIN_FALLBACK_TEXT ? "" : item.text };
    default:
      return { label: t("unknownItem"), body: item.text === UNKNOWN_FALLBACK_TEXT ? "" : item.text };
  }
}

/** A tool call's state in the user's language; a state this version doesn't know shows as is. */
export function toolStatusText(status: string | undefined, t: (key: "toolRunning" | "toolCompleted" | "toolFailed" | "toolCanceled") => string): string {
  switch (status) {
    case "running":
      return t("toolRunning");
    case "completed":
      return t("toolCompleted");
    case "failed":
      return t("toolFailed");
    case "canceled":
    case "cancelled":
      return t("toolCanceled");
    default:
      return status ?? "";
  }
}

/**
 * The line above a pane's rows when something went wrong, or null:
 * - liveLost: the subscription itself ended (plugin reload, daemon restart). Nothing retries on
 *   its own, so the pane offers a retry (rows already loaded survive it).
 * - reconnecting: the server reported an error but the subscription lives on, and the server
 *   retries by itself (1, 2, 5, 10, 30 s); rows are already showing, so no button.
 * - loadFailed: the same before any row arrived: the first load failed, retry offered.
 */
export function errorBanner(lost: boolean, error: string | null, hasRows: boolean): ErrorBanner {
  if (lost) return "liveLost";
  if (error === null) return null;
  return hasRows ? "reconnecting" : "loadFailed";
}

export type ErrorBanner = "liveLost" | "reconnecting" | "loadFailed" | null;

/** A host's connection state as the app reports it (`useHosts()`); undefined when not listed. */
export type HostStatus = PluginHostSummary["status"] | undefined;

/**
 * Automatic retry after a reconnect, in two steps a pane runs on every render:
 *
 * 1. `armAutoRetry`: the pane arms itself once it sees its host in any known state other than
 *    online (offline, connecting, error, idle), including the state it mounted in, and stays
 *    armed until the retry is used.
 * 2. `autoRetryDue`: an armed pane whose subscription ended (liveLost) retries once the host is
 *    online, after AUTO_RETRY_DELAY_MS (the plugin's server side may still be starting just
 *    after the host comes back). The order of the two does not matter: the host may come back
 *    first and the subscription end afterwards, or the other way round.
 *
 * Only liveLost: a server error (reconnecting: the server retries on its own) and a first load
 * that failed (loadFailed) are left alone. A retry remounts the pane's live part unarmed while
 * the host is online, so if that retry fails too nothing more happens until the host drops and
 * comes back. A pane the user already retried is connecting, not liveLost, so it is not retried
 * twice. A host unknown to the app (undefined) never arms.
 */
export function armAutoRetry(armed: boolean, status: HostStatus): boolean {
  return armed || (status !== undefined && status !== "online");
}

export function autoRetryDue(armed: boolean, status: HostStatus, banner: ErrorBanner): boolean {
  return armed && status === "online" && banner === "liveLost";
}

/** How long after the host is back (and the pane lost) the automatic retry waits. */
export const AUTO_RETRY_DELAY_MS = 1000;

/**
 * The timeline with the agent's error cleared (a retry starts clean); unchanged when it has none.
 * An entry that only ever held the error (no snapshot yet) is removed, so the pane shows its
 * loading state again rather than "no messages".
 */
export function clearTimelineError(state: Timelines, agentId: string): Timelines {
  const prev = state.get(agentId);
  if (!prev || prev.error === null) return state;
  const next = new Map(state);
  if (prev.epoch === null && prev.items.length === 0) next.delete(agentId);
  else next.set(agentId, { ...prev, error: null });
  return next;
}

/** Why a session can no longer take messages, as far as the pane can tell. "removed": gone from
 *  the host (archived and dropped from the snapshot, or its agent/workspace/project no longer
 *  exists) without the server saying which; "archived": the server said so. */
export type UnavailableReason = "archived" | "removed";

/**
 * Reads a send answer or a thrown send error for "this agent is gone". The server answers
 * `{ ok: false, error: { code: "agent_unavailable", reason } }` for an archived or deleted agent
 * (or one whose workspace or project is gone); an error object may carry the same `code`/`reason`
 * or a bare code such as `agent_not_found`. Anything else is an ordinary failure: null.
 */
export function unavailableReason(answer: unknown): UnavailableReason | null {
  const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const outer = record(answer);
  if (!outer) return null;
  const inner = outer.ok === false ? record(outer.error) : outer;
  if (!inner) return null;
  const code = typeof inner.code === "string" ? inner.code : "";
  const reason = typeof inner.reason === "string" ? inner.reason : "";
  if (code === "agent_unavailable") {
    if (reason === "archived") return "archived";
    // A host mismatch or an unknown host is not the agent being gone: the pane can be reopened.
    if (reason === "host_unknown" || reason === "host_mismatch") return null;
    return "removed";
  }
  if (/archived/i.test(code)) return "archived";
  if (/^(?:agent_)?(?:not_found|missing|deleted|removed)$/i.test(code)) return "removed";
  return null;
}
