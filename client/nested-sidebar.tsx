import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  useAgent,
  useAgents,
  useProject,
  useProjects,
  useTranslation,
  useWorkspace,
  useWorkspaces,
  type AgentRef,
  type PluginSidebarViewProps,
  type ProjectRef,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { PluginAgentSnapshot, PluginWorkspaceSnapshot } from "@getpaseo/plugin";
import { buildTree, type TreeNode } from "../shared/tree";
import { CONNECT, PROJECT, ROW, TITLE_LINE, connectorX, slotX, palette, type Palette } from "./look";
import { ProviderMark, StatusMark, URGENT, agentBucket, mostUrgent } from "./marks";
import type { Bucket } from "./look";
import { ChatSection, useChatDir } from "./chat";
import { ArchiveButton, ArchiveModal, archiveWarning, useArchive, type ArchiveTarget } from "./archive";
import { RenameButton, RenameModal, useRename } from "./rename";
import { RemoveProjectModal, useRemoveProject } from "./remove-project";
import { MoveButton, ProjectMenu, ReorderBar, useProjectOrder } from "./project-order";
import { applyOrder, move } from "../shared/project-order";
import { sidebarText } from "./sidebar-strings";

const ROOT = "__root__";

/** Where a row sits in the tree: per ancestor column, whether its line continues; and whether
 *  the row is its parent's last child (its elbow ends the line). */
interface Trail {
  readonly continues: readonly boolean[];
  readonly last: boolean;
}
const TrailContext = createContext<Trail>({ continues: [], last: true });

interface Ctx {
  view: PluginSidebarViewProps;
  p: Palette;
  compact: boolean;
  workspaceRefs: ReadonlyMap<string, WorkspaceRef>;
  projectRefs: ReadonlyMap<string, ProjectRef>;
  agentRefs: ReadonlyMap<string, AgentRef>;
  agentWorkspace: ReadonlyMap<string, string>;
  collapsed: ReadonlySet<string>;
  toggle(key: string): void;
  /** True while project headers show up/down buttons instead of their rows. */
  reordering: boolean;
  startReorder(): void;
  /** Moves a project one place up (-1) or down (+1). */
  moveProject(key: string, delta: -1 | 1): void;
  projectIndex: ReadonlyMap<string, number>;
}

/** Group keys → member keys, plus a key → ref lookup. */
function index<Ref extends { key: string }>(
  groups: readonly { key: string; items: readonly Ref[] }[],
) {
  const owner = new Map<string, string | null>();
  const refs = new Map<string, Ref>();
  for (const group of groups) {
    for (const ref of group.items) {
      owner.set(ref.key, group.key === ROOT ? null : group.key);
      refs.set(ref.key, ref);
    }
  }
  return { owner, refs };
}

const visibleWorkspace = (w: PluginWorkspaceSnapshot) => !w.background && !w.archivingAt;
// "closed" only means the agent's process is down (after a daemon restart, for instance); the
// session is still there and Paseo's own sidebar keeps it. Archived agents never reach here.
const visibleAgent = (a: PluginAgentSnapshot) => !a.background;

