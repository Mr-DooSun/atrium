// General: conversations that belong to no project. Paseo agents always run in a folder, so
// they run in one scratch folder on the daemon (~/.paseo-chat). The section is pinned under the
// tree, and the tree leaves that folder's workspaces out.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  useAgent,
  useAgents,
  useProjects,
  usePaseo,
  useRpc,
  useTranslation,
  useWorkspaces,
  type AgentRef,
  type PluginSidebarViewProps,
} from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { ensureChatDir } from "../shared/chat/rpc";
import { chatText } from "./chat-strings";
import { ROW, TITLE_LINE, type Palette } from "./look";
import { ProviderMark, StatusMark, agentBucket, isAgentTurnActive } from "./marks";
import { ArchiveButton, ArchiveModal, useArchive, NO_EMPTIED, type ArchiveTarget } from "./archive";

/** Rows shown before "show more"; the list scrolls inside its own box past this. */
const VISIBLE = 5;
const LIST_MAX_HEIGHT = ROW.minHeight * 8;

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
  const paseo = usePaseo();
  const toast = useToast();
  const { t } = useTranslation(chatText);
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [starting, setStarting] = useState(false);

  const project = useProjects({ where: (pr) => chatDir !== null && pr.rootPath === chatDir })[0] ?? null;
  const workspaces = useWorkspaces({
    where: (w) => chatDir !== null && w.projectRootPath === chatDir && !w.archivingAt,
  });
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

  // The first chat registers the folder as a project; open it once the project shows up.
  useEffect(() => {
    if (starting && project) {
      setStarting(false);
      view.navigation.openProject(project);
    }
  }, [starting, project, view.navigation]);

  const newChat = () => {
    if (!chatDir || starting) return;
    if (project) {
      // Paseo's own new-workspace screen: its composer picks the provider, last used first.
      view.navigation.openProject(project);
      return;
    }
    setStarting(true);
    paseo.workspaces.open(chatDir).catch((error: unknown) => {
      setStarting(false);
      toast.error(error instanceof Error ? error.message : t("openFailed"));
    });
  };

  const shown = expanded ? chats : chats.slice(0, VISIBLE);
  const more = chats.length - shown.length;

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: p.guide, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: ROW.minHeight }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={t("title")}
          onPress={() => setOpen((v) => !v)}
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
          <Text numberOfLines={1} style={{ flex: 1, color: p.muted, fontSize: 14 }}>
            {t("title")}
            {chats.length > 0 ? ` ${chats.length}` : ""}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("newChat")}
          hitSlop={6}
          disabled={!chatDir || starting}
          onPress={newChat}
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
          {starting || !chatDir ? (
            <ActivityIndicator size="small" color={p.muted} />
          ) : (
            <Icon name="SquarePen" size={14} color={p.muted} />
          )}
        </Pressable>
      </View>
      {open ? (
        <ScrollView style={{ maxHeight: LIST_MAX_HEIGHT }}>
          {chats.length === 0 ? (
            <Pressable onPress={newChat} disabled={!chatDir || starting} style={{ paddingLeft: 30, paddingVertical: 6 }}>
              <Text style={{ color: p.muted, fontSize: 12 }}>{t("empty")}</Text>
            </Pressable>
          ) : (
            shown.map((ref) => (
              <ChatRow key={ref.key} reference={ref} sharedWorkspaces={sharedWorkspaces} view={view} p={p} />
            ))
          )}
          {more > 0 || (expanded && chats.length > VISIBLE) ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded((v) => !v)}
              style={{ paddingLeft: 30, paddingVertical: 6 }}
            >
              <Text style={{ color: p.muted, fontSize: 12 }}>{expanded ? t("showLess") : t("showMore", { n: more })}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}
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
  const agent = useAgent(reference, (a) => ({
    label: a.title ?? t("untitled"),
    provider: a.provider,
    status: a.status,
    requiresAttention: a.requiresAttention,
    attentionReason: a.attentionReason,
    workspace: a.workspace,
  }));
  const [hovered, setHovered] = useState(false);
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
  return (
    <>
      {target ? (
        <ArchiveModal state={archive} title={agent.label} target={target} descendants={0} danger={false} p={p} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${agent.label}`}
        onPress={() => view.navigation.openAgent(reference)}
        onLongPress={canArchive ? archive.begin : undefined}
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
          }}
        >
          {agent.label}
        </Text>
        {hovered && canArchive && !archive.confirming ? (
          <ArchiveButton onPress={archive.begin} p={p} />
        ) : (
          <StatusMark bucket={bucket} p={p} />
        )}
      </Pressable>
    </>
  );
}
