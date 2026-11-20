// The panes screen: many chats side by side, families linked, sessions dropped in from the
// sidebar. Only panes near the viewport mount and subscribe, so there is no fixed limit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  useAgent,
  useAgents,
  useRpc,
  useTranslation,
  type AgentRef,
  type PluginScreenProps,
} from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/ui";
import { chatLinks } from "../../shared/chat/rpc";
import { panesText } from "../chat-strings";
import { palette, type Palette } from "../look";
import { onOpenInPanes, registerDropZone, useSessionDrag, type Rect, type SessionDragPayload } from "./drop-bus";
import {
  addPane,
  addPanes,
  arrangeByFamily,
  descendantsOf,
  groupByFamily,
  insertionIndex,
  moveGroup,
  paneOffsets,
  paneWidth,
  parsePanes,
  removePane,
  rootOf,
  visibleRange,
  type PaneRef,
} from "./layout";
import { Pane, type PaneLink } from "./pane";
import { setPanes, usePanes } from "./store";

const GAP = 12;
const PAD = 12;
const FAMILY_COLORS = ["#7c6cf2", "#e0739a", "#2fa59a", "#d98a2b", "#4c8fd6", "#a25bd1", "#5aa84a", "#c9574a"];

function familyColor(rootKey: string): string {
  let h = 0;
  for (let i = 0; i < rootKey.length; i++) h = (h * 31 + rootKey.charCodeAt(i)) | 0;
  return FAMILY_COLORS[Math.abs(h) % FAMILY_COLORS.length];
}

function toRef(a: PaneRef | AgentRef): AgentRef {
  return { kind: "agent", key: a.key, hostId: a.hostId, id: a.id };
}

let zoneSeq = 0;

