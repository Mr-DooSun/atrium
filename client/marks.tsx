// Row marks shared by the tree and the free chat section.
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Platform, Text, View } from "react-native";
import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import { useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { WorktreeInfo } from "../shared/project-rpc";
import { ROW, TITLE_LINE, showsFolderChip, worktreeColor, type Bucket, type Palette, type WorktreeBadgeSpec } from "./look";
import { providerMark } from "./provider-icons";
import { sidebarText } from "./sidebar-strings";

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

const STATUS_LABEL = {
  needs_input: "statusNeedsInput",
  failed: "statusFailed",
  running: "statusRunning",
  attention: "statusAttention",
  done: "statusDone",
} as const satisfies Record<Bucket, string>;

export function StatusMark({ bucket, p }: { bucket: Bucket; p: Palette }) {
  // Read out like Paseo's own sidebar does ("waiting for review" and so on), not left silent.
  const { t } = useTranslation(sidebarText);
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
    <View
      accessible
      accessibilityLabel={t(STATUS_LABEL[bucket])}
      style={{ width: 16, height: TITLE_LINE, alignItems: "center", justifyContent: "center" }}
    >
      {mark}
    </View>
  );
}

export function isAgentTurnActive(status: PluginAgentSnapshot["status"]) {
  return status === "running" || status === "initializing";
}

export function agentBucket(
  a: Pick<PluginAgentSnapshot, "status" | "requiresAttention" | "attentionReason">,
  hasPendingPermission = false,
): Bucket {
  if (a.status === "error" || a.attentionReason === "error") return "failed";
  if (hasPendingPermission || (a.requiresAttention && a.attentionReason === "permission")) return "needs_input";
  if (isAgentTurnActive(a.status)) return "running";
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

/** States worth surfacing on a folded row, most urgent first. "done" is never surfaced. */
export const URGENT: readonly Bucket[] = ["needs_input", "failed", "running", "attention"];

/** The most urgent of several states; "done" when none is urgent. */
export function mostUrgent(...buckets: readonly (Bucket | null | undefined)[]): Bucket {
  for (const level of URGENT) if (buckets.includes(level)) return level;
  return "done";
}

// ── Worktree badge ─────────────────────────────────────────────────────

type GitWorktree = Extract<WorktreeInfo, { kind: "git" }>;

/**
 * The branch a session works on and, for a linked worktree, the worktree's folder, in the color
 * every session of that worktree shares. `spec` comes from `worktreeBadge`. Long names are cut; the
 * full branch and path are in the tooltip and the accessibility label.
 */
export function WorktreeBadge({ info, spec, p }: { info: GitWorktree; spec: WorktreeBadgeSpec; p: Palette }) {
  const { t } = useTranslation(sidebarText);
  const linked = spec.tone === "linked";
  const color = linked ? worktreeColor(p, info.worktreePath) : p.muted;
  const branch = spec.detached ? t("worktreeDetached", { head: spec.label }) : spec.label;
  const label = spec.folder ? t("worktreeLinked", { folder: spec.folder, branch }) : t("worktreeMain", { branch });
  // react-native-web drops `title` and the plugin SDK has no tooltip, so the full path is only
  // in the accessibility label.
  const full = `${label}. ${t("worktreePath", { path: info.worktreePath })}`;
  return (
    <View
      accessible
      accessibilityLabel={full}
      // Never wider than the row: the branch (or the word "detached") gives way first, then the chip.
      style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, maxWidth: "100%", overflow: "hidden" }}
    >
      <View style={{ flexShrink: 0 }}>
        <Icon name={linked ? "FolderGit2" : "GitBranch"} size={12} color={color} />
      </View>
      {spec.detached ? (
        // The hash tells detached rows apart, so it never shrinks; the word before it may be cut.
        <>
          <Text numberOfLines={1} style={{ flexShrink: 0, color, fontSize: 12, opacity: linked ? 1 : 0.8 }}>
            {spec.label}
          </Text>
          <Text numberOfLines={1} style={{ flexShrink: 4, minWidth: 0, color, fontSize: 12, opacity: 0.7 }}>
            {t("worktreeDetached", { head: "" }).trim()}
          </Text>
        </>
      ) : (
        <Text numberOfLines={1} style={{ flexShrink: 4, minWidth: 0, color, fontSize: 12, opacity: linked ? 1 : 0.8 }}>
          {spec.label}
        </Text>
      )}
      {showsFolderChip(spec) ? (
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            minWidth: 24,
            maxWidth: 112,
            color,
            fontSize: 11,
            paddingHorizontal: 5,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: color,
            opacity: 0.85,
          }}
        >
          {spec.folder}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A thin bar on a row's left edge, in its worktree's color, so sessions of one worktree line up
 * (grey for the main checkout, drawn only in a run there).
 * Where the row drawn above or below is in the same checkout, the bar reaches the row's edge (and
 * across the gap below), so a run of rows reads as one unbroken line instead of dashes.
 */
export function WorktreeBar({
  info,
  spec,
  lane,
  p,
}: {
  info: GitWorktree;
  spec: WorktreeBadgeSpec;
  lane: { joinAbove: boolean; joinBelow: boolean } | null;
  p: Palette;
}) {
  const up = lane?.joinAbove ?? false;
  const down = lane?.joinBelow ?? false;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 2,
        top: up ? 0 : 6,
        bottom: down ? -ROW.gap : 6,
        width: 3,
        borderTopLeftRadius: up ? 0 : 2,
        borderTopRightRadius: up ? 0 : 2,
        borderBottomLeftRadius: down ? 0 : 2,
        borderBottomRightRadius: down ? 0 : 2,
        // A linked worktree in its own color; the main checkout off its default branch in grey.
        backgroundColor: spec.tone === "linked" ? worktreeColor(p, info.worktreePath) : p.muted,
        opacity: 0.8,
      }}
    />
  );
}
