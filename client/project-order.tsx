// Hand-set order of projects and sessions: the saved order from the daemon, the bar shown while reordering, and the
// long-press menu of compact layouts, where a long press used to remove the project directly.
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { getProjectOrder, setNodeOrder, setProjectOrder, type NodeOrders } from "../shared/project-order";
import type { HiddenProject } from "../shared/project-rpc";
import { ROW, TITLE_LINE, type Palette } from "./look";
import { sidebarText } from "./sidebar-strings";

export const PROJECT_ORDER_KEY = ["projectOrder", 2] as const;
const KEY = PROJECT_ORDER_KEY;
const NONE: readonly string[] = [];
const NO_NODES: NodeOrders = {};
const NO_HIDDEN: readonly HiddenProject[] = [];

export interface Saved {
  order: readonly string[];
  nodes: NodeOrders;
  /** Projects hidden from the Atrium sidebar, by host and id. Absent from older servers. */
  hiddenProjects?: readonly HiddenProject[];
}

export interface ProjectOrder {
  /** Project root paths in the saved order; empty for the default order. */
  saved: readonly string[];
  /** Per parent, its children's keys in the saved order. */
  nodes: NodeOrders;
  save(order: readonly string[]): void;
  saveNodes(group: string, order: readonly string[]): void;
  /** Projects hidden from this sidebar (project.hide), kept by the daemon with the order. */
  hidden: readonly HiddenProject[];
}

export function useProjectOrder(): ProjectOrder {
  const get = useRpc(getProjectOrder);
  const set = useRpc(setProjectOrder);
  const setNodes = useRpc(setNodeOrder);
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation(sidebarText);
  const query = useQuery({
    queryKey: KEY,
    queryFn: (): Promise<Saved> => get({}),
    staleTime: 30_000,
    retry: 2,
  });
  // Shown at once; put back if the daemon does not take it.
  const optimistic = useCallback(
    (change: (current: Saved) => Saved, send: () => Promise<unknown>) => {
      const previous = queryClient.getQueryData<Saved>(KEY);
      queryClient.setQueryData<Saved>(KEY, change(previous ?? { order: NONE, nodes: NO_NODES }));
      send().catch(() => {
        queryClient.setQueryData(KEY, previous);
        toast.error(t("orderFailed"));
      });
    },
    [queryClient, toast, t],
  );
  const save = useCallback(
    (order: readonly string[]) =>
      optimistic((current) => ({ ...current, order: [...order] }), () => set({ order: [...order] })),
    [optimistic, set],
  );
  const saveNodes = useCallback(
    (group: string, order: readonly string[]) =>
      optimistic(
        (current) => ({ ...current, nodes: { ...current.nodes, [group]: [...order] } }),
        () => setNodes({ group, order: [...order] }),
      ),
    [optimistic, setNodes],
  );
  return {
    saved: query.data?.order ?? NONE,
    nodes: query.data?.nodes ?? NO_NODES,
    hidden: query.data?.hiddenProjects ?? NO_HIDDEN,
    save,
    saveNodes,
  };
}

/**
 * Keeps hidden projects where they were in the saved order. Reordering only sees the shown
 * projects, so the order built from them (move / placeAt) would push every hidden one to the end.
 * Here each hidden key keeps its old slot and the shown keys fill the other slots in their new
 * order; anything left over follows. Keys are project root folders, as in the saved order.
 */
export function keepHiddenSlots(next: readonly string[], previous: readonly string[], hidden: ReadonlySet<string>): string[] {
  if (hidden.size === 0) return [...next];
  const rest = next.filter((key) => !hidden.has(key));
  const out: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  for (const key of previous) {
    if (hidden.has(key)) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    } else if (i < rest.length) {
      out.push(rest[i++]);
    }
  }
  out.push(...rest.slice(i));
  for (const key of next) {
    if (hidden.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Pinned above the projects while reordering. */
export function ReorderBar({ onDone, onReset, canReset, p }: { onDone(): void; onReset(): void; canReset: boolean; p: Palette }) {
  const { t } = useTranslation(sidebarText);
  return (
    <View
      style={{
        minHeight: ROW.minHeight,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 8,
        paddingRight: 4,
        marginBottom: 6,
      }}
    >
      <Icon name="ArrowUpDown" size={14} color={p.muted} />
      <Text numberOfLines={1} style={{ flex: 1, color: p.muted, fontSize: 13 }}>
        {t("reordering")}
      </Text>
      {canReset ? <BarButton label={t("resetOrder")} onPress={onReset} p={p} /> : null}
      <BarButton label={t("done")} onPress={onDone} p={p} primary />
    </View>
  );
}

function BarButton({ label, onPress, p, primary }: { label: string; onPress(): void; p: Palette; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: primary ? p.foreground : pressed ? p.pressed : "transparent",
        opacity: primary && pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ color: primary ? p.background : p.muted, fontSize: 12, fontWeight: primary ? "600" : "400" }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One place up or down, beside a project header while reordering. */
export function MoveButton({ up, disabled, onPress, p }: { up: boolean; disabled: boolean; onPress(): void; p: Palette }) {
  const { t } = useTranslation(sidebarText);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={up ? t("moveUp") : t("moveDown")}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 24,
        height: 24,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? p.pressed : "transparent",
        opacity: disabled ? 0.3 : 1,
      })}
    >
      <Icon name={up ? "ChevronUp" : "ChevronDown"} size={14} color={p.foreground} />
    </Pressable>
  );
}

