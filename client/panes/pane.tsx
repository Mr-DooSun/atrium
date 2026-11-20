// One chat column: header (provider, title, status, actions) over the agent's timeline.
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, PanResponder, Platform, Pressable, Text, View, type GestureResponderEvent, type NativeSyntheticEvent, type TextInputKeyPressEventData } from "react-native";
import { useAgent, usePaseo, useRpc, useSubscription, useTranslation, type AgentRef } from "@getpaseo/plugin/client";
import { FlatList, Icon, Markdown, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { chatOlder, chatTimelines, type ChatItem } from "../../shared/chat/rpc";
import { panesText } from "../chat-strings";
import { TITLE_LINE, type Palette } from "../look";
import { ProviderMark, StatusMark, agentBucket, isAgentTurnActive } from "../marks";
import { applyOlder, applyTimelineEvent, displayItems, type AgentTimeline, type Timelines } from "./timeline";

export interface PaneLink {
  /** Family color shared by every pane of the family. */
  color: string;
  /** Members in this family block (1 = alone, no link drawn). */
  size: number;
  /** Position within the family block. */
  index: number;
  depth: number;
  /** The nearest open ancestor, for the "sub-agent of" line. */
  parent: AgentRef | null;
}

export interface PaneProps {
  agent: AgentRef;
  width: number;
  gap: number;
  p: Palette;
  link: PaneLink;
  /** Set when the agent lives on another host than the plugin's: its timeline can't load here. */
  otherHost?: string | null;
  onClose(agent: AgentRef): void;
  onOpen(agent: AgentRef): void;
  onMoveFamily(agent: AgentRef, delta: -1 | 1): void;
  /** Drag-to-reorder from the header grip, in page coordinates. Omitted: no grip. */
  reorder?: PaneReorderHandlers;
  /** Live resize from the right-edge handle; null resets to the default width. Omitted: no handle. */
  onResize?(agent: AgentRef, width: number | null, done: boolean): void;
  /** This pane is the one being dragged. */
  dragging?: boolean;
}

export interface PaneReorderHandlers {
  onStart(agent: AgentRef, pageX: number): void;
  onMove(pageX: number): void;
  /** null: the gesture was cancelled. */
  onEnd(pageX: number | null): void;
}

export const PANE_BAND = 24;
/** Rows per snapshot and per older page. */
export const TAIL = 100;

export const Pane = memo(function Pane({
  agent,
  width,
  gap,
  p,
  link,
  otherHost,
  onClose,
  onOpen,
  onMoveFamily,
  reorder,
  onResize,
  dragging,
}: PaneProps) {
  const { t } = useTranslation(panesText);
  const info = useAgent(agent, (a) => ({
    title: a.title,
    provider: a.provider,
    status: a.status,
    requiresAttention: a.requiresAttention,
    attentionReason: a.attentionReason,
  }), shallowEqual);
  const title = info?.title || t("untitled");
  const linked = link.size > 1;
  const first = link.index === 0;
  const last = link.index === link.size - 1;

  return (
    <View style={{ width, height: "100%", opacity: dragging ? 0.45 : 1 }}>
      {/* Family band: one color across the whole family, bridging the gaps between its panes. */}
      <View style={{ height: PANE_BAND, justifyContent: "center" }}>
        {linked ? (
          <View
            style={{
              position: "absolute",
              left: first ? 0 : -gap,
              right: 0,
              top: PANE_BAND / 2 - 1,
              height: 2,
              backgroundColor: link.color,
              opacity: 0.7,
            }}
          />
        ) : null}
        {linked && first ? (
          <View style={{ alignSelf: "flex-start", marginLeft: 8, paddingHorizontal: 8, borderRadius: 10, backgroundColor: link.color }}>
            <Text numberOfLines={1} style={{ color: "#fff", fontSize: 11, lineHeight: 18, fontWeight: "600" }}>
              {t("family", { n: link.size })}
            </Text>
          </View>
        ) : null}
        {linked && !last ? (
          <View style={{ position: "absolute", right: -gap / 2 - 4, top: PANE_BAND / 2 - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: link.color }} />
        ) : null}
      </View>
      <View
        style={{
          flex: 1,
          minHeight: 0,
          borderWidth: 1,
          borderColor: linked ? link.color : p.guide,
          borderTopWidth: linked ? 3 : 1,
          borderRadius: 10,
          backgroundColor: p.background,
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: p.guide }}>
          {reorder ? <DragGrip agent={agent} handlers={reorder} label={first ? t("dragFamily") : t("drag")} p={p} /> : null}
          <View style={{ paddingLeft: Math.min(link.depth, 4) * 6 }}>
            <ProviderMark provider={info?.provider ?? ""} p={p} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: p.foreground, fontSize: 14, lineHeight: TITLE_LINE, fontWeight: "600" }}>
              {title}
            </Text>
            {link.parent ? <ParentLine parent={link.parent} p={p} /> : null}
          </View>
          {info ? <StatusMark bucket={agentBucket(info)} p={p} /> : null}
          {first ? (
            <>
              <HeaderButton icon="ChevronLeft" label={t("moveLeft")} p={p} onPress={() => onMoveFamily(agent, -1)} />
              <HeaderButton icon="ChevronRight" label={t("moveRight")} p={p} onPress={() => onMoveFamily(agent, 1)} />
            </>
          ) : null}
          <HeaderButton icon="ExternalLink" label={t("openInPaseo")} p={p} onPress={() => onOpen(agent)} />
          <HeaderButton icon="X" label={t("close")} p={p} onPress={() => onClose(agent)} />
        </View>
        {otherHost ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16, gap: 8 }}>
            <Icon name="ServerOff" size={20} color={p.muted} />
            <Text style={{ color: p.muted, fontSize: 12, textAlign: "center" }}>{t("otherHost", { host: otherHost })}</Text>
          </View>
        ) : (
          <PaneBody agent={agent} p={p} />
        )}
      </View>
      {onResize ? <ResizeHandle agent={agent} width={width} gap={gap} onResize={onResize} label={t("resize")} p={p} /> : null}
    </View>
  );
});

