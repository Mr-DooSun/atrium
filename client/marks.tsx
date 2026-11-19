// Row marks shared by the tree and the free chat section.
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Platform, Text, View } from "react-native";
import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { TITLE_LINE, type Bucket, type Palette } from "./look";
import { providerMark } from "./provider-icons";

// ── Status mark: same geometry as Paseo's own sidebar ──────────────────

/** Running: a dot with a quarter arc turning on a faint track, one turn per 900ms. */
function StatusRing({ color }: { color: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const circle = { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 } as const;
  return (
    <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
      <View style={{ ...circle, position: "absolute", borderColor: color, opacity: 0.3 }} />
      <Animated.View style={{ position: "absolute", width: 12, height: 12, transform: [{ rotate }] }}>
        <View style={{ ...circle, borderColor: "transparent", borderTopColor: color, opacity: 0.9 }} />
      </Animated.View>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

export function StatusMark({ bucket, p }: { bucket: Bucket; p: Palette }) {
  let mark: ReactNode;
  if (bucket === "running") mark = <StatusRing color={p.running} />;
  else if (bucket === "needs_input") mark = <Icon name="CircleAlert" size={12} color={p.warning} />;
  else {
    const color = bucket === "failed" ? p.danger : bucket === "attention" ? p.success : p.idle;
    mark = (
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
          opacity: bucket === "done" ? 0.3 : 1,
        }}
      />
    );
  }
  return (
    <View style={{ width: 16, height: TITLE_LINE, alignItems: "center", justifyContent: "center" }}>
      {mark}
    </View>
  );
}

export function agentBucket(
  a: Pick<PluginAgentSnapshot, "status" | "requiresAttention" | "attentionReason">,
): Bucket {
  if (a.status === "error" || a.attentionReason === "error") return "failed";
  if (a.status === "running" || a.status === "initializing") return "running";
  if (a.requiresAttention && a.attentionReason === "permission") return "needs_input";
  if (a.requiresAttention && a.attentionReason === "finished") return "attention";
  return "done";
}

/** The provider's own mark, as on Paseo's agent tabs; a generic bot for unknown providers. */
export function ProviderMark({ provider, p }: { provider: string; p: Palette }) {
  const mark = providerMark(provider);
  return (
    <View
      accessible
      accessibilityLabel={provider}
      style={{ width: 16, height: TITLE_LINE, alignItems: "center", justifyContent: "center" }}
    >
      {mark ? (
        <Icon icon={{ svg: mark.svg }} size={15} color={mark.color ?? p.muted} />
      ) : (
        <Icon name="Bot" size={14} color={p.muted} />
      )}
    </View>
  );
}

/** Secondary row content uses a single line, even at deep tree indents. */
export function MetaLine({ icon, p, children }: { icon?: string; p: Palette; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", minWidth: 0, alignItems: "center", gap: 4 }}>
      {icon ? <Icon name={icon} size={12} color={p.muted} /> : null}
      <Text numberOfLines={1} selectable={false} style={{ flexShrink: 1, minWidth: 0, color: p.muted, fontSize: 12 }}>
        {children}
      </Text>
    </View>
  );
}

/** States worth surfacing on a folded row, most urgent first. "done" is never surfaced. */
export const URGENT: readonly Bucket[] = ["needs_input", "failed", "running", "attention"];

/** The most urgent of several states; "done" when none is urgent. */
export function mostUrgent(...buckets: readonly (Bucket | null | undefined)[]): Bucket {
  for (const level of URGENT) if (buckets.includes(level)) return level;
  return "done";
}
