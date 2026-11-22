import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";
import {
  useAgent,
  useAgents,
  useHosts,
  useProject,
  useProjects,
  useRpc,
  useTranslation,
  useWorkspace,
  useWorkspaces,
  type AgentRef,
  type PluginSidebarViewProps,
  type ProjectRef,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import type { PluginAgentSnapshot, PluginWorkspaceSnapshot } from "@getpaseo/plugin";
import { checkoutKey, worktreeKey, type WorktreeInfo } from "../shared/project-rpc";
import { branchesBelow, buildTree, checkoutLanes, workspacesEmptiedBy, type Lane, type TreeNode } from "../shared/tree";
import { CONNECT, PROJECT, ROW, TITLE_LINE, connectorX, slotX, palette, worktreeBadge, worktreeColor, type Palette } from "./look";
import { ProviderMark, StatusMark, URGENT, WorktreeBadge, WorktreeBar, WorktreeMark, agentBucket, isAgentTurnActive, mostUrgent } from "./marks";
import type { Bucket } from "./look";
import { ChatSection, useChatDir } from "./chat";
import {
  ArchiveButton,
  ArchiveModal,
  useArchive,
  type ArchiveTarget,
  type EmptiedWorkspaces,
} from "./archive";
import { RenameButton, RenameModal, renameFallback, useRename } from "./rename";
import { HiddenProjects, HideProjectModal, useHideProject } from "./hide-project";
import { MoveButton, PanesButton, ProjectMenu, ReorderBar, SessionMenu, isPaneDrag, outsideSidebar, useProjectOrder } from "./project-order";
import {
  beginSessionDrag,
  endSessionDrag,
  hasDropZones,
  moveSessionDrag,
  openInPanes,
  type SessionDragPayload,
} from "./panes/drop-bus";
import {
  applyOrder,
  dropIndex,
  move,
  nodesFor,
  orderTree,
  placeAt,
  projectOrderKey,
  rootsGroup,
  sectionByHost,
  upgradeOrder,
  type BlockLayout,
} from "../shared/project-order";
import { sidebarText } from "./sidebar-strings";
import { usePendingPermissions } from "./pending-permissions";
import { useWorktrees } from "./worktrees";
import { useCollapsed } from "./collapsed-store";
import { hiddenKeySet, isHiddenProject, reorderSection, sectionSaved, visibleProjectBlocks } from "./sidebar-visibility";
import { workspaceCustomTitle, workspaceRowLabel } from "./workspace-naming";

const ROOT = "__root__";

/** Where a row sits in the tree: per ancestor column, whether its line continues; and whether
 *  the row is its parent's last child (its elbow ends the line). */
interface Trail {
  readonly continues: readonly boolean[];
  readonly last: boolean;
}
const TrailContext = createContext<Trail>({ continues: [], last: true });

/** The group projects are dragged in; sessions are dragged among their parent's children. */
const PROJECTS = "__projects__";
/** The drag group of the projects in one host's section; all projects share one with a single host. */
const projectsGroup = (hostId: string | null) => (hostId === null ? PROJECTS : `${PROJECTS}\u0000${hostId}`);
const isProjectsGroup = (group: string) => group === PROJECTS || group.startsWith(`${PROJECTS}\u0000`);
interface DragTarget {
  readonly group: string;
  readonly key: string;
}
/** The draggable item a row stands for; null for rows that do not move (a new chat row). */
const DragTargetContext = createContext<DragTarget | null>(null);
interface Drag extends DragTarget {
  readonly dy: number;
}
/** Where the dragged item would land: on this item's top or bottom edge. */
interface DropMark extends DragTarget {
  readonly edge: "top" | "bottom";
}

/** A branch among a row's nested sessions, ready to draw. */
interface BranchBelow {
  readonly label: string;
  /** The worktree's folder for a linked worktree (its color); null for the main checkout. */
  readonly worktreePath: string | null;
  readonly count: number;
}

interface Ctx {
  view: PluginSidebarViewProps;
  /** The host's name, when more than one host is configured (the sidebar is then split by host); else null. */
  hostLabel(hostId: string): string | null;
  /**
   * How a row's checkout (worktree folder and branch) meets the rows drawn right above and below it.
   * Consecutive rows in one checkout form a run: the badge shows on its first row, the color bar runs
   * unbroken to its last. Rows with no badge (or not drawn) have no lane.
   */
  lane(nodeKey: string): Lane | null;
  /**
   * The branches a row's nested sessions work on, most used first, when any differs from the row's
   * own; null otherwise. Drawn under a collapsed row, or one whose nested sessions span several
   * branches (see `BranchesBelow`), so a parent tells them apart without a level of grouping rows.
   */
  branchesBelow(nodeKey: string): readonly BranchBelow[] | null;
  /** The drag group a project header moves in: its host's section, or all projects with one host. */
  projectsGroup(projectKey: string): string;
  p: Palette;
  compact: boolean;
  workspaceRefs: ReadonlyMap<string, WorkspaceRef>;
  projectRefs: ReadonlyMap<string, ProjectRef>;
  agentRefs: ReadonlyMap<string, AgentRef>;
  hasPendingPermission(ref: AgentRef): boolean;
  agentWorkspace: ReadonlyMap<string, string>;
  /** The git worktree of each session folder on the plugin's own host, keyed by `worktreeKey(hostId, cwd)`;
   *  folders outside git and other hosts' folders are absent. */
  worktrees: ReadonlyMap<string, Extract<WorktreeInfo, { kind: "git" }>>;
  collapsed: ReadonlySet<string>;
  toggle(key: string): void;
  /** True while project headers show up/down buttons instead of their rows. */
  reordering: boolean;
  startReorder(): void;
  /** Moves a project one place up (-1) or down (+1). */
  moveProject(key: string, delta: -1 | 1): void;
  /** Each project's place among the projects it can move between (its host's section). */
  projectIndex: ReadonlyMap<string, { index: number; last: number }>;
  /** The item being dragged on desktop and how far it moved; null when none is. */
  drag: Drag | null;
  dropMark: DropMark | null;
  /** `dy`: how far the pointer moved since the press; `pageY`: where it is now on the page. */
  dragMove(target: DragTarget, dy: number, pageY: number): void;
  /** Drops the dragged item where it is, or cancels the drag when `dy` is null. */
  dragEnd(target: DragTarget, dy: number | null): void;
  /** Keeps the item's view (its whole block) or its head (its own row) for measuring. */
  register(target: DragTarget, part: "item" | "head", node: View | null): void;
  /** Records the item a press started on, the one a drag would move. */
  pressed(target: DragTarget): void;
  /**
   * Wraps a press handler so it does nothing right after a drag: on the web the pointer's release
   * still ends in a click, which would fold or open whatever the drag started on.
   */
  guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
  /** The group a project's top rows are ordered in. */
  rootGroup(projectKey: string): string;
  /** The session being dragged toward the panes screen; null when none is. */
  paneDrag: DragTarget | null;
  /** A session row says which session it stands for, so dragging it out can carry it. */
  setPayload(key: string, payload: SessionDragPayload | null): void;
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
  const { t } = useTranslation(sidebarText);
  // The free chat folder's workspaces live in the pinned section below, not in the tree.
  const chatDir = useChatDir();
  const pendingPermissions = usePendingPermissions();
  const hasPendingPermission = useCallback(
    (ref: AgentRef) => pendingPermissions.get(ref.hostId)?.has(ref.id) ?? false,
    [pendingPermissions],
  );
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

  const worktrees = useWorktrees();
  const agentsByCwd = useAgents({ where: visibleAgent, groupBy: (a) => a.cwd });
  const workspacesByDir = useWorkspaces({ where: inTree, groupBy: (w) => w.directory });
  const rowWorktrees = useMemo(() => {
    const map = new Map<string, string>();
    const add = (groups: readonly { key: string; items: readonly { key: string; hostId: string }[] }[]) => {
      for (const group of groups) {
        for (const ref of group.items) {
          const info = worktrees.get(worktreeKey(ref.hostId, group.key));
          if (info && worktreeBadge(info)) map.set(ref.key, checkoutKey(ref.hostId, info));
        }
      }
    };
    add(agentsByCwd);
    add(workspacesByDir);
    return map;
  }, [agentsByCwd, workspacesByDir, worktrees]);
  const rowWorktree = useCallback((nodeKey: string) => rowWorktrees.get(nodeKey) ?? null, [rowWorktrees]);
  // Every row's branch, badge or not (the main checkout on its default branch counts too), for the
  // nested-branch summary. Keyed like the badge's checkout, so one worktree and branch is one entry.
  const rowBranches = useMemo(() => {
    const map = new Map<string, { key: string; label: string; worktreePath: string | null }>();
    const add = (groups: readonly { key: string; items: readonly { key: string; hostId: string }[] }[]) => {
      for (const group of groups) {
        for (const ref of group.items) {
          const info = worktrees.get(worktreeKey(ref.hostId, group.key));
          if (!info) continue;
          const label = info.detached ? (info.head ?? "HEAD") : (info.branch ?? info.head ?? "HEAD");
          map.set(ref.key, { key: checkoutKey(ref.hostId, info), label, worktreePath: info.isMain ? null : info.worktreePath });
        }
      }
    };
    add(agentsByCwd);
    add(workspacesByDir);
    return map;
  }, [agentsByCwd, workspacesByDir, worktrees]);
  const projectRefs = useMemo(() => new Map(projects.map((r) => [r.key, r])), [projects]);
  // The saved order names projects by host and root folder, which outlive the project's id; the
  // same folder on two hosts is two projects with places of their own.
  const byRoot = useProjects({ where: (pr) => pr.rootPath !== chatDir, groupBy: (pr) => pr.rootPath });
  const projectRoot = useMemo(() => {
    const map = new Map<string, { orderKey: string; root: string }>();
    for (const group of byRoot) {
      for (const ref of group.items) map.set(ref.key, { orderKey: projectOrderKey(ref.hostId, group.key), root: group.key });
    }
    return map;
  }, [byRoot]);
  const order = useProjectOrder();
  const rootOf = useCallback((key: string) => projectRoot.get(key)?.orderKey ?? key, [projectRoot]);
  // An order saved before hosts were told apart names root folders: each such entry stands for
  // that folder's projects on every host until the order is saved again.
  const savedOrder = useMemo(
    () => upgradeOrder(order.saved, [...projectRoot.values()].map((v) => ({ key: v.orderKey, root: v.root }))),
    [order.saved, projectRoot],
  );
  const rootGroup = useCallback((projectKey: string) => rootsGroup(rootOf(projectKey)), [rootOf]);
  const nodeOrders = useCallback(
    (projectKey: string) =>
      nodesFor(order.nodes, rootGroup(projectKey), rootsGroup(projectRoot.get(projectKey)?.root ?? projectKey)),
    [order.nodes, rootGroup, projectRoot],
  );

  // With one host every project is on it, so it goes unsaid. With more, the list is split into a
  // section per host, in the app's host order, so every session sits under its host's name.
  const hosts = useHosts();
  const hostSections = hosts.length > 1;
  const hostLabel = useCallback(
    (hostId: string) => (hostSections ? (hosts.find((h) => h.serverId === hostId)?.label || hostId) : null),
    [hosts, hostSections],
  );
  const hostOf = useCallback(
    (projectKey: string) => (hostSections ? (projectRefs.get(projectKey)?.hostId ?? null) : null),
    [hostSections, projectRefs],
  );
  const hiddenKeys = useMemo(() => hiddenKeySet(order.hidden), [order.hidden]);
  // Order keys of hidden projects: their place in the saved order survives reordering the rest.
  const hiddenRoots = useMemo(
    () => new Set(projects.filter((r) => isHiddenProject(r, hiddenKeys)).map((r) => rootOf(r.key))),
    [projects, hiddenKeys, rootOf],
  );

  // Projects with sessions in tree order (most recent work first), then empty ones by name.
  const blocks = useMemo(() => {
    const all: { projectKey: string; roots: readonly TreeNode[] }[] = [...tree];
    const inTree = new Set(tree.map((b) => b.projectKey));
    for (const ref of projects) if (!inTree.has(ref.key)) all.push({ projectKey: ref.key, roots: [] });
    // Hidden from this sidebar (project.hide): by host and id, since ids can repeat across hosts.
    const shown = visibleProjectBlocks(all, projectRefs, hiddenKeys);
    // A hand-set order, when there is one, wins over recent work, for projects and the sessions
    // under them at every depth.
    const ordered = applyOrder(shown, savedOrder, (b) => rootOf(b.projectKey)).map((b) => ({
      ...b,
      roots: orderTree(b.roots, rootGroup(b.projectKey), nodeOrders(b.projectKey)),
    }));
    if (!hostSections) return ordered;
    // Hosts in the app's order, a host it no longer lists last; projects keep their order inside.
    return sectionByHost(ordered, (b) => hostOf(b.projectKey), hosts.map((h) => h.serverId));
  }, [tree, projects, projectRefs, hiddenKeys, savedOrder, rootOf, rootGroup, nodeOrders, hostSections, hosts, hostOf]);

  const [reordering, setReordering] = useState(false);
  // A project moves among its own host's projects: a place in another host's section would not show.
  const sectionOf = useCallback(
    (key: string) => blocks.filter((b) => hostOf(b.projectKey) === hostOf(key)),
    [blocks, hostOf],
  );
  const projectIndex = useMemo(() => {
    const map = new Map<string, { index: number; last: number }>();
    for (const b of blocks) {
      const section = sectionOf(b.projectKey);
      map.set(b.projectKey, { index: section.indexOf(b), last: section.length - 1 });
    }
    return map;
  }, [blocks, sectionOf]);
  const moveProject = useCallback(
    (key: string, delta: -1 | 1) => {
      const shown = sectionOf(key).map((b) => rootOf(b.projectKey));
      const host = hostOf(key);
      order.save(reorderSection(savedOrder, move(shown, sectionSaved(savedOrder, host), rootOf(key), delta), host, hiddenRoots));
    },
    [sectionOf, hostOf, order, savedOrder, rootOf, hiddenRoots],
  );
  const projectsGroupOf = useCallback((projectKey: string) => projectsGroup(hostOf(projectKey)), [hostOf]);

  // Desktop drag. The pressed item's siblings are measured when the press begins, on the page, so
  // the measures are fresh (react-native-web reports layout only when a size changes, not when a
  // row moves) and taken before the dragged item starts to move.
  const registry = useRef(new Map<string, Map<string, { item: View | null; head: View | null }>>());
  const measured = useRef<{ group: string; blocks: Map<string, BlockLayout> } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragEndedAt = useRef(0);
  const register = useCallback(({ group, key }: DragTarget, part: "item" | "head", node: View | null) => {
    let byKey = registry.current.get(group);
    if (!byKey) registry.current.set(group, (byKey = new Map()));
    const entry = byKey.get(key) ?? { item: null, head: null };
    entry[part] = node;
    if (entry.item || entry.head) byKey.set(key, entry);
    else byKey.delete(key);
  }, []);
  const measureGroup = useCallback((group: string) => {
    const blocks = new Map<string, BlockLayout>();
    measured.current = { group, blocks };
    for (const [key, { item, head }] of registry.current.get(group) ?? []) {
      item?.measureInWindow((_x, y, _w, height) => {
        const prev = blocks.get(key);
        blocks.set(key, { key, y, height, head: prev?.head });
      });
      head?.measureInWindow((_x, _y, _w, height) => {
        const prev = blocks.get(key);
        blocks.set(key, { key, y: prev?.y ?? 0, height: prev?.height ?? height, head: height });
      });
    }
  }, []);
  const groupBlocks = useCallback(
    (group: string) =>
      measured.current?.group === group
        ? [...measured.current.blocks.values()].filter((b) => b.height > 0).sort((x, y) => x.y - y.y)
        : [],
    [],
  );

  // Auto-scroll: while the pointer rests near the top or bottom edge of the list, the list scrolls,
  // so an item can be dragged past a project or session too long to fit on screen. The dragged
  // item's offset counts the scroll as well as the pointer's move, so it stays under the pointer.
  const scrollRef = useRef<ScrollView>(null);
  /** The scroll view's frame, measured for where its edges are on the page. */
  const frameRef = useRef<View>(null);
  const scroll = useRef({ y: 0, top: 0, height: 0, content: 0 });
  const active = useRef<{ target: DragTarget; dy: number; pageY: number; startScroll: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stopTimer, [stopTimer]);
  const offset = (a: NonNullable<typeof active.current>) => a.dy + scroll.current.y - a.startScroll;
  const tick = useCallback(() => {
    const a = active.current;
    const { y, top, height, content } = scroll.current;
    if (!a || height <= 0) return;
    const edge = Math.min(64, height / 4);
    let step = 0;
    if (a.pageY < top + edge) step = -Math.ceil(((top + edge - a.pageY) / edge) * 18);
    else if (a.pageY > top + height - edge) step = Math.ceil(((a.pageY - (top + height - edge)) / edge) * 18);
    if (step === 0) return;
    const next = Math.max(0, Math.min(Math.max(0, content - height), y + Math.max(-18, Math.min(18, step))));
    if (next === y) return;
    scroll.current.y = next;
    scrollRef.current?.scrollTo({ y: next, animated: false });
    setDrag({ group: a.target.group, key: a.target.key, dy: offset(a) });
  }, []);
  const pressedRef = useRef<DragTarget | null>(null);
  // Pane drag: a session dragged out of the sidebar toward the panes screen. While it lasts the
  // reorder preview is off; the row stays in place, dimmed.
  const payloads = useRef(new Map<string, SessionDragPayload>());
  const setPayload = useCallback((key: string, payload: SessionDragPayload | null) => {
    if (payload) payloads.current.set(key, payload);
    else payloads.current.delete(key);
  }, []);
  const [paneDrag, setPaneDrag] = useState<DragTarget | null>(null);
  const paneMode = useRef(false);
  const frameBox = useRef({ left: 0, right: 0 });
  const measureFrame = useCallback(() => {
    frameRef.current?.measureInWindow((x, _y, w) => {
      frameBox.current = { left: x, right: x + w };
    });
  }, []);
  /** Ends a running pane drag: dropped at the point, or cancelled with null coordinates. */
  const panePayload = useRef<SessionDragPayload | null>(null);
  const endPane = useCallback((at: { x: number; y: number } | null) => {
    if (!paneMode.current) return;
    paneMode.current = false;
    setPaneDrag(null);
    dragEndedAt.current = Date.now();
    const payload = panePayload.current;
    panePayload.current = null;
    endSessionDrag(at?.x ?? null, at?.y ?? null)
      .then((accepted) => {
        // No pane area took it: released outside the sidebar, the panes screen opens with it.
        // Released back inside the sidebar (or cancelled), nothing happens.
        if (!accepted && at && payload && outsideSidebar(at.x, frameBox.current.left, frameBox.current.right)) {
          openInPanes(payload);
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => () => endPane(null), [endPane]);
  const compactRef = useRef(view.layout.compact);
  compactRef.current = view.layout.compact;
  const pressed = useCallback(
    (target: DragTarget) => {
      pressedRef.current = target;
      if (!compactRef.current) measureGroup(target.group);
    },
    [measureGroup],
  );
  const dragMove = useCallback(
    (target: DragTarget, dy: number, pageY: number) => {
      const a = active.current;
      if (!a || a.target.group !== target.group || a.target.key !== target.key) {
        active.current = { target, dy, pageY, startScroll: scroll.current.y };
        frameRef.current?.measureInWindow((_x, top, _w, height) => {
          scroll.current.top = top;
          scroll.current.height = height;
        });
        stopTimer();
        timer.current = setInterval(tick, 16);
      } else {
        a.dy = dy;
        a.pageY = pageY;
      }
      setDrag({ group: target.group, key: target.key, dy: offset(active.current!) });
    },
    [stopTimer, tick],
  );
  /** The index the dragged item would land at among the others; null when it would stay put. */
  const landing = useCallback(
    ({ group, key }: DragTarget, dy: number) => {
      const all = groupBlocks(group);
      const at = dropIndex(all, key, dy);
      if (at < 0 || at === all.findIndex((b) => b.key === key)) return null;
      return { all, at };
    },
    [groupBlocks],
  );
  const dragEnd = useCallback(
    (target: DragTarget, rawDy: number | null) => {
      stopTimer();
      const a = active.current;
      active.current = null;
      setDrag(null);
      dragEndedAt.current = Date.now();
      if (rawDy === null) return;
      const dy = a ? rawDy + scroll.current.y - a.startScroll : rawDy;
      const land = landing(target, dy);
      if (!land) return;
      const shown = land.all.map((b) => b.key);
      if (isProjectsGroup(target.group)) {
        // Within the dragged project's host section; other hosts' places are left as they are.
        const host = hostOf(target.key);
        const next = placeAt(shown.map(rootOf), sectionSaved(savedOrder, host), rootOf(target.key), land.at);
        order.save(reorderSection(savedOrder, next, host, hiddenRoots));
      } else {
        // Only the children shown now: archived sessions do not come back, so they need no place.
        order.saveNodes(target.group, placeAt(shown, [], target.key, land.at));
      }
    },
    [landing, hostOf, order, savedOrder, rootOf, hiddenRoots, stopTimer],
  );
  const dropMark = useMemo((): DropMark | null => {
    if (!drag) return null;
    const land = landing(drag, drag.dy);
    if (!land) return null;
    const others = land.all.filter((b) => b.key !== drag.key);
    if (others.length === 0) return null;
    return land.at < others.length
      ? { group: drag.group, key: others[land.at].key, edge: "top" }
      : { group: drag.group, key: others[others.length - 1].key, edge: "bottom" };
  }, [drag, landing]);
  const guard = useCallback(
    <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (Date.now() - dragEndedAt.current > 400) fn(...args);
      },
    [],
  );

  // The one drag handler, on the list's frame: an ancestor of every row, so react-native-web always
  // asks it, however fast the pointer leaves the pressed row. It moves the item the press began on.
  /** Where the press began on the page. Offsets count from here: PanResponder's own `dy` starts at
   *  the moment the drag is granted, which drops the move that started it (all of it, after a quick
   *  flick), so the item would land short of the pointer. */
  const pressY = useRef(0);
  const lastY = useRef(0);
  const pressX = useRef(0);
  const lastX = useRef(0);
  const latestDrag = useRef({ dragMove, dragEnd, endPane });
  latestDrag.current = { dragMove, dragEnd, endPane };
  /** This gesture pulled a row with no chat (a workspace with no agent yet) toward the panes:
   *  said so once, and the rest of the gesture is dropped instead of reordering on release. */
  const noChatDrag = useRef(false);
  const toast = useToast();
  const noChatText = t("panesNoChat");
  const noChatRef = useRef({ toast, noChatText });
  noChatRef.current = { toast, noChatText };
  /** One step of the gesture: a reorder move, or a pane drag once the pointer leaves the sidebar. */
  const step = (target: DragTarget) => {
    const { dragMove, dragEnd, endPane } = latestDrag.current;
    const payload = isProjectsGroup(target.group) ? undefined : payloads.current.get(target.key);
    if (noChatDrag.current) return;
    if (!payload && !isProjectsGroup(target.group) && isPaneDrag({
      x: lastX.current,
      startX: pressX.current,
      left: frameBox.current.left,
      right: frameBox.current.right,
      active: false,
      dropZones: hasDropZones(),
    })) {
      // Nothing to open: put the row back and say why, instead of a drop that silently does nothing.
      noChatDrag.current = true;
      dragEnd(target, null);
      noChatRef.current.toast.show(noChatRef.current.noChatText);
      return;
    }
    if (payload) {
      const toward = isPaneDrag({
        x: lastX.current,
        startX: pressX.current,
        left: frameBox.current.left,
        right: frameBox.current.right,
        active: paneMode.current,
        dropZones: hasDropZones(),
      });
      if (toward && !paneMode.current) {
        // Back to place, no reorder on release; the panes screen takes the gesture from here.
        dragEnd(target, null);
        paneMode.current = true;
        panePayload.current = payload;
        setPaneDrag(target);
        beginSessionDrag(payload);
      } else if (!toward && paneMode.current) {
        endPane(null);
      }
      if (paneMode.current) {
        moveSessionDrag(lastX.current, lastY.current);
        return;
      }
    }
    dragMove(target, lastY.current - pressY.current, lastY.current);
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  const measureFrameRef = useRef(measureFrame);
  measureFrameRef.current = measureFrame;
  const listResponder = useMemo(
    () =>
      PanResponder.create({
        // Runs first on every press in the list (capture goes from the top down), before a row
        // records itself, so a press outside any row leaves nothing to drag.
        onStartShouldSetPanResponderCapture: (e) => {
          pressedRef.current = null;
          pressY.current = lastY.current = e.nativeEvent.pageY;
          pressX.current = lastX.current = e.nativeEvent.pageX;
          measureFrameRef.current();
          return false;
        },
        onMoveShouldSetPanResponderCapture: (_, g) => {
          const target = pressedRef.current;
          if (compactRef.current || target === null) return false;
          if (Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx)) return true;
          // A sideways start on a session can only be a pull toward the panes.
          return !isProjectsGroup(target.group) && Math.abs(g.dx) > 6;
        },
        onPanResponderGrant: (e) => {
          lastY.current = e.nativeEvent.pageY;
          lastX.current = e.nativeEvent.pageX;
          if (pressedRef.current) stepRef.current(pressedRef.current);
        },
        onPanResponderMove: (e) => {
          lastY.current = e.nativeEvent.pageY;
          lastX.current = e.nativeEvent.pageX;
          if (pressedRef.current) stepRef.current(pressedRef.current);
        },
        onPanResponderRelease: () => {
          const target = pressedRef.current;
          pressedRef.current = null;
          if (noChatDrag.current) {
            noChatDrag.current = false;
            return;
          }
          if (paneMode.current) {
            latestDrag.current.endPane({ x: lastX.current, y: lastY.current });
            return;
          }
          // The release lands where the last move left the pointer.
          if (target) latestDrag.current.dragEnd(target, lastY.current - pressY.current);
        },
        onPanResponderTerminate: () => {
          const target = pressedRef.current;
          pressedRef.current = null;
          if (noChatDrag.current) {
            noChatDrag.current = false;
            return;
          }
          if (paneMode.current) {
            latestDrag.current.endPane(null);
            return;
          }
          if (target) latestDrag.current.dragEnd(target, null);
        },
        onPanResponderTerminationRequest: () => false,
      }).panHandlers,
    [],
  );

  // Kept across reloads (web, Electron), like the project and session order.
  const [collapsed, toggle] = useCollapsed();

  const lanes = useMemo(() => {
    const all = new Map<string, Lane>();
    for (const block of blocks) {
      if (collapsed.has(block.projectKey)) continue;
      for (const [key, lane] of checkoutLanes(block.roots, collapsed, rowWorktree)) all.set(key, lane);
    }
    return all;
  }, [blocks, collapsed, rowWorktree]);
  const lane = useCallback((nodeKey: string) => lanes.get(nodeKey) ?? null, [lanes]);
  const summaries = useMemo(() => {
    const byKey = new Map<string, { label: string; worktreePath: string | null }>();
    for (const b of rowBranches.values()) byKey.set(b.key, b);
    const all = new Map<string, BranchBelow[]>();
    for (const block of blocks) {
      for (const [node, counts] of branchesBelow(block.roots, (key) => rowBranches.get(key)?.key ?? null)) {
        all.set(node, counts.map(({ key, count }) => ({ ...byKey.get(key)!, count })));
      }
    }
    return all;
  }, [blocks, rowBranches]);
  const branchesBelowOf = useCallback((nodeKey: string) => summaries.get(nodeKey) ?? null, [summaries]);

  const p = useMemo(() => palette(view.theme.colors), [view.theme]);
  const ctx: Ctx = {
    view,
    hostLabel,
    lane,
    branchesBelow: branchesBelowOf,
    projectsGroup: projectsGroupOf,
    p,
    compact: view.layout.compact,
    workspaceRefs,
    projectRefs,
    agentRefs,
    agentWorkspace,
    worktrees,
    hasPendingPermission,
    collapsed,
    toggle,
    reordering,
    startReorder: () => setReordering(true),
    moveProject,
    projectIndex,
    drag,
    dropMark,
    dragMove,
    dragEnd,
    register,
    pressed,
    guard,
    rootGroup,
    paneDrag,
    setPayload,
  };

  return (
    <View style={{ flex: 1 }}>
    <View ref={frameRef} style={{ flex: 1 }} {...listResponder}>
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      // No text selection: a drag that starts on selected text becomes the browser's own drag of
      // that text, and the pointer events this list needs stop coming.
      // userSelect is a web style React Native's types leave out of ViewStyle.
      contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 4, paddingBottom: 12, userSelect: "none" } as ViewStyle}
      scrollEventThrottle={16}
      onScroll={(e) => {
        scroll.current.y = e.nativeEvent.contentOffset.y;
      }}
      onLayout={(e) => {
        scroll.current.height = e.nativeEvent.layout.height;
      }}
      onContentSizeChange={(_w, h) => {
        scroll.current.content = h;
      }}
    >
      {reordering ? (
        <ReorderBar
          p={p}
          canReset={order.saved.length > 0}
          onReset={() => order.save([])}
          onDone={() => setReordering(false)}
        />
      ) : null}
      {blocks.map((project, i) => {
        const host = hostOf(project.projectKey);
        const first = host !== null && (i === 0 || hostOf(blocks[i - 1].projectKey) !== host);
        return (
          <Fragment key={project.projectKey}>
            {first ? <HostHeader hostId={host} first={i === 0} ctx={ctx} /> : null}
            <ProjectBlock project={project} ctx={ctx} />
          </Fragment>
        );
      })}
      {reordering ? null : <HiddenProjects hidden={order.hidden} p={p} />}
    </ScrollView>
    </View>
    <ChatSection view={view} p={p} chatDir={chatDir} />
    </View>
  );
}

/** The head of one host's section, shown when more than one host is configured. */
function HostHeader({ hostId, first, ctx }: { hostId: string; first: boolean; ctx: Ctx }) {
  const status = useHosts().find((h) => h.serverId === hostId)?.status;
  const label = ctx.hostLabel(hostId) ?? hostId;
  const { p } = ctx;
  return (
    <View
      accessibilityRole="header"
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 8,
        paddingRight: 8,
        marginTop: first ? 6 : PROJECT.blockGap,
        marginBottom: 4,
        opacity: status === "online" ? 1 : 0.6,
      }}
    >
      <Icon name="Server" size={12} color={p.muted} />
      <Text numberOfLines={1} selectable={false} style={{ flex: 1, color: p.muted, fontSize: 11, fontWeight: "600", letterSpacing: 0.4 }}>
        {label}
      </Text>
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
  const projectsGroup = ctx.projectsGroup(project.projectKey);
  const target = useMemo(() => ({ group: projectsGroup, key: project.projectKey }), [projectsGroup, project.projectKey]);
  const group = ctx.rootGroup(project.projectKey);
  const hasPendingPermission = !open && project.roots.some((node) => {
    const keys = descendantAgents(node);
    if (node.kind === "agent") keys.add(node.key);
    else if (node.agentKey) keys.add(node.agentKey);
    for (const key of keys) {
      const agent = ctx.agentRefs.get(key);
      if (agent && ctx.hasPendingPermission(agent)) return true;
    }
    return false;
  });
  if (!ref) return null;
  return (
    <DragItem target={target} inset={0} paddingBottom={open ? PROJECT.blockGap : 2} ctx={ctx}>
      <DragTargetContext.Provider value={target}>
        <ProjectRow reference={ref} open={open} hasPendingPermission={hasPendingPermission} ctx={ctx} />
      </DragTargetContext.Provider>
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
              group={group}
              depth={0}
              place={null}
              trail={{ continues: [], last: i === project.roots.length - 1 }}
              ctx={ctx}
            />
          ))
        : null}
    </DragItem>
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
  group,
  depth,
  place,
  trail,
  ctx,
}: {
  node: TreeNode;
  /** The group it is dragged in: its parent's key, or its project's for a top row. */
  group: string;
  depth: number;
  place: string | null;
  trail: Trail;
  ctx: Ctx;
}) {
  const open = !ctx.collapsed.has(node.key);
  const lane = ctx.lane(node.key);
  const here = node.kind === "workspace" ? node.key : (ctx.agentWorkspace.get(node.key) ?? place);
  const childContinues = [...trail.continues, !trail.last];
  const target = useMemo(() => ({ group, key: node.key }), [group, node.key]);
  // The row and everything under it move as one.
  return (
    <DragItem target={target} inset={slotX(depth) - 6} ctx={ctx}>
      <TrailContext.Provider value={trail}>
        <DragTargetContext.Provider value={target}>
          {node.kind === "workspace" ? (
            <WorkspaceRow node={node} depth={depth} open={open} lane={lane} ctx={ctx} />
          ) : (
            <AgentRow node={node} depth={depth} open={open} away={here !== place ? here : null} lane={lane} ctx={ctx} />
          )}
        </DragTargetContext.Provider>
      </TrailContext.Provider>
      {open
        ? node.children.map((child, i) => (
            <Node
              key={child.key}
              node={child}
              group={node.key}
              depth={depth + 1}
              place={here}
              trail={{ continues: childContinues, last: i === node.children.length - 1 }}
              ctx={ctx}
            />
          ))
        : null}
    </DragItem>
  );
}

