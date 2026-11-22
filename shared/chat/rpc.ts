// Free chat: agents that run in one scratch folder on the daemon, outside any real project.
import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

/** Creates the chat folder on the daemon if needed and returns its absolute path. */
export const ensureChatDir = defineRpc({
  name: "chat.ensure-dir",
  input: z.object({}),
  output: z.object({ path: z.string() }),
});

/** A display row keyed by its stable ID and ordered by daemon sequence. */
export const ChatItem = z.object({
  id: z.string(),
  seq: z.number(),
  kind: z.enum(["user", "assistant", "reasoning", "tool", "status", "other"]),
  text: z.string(),
  toolName: z.string().optional(),
  /** Agent that sent this instruction, for agent_message timeline entries. */
  senderName: z.string().optional(),
  at: z.string().optional(),
  /** Tool call state as the daemon reports it (running, completed, failed, canceled). */
  status: z.string().optional(),
  /**
   * What a row is when the client should word it itself: "compacting", "compacted", "plugin",
   * "unknown" (see `ChatItemCode`). A plain string on the wire, so a code added by a newer server
   * never makes an older client reject the whole event; clients show codes they don't know as
   * an unknown item.
   */
  code: z.string().optional(),
  /** The assistant message a row belongs to, when the daemon gives one. */
  messageId: z.string().optional(),
  /** A whole entry from the projected history: never a streaming chunk to join with others. */
  projected: z.boolean().optional(),
});

/** Row codes this version knows (`ChatItem.code`). */
export type ChatItemCode = "compacting" | "compacted" | "plugin" | "unknown";

/** The validated display row shared by snapshots, live updates, and history pages. */
export type ChatItem = z.infer<typeof ChatItem>;

/** Streams a snapshot and subsequent row upserts for each visible agent. */
export const chatTimelines = defineSubscription({
  name: "chat.timelines",
  input: z.object({
    agentIds: z.array(z.string()).max(64),
    tail: z.number().int().min(1).max(500).default(100),
  }),
  event: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("snapshot"),
      agentId: z.string(),
      epoch: z.string(),
      items: z.array(ChatItem),
      hasMore: z.boolean(),
    }),
    z.object({
      type: z.literal("append"),
      agentId: z.string(),
      epoch: z.string(),
      items: z.array(ChatItem),
    }),
    z.object({ type: z.literal("error"), agentId: z.string(), message: z.string() }),
  ]),
});

/** Fetches older timeline rows before the given sequence, optionally pinned to the snapshot epoch. */
export const chatOlder = defineRpc({
  name: "chat.timeline.older",
  input: z.object({
    agentId: z.string(),
    beforeSeq: z.number(),
    limit: z.number().int().min(1).max(500).default(100),
    epoch: z.string().optional(),
  }),
  output: z.object({ items: z.array(ChatItem), hasMore: z.boolean() }),
});

/** Resolves parents, roots, and direct children for the requested agents. */
export const chatLinks = defineRpc({
  name: "chat.links",
  input: z.object({ agentIds: z.array(z.string()).max(256) }),
  output: z.object({
    links: z.array(z.object({
      agentId: z.string(),
      parentAgentId: z.string().nullable(),
      rootAgentId: z.string(),
      childAgentIds: z.array(z.string()),
    })),
  }),
});

/** Sends only to a current, active agent on the RPC daemon. Always steers an existing turn. */
export const chatSend = defineRpc({
  name: "chat.send",
  input: z.object({
    agentId: z.string().min(1),
    hostId: z.string().min(1).max(256).regex(/^\S+$/),
    text: z.string().refine((text) => text.trim().length > 0),
    // Recognize unsupported payloads so they get an explicit error instead of being dropped.
    activeTurnBehavior: z.enum(["steer", "interrupt"]).optional(),
    images: z.array(z.unknown()).optional(),
    attachments: z.array(z.unknown()).optional(),
  }).strict(),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), error: z.discriminatedUnion("code", [
      z.object({ code: z.literal("agent_unavailable"), reason: z.enum([
        "archived", "agent_missing", "workspace_missing", "project_missing", "host_unknown", "host_mismatch",
      ]), message: z.string() }),
      z.object({ code: z.enum(["validation_failed", "send_failed"]), message: z.string() }),
    ]) }),
  ]),
});