export function NestedSidebar(view: PluginSidebarViewProps) {
  // The free chat folder's workspaces live in the pinned section below, not in the tree.
  const chatDir = useChatDir();
  const inTree = useCallback(
    (w: PluginWorkspaceSnapshot) => visibleWorkspace(w) && w.projectRootPath !== chatDir,
    [chatDir],
  );
  // Agents only reach the tree through their workspace, so filtering workspaces is enough.
  // Ordered lists, then the same entities grouped by each relation the tree needs.
  const workspaceOrder = useWorkspaces({ where: inTree, orderBy: ["createdAt", "desc"] });
  const agentOrder = useAgents({ where: visibleAgent, orderBy: ["createdAt", "asc"] });
  const byProject = useWorkspaces({ where: inTree, groupBy: (w) => w.project.key });
  const byCreator = useWorkspaces({
    where: inTree,
    groupBy: (w) => w.parentAgent?.key ?? ROOT,
  });
  const byWorkspace = useAgents({ where: visibleAgent, groupBy: (a) => a.workspace.key });
  const byParent = useAgents({ where: visibleAgent, groupBy: (a) => a.parentAgent?.key ?? ROOT });
  // Every project, empty ones included: a project whose sessions are all archived keeps its block.
  const projects = useProjects({
    where: (pr) => pr.rootPath !== chatDir,
    orderBy: ["displayName", "asc"],
  });

  const { tree, workspaceRefs, agentRefs, agentWorkspace } = useMemo(() => {
    const project = index(byProject);
    const creator = index(byCreator);
    const workspace = index(byWorkspace);
    const parent = index(byParent);
    const agentWorkspace = new Map<string, string>();
    for (const [agent, ws] of workspace.owner) if (ws) agentWorkspace.set(agent, ws);
    const workspaceProject = new Map<string, string>();
    for (const [ws, pr] of project.owner) if (pr) workspaceProject.set(ws, pr);
    return {
      tree: buildTree({
        workspaces: workspaceOrder.map((r) => r.key),
        agents: agentOrder.map((r) => r.key),
        workspaceProject,
        workspaceParentAgent: creator.owner,
        agentWorkspace,
        agentParent: parent.owner,
      }),
      workspaceRefs: project.refs,
      agentRefs: workspace.refs,
      agentWorkspace,
    };
  }, [workspaceOrder, agentOrder, byProject, byCreator, byWorkspace, byParent]);

  const projectRefs = useMemo(() => new Map(projects.map((r) => [r.key, r])), [projects]);
  // The saved order names projects by root folder, which outlives the project's id.
  const byRoot = useProjects({ where: (pr) => pr.rootPath !== chatDir, groupBy: (pr) => pr.rootPath });
  const projectRoot = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of byRoot) for (const ref of group.items) map.set(ref.key, group.key);
    return map;
  }, [byRoot]);
  const order = useProjectOrder();
  const rootOf = useCallback((key: string) => projectRoot.get(key) ?? key, [projectRoot]);

  // Projects with sessions in tree order (most recent work first), then empty ones by name.
  const blocks = useMemo(() => {
    const all: { projectKey: string; roots: readonly TreeNode[] }[] = [...tree];
    const inTree = new Set(tree.map((b) => b.projectKey));
    for (const ref of projects) if (!inTree.has(ref.key)) all.push({ projectKey: ref.key, roots: [] });
    const shown = all.filter((b) => projectRefs.has(b.projectKey));
    // A hand-set order, when there is one, wins over recent work.
    return applyOrder(shown, order.saved, (b) => rootOf(b.projectKey));
  }, [tree, projects, projectRefs, order.saved, rootOf]);

  const [reordering, setReordering] = useState(false);
  const projectIndex = useMemo(() => new Map(blocks.map((b, i) => [b.projectKey, i])), [blocks]);
  const moveProject = useCallback(
    (key: string, delta: -1 | 1) => {
      const shown = blocks.map((b) => rootOf(b.projectKey));
      order.save(move(shown, order.saved, rootOf(key), delta));
    },
    [blocks, order, rootOf],
  );

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const p = useMemo(() => palette(view.theme.colors), [view.theme]);
  const ctx: Ctx = {
    view,
    p,
    compact: view.layout.compact,
    workspaceRefs,
    projectRefs,
    agentRefs,
    agentWorkspace,
    collapsed,
    toggle,
    reordering,
    startReorder: () => setReordering(true),
    moveProject,
    projectIndex,
  };

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 4, paddingBottom: 12 }}>
      {reordering ? (
        <ReorderBar
          p={p}
          canReset={order.saved.length > 0}
          onReset={() => order.save([])}
          onDone={() => setReordering(false)}
        />
      ) : null}
      {blocks.map((project) => (
        <ProjectBlock key={project.projectKey} project={project} ctx={ctx} />
      ))}
    </ScrollView>
    <ChatSection view={view} p={p} chatDir={chatDir} />
    </View>
  );
}