/**
 * Something that can be dragged among its siblings: a project with its rows, or a row with the
 * rows under it. Reports where it sits, follows the pointer while dragged, and shows the drop
 * line when the dragged item would land next to it.
 */
function DragItem({
  target,
  inset,
  paddingBottom,
  ctx,
  children,
}: {
  target: DragTarget;
  /** Where the drop line starts, so it lines up with the item's own indent. */
  inset: number;
  paddingBottom?: number;
  ctx: Ctx;
  children: ReactNode;
}) {
  const { register } = ctx;
  const ref = useCallback((node: View | null) => register(target, "item", node), [register, target]);
  const same = (t: DragTarget | null) => t !== null && t.group === target.group && t.key === target.key;
  const dragged = same(ctx.drag) ? ctx.drag : null;
  const mark = same(ctx.dropMark) ? ctx.dropMark!.edge : null;
  return (
    <View
      ref={ref}
      style={{
        paddingBottom,
        // The dragged item follows the pointer above the others.
        ...(dragged
          ? {
              transform: [{ translateY: dragged.dy }],
              zIndex: 10,
              opacity: 0.85,
              borderRadius: 8,
              backgroundColor: ctx.p.background,
            }
          : null),
      }}
    >
      {children}
      {mark ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: Math.max(0, inset),
            right: 4,
            [mark]: -1,
            height: 2,
            borderRadius: 1,
            backgroundColor: ctx.p.foreground,
          }}
        />
      ) : null}
    </View>
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
  const target = useContext(DragTargetContext);
  const dragSource = useDragSource(target, ctx);
  const toPanes = target !== null && ctx.paneDrag?.group === target.group && ctx.paneDrag.key === target.key;
  return (
    <View {...dragSource} style={toPanes ? { opacity: 0.5 } : undefined}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={ctx.guard(onPress)}
      // Desktop rows archive from their hover button; a long press there would fire while the
      // pointer rests before a drag.
      onLongPress={onLongPress && ctx.compact ? onLongPress : undefined}
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
      {toPanes ? <PaneDragCue ctx={ctx} /> : null}
    </Pressable>
    </View>
  );
}

