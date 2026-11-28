// General: conversations that belong to no project. Paseo agents always run in a folder, so
// they run in one scratch folder on each daemon (~/.paseo-chat). The section is pinned under the
// tree and gathers every host's chat folder into one list; the tree leaves those folders out.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  getPaseoClient,
  useAgent,
  useAgents,
  useHosts,
  useProjects,
  useRpc,
  useTranslation,
  useWorkspaces,
  type AgentRef,
  type PluginSidebarViewProps,
} from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { ensureChatDir } from "../shared/chat/rpc";
import { CHAT_DIR_NAME, isChatFolder } from "../shared/chat/folder";
import { useOwnHost } from "./own-host";
import { chatText } from "./chat-strings";
import { sidebarText } from "./sidebar-strings";
import { ROW, TITLE_LINE, type Palette } from "./look";
import { ProviderMark, StatusMark, agentBucket, isAgentTurnActive } from "./marks";
import { ArchiveButton, ArchiveModal, useArchive, NO_EMPTIED, type ArchiveTarget } from "./archive";
import { PanesButton, SessionMenu } from "./project-order";
import { openInPanes } from "./panes/drop-bus";
import { useCollapsed } from "./collapsed-store";

/** The General section's key in the folded set; never a ref key. */
const GENERAL_KEY = "atrium:general";

/** The chat folder's absolute path on the daemon, created on first use. */
export function useChatDir(): string | null {
  const ensure = useRpc(ensureChatDir);
  const query = useQuery({
    queryKey: ["chat", "dir"],
    queryFn: () => ensure({}),
    staleTime: Infinity,
    retry: 2,
  });
  return query.data?.path ?? null;
}