/** A project: its header, then its rows on the indented rail; an empty project offers a new chat. */
function ProjectBlock({ project, ctx }: { project: { projectKey: string; roots: readonly TreeNode[] }; ctx: Ctx }) {
  const ref = ctx.projectRefs.get(project.projectKey);
  // While reordering only the headers show, so the whole list fits and moves read clearly.
  const open = !ctx.reordering && !ctx.collapsed.has(project.projectKey);
  const { p } = ctx;
  const empty = project.roots.length === 0;
  if (!ref) return null;
  return (
    <View style={{ paddingBottom: open ? PROJECT.blockGap : 2 }}>
      <ProjectRow reference={ref} open={open} ctx={ctx} />
      {open ? (
        // The project's line leaves its chevron and runs down to the first row.
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: CONNECT.x0 - 0.5,
            // From just under the chevron (centred in the header) to the first row's top.
            top: ROW.minHeight / 2 + 9,
            height: ROW.minHeight / 2 - 9 + PROJECT.gapBelow + 2,
            width: 1,
            backgroundColor: p.guide,
          }}
        />
      ) : null}
      {open && empty ? (
        <TrailContext.Provider value={{ continues: [], last: true }}>
          <StartChatRow reference={ref} ctx={ctx} />
        </TrailContext.Provider>
      ) : null}
      {open
        ? project.roots.map((node, i) => (
            <Node
              key={node.key}
              node={node}
              depth={0}
              place={null}
              trail={{ continues: [], last: i === project.roots.length - 1 }}
              ctx={ctx}
            />
          ))
        : null}
    </View>
  );
}

/** The one row of a project with no sessions: opens Paseo's new workspace screen for it. */
function StartChatRow({ reference, ctx }: { reference: ProjectRef; ctx: Ctx }) {
  const { t } = useTranslation(sidebarText);
  const { p } = ctx;
  return (
    <Row depth={0} active={false} label={t("startChat")} onPress={() => ctx.view.navigation.openProject(reference)} ctx={ctx}>
      {(hovered) => (
        <>
          <Glyph name="SquarePen" ctx={ctx} />
          <Text numberOfLines={1} style={{ ...titleStyle(ctx, hovered), color: hovered ? p.foreground : p.muted }}>
            {t("startChat")}
          </Text>
        </>
      )}
    </Row>
  );
}

/** `place`: the workspace the parent row lives in, so a row names its own only when it differs. */
function Node({
  node,
  depth,
  place,
  trail,
  ctx,
}: {
  node: TreeNode;
  depth: number;
  place: string | null;
  trail: Trail;
  ctx: Ctx;
}) {
  const open = !ctx.collapsed.has(node.key);
  const here = node.kind === "workspace" ? node.key : (ctx.agentWorkspace.get(node.key) ?? place);
  const childContinues = [...trail.continues, !trail.last];
  return (
    <>
      <TrailContext.Provider value={trail}>
        {node.kind === "workspace" ? (
          <WorkspaceRow node={node} depth={depth} open={open} ctx={ctx} />
        ) : (
          <AgentRow node={node} depth={depth} open={open} away={here !== place ? here : null} ctx={ctx} />
        )}
      </TrailContext.Provider>
      {open
        ? node.children.map((child, i) => (
            <Node
              key={child.key}
              node={child}
              depth={depth + 1}
              place={here}
              trail={{ continues: childContinues, last: i === node.children.length - 1 }}
              ctx={ctx}
            />
          ))
        : null}
    </>
  );
}

// ── Row chrome ─────────────────────────────────────────────────────────

/** Tree connectors: ancestor lines that continue past this row, then this row's elbow. */
function Connectors({ ctx }: { ctx: Ctx }) {
  const { continues, last } = useContext(TrailContext);
  const color = ctx.p.guide;
  const own = continues.length;
  const x = (column: number) => connectorX(column) - 0.5;
  // The elbow reaches to just short of the row's leading slot.
  const tick = slotX(own) - connectorX(own) - 2;
  return (
    <>
      {continues.map((on, column) =>
        on ? (
          <View
            key={column}
            pointerEvents="none"
            style={{ position: "absolute", left: x(column), top: -2, bottom: -2, width: 1, backgroundColor: color }}
          />
        ) : null,
      )}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: x(own),
          top: -2,
          width: 1,
          backgroundColor: color,
          ...(last ? { height: CONNECT.elbowY + 2.5 } : { bottom: -2 }),
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: x(own),
          top: CONNECT.elbowY - 0.5,
          width: tick,
          height: 1,
          backgroundColor: color,
        }}
      />
    </>
  );
}