export function PanesScreen(props: PluginScreenProps) {
  const p = useMemo(() => palette(props.theme.colors), [props.theme.colors]);
  const { t } = useTranslation(panesText);
  const panes = usePanes();
  // Timelines and links come from the plugin's own host; other hosts' panes show a notice.
  const ownHost = props.host.id;

  // Panes passed in the screen's params (`agents`, the persisted form) open once.
  const paramAgents = props.params.agents;
  useEffect(() => {
    const incoming = parsePanes(paramAgents);
    if (incoming.length > 0) setPanes((prev) => addPanes(prev, incoming));
  }, [paramAgents]);

  // ── Family links: live parent map from client state, chatLinks for the rest ──
  const byParent = useAgents({ where: (a) => !a.background, groupBy: (a) => a.parentAgent?.key ?? "" });
  const { parentByKey, allAgents, keyById } = useMemo(() => {
    const parentByKey = new Map<string, string>();
    const allAgents: AgentRef[] = [];
    const keyById = new Map<string, string>();
    for (const group of byParent) {
      for (const ref of group.items) {
        allAgents.push(ref);
        keyById.set(`${ref.hostId}\u0000${ref.id}`, ref.key);
        if (group.key) parentByKey.set(ref.key, group.key);
      }
    }
    return { parentByKey, allAgents, keyById };
  }, [byParent]);

  const fetchLinks = useRpc(chatLinks);
  const unknownIds = useMemo(
    () => [...new Set(panes.filter((pane) => pane.hostId === ownHost && !keyById.has(`${pane.hostId}\u0000${pane.id}`)).map((pane) => pane.id))].sort().slice(0, 256),
    [panes, keyById, ownHost],
  );
  const links = useQuery({
    queryKey: ["atrium", "panes", "links", unknownIds],
    queryFn: () => fetchLinks({ agentIds: unknownIds }),
    enabled: unknownIds.length > 0,
    staleTime: 60_000,
  });
  const parentOf = useCallback(
    (key: string): string | null => {
      const live = parentByKey.get(key);
      if (live) return live;
      const pane = panes.find((x) => x.key === key);
      if (!pane) return null;
      const link = links.data?.links.find((l) => l.agentId === pane.id);
      if (!link?.parentAgentId) return null;
      return keyById.get(`${pane.hostId}\u0000${link.parentAgentId}`)
        ?? panes.find((x) => x.hostId === pane.hostId && x.id === link.parentAgentId)?.key
        ?? null;
    },
    [parentByKey, panes, links.data, keyById],
  );

  const groups = useMemo(() => groupByFamily(panes, parentOf), [panes, parentOf]);
  const arranged = useMemo(() => groups.flatMap((g) => g.panes), [groups]);
  const linkOf = useMemo(() => {
    const out = new Map<string, PaneLink>();
    for (const g of groups) {
      const color = familyColor(g.rootKey);
      const present = new Set(g.panes.map((x) => x.key));
      g.panes.forEach((pane, index) => {
        let parent: AgentRef | null = null;
        let cur = parentOf(pane.key);
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
          if (present.has(cur)) {
            const hit = g.panes.find((x) => x.key === cur);
            parent = hit ? toRef(hit) : null;
            break;
          }
          seen.add(cur);
          cur = parentOf(cur);
        }
        out.set(pane.key, { color, size: g.panes.length, index, depth: g.depths[index], parent });
      });
    }
    return out;
  }, [groups, parentOf]);

  // ── Geometry & virtualization ──
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollX, setScrollX] = useState(0);
  const [scrollHeight, setScrollHeight] = useState(0);
  const width = paneWidth(viewport.width - PAD * 2, GAP);
  const widths = useMemo(() => arranged.map(() => width), [arranged, width]);
  const { offsets, total } = useMemo(() => paneOffsets(widths, GAP), [widths]);
  const range = visibleRange(widths, GAP, scrollX - PAD, viewport.width, 1);
  const visible = arranged.slice(range.start, range.end);

  // Each mounted pane subscribes to its own timeline (pane.tsx), so scrolling only adds or
  // removes the panes that scroll in or out of view.

  // ── Mutations (always kept in family order) ──
  const [familyOffer, setFamilyOffer] = useState<{ agent: AgentRef; children: AgentRef[] } | null>(null);
  const latest = useRef({ arranged, parentOf, allAgents, widths, scrollX });
  latest.current = { arranged, parentOf, allAgents, widths, scrollX };

  const open = useCallback((payload: SessionDragPayload, index?: number) => {
    const { parentOf, allAgents } = latest.current;
    const ref = toRef(payload.agent);
    setPanes((prev) => arrangeByFamily(addPane(arrangeByFamily(prev, parentOf), ref, index), parentOf));
    const children = descendantsOf(ref.key, allAgents, parentOf);
    setFamilyOffer(children.length > 0 ? { agent: ref, children } : null);
  }, []);

  const onClose = useCallback((agent: AgentRef) => setPanes((prev) => removePane(prev, agent.key)), []);
  const onMoveFamily = useCallback((agent: AgentRef, delta: -1 | 1) => {
    const { parentOf } = latest.current;
    setPanes((prev) => moveGroup(arrangeByFamily(prev, parentOf), parentOf, rootOf(agent.key, parentOf), delta));
  }, []);
  const navigation = props.navigation;
  const onOpen = useCallback(
    (agent: AgentRef) => navigation?.openAgent({ agentId: agent.id, serverId: agent.hostId }),
    [navigation],
  );

  // The global listener (index.tsx) adds the pane and opens this screen; here only offer the
  // family, so a queued request is never added twice.
  useEffect(
    () =>
      onOpenInPanes((payload) => {
        const { parentOf, allAgents } = latest.current;
        const children = descendantsOf(payload.agent.key, allAgents, parentOf);
        setFamilyOffer(children.length > 0 ? { agent: toRef(payload.agent), children } : null);
      }),
    [],
  );

  // ── Drop zone ──
  const frameRef = useRef<View>(null);
  const rectRef = useRef<Rect | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const dragging = useSessionDrag();
  useEffect(() => {
    const id = `atrium.panes.${++zoneSeq}`;
    const indexAt = (x: number) => {
      const rect = rectRef.current;
      const { widths, scrollX } = latest.current;
      return insertionIndex(widths, GAP, x - (rect?.x ?? 0) + scrollX - PAD);
    };
    return registerDropZone({
      id,
      measure: () =>
        new Promise((resolve) => {
          const node = frameRef.current;
          if (!node) return resolve(null);
          node.measureInWindow((x, y, w, h) => {
            const rect = { x, y, width: w, height: h };
            rectRef.current = rect;
            resolve(rect);
          });
        }),
      onHover: (payload, at) => setHoverIndex(payload && at ? indexAt(at.x) : null),
      onDrop: (payload, at) => {
        setHoverIndex(null);
        open(payload, indexAt(at.x));
      },
    });
  }, [open]);
  useEffect(() => {
    if (!dragging) setHoverIndex(null);
  }, [dragging]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport((v) => (v.width === width && v.height === height ? v : { width, height }));
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setScrollX(e.nativeEvent.contentOffset.x);

  const leading = range.start < arranged.length ? offsets[range.start] ?? 0 : 0;
  const lastShown = range.end - 1;
  const trailing = lastShown >= 0 && lastShown < arranged.length ? total - (offsets[lastShown] + widths[lastShown]) : 0;
  const hoverX = hoverIndex === null ? null : hoverIndex >= arranged.length ? total + GAP / 2 : (offsets[hoverIndex] ?? 0) - GAP / 2;

  return (
    <View ref={frameRef} onLayout={onLayout} style={{ flex: 1, backgroundColor: p.background }}>
      <Toolbar count={arranged.length} p={p} onCloseAll={() => setPanes([])} />
      {familyOffer ? (
        <FamilyOffer
          offer={familyOffer}
          p={p}
          onAccept={() => {
            const { parentOf } = latest.current;
            setPanes((prev) => {
              const arrangedPrev = arrangeByFamily(prev, parentOf);
              const at = arrangedPrev.findIndex((x) => x.key === familyOffer.agent.key);
              return arrangeByFamily(addPanes(arrangedPrev, familyOffer.children, at < 0 ? undefined : at + 1), parentOf);
            });
            setFamilyOffer(null);
          }}
          onDismiss={() => setFamilyOffer(null)}
        />
      ) : null}
      {arranged.length === 0 ? (
        <View
          style={{
            flex: 1,
            margin: PAD,
            borderRadius: 12,
            borderWidth: 2,
            borderStyle: "dashed",
            borderColor: dragging ? p.running : p.guide,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            gap: 10,
          }}
        >
          <Icon name="Columns3" size={28} color={dragging ? p.running : p.muted} />
          <Text style={{ color: dragging ? p.running : p.muted, fontSize: 13, textAlign: "center", maxWidth: 360 }}>
            {dragging ? t("dropHere") : t("empty")}
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          onScroll={onScroll}
          onLayout={(e) => setScrollHeight(e.nativeEvent.layout.height)}
          scrollEventThrottle={32}
          snapToInterval={props.layout.compact ? width + GAP : undefined}
          decelerationRate={props.layout.compact ? "fast" : undefined}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: PAD, gap: 0 }}
        >
          <View style={{ flexDirection: "row", height: Math.max(240, scrollHeight - PAD * 2) }}>
            {leading > 0 ? <View style={{ width: leading }} /> : null}
            {visible.map((pane, i) => (
              <View key={pane.key} style={{ marginLeft: i === 0 ? 0 : GAP }}>
                <Pane
                  agent={toRef(pane)}
                  width={width}
                  gap={GAP}
                  p={p}
                  link={linkOf.get(pane.key) ?? { color: p.guide, size: 1, index: 0, depth: 0, parent: null }}
                  otherHost={pane.hostId === ownHost ? null : pane.hostId}
                  onClose={onClose}
                  onOpen={onOpen}
                  onMoveFamily={onMoveFamily}
                />
              </View>
            ))}
            {trailing > 0 ? <View style={{ width: trailing }} /> : null}
            {hoverX !== null ? (
              <View
                pointerEvents="none"
                style={{ position: "absolute", left: hoverX - 2, top: 0, bottom: 0, width: 4, borderRadius: 2, backgroundColor: p.running }}
              />
            ) : null}
          </View>
        </ScrollView>
      )}
      {dragging && arranged.length > 0 ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderWidth: 2, borderColor: p.running, borderRadius: 8 }}
        />
      ) : null}
    </View>
  );
}

