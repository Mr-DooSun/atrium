import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PaseoAgentTimelineHandle, PaseoAgentTimelineSubscription } from "@getpaseo/client";
import type { PluginServerContext, PluginSubscriptionContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { computeChatLinks, toChatItem } from "../shared/chat/convert";
import { chatLinks, chatOlder, chatTimelines, ensureChatDir, type ChatItem } from "../shared/chat/rpc";

/** The daemon user's scratch folder for free chat. Not a git repo, so no worktrees. */
export const CHAT_DIR = join(homedir(), ".paseo-chat");

type TimelinePage = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
type ChatEvent = z.infer<typeof chatTimelines.event>;

function chatItems(page: TimelinePage): ChatItem[] {
  return page.entries.map(toChatItem).sort((a, b) => a.seq - b.seq);
}

function observeTimeline(
  agentId: string,
  tail: number,
  { paseo, push, signal }: PluginSubscriptionContext<ChatEvent>,
): void {
  let stop: PaseoAgentTimelineSubscription | undefined;
  let active = true;
  let ready = false;
  let fetching = false;
  let generation = 0;
  let epoch: string | undefined;
  let pending: { item: ChatItem; epoch?: string }[] = [];

  function release() {
    active = false;
    pending = [];
    signal.removeEventListener("abort", release);
    stop?.();
  }

  function emit(event: ChatEvent) {
    if (!signal.aborted) void push(event).catch(() => {});
  }

  function report(error: unknown) {
    emit({ type: "error", agentId, message: error instanceof Error ? error.message : String(error) });
  }

  function fail(error: unknown) {
    if (!active) return;
    release();
    report(error);
  }

  async function refreshSnapshot(timeline: PaseoAgentTimelineHandle) {
    if (!active || !ready || fetching) return;
    fetching = true;
    const requestedGeneration = generation;
    try {
      const page = await timeline.refetch({ direction: "tail", limit: tail, projection: "canonical" });
      if (!active || requestedGeneration !== generation) return;
      epoch = page.epoch;
      emit({ type: "snapshot", agentId, epoch, items: chatItems(page), hasMore: page.hasOlder });
      const items = pending
        .filter((row) => (row.epoch === undefined || row.epoch === epoch) && row.item.seq >= page.window.nextSeq)
        .map(({ item }) => item)
        .sort((a, b) => a.seq - b.seq);
      pending = [];
      if (items.length) emit({ type: "append", agentId, epoch, items });
    } catch (error) {
      if (active && requestedGeneration === generation) {
        pending = [];
        report(error);
      }
    } finally {
      fetching = false;
      // A replacement or reconnect can arrive while the previous page is in flight.
      if (requestedGeneration !== generation) void refreshSnapshot(timeline);
    }
  }

  function invalidate() {
    generation += 1;
    epoch = undefined;
    pending = [];
  }

  if (signal.aborted) return;
  signal.addEventListener("abort", release, { once: true });
  try {
    const timeline = paseo.agents.ref(agentId).timeline;
    stop = timeline.subscribe((update) => {
      if (!active) return;
      switch (update.event.type) {
        case "error":
          fail(update.event.error);
          return;
        case "replacement":
        case "subscription_restored":
          invalidate();
          void refreshSnapshot(timeline);
          return;
        case "timeline": {
          if (!("seq" in update) || update.seq === undefined) return;
          const item = toChatItem({
            item: update.event.item,
            seqStart: update.seq,
            timestamp: update.timestamp,
          });
          if (epoch !== undefined && update.epoch !== undefined && epoch !== update.epoch) {
            invalidate();
          }
          if (epoch !== undefined) {
            emit({ type: "append", agentId, epoch, items: [item] });
          } else {
            pending.push({ item, epoch: update.epoch });
            void refreshSnapshot(timeline);
          }
        }
      }
    });
    // A subscription can report failure before its handle is returned.
    if (!active) stop();
    void stop.ready.then(() => {
      ready = true;
      return refreshSnapshot(timeline);
    }).catch(fail);
  } catch (error) {
    fail(error);
  }
}

export function registerChat(server: PluginServerContext) {
  server.handle(ensureChatDir, async () => {
    await mkdir(CHAT_DIR, { recursive: true });
    return { path: CHAT_DIR };
  });

  server.handle(chatTimelines, ({ agentIds, tail }, context) => {
    for (const agentId of new Set(agentIds)) observeTimeline(agentId, tail, context);
  });

  server.handle(chatOlder, async ({ agentId, beforeSeq, limit }, { paseo }) => {
    if (beforeSeq <= 0) return { items: [], hasMore: false };
    const timeline = paseo.agents.ref(agentId).timeline;
    // The shared RPC supplies the sequence. The daemon also needs a current epoch.
    const current = await timeline.refetch({ direction: "tail", limit: 1, projection: "canonical" });
    const before = await timeline.refetch({
      direction: "before",
      cursor: { epoch: current.epoch, seq: Math.min(Math.ceil(beforeSeq), current.window.nextSeq) },
      limit,
      projection: "canonical",
    });
    if (before.epoch !== current.epoch || before.staleCursor || before.reset) {
      throw new Error("The timeline changed while loading older history.");
    }
    return { items: chatItems(before).filter(({ seq }) => seq < beforeSeq), hasMore: before.hasOlder };
  });

  server.handle(chatLinks, async ({ agentIds }, { paseo }) => {
    if (agentIds.length === 0) return { links: [] };
    const agents = new Map<string, Parameters<typeof computeChatLinks>[1][number]>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const { entries, pageInfo } = await paseo.agents.list({
        filter: { includeArchived: true },
        includeBackground: true,
        page: { limit: 200, cursor },
      });
      for (const { agent } of entries) agents.set(agent.id, agent);
      cursor = pageInfo.nextCursor ?? undefined;
      if (cursor && seenCursors.has(cursor)) throw new Error("Paseo returned a repeated agent page cursor.");
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return { links: computeChatLinks(agentIds, [...agents.values()]) };
  });
}