function pageXOf(e: GestureResponderEvent): number {
  return e.nativeEvent.pageX;
}

/** Header grip: press and drag sideways to move the pane (a family's first pane moves the family). */
function DragGrip({ agent, handlers, label, p }: { agent: AgentRef; handlers: PaneReorderHandlers; label: string; p: Palette }) {
  const latest = useRef({ agent, handlers });
  latest.current = { agent, handlers };
  const lastX = useRef(0);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          lastX.current = pageXOf(e);
          latest.current.handlers.onStart(latest.current.agent, lastX.current);
        },
        onPanResponderMove: (e) => {
          lastX.current = pageXOf(e);
          latest.current.handlers.onMove(lastX.current);
        },
        onPanResponderRelease: () => latest.current.handlers.onEnd(lastX.current),
        onPanResponderTerminate: () => latest.current.handlers.onEnd(null),
      }),
    [],
  );
  const [hovered, setHovered] = useState(false);
  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityLabel={label}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{ width: 14, height: TITLE_LINE, marginLeft: -4, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: hovered ? p.hover : "transparent", cursor: "grab" } as object}
    >
      <Icon name="GripVertical" size={13} color={p.muted} />
    </View>
  );
}

const DOUBLE_TAP_MS = 300;

/** Thin handle on the right edge: drag to resize, double-click/tap to reset. */
function ResizeHandle({
  agent,
  width,
  gap,
  onResize,
  label,
  p,
}: {
  agent: AgentRef;
  width: number;
  gap: number;
  onResize(agent: AgentRef, width: number | null, done: boolean): void;
  label: string;
  p: Palette;
}) {
  const latest = useRef({ agent, width, onResize });
  latest.current = { agent, width, onResize };
  const start = useRef(0);
  const lastTap = useRef(0);
  const [active, setActive] = useState(false);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = latest.current.width;
          setActive(true);
        },
        onPanResponderMove: (_e, g) => latest.current.onResize(latest.current.agent, start.current + g.dx, false),
        onPanResponderRelease: (_e, g) => {
          setActive(false);
          const { agent, onResize } = latest.current;
          if (Math.abs(g.dx) < 3) {
            const now = Date.now();
            if (now - lastTap.current < DOUBLE_TAP_MS) {
              lastTap.current = 0;
              onResize(agent, null, true);
            } else {
              lastTap.current = now;
              onResize(agent, start.current, true);
            }
            return;
          }
          onResize(agent, start.current + g.dx, true);
        },
        onPanResponderTerminate: () => {
          setActive(false);
          latest.current.onResize(latest.current.agent, start.current, true);
        },
      }),
    [],
  );
  const [hovered, setHovered] = useState(false);
  const lit = active || hovered;
  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityLabel={label}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        top: PANE_BAND,
        bottom: 0,
        right: -(gap / 2) - 4,
        width: 8,
        alignItems: "center",
        justifyContent: "center",
        cursor: "col-resize",
      } as object}
    >
      <View style={{ width: lit ? 3 : 1, height: lit ? "100%" : 32, borderRadius: 2, backgroundColor: lit ? p.running : p.guide }} />
    </View>
  );
}