/** On the row being pulled toward the panes: an icon and a hint, over the row's right end. */
function PaneDragCue({ ctx }: { ctx: Ctx }) {
  const { t } = useTranslation(sidebarText);
  return (
    <View
      pointerEvents="none"
      accessibilityLabel={t("paneDrag")}
      style={{ position: "absolute", right: 8, top: 0, bottom: 0, justifyContent: "center" }}
    >
      <Icon name="PanelRightOpen" size={14} color={ctx.p.foreground} />
    </View>
  );
}

/** Tells the sidebar which session a row stands for, so a drag out of it can carry the session. */
function useSessionPayload(key: string, agent: AgentRef | null | undefined, title: string | undefined, ctx: Ctx) {
  const { setPayload } = ctx;
  const payload = useMemo(
    (): SessionDragPayload | null => (agent ? { kind: "atrium.session", agent, title } : null),
    [agent, title],
  );
  useEffect(() => {
    setPayload(key, payload);
    return () => setPayload(key, null);
  }, [key, payload, setPayload]);
  return payload;
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
  const { t } = useTranslation(sidebarText);
  if (!ctx.compact && node.children.length > 0 && (hovered || !open)) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(open ? "collapse" : "expand")}
        hitSlop={6}
        onPress={ctx.guard(() => ctx.toggle(node.key))}
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
  const { t } = useTranslation(sidebarText);
  if (!ctx.compact || node.children.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(open ? "collapse" : "expand")}
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