function Row({
  depth,
  active,
  label,
  onPress,
  onLongPress,
  ctx,
  children,
}: {
  depth: number;
  active: boolean;
  label: string;
  onPress(): void;
  onLongPress?: () => void;
  ctx: Ctx;
  children: (hovered: boolean) => ReactNode;
}) {
  // pointerenter/leave ignore moves between the row and the controls inside it, so the row
  // stays hovered while the pointer is on its archive button or chevron and back again.
  const [hovered, setHovered] = useState(false);
  const { p } = ctx;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // Indent is row padding, so hover and selection still span the full width.
      style={({ pressed }) => ({
        minHeight: ROW.minHeight,
        paddingVertical: ROW.paddingVertical,
        paddingLeft: slotX(depth),
        paddingRight: 12,
        borderRadius: 8,
        marginBottom: ROW.gap,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        backgroundColor: active ? p.selected : pressed ? p.pressed : hovered ? p.hover : "transparent",
      })}
    >
      <Connectors ctx={ctx} />
      {children(hovered)}
    </Pressable>
  );
}

/** The leading slot shows status; hovering a row that has children swaps in its chevron. */
function Leading({
  node,
  mark,
  open,
  hovered,
  ctx,
}: {
  node: TreeNode;
  mark: ReactNode;
  open: boolean;
  hovered: boolean;
  ctx: Ctx;
}) {
  if (!ctx.compact && node.children.length > 0 && (hovered || !open)) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Collapse" : "Expand"}
        hitSlop={6}
        onPress={() => ctx.toggle(node.key)}
        style={{ width: 16, height: TITLE_LINE, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={ctx.p.muted} />
      </Pressable>
    );
  }
  return <>{mark}</>;
}

/** Compact layouts have no hover, so rows with children keep a trailing toggle. */
function CompactToggle({ node, open, ctx }: { node: TreeNode; open: boolean; ctx: Ctx }) {
  if (!ctx.compact || node.children.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? "Collapse" : "Expand"}
      hitSlop={8}
      onPress={() => ctx.toggle(node.key)}
      style={{ height: TITLE_LINE, justifyContent: "center" }}
    >
      <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={ctx.p.muted} />
    </Pressable>
  );
}

/** Agent keys under a node, for the "n running" note. */
function descendantAgents(node: TreeNode, out = new Set<string>()): Set<string> {
  for (const child of node.children) {
    if (child.kind === "agent") out.add(child.key);
    else if (child.agentKey) out.add(child.agentKey);
    descendantAgents(child, out);
  }
  return out;
}

