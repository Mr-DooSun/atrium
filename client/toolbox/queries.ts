// Query keys and shared queries. Keys are prefixes so one invalidation covers a profile's lists.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { listProfiles } from "../../shared/toolbox/rpc";
import type { Ecosystem } from "../../shared/toolbox/types";

export const keys = {
  profiles: ["toolbox", "profiles"] as const,
  mcpAll: ["toolbox", "mcp"] as const,
  mcp: (profileId: string) => ["toolbox", "mcp", profileId] as const,
  mcpList: (profileId: string, cwd: string | null) => ["toolbox", "mcp", profileId, cwd] as const,
  plugins: (ecosystem: Ecosystem, profileId: string | null) => ["toolbox", "plugins", ecosystem, profileId] as const,
  installed: (ecosystem: Ecosystem, profileId: string | null, cwd: string | null) =>
    ["toolbox", "plugins", ecosystem, profileId, "installed", cwd] as const,
  catalog: (ecosystem: Ecosystem, profileId: string | null, cwd: string | null, query: string) =>
    ["toolbox", "plugins", ecosystem, profileId, "catalog", cwd, query] as const,
};

/** Profiles with cached auth; `refresh()` re-runs the auth checks and replaces the cache. */
export function useProfiles() {
  const list = useRpc(listProfiles);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: keys.profiles,
    queryFn: () => list({ refresh: false }),
    staleTime: 30_000,
  });
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    list({ refresh: true })
      .then((data) => queryClient.setQueryData(keys.profiles, data))
      .catch(() => queryClient.invalidateQueries({ queryKey: keys.profiles }))
      .finally(() => setRefreshing(false));
  }, [list, queryClient]);
  return { query, refresh, refreshing };
}
