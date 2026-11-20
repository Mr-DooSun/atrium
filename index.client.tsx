import type { PluginClientContext } from "@getpaseo/plugin/client";
import { NestedSidebar } from "./client/nested-sidebar";
import { registerToolbox } from "./client/toolbox";
import { registerPanes } from "./client/panes";

export default function contribute(client: PluginClientContext) {
  const removeSidebar = client.addSidebarView({
    id: "atrium",
    title: "Atrium",
    description: "Workspaces and agents as a tree, sub-agent worktrees under their parent",
    Component: NestedSidebar,
  });
  const removeToolbox = registerToolbox(client);
  const removePanes = registerPanes(client);
  return () => {
    void removeSidebar();
    removeToolbox();
    removePanes();
  };
}
