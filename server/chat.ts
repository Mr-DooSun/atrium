import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext, PluginSubscriptionContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { computeChatLinks, toChatItem } from "../shared/chat/convert";
import { CHAT_DIR_NAME } from "../shared/chat/folder";
import { chatLinks, chatOlder, chatSend, chatTimelines, ensureChatDir, type ChatItem } from "../shared/chat/rpc";

import { ownHostId } from "./core/host-id";

/** The daemon user's scratch folder for free chat. Not a git repo, so no worktrees. */
export const CHAT_DIR = join(homedir(), CHAT_DIR_NAME);

type TimelineHandle = ReturnType<PluginSubscriptionContext["paseo"]["agents"]["ref"]>["timeline"];
type TimelinePage = Awaited<ReturnType<TimelineHandle["refetch"]>>;
type ChatEvent = z.infer<typeof chatTimelines.event>;
type Observation = { stop?: ReturnType<TimelineHandle["subscribe"]>; ready: boolean };

const retryDelays = [1000, 2000, 5000, 10_000, 30_000];
const maxPendingRows = 2000;

function chatPage(page: TimelinePage, limit: number, beforeSeq = Infinity) {
  const entries = page.entries
    .filter((entry) => entry.seqStart < beforeSeq)
    .sort((a, b) => a.seqStart - b.seqStart);
  return {
    items: entries.slice(-limit).map(toChatItem),
    hasMore: page.hasOlder || entries.length > limit,
  };
}

function observeTimeline(
  agentId: string,
  tail: number,
  { paseo, push, signal }: PluginSubscriptionContext<ChatEvent>,
): void {
  let observation: Observation | undefined;
  let fetching: Observation | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;
  let generation = 0;
  let epoch: string | undefined;
  let pending: { item: ChatItem; epoch?: string }[] = [];

  function invalidate() {
    generation += 1;
    epoch = undefined;
    pending = [];
  }

  function releaseObservation() {
    const previous = observation;
    observation = undefined;
    invalidate();
    previous?.stop?.();
  }

  function release() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    releaseObservation();
  }

  function emit(event: ChatEvent) {
    if (!signal.aborted) void push(event).catch(() => {});
  }

  function scheduleRetry(error: unknown, attempt: () => void) {
    if (signal.aborted) return;
    clearTimeout(retryTimer);
    const delay = retryDelays[retryAttempt];
    const firstFailure = retryAttempt === 0;
    retryAttempt = Math.min(retryAttempt + 1, retryDelays.length - 1);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      attempt();
    }, delay);
    if (firstFailure) {
      emit({ type: "error", agentId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function refreshSnapshot(timeline: TimelineHandle, current: Observation) {
    if (signal.aborted || observation !== current || !current.ready || retryTimer || fetching === current) return;
    fetching = current;
    const requestedGeneration = generation;
    try {
      const page = await timeline.refetch({ direction: "tail", limit: tail, projection: "projected" });
      if (observation !== current || requestedGeneration !== generation) return;
      const snapshot = chatPage(page, tail);
      epoch = page.epoch;
      retryAttempt = 0;
      emit({ type: "snapshot", agentId, epoch, ...snapshot });
      // Projected entries already cover merged live chunks before the daemon's next sequence.
      const items = pending
        .filter((row) => (row.epoch === undefined || row.epoch === epoch) && row.item.seq >= page.window.nextSeq)
        .map(({ item }) => item)
        .sort((a, b) => a.seq - b.seq);
      pending = [];
      if (items.length) emit({ type: "append", agentId, epoch, items });
    } catch (error) {
      if (observation === current && requestedGeneration === generation) {
        pending = [];
        scheduleRetry(error, () => void refreshSnapshot(timeline, current));
      }
    } finally {
      if (fetching === current) fetching = undefined;
      if (observation === current && requestedGeneration !== generation) {
        void refreshSnapshot(timeline, current);
      }
    }
  }

  function subscribe() {
    if (signal.aborted) return;
    const current: Observation = { ready: false };
    observation = current;

    function fail(error: unknown) {
      if (observation !== current) return;
      releaseObservation();
      scheduleRetry(error, subscribe);
    }

    try {
      const timeline = paseo.agents.ref(agentId).timeline;
      const stop = timeline.subscribe((update) => {
        if (observation !== current) return;
        switch (update.event.type) {
          case "error":
            fail(update.event.error);
            return;
          case "replacement":
          case "subscription_restored":
            invalidate();
            void refreshSnapshot(timeline, current);
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
              void refreshSnapshot(timeline, current);
            }
            if (epoch !== undefined) {
              emit({ type: "append", agentId, epoch, items: [item] });
            } else {
              if (pending.length === maxPendingRows) {
                // The next snapshot must cover the rows discarded during this read.
                invalidate();
                void refreshSnapshot(timeline, current);
              }
              pending.push({ item, epoch: update.epoch });
            }
          }
        }
      });
      current.stop = stop;
      // Setup can report an error before the handle is returned.
      if (observation !== current) stop();
      void stop.ready.then(() => {
        current.ready = true;
        return refreshSnapshot(timeline, current);
      }).catch(fail);
    } catch (error) {
      fail(error);
    }
  }

  if (signal.aborted) return;
  signal.addEventListener("abort", release, { once: true });
  subscribe();
}

