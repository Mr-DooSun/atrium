import type { PaseoAgentTimelineHandle } from "@getpaseo/client";
import type { ChatItem } from "./rpc";

type TimelinePage = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
type TimelineEntry = Pick<TimelinePage["entries"][number], "item" | "seqStart" | "timestamp">;
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

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Converts a projected history entry or a live timeline event to a display row. */
export function toChatItem({ item, seqStart, timestamp }: TimelineEntry): ChatItem {
  const base = { id: String(seqStart), seq: seqStart, at: timestamp };
  const type = item?.type;
  switch (type) {
    case "user_message":
      return { ...base, kind: "user", text: stringOrEmpty(item.text) };
    case "assistant_message":
      return { ...base, kind: "assistant", text: stringOrEmpty(item.text) };
    case "reasoning":
      return { ...base, kind: "reasoning", text: stringOrEmpty(item.text) };
    case "tool_call": {
      const callId = stringOrEmpty(item.callId);
      const toolName = stringOrEmpty(item.name) || undefined;
      const status = stringOrEmpty(item.status);
      const label = toolName ?? "Tool";
      return {
        ...base,
        id: callId ? `tool:${callId}` : base.id,
        kind: "tool",
        text: status ? `${label} (${status})` : label,
        toolName,
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
      return {
        ...base,
        kind: "status",
        text: item.status === "completed" ? "Context compacted" : "Compacting context",
      };
    case "plugin": {
      const pluginId = stringOrEmpty(item.pluginId);
      const id = stringOrEmpty(item.id);
      return {
        ...base,
        id: pluginId && id ? JSON.stringify([pluginId, id]) : base.id,
        kind: "other",
        text: [pluginId, stringOrEmpty(item.kind)].filter(Boolean).join(": ") || "Plugin",
      };
    }
    default:
      return { ...base, kind: "other", text: stringOrEmpty(type) || "Unknown timeline item" };
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