function Toolbar({ count, p, onCloseAll }: { count: number; p: Palette; onCloseAll(): void }) {
  const { t } = useTranslation(panesText);
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={{ height: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: PAD, borderBottomWidth: 1, borderBottomColor: p.guide }}>
      <Icon name="Columns3" size={15} color={p.muted} />
      <Text style={{ flex: 1, color: p.muted, fontSize: 13 }}>{t("count", { n: count })}</Text>
      {count > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirming(true)}
          style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: pressed ? p.pressed : p.hover })}
        >
          <Text style={{ color: p.foreground, fontSize: 12 }}>{t("closeAll")}</Text>
        </Pressable>
      ) : null}
      <Modal
        title={t("closeAllTitle")}
        icon={<Icon name="Columns3" size={16} color={p.foreground} />}
        open={confirming}
        onOpenChange={setConfirming}
      >
        <Modal.Content>
          <Text style={{ color: p.muted, fontSize: 13, lineHeight: 19 }}>{t("closeAllBody", { n: count })}</Text>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirming(false)}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: p.guide,
                backgroundColor: pressed ? p.pressed : "transparent",
              })}
            >
              <Text style={{ color: p.foreground, fontSize: 13 }}>{t("cancel")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setConfirming(false);
                onCloseAll();
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: p.danger,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{t("closeAll")}</Text>
            </Pressable>
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}

function FamilyOffer({
  offer,
  p,
  onAccept,
  onDismiss,
}: {
  offer: { agent: AgentRef; children: AgentRef[] };
  p: Palette;
  onAccept(): void;
  onDismiss(): void;
}) {
  const { t } = useTranslation(panesText);
  const title = useAgent(offer.agent, (a) => a.title) || t("untitled");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: PAD, marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: p.hover }}>
      <Icon name="GitFork" size={14} color={p.muted} />
      <Text numberOfLines={1} style={{ flex: 1, color: p.foreground, fontSize: 12 }}>
        {t("addFamilyTitle", { title })}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onAccept}
        style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: pressed ? p.pressed : p.running })}
      >
        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>{t("addFamily", { n: offer.children.length })}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t("dismiss")} onPress={onDismiss} hitSlop={6}>
        <Icon name="X" size={14} color={p.muted} />
      </Pressable>
    </View>
  );
}
