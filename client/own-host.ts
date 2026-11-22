// Which Paseo host this plugin's own daemon is. RPCs always reach that daemon, whichever host the
// sidebar shows, so anything that acts on a host's folders or projects has to be on it.
import { useQuery } from "@tanstack/react-query";
import { useHosts, useRpc } from "@getpaseo/plugin/client";
import { projectWorktrees } from "../shared/project-rpc";

export const OWN_HOST_REFRESH_MS = 20_000;
export const OWN_HOST_KEY = ["atrium", "worktrees", "host"] as const;

/**
 * The host id the daemon serving this plugin's RPCs gave for itself: a string once it named
 * itself, null when it answered without a name (an older server, or one that cannot tell),
 * undefined while not asked yet.
 */
export function useNamedOwnHost(): string | null | undefined {
  const fetchWorktrees = useRpc(projectWorktrees);
  const named = useQuery({
    queryKey: OWN_HOST_KEY,
    queryFn: async () => (await fetchWorktrees({ cwds: [] })).hostId,
    // Once named, the host never changes; an unnamed answer is asked again now and then.
    staleTime: (q) => (q.state.data ? Infinity : OWN_HOST_REFRESH_MS),
    refetchInterval: (q) => (q.state.data ? false : OWN_HOST_REFRESH_MS * 3),
    refetchIntervalInBackground: false,
    retry: 1,
  });
  return named.isSuccess ? named.data : undefined;
}

/**
 * The host id of the daemon serving this plugin's RPCs, or null while unknown. An older server does
 * not name itself, and then the only host it can be is the single configured one. With several
 * hosts and no name, null. Good enough to choose which folders to look into; not for removing
 * anything (see `projectRemovalTarget`).
 */
export function useOwnHost(): string | null {
  const hosts = useHosts();
  const named = useNamedOwnHost();
  if (named) return named;
  if (named === null && hosts.length === 1) return hosts[0].serverId;
  return null;
}

/**
 * Whether Atrium may remove a project on `projectHost`: only when the daemon that would run the
 * removal named itself as that host. A guess is never enough; the server refuses it as well.
 */
export type RemovalTarget = "own" | "other" | "unknown";
export function projectRemovalTarget(projectHost: string, ownHost: string | null | undefined): RemovalTarget {
  if (!ownHost) return "unknown";
  return ownHost === projectHost ? "own" : "other";
}