export function ChatSection({
  view,
  p,
  chatDir,
}: {
  view: PluginSidebarViewProps;
  p: Palette;
  chatDir: string | null;
}) {
  const toast = useToast();
  const { t } = useTranslation(chatText);
  const { t: tSidebar } = useTranslation(sidebarText);
  const ensure = useRpc(ensureChatDir);
  // Folded state kept across reloads with the tree's (web, Electron).
  const [collapsed, toggleCollapsed] = useCollapsed();
  const open = !collapsed.has(GENERAL_KEY);
  const [expandedHosts, setExpandedHosts] = useState<ReadonlySet<string>>(() => new Set());
  const [startingHost, setStartingHost] = useState<string | null>(null);
  const [openingProject, setOpeningProject] = useState<{ hostId: string; id: string } | null>(null);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const ownHost = useOwnHost();
  const projects = useProjects({ where: (pr) => isChatFolder(pr.rootPath, chatDir) });
  const workspaces = useWorkspaces({
    where: (w) => isChatFolder(w.projectRootPath, chatDir) && !w.background && !w.archivingAt,
  });
  const hosts = useHosts();
  const multipleHosts = hosts.length > 1;
  const filterHost = multipleHosts && hosts.some((host) => host.serverId === selectedHost) ? selectedHost : null;
  const hostLabel = (hostId: string) =>
    hosts.find((host) => host.serverId === hostId)?.label || hostId;
  const workspaceKeys = useMemo(() => new Set(workspaces.map((w) => w.key)), [workspaces]);
  // Every agent in the chat folder, sub-agents included, to tell which chats own their workspace.
  const byWorkspace = useAgents({
    where: (a) => workspaceKeys.has(a.workspace.key) && !a.background,
    groupBy: (a) => a.workspace.key,
  });
  const sharedWorkspaces = useMemo(
    () => new Set(byWorkspace.filter((g) => g.items.length > 1).map((g) => String(g.key))),
    [byWorkspace],
  );
  // One conversation per root agent; sub-agents it starts open from its own tabs.
  const chats = useAgents({
    where: (a) => workspaceKeys.has(a.workspace.key) && !a.background && !a.parentAgent,
    orderBy: ["lastActivityAt", "desc"],
  });

  // The first chat registers the folder as a project; wait for its host-scoped ref.
  useEffect(() => {
    if (!openingProject) return;
    const project = projects.find((pr) => pr.hostId === openingProject.hostId && pr.id === openingProject.id);
    if (project) {
      setOpeningProject(null);
      setStartingHost(null);
      view.navigation.openProject(project);
      return;
    }
    const timer = setTimeout(() => {
      setOpeningProject(null);
      setStartingHost(null);
      toast.error(t("openFailed"));
    }, 5000);
    return () => clearTimeout(timer);
  }, [openingProject, projects, view.navigation, toast, t]);

  const newChat = async (hostId: string) => {
    if (startingHost !== null) return;
    const project = projects.find((pr) => pr.hostId === hostId);
    if (project) {
      view.navigation.openProject(project);
      return;
    }
    setStartingHost(hostId);
    try {
      const path = hostId === ownHost ? chatDir ?? (await ensure({})).path : `~/${CHAT_DIR_NAME}`;
      const workspace = await getPaseoClient(hostId).workspaces.open(path);
      if (!workspace.projectId) throw new Error(t("openFailed"));
      setOpeningProject({ hostId, id: workspace.projectId });
    } catch (error: unknown) {
      setStartingHost(null);
      const message = error instanceof Error ? error.message : t("openFailed");
      toast.error(hostId !== ownHost && message.startsWith("Directory not found:")
        ? t("missingHostFolder", { host: hostLabel(hostId) })
        : message);
    }
  };

  const defaultHost = filterHost ?? ownHost;
  const visibleHosts = hosts.filter((host) => filterHost === null || host.serverId === filterHost);
  const limit = multipleHosts ? 1 : view.layout.compact ? 3 : 5;
  const count = filterHost === null ? chats.length : chats.filter((chat) => chat.hostId === filterHost).length;

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: p.guide, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: ROW.minHeight }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={t("title")}
          onPress={() => toggleCollapsed(GENERAL_KEY)}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: 8,
            paddingVertical: ROW.paddingVertical,
            borderRadius: 8,
            backgroundColor: pressed ? p.pressed : "transparent",
          })}
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={p.muted} />
          {/* The icon carries the meaning on its own, whatever the language. */}
          <Icon name="MessagesSquare" size={14} color={p.muted} />
          <Text numberOfLines={1} style={{ flex: 1, color: p.muted, fontSize: 14, textAlign: "left" }}>
            {t("title")}
            {count > 0 ? ` ${count}` : ""}
          </Text>
        </Pressable>
        {open && multipleHosts ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("filterByHost")}
            accessibilityHint={filterHost === null ? t("allHosts") : hostLabel(filterHost)}
            accessibilityState={{ selected: filterHost !== null }}
            hitSlop={4}
            onPress={() => setFilterOpen(true)}
            style={({ pressed }) => ({
              width: 28,
              height: 28,
              borderRadius: 6,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? p.pressed : filterHost !== null ? p.selected : "transparent",
            })}
          >
            <Icon name="ListFilter" size={15} color={filterHost === null ? p.muted : p.foreground} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("newChat")}
          hitSlop={6}
          disabled={defaultHost === null || startingHost !== null}
          onPress={() => { if (defaultHost !== null) void newChat(defaultHost); }}
          style={({ pressed }) => ({
            width: 24,
            height: 24,
            marginRight: 6,
            borderRadius: 6,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? p.pressed : "transparent",
          })}
        >
          {startingHost !== null || defaultHost === null ? (
            <ActivityIndicator size="small" color={p.muted} />
          ) : (
            <Icon name="SquarePen" size={14} color={p.muted} />
          )}
        </Pressable>
      </View>
      {open ? (
        <ScrollView style={{ maxHeight: ROW.minHeight * (view.layout.compact ? 6 : 8) }}>
          {visibleHosts.map(({ serverId: hostId }) => {
            const refs = chats.filter((chat) => chat.hostId === hostId);
            const expanded = expandedHosts.has(hostId);
            const shown = expanded ? refs : refs.slice(0, limit);
            return (
              <View key={hostId}>
                {multipleHosts ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 16, paddingRight: 12, paddingVertical: 4 }}>
                    <Icon name="Server" size={12} color={p.muted} />
                    <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: p.muted, fontSize: 11, fontWeight: "600" }}>
                      {hostLabel(hostId)}
                    </Text>
                  </View>
                ) : null}
                {shown.map((ref) => (
                  <ChatRow key={ref.key} reference={ref} sharedWorkspaces={sharedWorkspaces} view={view} p={p} />
                ))}
                {refs.length === 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={startingHost !== null}
                    onPress={() => void newChat(hostId)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 30, paddingVertical: 6 }}
                  >
                    {startingHost === hostId ? <ActivityIndicator size="small" color={p.muted} /> : <Icon name="SquarePen" size={12} color={p.muted} />}
                    <Text style={{ color: p.muted, fontSize: 12 }}>{tSidebar("startChat")}</Text>
                  </Pressable>
                ) : null}
                {refs.length > limit ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    onPress={() => setExpandedHosts((previous) => {
                      const next = new Set(previous);
                      if (next.has(hostId)) next.delete(hostId);
                      else next.add(hostId);
                      return next;
                    })}
                    style={{ paddingLeft: 30, paddingVertical: 6 }}
                  >
                    <Text style={{ color: p.muted, fontSize: 12 }}>
                      {expanded ? t("showLess") : t("showMore", { n: refs.length - limit })}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      ) : null}
      <Modal title={t("filterByHost")} open={filterOpen && multipleHosts} onOpenChange={setFilterOpen}>
        <Modal.Content contentContainerStyle={{ padding: 16, gap: 4 }}>
          {[{ id: null, label: t("allHosts") }, ...hosts.map((host) => ({ id: host.serverId, label: hostLabel(host.serverId) }))].map(({ id, label }) => (
            <Pressable
              key={id ?? "all"}
              accessibilityRole="radio"
              accessibilityState={{ checked: id === filterHost }}
              onPress={() => {
                setSelectedHost(id);
                setFilterOpen(false);
              }}
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: 12,
                borderRadius: 8,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: pressed ? p.pressed : id === filterHost ? p.selected : "transparent",
              })}
            >
              <Text style={{ flex: 1, color: p.foreground, fontSize: 14 }}>{label}</Text>
              {id === filterHost ? <Icon name="Check" size={16} color={p.foreground} /> : null}
            </Pressable>
          ))}
        </Modal.Content>
      </Modal>
    </View>
  );
}

