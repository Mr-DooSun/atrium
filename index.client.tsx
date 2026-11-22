import type { PluginClientContext } from "@getpaseo/plugin/client";
import { NestedSidebar } from "./client/nested-sidebar";
import { sidebarText } from "./client/sidebar-strings";
import { registerToolbox } from "./client/toolbox";
import { registerPanes } from "./client/panes";
import { registerWorktreeBadge } from "./client/worktree-badge-item";

export default function contribute(client: PluginClientContext) {
  const removeSidebar = client.addSidebarView({
    id: "atrium",
    title: "Atrium",
    description: sidebarText.message("viewDescription"),
    Component: NestedSidebar,
  });
  const removeToolbox = registerToolbox(client);
  const removePanes = registerPanes(client);
  // Paseo's own sidebar rows get the worktree badge too; a toggle in its Show menu.
  const removeWorktreeBadge = registerWorktreeBadge(client);
  return () => {
    void removeSidebar();
    removeToolbox();
    removePanes();
    removeWorktreeBadge();
  };
}
