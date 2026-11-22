import type { PluginServerContext } from "@getpaseo/plugin/server";
import { hideProject, unhideProject, projectWorktrees, removeProject, type WorktreeInfo } from "../shared/project-rpc";
import { ownHostId } from "./core/host-id.ts";
import { setProjectHidden } from "./project-order";
import { getWorktreeInfo } from "./core/worktree.ts";

export function registerProject(server: PluginServerContext) {
  server.handle(projectWorktrees, async ({ cwds }, context) => {
    // Looked up alongside the folders, not before them; cached once found.
    const hostId = ownHostId(context?.paseo);
    const directories = [...new Set(cwds)];
    const entries: Array<readonly [string, WorktreeInfo]> = [];
    // Keep a sidebar full of cold entries from starting every Git subprocess at once.
    const concurrency = 16;
    for (let offset = 0; offset < directories.length; offset += concurrency) {
      const batch = directories.slice(offset, offset + concurrency);
      const found = await Promise.all(batch.map(async (cwd) => [cwd, await getWorktreeInfo(cwd)] as const));
      entries.push(...found);
    }
    return { hostId: await hostId, worktrees: Object.fromEntries(entries) };
  });

  for (const [rpc, hidden] of [[hideProject, true], [unhideProject, false], [removeProject, true]] as const) {
    server.handle(rpc, async ({ projectId, hostId }, context) => {
      if (!hostId) throw new Error("Project target host is required. Refresh Atrium before hiding projects.");
      const currentHostId = await ownHostId(context?.paseo);
      if (!currentHostId) throw new Error("This daemon's host could not be identified.");
      if (hostId !== currentHostId) throw new Error("Project target host does not match this daemon.");
      return { ok: true as const, hiddenProjects: await setProjectHidden(hostId, projectId, hidden) };
    });
  }
}