function countDescendants(node: TreeNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

function useRunningBelow(node: TreeNode) {
  const keys = useMemo(() => descendantAgents(node), [node]);
  return useAgents({
    where: (a) => keys.has(a.ref.key) && (a.status === "running" || a.status === "initializing"),
  }).length;
}

/**
 * The most urgent state among the agents a folded row hides, so a collapsed row still says
 * that something below it is running or waiting. One query per urgent state, in a fixed order.
 */
function useUrgentBelow(node: TreeNode, folded: boolean): Bucket {
  const keys = useMemo(() => (folded ? descendantAgents(node) : new Set<string>()), [node, folded]);
  const counts = URGENT.map(
    (level) =>
      // eslint-disable-next-line react-hooks/rules-of-hooks -- URGENT is a constant list
      useAgents({ where: (a) => keys.has(a.ref.key) && !a.background && agentBucket(a) === level }).length,
  );
  return URGENT[counts.findIndex((n) => n > 0)] ?? "done";
}

/** The same for a folded project: Paseo's own state of each of its workspaces. */
function useUrgentInProject(reference: ProjectRef, folded: boolean): Bucket {
  const counts = URGENT.map(
    (level) =>
      // eslint-disable-next-line react-hooks/rules-of-hooks -- URGENT is a constant list
      useWorkspaces({
        where: (w) =>
          folded && w.project.key === reference.key && !w.background && !w.archivingAt && w.indicator === level,
      }).length,
  );
  return URGENT[counts.findIndex((n) => n > 0)] ?? "done";
}

function titleStyle(ctx: Ctx, emphasized: boolean) {
  return {
    flex: 1,
    minWidth: 0,
    color: ctx.p.foreground,
    fontSize: 14,
    lineHeight: TITLE_LINE,
    opacity: emphasized ? 1 : 0.76,
  } as const;
}

// ── Rows ───────────────────────────────────────────────────────────────

function WorkspaceRow({
  node,
  depth,
  open,
  ctx,
}: {
  node: Extract<TreeNode, { kind: "workspace" }>;
  depth: number;
  open: boolean;
  ctx: Ctx;
}) {
  const reference = ctx.workspaceRefs.get(node.key);
  const ws = useWorkspace(reference ?? node.key, (w) => ({
    label: w.title ?? w.name,
    title: w.title,
    folder: w.name,
    branch: w.branch,
    indicator: w.indicator,
    kind: w.kind,
    additions: w.diffStat?.additions ?? null,
    deletions: w.diffStat?.deletions ?? null,
  }));
  const running = useRunningBelow(node);
  const below = useUrgentBelow(node, !open);
  // The row stands for the workspace's root agent when it has exactly one. Opening the
  // workspace would restore whichever tab was focused last, often a sub-agent's chat.
  // With several root agents the row opens the most recently active one: opening the workspace
  // itself only restores its last tab, which may be nothing at all.
  const rootKeys = useMemo(
    () => new Set(node.agentKey ? [] : node.children.filter((c) => c.kind === "agent").map((c) => c.key)),
    [node],
  );
  const recentRoots = useAgents({
    where: (a) => rootKeys.has(a.ref.key),
    orderBy: ["lastActivityAt", "desc"],
  });
  const rootAgent = node.agentKey ? ctx.agentRefs.get(node.agentKey) : recentRoots[0];
  const activeAgent = ctx.view.active.agent?.key ?? null;
  const inWorkspace = ctx.view.active.workspace?.key === node.key;
  const active = rootAgent
    ? activeAgent
      ? activeAgent === rootAgent.key
      : inWorkspace
    : inWorkspace && !activeAgent;
  const rootProvider = useAgent(rootAgent ?? node.key, (a) => a.provider);
  const target: ArchiveTarget | null = useMemo(
    () =>
      reference && ws
        ? {
            kind: "workspace",
            ref: reference,
            rootAgent: rootAgent ?? null,
            worktree: ws.kind === "worktree",
            hasChanges: (ws.additions ?? 0) + (ws.deletions ?? 0) > 0,
          }
        : null,
    [reference, rootAgent, ws?.kind, ws?.additions, ws?.deletions],
  );
  const archive = useArchive(target);
  const rename = useRename(reference ?? null, ws?.title ?? null);
  const open_ = () =>
    rootAgent
      ? ctx.view.navigation.openAgent(rootAgent)
      : reference && ctx.view.navigation.openWorkspace(reference);
  if (!ws || !reference) return null;
  const { p } = ctx;
  const hidden = open ? 0 : countDescendants(node);
  // Only finished work: nothing in this row or below it is running.
  const canArchive = ws.indicator !== "running" && running === 0;
  const modal = target ? (
    <ArchiveModal
      state={archive}
      title={ws.label}
      warning={archiveWarning(target, countDescendants(node))}
      danger={target.kind === "workspace" && target.worktree}
      p={p}
    />
  ) : null;
  const renameModal = <RenameModal state={rename} folder={ws.folder} p={p} />;
  // A branch only says something when the row works in its own worktree; rows on the project's
  // checkout would all repeat the same branch.
  const branch = ws.kind === "worktree" ? ws.branch : null;
  const meta: ReactNode[] = [];
  if (running > 0) meta.push(<Text key="run" style={{ color: p.running }}>하위 {running}개 실행 중</Text>);
  if (hidden > 0) meta.push(<Text key="hid">{hidden}개 접힘</Text>);
  return (
    <>
    {modal}
    {renameModal}
    <Row
      depth={depth}
      active={active}
      label={`Open ${ws.label}`}
      onPress={open_}
      onLongPress={canArchive ? archive.begin : undefined}
      ctx={ctx}
    >
      {(hovered) => (
        <>
          <Leading
            node={node}
            mark={
              rootAgent && rootProvider ? (
                <ProviderMark provider={rootProvider} p={ctx.p} />
              ) : (
                <Glyph name="FolderGit2" ctx={ctx} />
              )
            }
            open={open}
            hovered={hovered}
            ctx={ctx}
          />
          <View style={{ flex: 1, minWidth: 0, gap: ROW.lineGap }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Text numberOfLines={1} style={titleStyle(ctx, hovered || active)}>
                {ws.label}
              </Text>
              {ws.additions !== null && ws.deletions !== null ? (
                <Text style={{ fontSize: 12, lineHeight: TITLE_LINE, fontVariant: ["tabular-nums"] }}>
                  <Text style={{ color: p.success }}>+{ws.additions}</Text>
                  <Text style={{ color: p.danger }}> -{ws.deletions}</Text>
                </Text>
              ) : null}
              {hovered && !archive.confirming && !rename.editing ? (
                <View style={{ flexDirection: "row", gap: 2 }}>
                  <RenameButton onPress={rename.begin} p={p} />
                  {canArchive ? <ArchiveButton onPress={archive.begin} p={p} /> : null}
                </View>
              ) : (
                <StatusMark bucket={mostUrgent(ws.indicator, below)} p={p} />
              )}
              <CompactToggle node={node} open={open} ctx={ctx} />
            </View>
            {branch || meta.length > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {branch ? <Icon name="GitBranch" size={12} color={p.muted} /> : null}
                <Text numberOfLines={1} style={{ flexShrink: 1, color: p.muted, fontSize: 12 }}>
                  {branch ?? ""}
                  {meta.map((part, i) => (
                    <Text key={i}>
                      {branch || i > 0 ? " · " : ""}
                      {part}
                    </Text>
                  ))}
                </Text>
              </View>
            ) : null}
          </View>
        </>
      )}
    </Row>
    </>
  );
}

function AgentRow({
  node,
  depth,
  open,
  away,
  ctx,
}: {
  node: Extract<TreeNode, { kind: "agent" }>;
  depth: number;
  open: boolean;
  /** The agent's workspace when it differs from its parent's; shown under the title. */
  away: string | null;
  ctx: Ctx;
}) {
  const reference = ctx.agentRefs.get(node.key);
  const agent = useAgent(reference ?? node.key, (a) => ({
    label: a.title ?? a.provider,
    provider: a.provider,
    status: a.status,
    requiresAttention: a.requiresAttention,
    attentionReason: a.attentionReason,
  }));
  const active = ctx.view.active.agent?.key === node.key;
  const runningBelow = useRunningBelow(node);
  const below = useUrgentBelow(node, !open);
  const target: ArchiveTarget | null = useMemo(
    () => (reference ? { kind: "agent", ref: reference } : null),
    [reference],
  );
  const archive = useArchive(target);
  if (!agent || !reference) return null;
  const { p } = ctx;
  const hidden = open ? 0 : countDescendants(node);
  const canArchive = agentBucket(agent) !== "running" && runningBelow === 0;
  const modal = target ? (
    <ArchiveModal
      state={archive}
      title={agent.label}
      warning={archiveWarning(target, countDescendants(node))}
      danger={false}
      p={p}
    />
  ) : null;
  return (
    <>
    {modal}
    <Row
      depth={depth}
      active={active}
      label={`Open agent ${agent.label}`}
      onPress={() => ctx.view.navigation.openAgent(reference)}
      onLongPress={canArchive ? archive.begin : undefined}
      ctx={ctx}
    >
      {(hovered) => (
        <>
          <Leading
            node={node}
            mark={<ProviderMark provider={agent.provider} p={ctx.p} />}
            open={open}
            hovered={hovered}
            ctx={ctx}
          />
          <View style={{ flex: 1, minWidth: 0, gap: ROW.lineGap }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Text numberOfLines={1} style={titleStyle(ctx, hovered || active)}>
                {agent.label}
              </Text>
              {away && node.ownsWorkspace ? <DiffStat workspaceKey={away} ctx={ctx} /> : null}
              <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12, lineHeight: TITLE_LINE }}>
                {hidden > 0 ? `${hidden}개 접힘` : ""}
              </Text>
              {hovered && canArchive && !archive.confirming ? (
                <ArchiveButton onPress={archive.begin} p={p} />
              ) : (
                <StatusMark bucket={mostUrgent(agentBucket(agent), below)} p={p} />
              )}
              <CompactToggle node={node} open={open} ctx={ctx} />
            </View>

          </View>
        </>
      )}
    </Row>
    </>
  );
}

