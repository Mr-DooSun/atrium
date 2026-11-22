// Panes entry: the screen, a sidebar header row that opens it, and Command Center items.
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useTranslation } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { panesText } from "../chat-strings";
import { onOpenInPanes, openInPanes } from "./drop-bus";
import { addPane } from "./layout";
import { PanesScreen } from "./screen";
import { setPanes, usePanes, watchOtherWindows } from "./store";

export const PANES_SCREEN = "panes";

function PanesSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const { t } = useTranslation(panesText);
  const count = usePanes().length;
  return (
    <SidebarRow
      icon="Columns3"
      label={count > 0 ? `${t("title")} · ${count}` : t("title")}
      active={currentScreen?.screenId === PANES_SCREEN}
      onPress={() => openScreen({ screenId: PANES_SCREEN })}
    />
  );
}

export function registerPanes(client: PluginClientContext): () => void {
  const cleanups = [
    // Panes closed or opened in another window of the app reach this one (and stop with the plugin).
    watchOtherWindows(),
    // The one place "open in panes" adds a pane (the sidebar has no openScreen): add it, then
    // bring the screen up. Registered first, so anything queued before the plugin loaded lands
    // here once; the screen's own listener only offers to add the family.
    onOpenInPanes(({ agent }) => {
      setPanes((prev) => addPane(prev, { kind: "agent", key: agent.key, hostId: agent.hostId, id: agent.id }));
      client.openScreen({ screenId: PANES_SCREEN });
    }),
    client.addScreen({ id: PANES_SCREEN, title: panesText.message("title"), Component: PanesScreen }),
    // Named like its row ("Panes"), so the Show menu and the sidebar agree.
    client.addSidebarHeaderItem({ id: "panes", title: panesText.message("title"), Component: PanesSidebarItem }),
    client.addCommandCenterItem({
      id: "panes-open",
      title: panesText.message("open"),
      icon: "Columns3",
      keywords: ["panes", "split", "grid", "columns"],
      context: "global",
      onSelect: (ctx) => ctx.openScreen({ screenId: PANES_SCREEN }),
    }),
    client.addCommandCenterItem({
      id: "panes-open-this",
      title: panesText.message("openThis"),
      icon: "Columns3",
      keywords: ["panes", "split", "grid", "columns"],
      context: "agent",
      // The global listener adds the pane and opens the screen.
      onSelect: (ctx) => openInPanes({ kind: "atrium.session", agent: ctx.agent.ref, title: ctx.agent.title ?? undefined }),
    }),
  ];
  return () => {
    for (const cleanup of cleanups.reverse()) void cleanup();
  };
}
