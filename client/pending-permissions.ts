import { useEffect, useState } from "react";
import { getPaseoClient, useHosts } from "@getpaseo/plugin/client";

/** The agent directory exposes current permission requests, unlike PluginAgentSnapshot. */
export function usePendingPermissions(): ReadonlyMap<string, ReadonlySet<string>> {
  const hosts = useHosts();
  const onlineHosts = JSON.stringify(hosts.filter((host) => host.status === "online").map((host) => host.serverId).sort());
  const [pending, setPending] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map());

  useEffect(() => {
    const lifetime = new AbortController();
    setPending(new Map());
    for (const hostId of JSON.parse(onlineHosts) as string[]) {
      const publish = (change: (previous: ReadonlySet<string>) => ReadonlySet<string>) => {
        if (lifetime.signal.aborted) return;
        setPending((current) => {
          if (lifetime.signal.aborted) return current;
          const previous = current.get(hostId) ?? new Set<string>();
          const next = change(previous);
          if (next === previous || (next.size === 0 && !current.has(hostId))) return current;
          const result = new Map(current);
          if (next.size === 0) result.delete(hostId);
          else result.set(hostId, next);
          return result;
        });
      };

      async function observe() {
        const { subscription } = await getPaseoClient(hostId).agents.list({
          filter: { statuses: ["running", "initializing"] },
          subscribe: {},
          signal: lifetime.signal,
        });
        if (lifetime.signal.aborted) {
          await subscription.release();
          return;
        }
        subscription.subscribe({
          snapshot({ entries }) {
            const waiting = entries.filter(({ agent }) => agent.pendingPermissions.length > 0);
            publish(() => new Set(waiting.map(({ agent }) => agent.id)));
          },
          update(message) {
            if (message.type !== "agent_update") return;
            const update = message.payload;
            const id = update.kind === "upsert" ? update.agent.id : update.agentId;
            const waiting = update.kind === "upsert" && update.agent.pendingPermissions.length > 0;
            publish((previous) => {
              if (previous.has(id) === waiting) return previous;
              const next = new Set(previous);
              if (waiting) next.add(id);
              else next.delete(id);
              return next;
            });
          },
          error() {
            publish(() => new Set());
          },
        });
      }
      void observe().catch(() => publish(() => new Set()));
    }

    return () => lifetime.abort();
  }, [onlineHosts]);

  return pending;
}