function Glyph({ name, ctx }: { name: string; ctx: Ctx }) {
  return (
    <View style={{ width: 16, height: TITLE_LINE, alignItems: "center", justifyContent: "center" }}>
      <Icon name={name} size={14} color={ctx.p.muted} />
    </View>
  );
}

function DiffStat({ workspaceKey, ctx }: { workspaceKey: string; ctx: Ctx }) {
  const reference = ctx.workspaceRefs.get(workspaceKey);
  const diff = useWorkspace(reference ?? workspaceKey, (w) => ({
    additions: w.diffStat?.additions ?? null,
    deletions: w.diffStat?.deletions ?? null,
  }));
  if (!diff || diff.additions === null || diff.deletions === null) return null;
  return (
    <Text style={{ fontSize: 12, lineHeight: TITLE_LINE, fontVariant: ["tabular-nums"] }}>
      <Text style={{ color: ctx.p.success }}>+{diff.additions}</Text>
      <Text style={{ color: ctx.p.danger }}> -{diff.deletions}</Text>
    </Text>
  );
}

/** Project header: a chevron where Paseo draws the project tile, then the muted name. The
 *  project's connector line starts under the chevron. */
function ProjectRow({
  reference,
  open,
  ctx,
}: {
  reference: ProjectRef;
  open: boolean;
  ctx: Ctx;
}) {
  const { t } = useTranslation(sidebarText);
  const name = useProject(reference, (pr) => pr.displayName);
  const [hovered, setHovered] = useState(false);
  const remove = useRemoveProject(reference);
  const [menu, setMenu] = useState(false);
  const index = ctx.projectIndex.get(reference.key) ?? 0;
  const last = ctx.projectIndex.size - 1;
  // Folded, the header stands in for its rows: it shows the most urgent state among them.
  const urgent = useUrgentInProject(reference, !open);
  const { p } = ctx;
  if (!name) return null;
  return (
    <>
    <RemoveProjectModal reference={reference} name={name} state={remove} p={p} />
    <ProjectMenu
      name={name}
      open={menu}
      onClose={() => setMenu(false)}
      onReorder={ctx.startReorder}
      onRemove={remove.begin}
      p={p}
    />
    {/* Hover is tracked on the whole header so moving onto its buttons keeps them shown. */}
    <View
      style={{ marginBottom: PROJECT.gapBelow }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={name}
        onPress={() => (ctx.reordering ? undefined : ctx.toggle(reference.key))}
        // A long press reorders projects. Compact layouts have no hover, so there it opens a menu
        // that also holds removing the project.
        onLongPress={ctx.reordering ? undefined : ctx.compact ? () => setMenu(true) : ctx.startReorder}
        style={({ pressed }) => ({
          minHeight: ROW.minHeight,
          paddingVertical: ROW.paddingVertical,
          paddingLeft: 8,
          paddingRight: 64,
          borderRadius: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: pressed ? p.pressed : hovered ? p.hover : "transparent",
        })}
      >
        <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
          <Icon
            name={ctx.reordering ? "GripVertical" : open ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={hovered ? p.foreground : p.muted}
          />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, color: p.muted, fontSize: 14 }}>
          {name}
        </Text>
      </Pressable>
      {ctx.reordering ? (
        <View style={{ position: "absolute", right: 6, top: 6, flexDirection: "row", gap: 2 }}>
          <MoveButton up disabled={index === 0} onPress={() => ctx.moveProject(reference.key, -1)} p={p} />
          <MoveButton up={false} disabled={index >= last} onPress={() => ctx.moveProject(reference.key, 1)} p={p} />
        </View>
      ) : (
      <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`New workspace in ${name}`}
        hitSlop={6}
        onPress={() => ctx.view.navigation.openProject(reference)}
        style={({ pressed }) => ({
          position: "absolute",
          right: 6,
          top: 6,
          width: 24,
          height: 24,
          borderRadius: 6,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? p.pressed : "transparent",
        })}
      >
        <Icon name="Plus" size={14} color={p.muted} />
      </Pressable>
      {!open && !ctx.reordering && urgent !== "done" && !(hovered && !remove.confirming) ? (
        // Same slot as the remove button, which takes it over on hover, as rows do with archive.
        <View pointerEvents="none" style={{ position: "absolute", right: 38, top: ROW.paddingVertical }}>
          <StatusMark bucket={urgent} p={p} />
        </View>
      ) : null}
      {hovered && !remove.confirming ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("remove")}
          hitSlop={6}
          onPress={remove.begin}
          style={({ pressed }) => ({
            position: "absolute",
            right: 34,
            top: 6,
            width: 24,
            height: 24,
            borderRadius: 6,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? p.pressed : "transparent",
          })}
        >
          <Icon name="FolderX" size={14} color={p.muted} />
        </Pressable>
      ) : null}
      </>
      )}
    </View>
    </>
  );
}