/** Only mounted when the agent has a parent pane, so useAgent never sees an empty ref. */
function ParentLine({ parent, p }: { parent: AgentRef; p: Palette }) {
  const { t } = useTranslation(panesText);
  const title = useAgent(parent, (a) => a.title);
  return (
    <Text numberOfLines={1} style={{ color: p.muted, fontSize: 11 }}>
      {"↳ "}
      {t("childOf", { title: title || t("untitled") })}
    </Text>
  );
}

/**
 * The live part of an own-host pane: its own `chatTimelines` subscription (so scrolling only
 * adds or removes this one), its rows (dropped when the pane unmounts), and the composer.
 */
function PaneBody({ agent, p }: { agent: AgentRef; p: Palette }) {
  const { t } = useTranslation(panesText);
  // Timelines map of one entry, so the shared pure reducers apply unchanged.
  const [state, setState] = useState<Timelines>(() => new Map());
  const input = useMemo(() => ({ agentIds: [agent.id], tail: TAIL }), [agent.id]);
  useSubscription(chatTimelines, input, (event) => setState((s) => applyTimelineEvent(s, event)));
  const timeline: AgentTimeline | undefined = state.get(agent.id);

  const fetchOlder = useRpc(chatOlder);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const latest = useRef(timeline);
  latest.current = timeline;
  const loadOlder = useCallback(() => {
    const tl = latest.current;
    const oldest = tl?.items[0];
    if (!tl || !oldest || !tl.hasMore || loadingOlder) return;
    setLoadingOlder(true);
    fetchOlder({ agentId: agent.id, beforeSeq: oldest.seq, limit: TAIL })
      // Dropped if a snapshot replaced the rows while the page was in flight.
      .then((page) => setState((s) => applyOlder(s, agent.id, tl.epoch, page, oldest.seq)))
      .catch(() => undefined)
      .finally(() => setLoadingOlder(false));
  }, [agent.id, fetchOlder, loadingOlder]);

  // Streamed replies arrive as one row per chunk; join them for display. Newest first for the
  // inverted list, which starts at the bottom and grows upward.
  const data = useMemo(() => (timeline ? displayItems(timeline.items).reverse() : []), [timeline]);

  return (
    <>
        {timeline?.error ? (
          <Text style={{ color: p.danger, fontSize: 12, padding: 10 }}>{t("loadFailed", { message: timeline.error })}</Text>
        ) : null}
        {!timeline ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={p.muted} />
          </View>
        ) : data.length === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
            <Text style={{ color: p.muted, fontSize: 12 }}>{t("noMessages")}</Text>
          </View>
        ) : (
          <FlatList
            inverted
            data={data}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <Row item={item} p={p} />}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.5}
            initialNumToRender={20}
            windowSize={7}
            contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}
            ListFooterComponent={
              loadingOlder ? (
                <View style={{ paddingVertical: 8, alignItems: "center" }}>
                  <Text style={{ color: p.muted, fontSize: 11 }}>{t("loadingOlder")}</Text>
                </View>
              ) : null
            }
          />
        )}
      <Composer agent={agent} p={p} />
    </>
  );
}

/** react-native-web passes these DOM KeyboardEvent fields through on `nativeEvent`. */
type KeyPress = TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean; keyCode?: number };

