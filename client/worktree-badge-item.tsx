// Atrium's worktree badge on Paseo's own sidebar rows, for people who keep the default sidebar.
// Paseo calls it for every workspace of the plugin's host, the only host whose folders the plugin's
// daemon can look into. It says only what Paseo's row does not: a linked worktree's folder, a
// detached HEAD, or a main checkout off its default branch (same rule as the Atrium tree).
import { useTranslation, useWorkspaces, type PluginClientContext, type PluginWorkspaceRowBadgeItemProps } from "@getpaseo/plugin/client";
import { WorkspaceRowBadge } from "@getpaseo/plugin/client/ui";
import { worktreeKey } from "../shared/project-rpc";
import { worktreeBadge } from "./look";
import { sidebarText } from "./sidebar-strings";
import { useWorktrees } from "./worktrees";

function WorktreeRowBadge({ workspaceId, host }: PluginWorkspaceRowBadgeItemProps) {
  const { t } = useTranslation(sidebarText);
  const directory = useWorkspaces({
    where: (w) => w.id === workspaceId && w.hostId === host.id,
    groupBy: (w) => w.directory,
  })[0]?.key;
  // Workspace folders only: Paseo's rows are workspaces, never single agents.
  const worktrees = useWorktrees({ agents: false });
  const info = typeof directory === "string" ? worktrees.get(worktreeKey(host.id, directory)) ?? null : null;
  const spec = worktreeBadge(info);
  if (!info || !spec) return null;
  const branch = spec.detached ? t("worktreeDetached", { head: spec.label }) : spec.label;
  const label = spec.folder ? t("worktreeLinked", { folder: spec.folder, branch }) : t("worktreeMain", { branch });
  return (
    <WorkspaceRowBadge
      icon={spec.folder ? "FolderGit2" : "GitBranch"}
      label={spec.folder ? `${spec.folder} · ${branch}` : branch}
      tone={spec.tone === "linked" ? "info" : "muted"}
      accessibilityLabel={`${label}. ${t("worktreePath", { path: info.worktreePath })}`}
    />
  );
}

/**
 * Paseo's app checks every contribution id against /^[a-z][a-z0-9-]*$/ (packages/app/src/plugins/
 * evaluate.ts, 0.16.1 and 0.17.1 alike): no dots. A throw here fails the whole client entry, so
 * this optional badge is registered apart: if the host refuses it, the sidebar, panes and toolbox
 * still load.
 */
export function registerWorktreeBadge(client: PluginClientContext): () => void {
  try {
    const remove = client.addWorkspaceRowBadgeItem({
      id: "worktree",
      title: sidebarText.message("worktreeBadgeItem"),
      icon: "FolderGit2",
      Component: WorktreeRowBadge,
    });
    return () => {
      void remove();
    };
  } catch (error) {
    console.warn("[atrium] worktree badge not registered", error);
    return () => {};
  }
}
