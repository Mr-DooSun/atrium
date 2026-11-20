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
  edgeScrollDelta,
  groupByFamily,
  insertionIndex,
  moveGroup,
  paneOffsets,
  paneWidth,
  PANE_MAX_WIDTH,
  PANE_MIN_WIDTH,
  parsePanes,
  removePane,
  reorderTarget,
  resolveWidths,
  rootOf,
  visibleRange,
  type PaneRef,
} from "./layout";
import { Pane, type PaneLink, type PaneReorderHandlers } from "./pane";
import { setPaneWidth, setPanes, usePaneWidths, usePanes } from "./store";

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
  const compact = props.layout.compact;
  const width = paneWidth(viewport.width - PAD * 2, GAP);
  const savedWidths = usePaneWidths();
  // Live width while a resize handle is being dragged; committed to the store on release.
  const [resizing, setResizing] = useState<{ key: string; width: number } | null>(null);
  const customWidths = useMemo(() => {
    // Phones page one pane at a time: every pane takes the viewport's width.
    if (compact) return new Map<string, number>();
    if (!resizing) return savedWidths;
    const next = new Map(savedWidths);
    next.set(resizing.key, resizing.width);
    return next;
  }, [compact, savedWidths, resizing]);
  const widths = useMemo(() => resolveWidths(arranged, customWidths, width), [arranged, customWidths, width]);
  const { offsets, total } = useMemo(() => paneOffsets(widths, GAP), [widths]);
  const range = visibleRange(widths, GAP, scrollX - PAD, viewport.width, 1);
  // ── Reorder drag state (declared here: the dragged pane must stay mounted) ──
  const [reordering, setReordering] = useState<string | null>(null);
  const mounted = useMemo(() => {
    const out = arranged.slice(range.start, range.end).map((pane, i) => ({ pane, index: range.start + i }));
    if (reordering) {
      const at = arranged.findIndex((x) => x.key === reordering);
      if (at >= 0 && (at < range.start || at >= range.end)) out.push({ pane: arranged[at], index: at });
    }
    return out;
  }, [arranged, range.start, range.end, reordering]);

  // Each mounted pane subscribes to its own timeline (pane.tsx), so scrolling only adds or
  // removes the panes that scroll in or out of view.

  // ── Mutations (always kept in family order) ──
  const [familyOffer, setFamilyOffer] = useState<{ agent: AgentRef; children: AgentRef[] } | null>(null);
  const latest = useRef({ arranged, parentOf, allAgents, widths, scrollX, contentWidth: total + PAD * 2 });
  latest.current = { arranged, parentOf, allAgents, widths, scrollX, contentWidth: total + PAD * 2 };

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
      const { widths } = latest.current;
      return insertionIndex(widths, GAP, x - (rect?.x ?? 0) + scrollXRef.current - PAD);
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

  // ── Reorder by dragging a pane's header grip ──
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrollXRef = useRef(0);
  const pointerX = useRef<number | null>(null);
  const reorderKey = useRef<string | null>(null);
  const contentIndexAt = (pageX: number) => {
    const rect = rectRef.current;
    const { widths } = latest.current;
    return insertionIndex(widths, GAP, pageX - (rect?.x ?? 0) + scrollXRef.current - PAD);
  };
  const indexAtRef = useRef(contentIndexAt);
  indexAtRef.current = contentIndexAt;
  const measureFrame = () =>
    frameRef.current?.measureInWindow((x, y, w, h) => {
      rectRef.current = { x, y, width: w, height: h };
    });
  const reorder: PaneReorderHandlers = useMemo(
    () => ({
      onStart: (agent, pageX) => {
        measureFrame();
        reorderKey.current = agent.key;
        pointerX.current = pageX;
        setReordering(agent.key);
        setHoverIndex(indexAtRef.current(pageX));
      },
      onMove: (pageX) => {
        pointerX.current = pageX;
        setHoverIndex(indexAtRef.current(pageX));
      },
      onEnd: (pageX) => {
        const key = reorderKey.current;
        reorderKey.current = null;
        pointerX.current = null;
        setReordering(null);
        setHoverIndex(null);
        if (!key || pageX === null) return;
        const to = indexAtRef.current(pageX);
        const { parentOf } = latest.current;
        setPanes((prev) => reorderTarget(prev, parentOf, key, to));
      },
    }),
    [],
  );
  // Auto-scroll while the pointer is near the left or right edge.
  useEffect(() => {
    if (!reordering) return;
    const timer = setInterval(() => {
      const rect = rectRef.current;
      const x = pointerX.current;
      if (!rect || x === null) return;
      const delta = edgeScrollDelta(x, rect.x, rect.x + rect.width);
      if (delta === 0) return;
      const max = Math.max(0, latest.current.contentWidth - rect.width);
      const next = Math.max(0, Math.min(max, scrollXRef.current + delta));
      if (next === scrollXRef.current) return;
      scrollXRef.current = next;
      scrollRef.current?.scrollTo({ x: next, animated: false });
      setHoverIndex(indexAtRef.current(x));
    }, 16);
    return () => clearInterval(timer);
  }, [reordering]);

  // ── Resize from a pane's right edge ──
  const onResize = useCallback((agent: AgentRef, next: number | null, done: boolean) => {
    if (!done) {
      if (next !== null) setResizing({ key: agent.key, width: Math.max(PANE_MIN_WIDTH, Math.min(PANE_MAX_WIDTH, next)) });
      return;
    }
    setResizing(null);
    setPaneWidth(agent.key, next);
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport((v) => (v.width === width && v.height === height ? v : { width, height }));
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollXRef.current = e.nativeEvent.contentOffset.x;
    setScrollX(e.nativeEvent.contentOffset.x);
  };
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
          ref={scrollRef}
          horizontal
          scrollEnabled={!reordering && !resizing}
          onScroll={onScroll}
          onLayout={(e) => setScrollHeight(e.nativeEvent.layout.height)}
          scrollEventThrottle={32}
          snapToInterval={compact ? width + GAP : undefined}
          decelerationRate={compact ? "fast" : undefined}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: PAD, gap: 0 }}
        >
          {/* Panes sit at their offsets, so any subset can mount: the visible ones plus the one
              being dragged, which must not unmount mid-gesture. */}
          <View style={{ width: total, height: Math.max(240, scrollHeight - PAD * 2) }}>
            {mounted.map(({ pane, index }) => (
              <View key={pane.key} style={{ position: "absolute", left: offsets[index], top: 0, bottom: 0, width: widths[index] }}>
                <Pane
                  agent={toRef(pane)}
                  width={widths[index]}
                  gap={GAP}
                  p={p}
                  link={linkOf.get(pane.key) ?? { color: p.guide, size: 1, index: 0, depth: 0, parent: null }}
                  otherHost={pane.hostId === ownHost ? null : pane.hostId}
                  onClose={onClose}
                  onOpen={onOpen}
                  onMoveFamily={onMoveFamily}
                  reorder={arranged.length > 1 ? reorder : undefined}
                  onResize={compact ? undefined : onResize}
                  dragging={reordering === pane.key}
                />
              </View>
            ))}
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