function Composer({ agent, p }: { agent: AgentRef; p: Palette }) {
  const { t } = useTranslation(panesText);
  const paseo = usePaseo();
  const working = useAgent(agent, (a) => isAgentTurnActive(a.status)) ?? false;
  const toast = useToast();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const canSend = text.trim().length > 0 && !sending;

  const send = () => {
    if (!canSend) return;
    const message = text;
    setSending(true);
    paseo.agents
      .ref(agent)
      // Steer, never interrupt: a side pane must not cut off a running turn (the daemon
      // interrupts when this is omitted).
      .send(message, { activeTurnBehavior: "steer" })
      .then(() => setText((cur) => (cur === message ? "" : cur)))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : t("sendFailed")))
      .finally(() => setSending(false));
  };

  // Desktop: Enter sends, Shift+Enter breaks the line. Touch keyboards keep Enter as a newline.
  const onKeyPress = (e: NativeSyntheticEvent<KeyPress>) => {
    const k = e.nativeEvent;
    if (Platform.OS !== "web" || k.key !== "Enter" || k.shiftKey) return;
    // Enter that confirms an IME composition (Korean, Japanese, Chinese) is not a send.
    if (k.isComposing || k.keyCode === 229) return;
    // Keep the newline out of the box (react-native-web forwards preventDefault to the DOM).
    (e as { preventDefault?(): void }).preventDefault?.();
    send();
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, padding: 8, borderTopWidth: 1, borderTopColor: p.guide }}>
      <TextInput
        multiline
        value={text}
        onChangeText={setText}
        onKeyPress={onKeyPress}
        editable={!sending}
        placeholder={working ? t("composerSteer") : t("composerPlaceholder")}
        placeholderTextColor={p.muted}
        accessibilityLabel={t("composerPlaceholder")}
        style={{
          flex: 1,
          minHeight: 34,
          maxHeight: 120,
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: p.guide,
          color: p.foreground,
          fontSize: 13,
          lineHeight: 18,
          opacity: sending ? 0.6 : 1,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("send")}
        accessibilityState={{ disabled: !canSend, busy: sending }}
        disabled={!canSend}
        onPress={send}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: canSend ? (pressed ? p.pressed : p.running) : p.hover,
        })}
      >
        {sending ? <ActivityIndicator size="small" color={p.muted} /> : <Icon name="ArrowUp" size={16} color={canSend ? "#fff" : p.muted} />}
      </Pressable>
    </View>
  );
}

function HeaderButton({ icon, label, p, onPress }: { icon: string; label: string; p: Palette; onPress(): void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={({ pressed }) => ({
        width: 22,
        height: TITLE_LINE,
        borderRadius: 5,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? p.pressed : hovered ? p.hover : "transparent",
      })}
    >
      <Icon name={icon} size={13} color={p.muted} />
    </Pressable>
  );
}

const Row = memo(function Row({ item, p }: { item: ChatItem; p: Palette }) {
  const { t } = useTranslation(panesText);
  if (item.kind === "user") {
    return (
      <View style={{ alignSelf: "flex-end", maxWidth: "88%", marginVertical: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: p.hover }}>
        <Text selectable style={{ color: p.foreground, fontSize: 13, lineHeight: 19 }}>{item.text}</Text>
      </View>
    );
  }
  if (item.kind === "assistant") {
    return (
      <View style={{ marginVertical: 4 }}>
        <Markdown>{item.text}</Markdown>
      </View>
    );
  }
  const label = item.kind === "tool" ? item.toolName || t("tool") : item.kind === "reasoning" ? t("thinking") : null;
  return (
    <View style={{ flexDirection: "row", gap: 6, marginVertical: 2, opacity: 0.75 }}>
      {label ? (
        <Text numberOfLines={1} style={{ color: p.muted, fontSize: 11, fontWeight: "600", maxWidth: "40%" }}>{label}</Text>
      ) : null}
      <Text numberOfLines={item.kind === "reasoning" ? 4 : 2} style={{ flex: 1, color: p.muted, fontSize: 11, lineHeight: 16 }}>
        {item.text}
      </Text>
    </View>
  );
});

function shallowEqual<T extends Record<string, unknown>>(a: T | null, b: T | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.is(a[k], b[k]));
}
