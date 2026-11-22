import type { PluginServerContext } from "@getpaseo/plugin/server";
import { hideProject, unhideProject, projectWorktrees, projectHostIdSchema, removeProject, type WorktreeInfo } from "../shared/project-rpc";
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
    server.handle(rpc, async ({ projectId, hostId }) => {
      const projectHost = projectHostIdSchema.safeParse(hostId);
      if (!projectHost.success) {
        throw new Error("Project target host is required and must be 1–256 characters without whitespace.");
      }
      // Like order keys, visibility may name any project host. Only this RPC daemon's
      // sidebar preference file changes; no connection to the project's host is needed.
      return { ok: true as const, hiddenProjects: await setProjectHidden(projectHost.data, projectId, hidden) };
    });
  }
}