function useDescendantAgentKeys(node: TreeNode) {
  return useMemo(() => descendantAgents(node), [node]);
}

function useHasActiveDescendants(keys: ReadonlySet<string>) {
  return useAgents({ where: (a) => keys.has(a.ref.key) && isAgentTurnActive(a.status) }).length > 0;
}

/**
 * The most urgent state among the agents a folded row hides, so a collapsed row still says
 * that something below it is running or waiting. One query per urgent state, in a fixed order.
 */
function useUrgentBelow(node: TreeNode, folded: boolean, ctx: Ctx): Bucket {
  const keys = useMemo(() => (folded ? descendantAgents(node) : new Set<string>()), [node, folded]);
  const counts = URGENT.map(
    (level) =>
      // eslint-disable-next-line react-hooks/rules-of-hooks -- URGENT is a constant list
      useAgents({ where: (a) => keys.has(a.ref.key) && !a.background && agentBucket(a, ctx.hasPendingPermission(a.ref)) === level }).length,
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
    // The layout stays left to right in every language; without this, react-native-web aligns
    // Arabic text to the right, away from its icon.
    textAlign: "left",
  } as const;
}

// ── Rows ───────────────────────────────────────────────────────────────

/** The workspaces archiving this row would leave empty, so the archive can take them too. */
function useEmptiedWorkspaces(node: TreeNode, ctx: Ctx): EmptiedWorkspaces {
  const keys = useMemo(() => new Set(workspacesEmptiedBy(node, ctx.agentWorkspace)), [node, ctx.agentWorkspace]);
  const refs = useWorkspaces({ where: useCallback((w: PluginWorkspaceSnapshot) => keys.has(w.ref.key), [keys]) });
  const worktrees = useWorkspaces({
    where: useCallback((w: PluginWorkspaceSnapshot) => keys.has(w.ref.key) && w.kind === "worktree", [keys]),
  }).length;
  return useMemo(() => ({ refs, worktrees }), [refs, worktrees]);
}