/** Compact layouts have no hover: a long press on a project header offers these two. */
export function ProjectMenu({
  name,
  open,
  onClose,
  onReorder,
  onHide,
  p,
}: {
  name: string;
  open: boolean;
  onClose(): void;
  onReorder(): void;
  onHide(): void;
  p: Palette;
}) {
  const { t } = useTranslation(sidebarText);
  const item = (icon: string, label: string, onPress: () => void, danger = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        onClose();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: pressed ? p.pressed : "transparent",
      })}
    >
      <Icon name={icon} size={16} color={danger ? p.danger : p.foreground} />
      <Text style={{ color: danger ? p.danger : p.foreground, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal
      title={name}
      icon={<Icon name="Folder" size={16} color={p.foreground} />}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal.Content>
        {item("ArrowUpDown", t("reorder"), onReorder)}
        {item("EyeOff", t("hide"), onHide)}
      </Modal.Content>
    </Modal>
  );
}

// ── Session → pane drag ────────────────────────────────────────────────

/** How far past the sidebar's edge the pointer must go to start a pane drag, and how far back it
 *  must come to return to reordering (the gap keeps a pointer on the edge from flickering). */
export const PANE_DRAG_ENTER = 12;
/** Horizontal travel that starts a pane drag even inside the sidebar (a very wide one). */
export const PANE_DRAG_FAR = 220;
export const PANE_DRAG_FAR_EXIT = 180;

/** Whether `x` is beyond the sidebar's edges by more than `margin`; false when the edges are unknown. */
export function outsideSidebar(x: number, left: number, right: number, margin = 0): boolean {
  return right > left && (x > right + margin || x < left - margin);
}

/**
 * Whether a session drag at `x` is a drag toward the panes rather than a reorder. Pure: `left` and
 * `right` are the sidebar's edges on the page (right <= left when unknown), `startX` is where the
 * press began, `active` whether the gesture already is a pane drag (it then leaves more slowly).
 * `dropZones`: whether the panes screen is mounted. With it, leaving the sidebar or travelling far
 * sideways counts; without it only leaving the sidebar does (a drop then opens the panes screen).
 */
export function isPaneDrag(args: {
  x: number;
  startX: number;
  left: number;
  right: number;
  active: boolean;
  dropZones: boolean;
}): boolean {
  if (outsideSidebar(args.x, args.left, args.right, args.active ? 0 : PANE_DRAG_ENTER)) return true;
  if (!args.dropZones) return false;
  return Math.abs(args.x - args.startX) > (args.active ? PANE_DRAG_FAR_EXIT : PANE_DRAG_FAR);
}

/** Hover button on a session row: opens it in the panes screen. */
/** `onPress` omitted: the row has no chat to open yet, and the button says so instead of hiding. */
export function PanesButton({ onPress, p }: { onPress?: () => void; p: Palette }) {
  const [hovered, setHovered] = useState(false);
  const { t } = useTranslation(sidebarText);
  const disabled = !onPress;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={disabled ? t("panesNoChat") : t("openInPanes")}
      accessibilityState={{ disabled }}
      aria-disabled={disabled}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        width: 20,
        height: TITLE_LINE,
        borderRadius: 5,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: hovered && !disabled ? p.pressed : "transparent",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name="PanelRightOpen" size={13} color={hovered && !disabled ? p.foreground : p.muted} />
    </Pressable>
  );
}

/** Compact layouts have no hover: a long press on a session row offers these. */
export function SessionMenu({
  name,
  open,
  onClose,
  onOpenInPanes,
  onRename,
  onArchive,
  p,
}: {
  name: string;
  open: boolean;
  onClose(): void;
  onOpenInPanes?: () => void;
  /** Workspace rows only: compact layouts have no hover button to rename with. */
  onRename?: () => void;
  onArchive?: () => void;
  p: Palette;
}) {
  const { t } = useTranslation(sidebarText);
  const item = (icon: string, label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        onClose();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: pressed ? p.pressed : "transparent",
      })}
    >
      <Icon name={icon} size={16} color={p.foreground} />
      <Text style={{ color: p.foreground, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal
      title={name}
      icon={<Icon name="MessageSquare" size={16} color={p.foreground} />}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal.Content>
        {onOpenInPanes ? item("PanelRightOpen", t("openInPanes"), onOpenInPanes) : null}
        {onRename ? item("Pencil", t("rename"), onRename) : null}
        {onArchive ? item("Archive", t("archive"), onArchive) : null}
      </Modal.Content>
    </Modal>
  );
}
