import type { ChatItem } from "./rpc";

type TimelineEntry = {
  item: {
    type?: string;
    text?: unknown;
    callId?: unknown;
    name?: unknown;
    status?: unknown;
    items?: unknown;
    message?: unknown;
    pluginId?: unknown;
    id?: unknown;
    kind?: unknown;
    messageId?: unknown;
    detail?: unknown;
    agentMessage?: unknown;
  } | null | undefined;
  seqStart: number;
  timestamp: string;
  /** Present on projected history entries, absent on live updates. */
  seqEnd?: number;
};
type AgentWithLabels = {
  id: string;
  labels?: Readonly<Record<string, string>>;
};
type ChatLink = {
  agentId: string;
  parentAgentId: string | null;
  rootAgentId: string;
  childAgentIds: string[];
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** `text` of a plugin row without pluginId/kind, and of an unknown item without a type. */
export const PLUGIN_FALLBACK_TEXT = "Plugin";
export const UNKNOWN_FALLBACK_TEXT = "Unknown timeline item";
/** `text` of a compaction row; servers before `code` existed sent only this. */
export const COMPACTED_FALLBACK_TEXT = "Context compacted";
export const COMPACTING_FALLBACK_TEXT = "Compacting context";

/**
 * Converts a projected history entry or a live timeline event to a display row. Tool, compaction,
 * plugin and unknown rows carry structured fields (`toolName`/`status`, `code`) that current
 * clients word in the user's language. `text` keeps the English line older clients show: the
 * client bundle comes from the daemon's plugin catalog, so after a plugin update an app still
 * running the previous bundle can talk to this server until it reloads.
 */
export function toChatItem({ item, seqStart, timestamp, seqEnd }: TimelineEntry): ChatItem {
  const base: Pick<ChatItem, "id" | "seq" | "at" | "projected"> = {
    id: String(seqStart),
    seq: seqStart,
    at: timestamp,
    ...(typeof seqEnd === "number" ? { projected: true } : {}),
  };
  switch (item?.type) {
    case "user_message":
      return { ...base, kind: "user", text: stringOrEmpty(item.text) };
    case "assistant_message": {
      const messageId = stringOrEmpty(item.messageId);
      return { ...base, kind: "assistant", text: stringOrEmpty(item.text), ...(messageId ? { messageId } : {}) };
    }
    case "reasoning":
      return { ...base, kind: "reasoning", text: stringOrEmpty(item.text) };
    case "tool_call": {
      const callId = stringOrEmpty(item.callId);
      const toolName = stringOrEmpty(item.name) || undefined;
      const status = stringOrEmpty(item.status) || undefined;
      if (toolName === "agent_message") {
        const message = record(item.agentMessage);
        const detail = record(item.detail);
        const sender = record(message?.sender) ?? record(detail?.sender);
        const text = typeof message?.text === "string" ? message.text : stringOrEmpty(detail?.text);
        const senderName = stringOrEmpty(sender?.title) || stringOrEmpty(sender?.id) || stringOrEmpty(detail?.senderName);
        if (text) return {
          ...base, id: callId ? `tool:${callId}` : base.id, kind: "user", text,
          ...(senderName ? { senderName } : {}),
        };
      }
      const label = toolName ?? "Tool";
      return {
        ...base,
        id: callId ? `tool:${callId}` : base.id,
        kind: "tool",
        text: status ? `${label} (${status})` : label,
        toolName,
        status,
      };
    }
    case "todo":
      return {
        ...base,
        kind: "status",
        text: (Array.isArray(item.items) ? item.items : [])
          .map((task) => `- [${task?.completed ? "x" : " "}] ${stringOrEmpty(task?.text)}`)
          .join("\n"),
      };
    case "error":
    case "notification":
      return { ...base, kind: "status", text: stringOrEmpty(item.message) };
    case "compaction":
      return item.status === "completed"
        ? { ...base, kind: "status", text: COMPACTED_FALLBACK_TEXT, code: "compacted" }
        : { ...base, kind: "status", text: COMPACTING_FALLBACK_TEXT, code: "compacting" };
    case "plugin": {
      const pluginId = stringOrEmpty(item.pluginId);
      const id = stringOrEmpty(item.id);
      return {
        ...base,
        id: pluginId && id ? JSON.stringify([pluginId, id]) : base.id,
        kind: "other",
        text: [pluginId, stringOrEmpty(item.kind)].filter(Boolean).join(": ") || PLUGIN_FALLBACK_TEXT,
        code: "plugin",
      };
    }
    default:
      // The raw type name is data, shown under a translated "unknown item" label.
      return { ...base, kind: "other", text: stringOrEmpty(item?.type) || UNKNOWN_FALLBACK_TEXT, code: "unknown" };
  }
}

/** Computes links from the directory, including relatives outside the requested set. */
export function computeChatLinks(
  agentIds: readonly string[],
  agents: readonly AgentWithLabels[],
): ChatLink[] {
  const parents = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const { id, labels } of agents) {
    const parent = labels?.["paseo.parent-agent-id"]?.trim();
    if (!parent || parent === id) continue;
    parents.set(id, parent);
    const siblings = children.get(parent) ?? [];
    siblings.push(id);
    children.set(parent, siblings);
  }

  function findRoot(agentId: string): string {
    const visited = new Map<string, number>();
    let current = agentId;
    while (true) {
      const cycleStart = visited.get(current);
      if (cycleStart !== undefined) {
        // Give every agent reaching the same malformed cycle a consistent group.
        return [...visited.keys()].slice(cycleStart).sort()[0];
      }
      visited.set(current, visited.size);
      const parent = parents.get(current);
      if (!parent) return current;
      current = parent;
    }
  }

  return [...new Set(agentIds)].map((agentId) => ({
    agentId,
    parentAgentId: parents.get(agentId) ?? null,
    rootAgentId: findRoot(agentId),
    childAgentIds: children.get(agentId)?.sort() ?? [],
  }));
}