export function registerChat(server: PluginServerContext) {
  server.handle(ensureChatDir, async () => {
    await mkdir(CHAT_DIR, { recursive: true });
    return { path: CHAT_DIR };
  });

  server.handle(chatSend, async ({ agentId, hostId, text, activeTurnBehavior, images, attachments }, { paseo }) => {
    if (images?.length || attachments?.length) {
      return { ok: false as const, error: { code: "validation_failed" as const, message: "Attachments are not supported in Panes. Open the session in Paseo to send attachments." } };
    }
    if (activeTurnBehavior === "interrupt") {
      return { ok: false as const, error: { code: "validation_failed" as const, message: "Panes only support steering an active turn. Open the session in Paseo to interrupt it." } };
    }
    const unavailable = (reason: "archived" | "agent_missing" | "workspace_missing" | "project_missing" | "host_unknown" | "host_mismatch") => ({
      ok: false as const, error: { code: "agent_unavailable" as const, reason, message: "This session is no longer available for messages." },
    });
    const agent = paseo.agents.ref(agentId);
    try {
      const currentHost = await ownHostId(paseo);
      if (!currentHost) return unavailable("host_unknown");
      if (currentHost !== hostId) return unavailable("host_mismatch");
      const snapshot = await agent.refresh();
      if (!snapshot) return unavailable("agent_missing");
      if (snapshot.agent.archivedAt) return unavailable("archived");
      if (!snapshot.agent.workspaceId) return unavailable("workspace_missing");
      const workspace = await paseo.workspaces.ref(snapshot.agent.workspaceId).refresh();
      if (!workspace) return unavailable("workspace_missing");
      const { projects } = await paseo.projects.list();
      if (!projects.some((project) => project.projectId === workspace.projectId)) return unavailable("project_missing");
    } catch {
      // A failed read cannot establish that sending is safe. Never fall through to send.
      return { ok: false as const, error: { code: "validation_failed" as const, message: "The session could not be checked. Try again after reconnecting." } };
    }
    try {
      await agent.send(text, { activeTurnBehavior: "steer" });
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: { code: "send_failed" as const, message: "The message could not be sent." } };
    }
  });

  server.handle(chatTimelines, ({ agentIds, tail }, context) => {
    for (const agentId of new Set(agentIds)) observeTimeline(agentId, tail, context);
  });

  server.handle(chatOlder, async ({ agentId, beforeSeq, limit, epoch }, { paseo }) => {
    if (epoch === undefined && beforeSeq <= 0) return { items: [], hasMore: false };
    const timeline = paseo.agents.ref(agentId).timeline;
    let seq = Math.max(0, Math.min(Math.ceil(beforeSeq), Number.MAX_SAFE_INTEGER));
    // Older clients supply only the sequence, so read the cursor epoch first.
    if (epoch === undefined) {
      const current = await timeline.refetch({ direction: "tail", limit: 1, projection: "projected" });
      epoch = current.epoch;
      seq = Math.min(seq, current.window.nextSeq);
    }
    const before = await timeline.refetch({
      direction: "before",
      cursor: { epoch, seq },
      limit,
      projection: "projected",
    });
    if (before.epoch !== epoch || before.staleCursor || before.reset) {
      throw new Error("The timeline changed while loading older history.");
    }
    return chatPage(before, limit, beforeSeq);
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
