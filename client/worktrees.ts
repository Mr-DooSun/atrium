// The git worktree and branch of session folders, asked of the plugin's own daemon. Shared by the
// Atrium tree and the badge it adds to Paseo's own sidebar rows (worktree-badge-item.tsx).
//
// Paseo's workspace snapshot already has the branch and whether a workspace is a worktree. It has
// no linked worktree path, no default branch and no detached HEAD, and nothing at all per agent
// folder, so the badge still needs this lookup; the branch-only fallback uses the snapshot.
import { useCallback, useMemo, useRef } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAgents, useRpc, useWorkspaces } from "@getpaseo/plugin/client";
import type { PluginAgentSnapshot, PluginWorkspaceSnapshot } from "@getpaseo/plugin";
import { MAX_WORKTREE_CWDS, projectWorktrees, worktreeKey, type WorktreeInfo } from "../shared/project-rpc";
import { OWN_HOST_KEY, OWN_HOST_REFRESH_MS, useOwnHost } from "./own-host";

const visibleWorkspace = (w: PluginWorkspaceSnapshot) => !w.background && !w.archivingAt;
const visibleAgent = (a: PluginAgentSnapshot) => !a.background;

const WORKTREE_REFRESH_MS = OWN_HOST_REFRESH_MS;
const NO_WORKTREES: ReadonlyMap<string, Extract<WorktreeInfo, { kind: "git" }>> = new Map();

/**
 * The git worktree and branch of every session folder, asked of the server in batches. A session
 * can switch branches while it works, so the answer is refreshed now and then (the server caches
 * each folder for a few seconds as well); between refreshes the last answer stays on screen.
 *
 * Only the plugin's own daemon can look into a folder, so only its host's sessions are asked
 * about, and the map is keyed by `worktreeKey(hostId, cwd)`: the same path on another host is a
 * different folder. Other hosts' rows keep Paseo's own branch line.
 */
export function useWorktrees(options: { agents?: boolean } = {}): ReadonlyMap<string, Extract<WorktreeInfo, { kind: "git" }>> {
  const withAgents = options.agents ?? true;
  const fetchWorktrees = useRpc(projectWorktrees);
  const queryClient = useQueryClient();
  const ownHost = useOwnHost();
  const onOwnHost = useCallback((s: { hostId: string }) => ownHost !== null && s.hostId === ownHost, [ownHost]);
  // Agents grouped by the folder they work in: one entry per distinct cwd.
  const byCwd = useAgents({ where: (a) => withAgents && visibleAgent(a) && onOwnHost(a), groupBy: (a) => a.cwd });
  // Sorted and distinct, so the key only changes when the set of folders does, not their order.
  // A workspace's own folder is asked about too: a workspace with one agent is drawn as one row.
  const byDirectory = useWorkspaces({ where: (w) => visibleWorkspace(w) && onOwnHost(w), groupBy: (w) => w.directory });
  const cwds = useMemo(
    () => [...new Set([...byCwd, ...byDirectory].map((g) => g.key).filter((c) => c.length > 0))].sort(),
    [byCwd, byDirectory],
  );
  const cwdsKey = cwds.join("\n");
  const query = useQuery({
    queryKey: ["atrium", "worktrees", ownHost, cwdsKey],
    queryFn: async () => {
      const found = new Map<string, Extract<WorktreeInfo, { kind: "git" }>>();
      if (ownHost === null) return found;
      for (let i = 0; i < cwds.length; i += MAX_WORKTREE_CWDS) {
        const { hostId, worktrees } = await fetchWorktrees({ cwds: cwds.slice(i, i + MAX_WORKTREE_CWDS) });
        // Another daemon answers now (the sidebar was moved to another host, or ownHost was only
        // a guess): its folders are not ownHost's. Learn its name; the next round asks its own sessions.
        if (hostId !== null && hostId !== ownHost) {
          queryClient.setQueryData(OWN_HOST_KEY, hostId);
          return new Map<string, Extract<WorktreeInfo, { kind: "git" }>>();
        }
        for (const [cwd, info] of Object.entries(worktrees)) {
          if (info.kind === "git") found.set(worktreeKey(ownHost, cwd), info);
        }
      }
      return found;
    },
    enabled: ownHost !== null && cwds.length > 0,
    staleTime: WORKTREE_REFRESH_MS,
    refetchInterval: WORKTREE_REFRESH_MS,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  // A failed refresh (or a server without project.worktrees) keeps the last answer, or none: the
  // rows lose their badge at worst and the sidebar is unaffected. An answer is only kept for the
  // host it was asked of: when the host becomes unknown or changes, the badges go rather than freeze.
  const last = useRef<{ host: string | null; map: ReadonlyMap<string, Extract<WorktreeInfo, { kind: "git" }>> }>({ host: null, map: NO_WORKTREES });
  if (last.current.host !== ownHost) last.current = { host: ownHost, map: NO_WORKTREES };
  if (ownHost !== null && query.data && query.isPlaceholderData === false) last.current = { host: ownHost, map: query.data };
  return last.current.map;
}