function ChatRow({
  reference,
  sharedWorkspaces,
  view,
  p,
}: {
  reference: AgentRef;
  sharedWorkspaces: ReadonlySet<string>;
  view: PluginSidebarViewProps;
  p: Palette;
}) {
  const { t } = useTranslation(chatText);
  const { t: tSidebar } = useTranslation(sidebarText);
  const agent = useAgent(reference, (a) => ({
    label: a.title ?? t("untitled"),
    provider: a.provider,
    status: a.status,
    requiresAttention: a.requiresAttention,
    attentionReason: a.attentionReason,
    workspace: a.workspace,
  }));
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // A chat alone in its workspace takes the workspace with it, so no empty rows pile up; one
  // that shares a workspace with other agents goes alone.
  const alone = agent ? !sharedWorkspaces.has(agent.workspace.key) : false;
  const target: ArchiveTarget | null = useMemo(
    () =>
      agent
        ? alone
          ? { kind: "workspace", ref: agent.workspace, rootAgent: reference, worktree: false, hasChanges: false, emptied: NO_EMPTIED }
          : { kind: "agent", ref: reference, emptied: NO_EMPTIED }
        : null,
    [agent?.workspace, reference, alone],
  );
  const archive = useArchive(target);
  if (!agent) return null;
  const active = view.active.agent?.key === reference.key;
  const bucket = agentBucket(agent);
  const canArchive = !isAgentTurnActive(agent.status);
  const openPanes = () => openInPanes({ kind: "atrium.session", agent: reference, title: agent.label });
  return (
    <>
      {/* Long press (compact layouts have no hover) offers the same actions as the hover buttons. */}
      <SessionMenu
        name={agent.label}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenInPanes={openPanes}
        onArchive={canArchive ? archive.begin : undefined}
        p={p}
      />
      {target ? (
        <ArchiveModal state={archive} title={agent.label} target={target} descendants={0} danger={false} p={p} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tSidebar("openRow", { name: agent.label })}
        onPress={() => view.navigation.openAgent(reference)}
        // Desktop has the hover buttons; the menu is for touch layouts only.
        onLongPress={view.layout.compact ? () => setMenuOpen(true) : undefined}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={({ pressed }) => ({
          minHeight: ROW.minHeight,
          paddingVertical: ROW.paddingVertical,
          paddingLeft: 30,
          paddingRight: 12,
          borderRadius: 8,
          marginBottom: ROW.gap,
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 8,
          backgroundColor: active ? p.selected : pressed ? p.pressed : hovered ? p.hover : "transparent",
        })}
      >
        <ProviderMark provider={agent.provider} p={p} />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            minWidth: 0,
            color: p.foreground,
            fontSize: 14,
            lineHeight: TITLE_LINE,
            opacity: hovered || active ? 1 : 0.76,
            textAlign: "left",
          }}
        >
          {agent.label}
        </Text>
        {hovered && !archive.confirming ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <PanesButton onPress={openPanes} p={p} />
            {canArchive ? <ArchiveButton onPress={archive.begin} p={p} /> : null}
          </View>
        ) : (
          <StatusMark bucket={bucket} p={p} />
        )}
      </Pressable>
    </>
  );
}