function WorkspaceRow({
  node,
  depth,
  open,
  lane,
  ctx,
}: {
  node: Extract<TreeNode, { kind: "workspace" }>;
  depth: number;
  open: boolean;
  /** Null with no badge. When it joins the row above, the badge shrinks to its icon on the title line. */
  lane: Lane | null;
  ctx: Ctx;
}) {
  const reference = ctx.workspaceRefs.get(node.key);
  const ws = useWorkspace(reference ?? node.key, (w) => ({
    label: w.title ?? w.name,
    title: w.title,
    customTitle: workspaceCustomTitle(w),
    branch: w.branch,
    directory: w.directory,
    indicator: w.indicator,
    kind: w.kind,
    additions: w.diffStat?.additions ?? null,
    deletions: w.diffStat?.deletions ?? null,
  }));
  const { t } = useTranslation(sidebarText);
  const childAgents = useDescendantAgentKeys(node);
  const running = useAgents({
    where: (a) => childAgents.has(a.ref.key) && agentBucket(a, ctx.hasPendingPermission(a.ref)) === "running",
  }).length;
  const hasActiveDescendants = useHasActiveDescendants(childAgents);
  const below = useUrgentBelow(node, !open, ctx);
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
  const root = useAgent(rootAgent ?? node.key, (a) => ({
    provider: a.provider,
    title: a.title,
    activeTurn: isAgentTurnActive(a.status),
    bucket: agentBucket(a, ctx.hasPendingPermission(a.ref)),
  }));
  // A workspace drawn as one row with its only agent and no name of its own reads as that agent.
  const label = ws
    ? workspaceRowLabel({ customTitle: ws.customTitle, name: ws.label, singleAgent: !!node.agentKey, agentTitle: root?.title })
    : undefined;
  const emptied = useEmptiedWorkspaces(node, ctx);
  const target: ArchiveTarget | null = useMemo(
    () =>
      reference && ws
        ? {
            kind: "workspace",
            ref: reference,
            rootAgent: rootAgent ?? null,
            worktree: ws.kind === "worktree",
            hasChanges: (ws.additions ?? 0) + (ws.deletions ?? 0) > 0,
            emptied,
          }
        : null,
    [reference, rootAgent, ws?.kind, ws?.additions, ws?.deletions, emptied],
  );
  const archive = useArchive(target);
  const rename = useRename(reference ?? null, ws?.title ?? null);
  const payload = useSessionPayload(node.key, rootAgent, label, ctx);
  const [menu, setMenu] = useState(false);
  const open_ = () =>
    rootAgent
      ? ctx.view.navigation.openAgent(rootAgent)
      : reference && ctx.view.navigation.openWorkspace(reference);
  if (!ws || !reference || label === undefined) return null;
  const { p } = ctx;
  const hidden = open ? 0 : countDescendants(node);
  const bucket = mostUrgent(ws.indicator, root?.bucket === "needs_input" ? root.bucket : null, below);
  // Only finished work: nothing in this row or below it is running.
  const canArchive = ws.indicator !== "running" && !root?.activeTurn && !hasActiveDescendants;
  const modal = target ? (
    <ArchiveModal
      state={archive}
      title={label}
      target={target}
      descendants={countDescendants(node)}
      danger={(target.kind === "workspace" && target.worktree) || target.emptied.worktrees > 0}
      p={p}
    />
  ) : null;
  const renameModal = <RenameModal state={rename} fallback={renameFallback(ws.branch, ws.directory)} p={p} />;
  // A branch only says something when the row works in its own worktree; rows on the project's
  // checkout would all repeat the same branch.
  const worktree = ctx.worktrees.get(worktreeKey(reference.hostId, ws.directory)) ?? null;
  const badge = worktreeBadge(worktree);
  const showBadge = !lane?.joinAbove;
  // Our badge says it better; Paseo's own branch is the fallback when there is no answer.
  const branch = !worktree && ws.kind === "worktree" ? ws.branch : null;
  const meta: ReactNode[] = [];
  if (running > 0) meta.push(<Text key="run" style={{ color: p.running }}>{t("runningBelow", { n: running })}</Text>);
  if (hidden > 0) meta.push(<Text key="hid">{t("collapsedBelow", { n: hidden })}</Text>);
  return (
    <>
    {modal}
    {renameModal}
    <SessionMenu
      name={label}
      open={menu}
      onClose={() => setMenu(false)}
      onOpenInPanes={payload ? () => openInPanes(payload) : undefined}
      onRename={rename.begin}
      onArchive={canArchive ? archive.begin : undefined}
      p={p}
    />
    <Row
      depth={depth}
      active={active}
      label={t("openRow", { name: label })}
      onPress={open_}
      onLongPress={() => setMenu(true)}
      ctx={ctx}
    >
      {(hovered) => (
        <>
          {worktree && badge?.tone === "linked" ? <WorktreeBar info={worktree} lane={lane} p={p} /> : null}
          <Leading
            node={node}
            mark={
              rootAgent && root?.provider ? (
                <ProviderMark provider={root.provider} p={ctx.p} />
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
                {label}
              </Text>
              {worktree && badge && !showBadge ? <WorktreeMark info={worktree} spec={badge} p={p} /> : null}
              {ws.additions !== null && ws.deletions !== null ? (
                <Text style={{ fontSize: 12, lineHeight: TITLE_LINE, fontVariant: ["tabular-nums"] }}>
                  <Text style={{ color: p.success }}>+{ws.additions}</Text>
                  <Text style={{ color: p.danger }}> -{ws.deletions}</Text>
                </Text>
              ) : null}
              {hovered && !archive.confirming && !rename.editing ? (
                <View style={{ flexDirection: "row", gap: 2 }}>
                  {/* No agent yet: nothing to open, and the dimmed button says so rather than vanish. */}
                  <PanesButton onPress={payload ? ctx.guard(() => openInPanes(payload)) : undefined} p={p} />
                  <RenameButton onPress={ctx.guard(rename.begin)} p={p} />
                  {canArchive ? <ArchiveButton onPress={ctx.guard(archive.begin)} p={p} /> : null}
                  {bucket === "needs_input" ? <StatusMark bucket={bucket} p={p} /> : null}
                </View>
              ) : (
                <StatusMark bucket={bucket} p={p} />
              )}
              <CompactToggle node={node} open={open} ctx={ctx} />
            </View>
            {worktree && badge && showBadge ? <WorktreeBadge info={worktree} spec={badge} p={p} /> : null}
            <BranchesBelow branches={ctx.branchesBelow(node.key)} open={open} ctx={ctx} />
            {branch || meta.length > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {branch ? (
                  <View style={{ flexShrink: 0 }}>
                    <Icon name="GitBranch" size={12} color={p.muted} />
                  </View>
                ) : null}
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
  lane,
  ctx,
}: {
  node: Extract<TreeNode, { kind: "agent" }>;
  depth: number;
  open: boolean;
  /** The agent's workspace when it differs from its parent's; shown under the title. */
  away: string | null;
  /** Null with no badge. When it joins the row above, the badge shrinks to its icon on the title line. */
  lane: Lane | null;
  ctx: Ctx;
}) {
  const reference = ctx.agentRefs.get(node.key);
  const agent = useAgent(reference ?? node.key, (a) => ({
    label: a.title ?? a.provider,
    provider: a.provider,
    status: a.status,
    requiresAttention: a.requiresAttention,
    attentionReason: a.attentionReason,
    cwd: a.cwd,
  }));
  const active = ctx.view.active.agent?.key === node.key;
  const { t } = useTranslation(sidebarText);
  const childAgents = useDescendantAgentKeys(node);
  const hasActiveDescendants = useHasActiveDescendants(childAgents);
  const below = useUrgentBelow(node, !open, ctx);
  const emptied = useEmptiedWorkspaces(node, ctx);
  const target: ArchiveTarget | null = useMemo(
    () => (reference ? { kind: "agent", ref: reference, emptied } : null),
    [reference, emptied],
  );
  const archive = useArchive(target);
  const payload = useSessionPayload(node.key, reference, agent?.label, ctx);
  const [menu, setMenu] = useState(false);
  if (!agent || !reference) return null;
  const { p } = ctx;
  const hidden = open ? 0 : countDescendants(node);
  const canArchive = !isAgentTurnActive(agent.status) && !hasActiveDescendants;
  const worktree = ctx.worktrees.get(worktreeKey(reference.hostId, agent.cwd)) ?? null;
  const badge = worktreeBadge(worktree);
  const showBadge = !lane?.joinAbove;
  const modal = target ? (
    <ArchiveModal
      state={archive}
      title={agent.label}
      target={target}
      descendants={countDescendants(node)}
      danger={target.emptied.worktrees > 0}
      p={p}
    />
  ) : null;
  return (
    <>
    {modal}
    <SessionMenu
      name={agent.label}
      open={menu}
      onClose={() => setMenu(false)}
      onOpenInPanes={payload ? () => openInPanes(payload) : undefined}
      onArchive={canArchive ? archive.begin : undefined}
      p={p}
    />
    <Row
      depth={depth}
      active={active}
      label={t("openAgentRow", { name: agent.label })}
      onPress={() => ctx.view.navigation.openAgent(reference)}
      onLongPress={payload || canArchive ? () => setMenu(true) : undefined}
      ctx={ctx}
    >
      {(hovered) => (
        <>
          {worktree && badge?.tone === "linked" ? <WorktreeBar info={worktree} lane={lane} p={p} /> : null}
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
              {worktree && badge && !showBadge ? <WorktreeMark info={worktree} spec={badge} p={p} /> : null}
              {away && node.ownsWorkspace ? <DiffStat workspaceKey={away} ctx={ctx} /> : null}
              <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12, lineHeight: TITLE_LINE }}>
                {hidden > 0 ? t("collapsedBelow", { n: hidden }) : ""}
              </Text>
              {hovered && !archive.confirming ? (
                <View style={{ flexDirection: "row", gap: 2 }}>
                  {payload ? <PanesButton onPress={ctx.guard(() => openInPanes(payload))} p={p} /> : null}
                  {canArchive ? <ArchiveButton onPress={ctx.guard(archive.begin)} p={p} /> : null}
                </View>
              ) : (
                <StatusMark bucket={mostUrgent(agentBucket(agent, ctx.hasPendingPermission(reference)), below)} p={p} />
              )}
              <CompactToggle node={node} open={open} ctx={ctx} />
            </View>
            {worktree && badge && showBadge ? <WorktreeBadge info={worktree} spec={badge} p={p} /> : null}
            <BranchesBelow branches={ctx.branchesBelow(node.key)} open={open} ctx={ctx} />
          </View>
        </>
      )}
    </Row>
    </>
  );
}

/**
 * Under a parent row: the branches its nested sessions work on, e.g. "3 nested: feat/x 2 · main 1".
 * It leads with the count and a "nested" arrow so it never reads as the row's own branch (that is
 * what the badge says). Shown only when the rows below do not already say it: when the row is
 * collapsed, or when its nested sessions span more than one branch. An expanded row whose children
 * are all on one branch leaves it to their badge and color bar.
 */
function BranchesBelow({ branches, open, ctx }: { branches: readonly BranchBelow[] | null; open: boolean; ctx: Ctx }) {
  const { t } = useTranslation(sidebarText);
  if (!branches || branches.length === 0) return null;
  if (open && branches.length < 2) return null;
  const { p } = ctx;
  const total = branches.reduce((n, b) => n + b.count, 0);
  const single = branches.length === 1;
  const list = branches.map((b) => `${b.label} ${b.count}`).join(", ");
  return (
    <View
      accessible
      accessibilityLabel={t("branchesBelow", { list })}
      style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}
    >
      <View style={{ flexShrink: 0 }}>
        <Icon name="CornerDownRight" size={12} color={p.muted} />
      </View>
      <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontSize: 12, color: p.muted }}>
        {t("branchesBelowLead", { n: total })}{" "}
        {branches.map((b, i) => (
          <Text key={`${b.worktreePath ?? ""}|${b.label}`}>
            {i > 0 ? " · " : ""}
            <Text style={{ color: b.worktreePath ? worktreeColor(p, b.worktreePath) : p.muted }}>{b.label}</Text>
            {single ? null : <Text style={{ fontVariant: ["tabular-nums"] }}> {b.count}</Text>}
          </Text>
        ))}
      </Text>
    </View>
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
  hasPendingPermission,
  ctx,
}: {
  reference: ProjectRef;
  open: boolean;
  hasPendingPermission: boolean;
  ctx: Ctx;
}) {
  const { t } = useTranslation(sidebarText);
  const displayName = useProject(reference, (pr) => pr.displayName);
  const host = ctx.hostLabel(reference.hostId);
  // Menus and the hide dialog name the host too, so the right one of two same-named projects is meant.
  const name = displayName && host ? `${displayName} · ${host}` : displayName;
  const [hovered, setHovered] = useState(false);
  const hide = useHideProject(reference);
  const [menu, setMenu] = useState(false);
  const { index, last } = ctx.projectIndex.get(reference.key) ?? { index: 0, last: 0 };
  const dragTarget = useContext(DragTargetContext);
  const dragSource = useDragSource(dragTarget, ctx);
  // Folded, the header stands in for its rows: it shows the most urgent state among them.
  const workspaceUrgency = useUrgentInProject(reference, !open);
  const urgent = hasPendingPermission ? "needs_input" : workspaceUrgency;
  // Folded over the workspace that is open right now: the header is the only place left to show it.
  const activeKey = ctx.view.active.workspace?.key ?? null;
  const holdsActive = useWorkspaces({
    where: (w) => !open && activeKey !== null && w.ref.key === activeKey && w.project.key === reference.key,
  }).length > 0;
  const { p } = ctx;
  if (!name) return null;
  return (
    <>
    <HideProjectModal name={name} state={hide} p={p} />
    <ProjectMenu
      name={name}
      open={menu}
      onClose={() => setMenu(false)}
      onReorder={ctx.startReorder}
      onHide={hide.begin}
      p={p}
    />
    {/* Hover is tracked on the whole header so moving onto its buttons keeps them shown. */}
    <View
      {...dragSource}
      style={{ marginBottom: PROJECT.gapBelow }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open, selected: holdsActive }}
        accessibilityLabel={name}
        onPress={ctx.guard(() => (ctx.reordering ? undefined : ctx.toggle(reference.key)))}
        // Desktop reorders by dragging, so a long press does nothing there. Compact layouts have no
        // hover or drag: a long press opens a menu with reordering and removing the project.
        onLongPress={ctx.compact && !ctx.reordering ? () => setMenu(true) : undefined}
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
        {/* Not selectable, so dragging the header never selects its name. */}
        <Text
          numberOfLines={1}
          selectable={false}
          style={{ flex: 1, color: holdsActive ? p.foreground : p.muted, fontSize: 14, fontWeight: holdsActive ? "600" : "400", textAlign: "left" }}
        >
          {displayName}
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
        accessibilityLabel={t("newWorkspaceIn", { name })}
        hitSlop={6}
        onPress={ctx.guard(() => ctx.view.navigation.openProject(reference))}
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
      {!open && !ctx.reordering && urgent !== "done" && !(hovered && !hide.confirming) ? (
        // Same slot as the hide button, which takes it over on hover, as rows do with archive.
        <View pointerEvents="none" style={{ position: "absolute", right: 38, top: ROW.paddingVertical }}>
          <StatusMark bucket={urgent} p={p} />
        </View>
      ) : null}
      {hovered && !hide.confirming ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("hide")}
          hitSlop={6}
          onPress={ctx.guard(hide.begin)}
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
          <Icon name="EyeOff" size={14} color={p.muted} />
        </Pressable>
      ) : null}
      </>
      )}
    </View>
    </>
  );
}

/**
 * Props for the row or header an item is dragged by. A press on it only records the item: the drag
 * itself is caught by the list (see `useListDrag`), because react-native-web asks only the pressed
 * element's common ancestors with the element under the pointer, and after a quick move that is no
 * longer the row.
 */
function useDragSource(target: DragTarget | null, ctx: Ctx) {
  const latest = useRef(ctx);
  latest.current = ctx;
  return useMemo(
    () =>
      target
        ? {
            onStartShouldSetResponderCapture: () => {
              latest.current.pressed(target);
              return false;
            },
            ref: (node: View | null) => latest.current.register(target, "head", node),
          }
        : {},
    [target],
  );
}
