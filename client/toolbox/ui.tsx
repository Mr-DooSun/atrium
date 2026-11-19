// Small building blocks shared by the toolbox screens. Paseo's own rhythm: 8px radii, 36px rows,
// muted 12px labels, colors from the theme through client/look.ts.
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { MCP_SCOPES, type AuthState, type Ecosystem, type McpServer, type Profile, type ProviderKind } from "../../shared/toolbox/types";
import { ROW, type Palette } from "../look";
import { providerMark } from "../provider-icons";
import { t } from "./strings";

export const MONO = "Menlo";
export const RADIUS = 8;

export interface Look {
  p: Palette;
  compact: boolean;
}

const LookContext = createContext<Look | null>(null);
export const LookProvider = LookContext.Provider;

export function useLook(): Look {
  const look = useContext(LookContext);
  if (!look) throw new Error("toolbox: LookProvider missing");
  return look;
}

/** Lets a list deep in the screen ask to be told when the screen is scrolled near its end. */
type EndListener = () => void;
const EndReachedContext = createContext<{ add(listener: EndListener): () => void } | null>(null);

export function useOnScreenEnd(listener: EndListener) {
  const registry = useContext(EndReachedContext);
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => registry?.add(() => latest.current()), [registry]);
}

/** Screen body: one vertical scroll owner, centred column on wide layouts. */
export function ScreenBody({ children }: { children: ReactNode }) {
  const { p, compact } = useLook();
  const listeners = useRef(new Set<EndListener>());
  const registry = useRef({
    add(listener: EndListener) {
      listeners.current.add(listener);
      return () => void listeners.current.delete(listener);
    },
  }).current;
  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      // Within ~one screen of the bottom.
      if (contentOffset.y + layoutMeasurement.height >= contentSize.height - layoutMeasurement.height) {
        for (const listener of listeners.current) listener();
      }
    },
    [],
  );
  return (
    <EndReachedContext.Provider value={registry}>
    <ScrollView
      onScroll={onScroll}
      scrollEventThrottle={200}
      style={{ flex: 1, backgroundColor: p.background }}
      contentContainerStyle={{
        padding: compact ? 12 : 24,
        gap: 16,
        width: "100%",
        maxWidth: 820,
        alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
    </EndReachedContext.Provider>
  );
}

export function SectionLabel({ children, trailing }: { children: string; trailing?: ReactNode }) {
  const { p } = useLook();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 }}>
      <Text style={{ flex: 1, color: p.muted, fontSize: 12, fontWeight: "500" }}>{children}</Text>
      {trailing}
    </View>
  );
}

type Tone = "default" | "primary" | "danger";

export function Button({
  label,
  icon,
  onPress,
  tone = "default",
  disabled,
  small,
}: {
  label: string;
  icon?: string;
  onPress(): void;
  tone?: Tone;
  disabled?: boolean;
  small?: boolean;
}) {
  const { p } = useLook();
  const filled = tone !== "default";
  const bg = tone === "danger" ? p.danger : tone === "primary" ? p.foreground : "transparent";
  const fg = tone === "danger" ? "#ffffff" : tone === "primary" ? p.background : p.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: small ? 28 : 32,
        paddingHorizontal: small ? 10 : 14,
        borderRadius: RADIUS,
        borderWidth: filled ? 0 : 1,
        borderColor: p.guide,
        backgroundColor: filled ? bg : pressed ? p.pressed : "transparent",
        opacity: disabled ? 0.45 : filled && pressed ? 0.85 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={small ? 13 : 14} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: small ? 12 : 13, fontWeight: filled ? "600" : "400" }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: string;
  label: string;
  onPress(): void;
  busy?: boolean;
}) {
  const { p } = useLook();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? p.pressed : "transparent",
      })}
    >
      {busy ? <ActivityIndicator size="small" color={p.muted} /> : <Icon name={icon} size={15} color={p.muted} />}
    </Pressable>
  );
}

/** A segmented row of choices; scrolls sideways when it does not fit. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: readonly { value: V; label: string; disabled?: boolean }[];
  onChange(value: V): void;
}) {
  const { p } = useLook();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
      <View style={{ flexDirection: "row", gap: 4, padding: 2, borderRadius: RADIUS, backgroundColor: p.hover }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active, disabled: !!o.disabled }}
              accessibilityLabel={o.label}
              disabled={o.disabled}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => ({
                height: 28,
                paddingHorizontal: 12,
                borderRadius: RADIUS - 2,
                justifyContent: "center",
                backgroundColor: active ? p.background : pressed ? p.pressed : "transparent",
                opacity: o.disabled ? 0.4 : 1,
              })}
            >
              <Text style={{ color: active ? p.foreground : p.muted, fontSize: 13, fontWeight: active ? "600" : "400" }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** A bordered group of rows. */
export function Card({ children }: { children: ReactNode }) {
  const { p } = useLook();
  return (
    <View style={{ borderWidth: 1, borderColor: p.guide, borderRadius: RADIUS, overflow: "hidden" }}>{children}</View>
  );
}

/** One 36px row: leading slot, title + meta lines, trailing actions (below the text on compact). */
export function ListRow({
  leading,
  title,
  badge,
  meta,
  detail,
  detailTone,
  actions,
  first,
  below,
}: {
  leading?: ReactNode;
  title: string;
  badge?: ReactNode;
  meta?: string | null;
  detail?: string | null;
  detailTone?: "muted" | "danger" | "warning";
  actions?: ReactNode;
  first?: boolean;
  /** Extra block under the text lines (e.g. the per-profile strip); wraps with the text column. */
  below?: ReactNode;
}) {
  const { p, compact } = useLook();
  const detailColor = detailTone === "danger" ? p.danger : detailTone === "warning" ? p.warning : p.muted;
  const text = (
    <View style={{ flex: 1, minWidth: 0, gap: ROW.lineGap }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Text numberOfLines={1} style={{ flexShrink: 1, color: p.foreground, fontSize: 14, fontWeight: "500" }}>
          {title}
        </Text>
        {badge}
      </View>
      {meta ? (
        <Text numberOfLines={compact ? 2 : 1} style={{ color: p.muted, fontSize: 12 }}>
          {meta}
        </Text>
      ) : null}
      {detail ? <Text style={{ color: detailColor, fontSize: 12, lineHeight: 17 }}>{detail}</Text> : null}
      {below}
    </View>
  );
  const rowStyle: ViewStyle = {
    minHeight: ROW.minHeight,
    paddingVertical: ROW.paddingVertical,
    paddingHorizontal: 12,
    borderTopWidth: first ? 0 : 1,
    borderTopColor: p.guide,
    gap: 8,
  };
  if (compact) {
    return (
      <View style={rowStyle}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          {leading ? <View style={{ height: 20, justifyContent: "center" }}>{leading}</View> : null}
          {text}
        </View>
        {actions ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{actions}</View> : null}
      </View>
    );
  }
  return (
    <View style={[rowStyle, { flexDirection: "row", alignItems: "flex-start", gap: 10 }]}>
      {leading ? <View style={{ height: 20, justifyContent: "center" }}>{leading}</View> : null}
      {text}
      {actions ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>{actions}</View> : null}
    </View>
  );
}

export function Badge({ label, tone = "muted" }: { label: string; tone?: "muted" | "success" | "warning" | "danger" }) {
  const { p } = useLook();
  const color = tone === "success" ? p.success : tone === "warning" ? p.warning : tone === "danger" ? p.danger : p.muted;
  return (
    <View style={{ paddingHorizontal: 6, height: 18, borderRadius: 5, borderWidth: 1, borderColor: p.guide, justifyContent: "center" }}>
      <Text style={{ color, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

export function Dot({ color }: { color: string }) {
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
}

export function mcpStatusColor(p: Palette, status: McpServer["status"]): string {
  switch (status) {
    case "connected":
      return p.success;
    case "failed":
      return p.danger;
    case "needs_auth":
      return p.warning;
    case "pending":
      return p.running;
    default:
      return p.idle;
  }
}

export function authTone(state: AuthState["state"]): "success" | "warning" | "muted" {
  return state === "logged_in" ? "success" : state === "logged_out" ? "warning" : "muted";
}

export function ProviderGlyph({ provider, size = 15 }: { provider: string; size?: number }) {
  const { p } = useLook();
  const mark = providerMark(provider);
  if (!mark) return <Icon name="Bot" size={size - 1} color={p.muted} />;
  return <Icon icon={{ svg: mark.svg }} size={size} color={mark.color ?? p.muted} />;
}

/** Value of the switcher's "all profiles" choice. Never a Paseo provider id. */
export const ALL_PROFILES = "*all*";

/** Horizontal chips, one per profile, with login state; refresh re-runs the auth checks.
 *  `withAll` adds a leading "전체" chip whose value is ALL_PROFILES. */
export function ProfileSwitcher({
  profiles,
  value,
  onChange,
  onRefresh,
  refreshing,
  withAll,
}: {
  profiles: readonly Profile[];
  value: string | null;
  onChange(id: string): void;
  onRefresh(): void;
  refreshing: boolean;
  withAll?: boolean;
}) {
  const { p } = useLook();
  const allActive = value === ALL_PROFILES;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {withAll ? (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: allActive }}
              accessibilityLabel={t.profile.all}
              onPress={() => onChange(ALL_PROFILES)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                height: 36,
                paddingHorizontal: 12,
                borderRadius: RADIUS,
                borderWidth: 1,
                borderColor: allActive ? p.muted : p.guide,
                backgroundColor: allActive ? p.selected : pressed ? p.pressed : "transparent",
              })}
            >
              <Icon name="Layers" size={14} color={p.foreground} />
              <Text style={{ color: p.foreground, fontSize: 13, fontWeight: allActive ? "600" : "400" }}>{t.profile.all}</Text>
            </Pressable>
          ) : null}
          {profiles.map((profile) => {
            const active = profile.id === value;
            const tone = authTone(profile.auth.state);
            const toneColor = tone === "success" ? p.success : tone === "warning" ? p.warning : p.idle;
            return (
              <Pressable
                key={profile.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${profile.label} · ${t.auth[profile.auth.state]}`}
                onPress={() => onChange(profile.id)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  height: 36,
                  paddingHorizontal: 12,
                  borderRadius: RADIUS,
                  borderWidth: 1,
                  borderColor: active ? p.muted : p.guide,
                  backgroundColor: active ? p.selected : pressed ? p.pressed : "transparent",
                  opacity: profile.enabled ? 1 : 0.6,
                })}
              >
                <ProviderGlyph provider={profile.id} />
                <Text numberOfLines={1} style={{ color: p.foreground, fontSize: 13, fontWeight: active ? "600" : "400" }}>
                  {profile.label}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Dot color={toneColor} />
                  <Text style={{ color: p.muted, fontSize: 11 }}>
                    {profile.enabled ? t.auth[profile.auth.state] : t.auth.disabledProfile}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <IconButton icon="RefreshCw" label={t.common.refresh} onPress={onRefresh} busy={refreshing} />
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: string; title: string; body?: string; action?: ReactNode }) {
  const { p } = useLook();
  return (
    <View
      style={{
        alignItems: "center",
        gap: 8,
        paddingVertical: 32,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: p.guide,
        borderStyle: "dashed",
        borderRadius: RADIUS,
      }}
    >
      <Icon name={icon} size={20} color={p.muted} />
      <Text style={{ color: p.foreground, fontSize: 14, fontWeight: "500", textAlign: "center" }}>{title}</Text>
      {body ? <Text style={{ color: p.muted, fontSize: 13, lineHeight: 19, textAlign: "center" }}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function Notice({ text, tone = "muted" }: { text: string; tone?: "muted" | "warning" | "danger" }) {
  const { p } = useLook();
  const color = tone === "danger" ? p.danger : tone === "warning" ? p.warning : p.muted;
  return (
    <View style={{ flexDirection: "row", gap: 8, padding: 10, borderRadius: RADIUS, backgroundColor: p.hover }}>
      <Icon name={tone === "muted" ? "Info" : "TriangleAlert"} size={14} color={color} />
      <Text selectable style={{ flex: 1, color, fontSize: 12, lineHeight: 17 }}>
        {text}
      </Text>
    </View>
  );
}

export function LoadingLine({ label = t.common.loading }: { label?: string }) {
  const { p } = useLook();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36 }}>
      <ActivityIndicator size="small" color={p.muted} />
      <Text style={{ color: p.muted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

/** Monospace block for commands and output; selectable for OS copy. */
export function CodeBlock({ text }: { text: string }) {
  const { p } = useLook();
  return (
    <View style={{ padding: 10, borderRadius: RADIUS, backgroundColor: p.hover, borderWidth: 1, borderColor: p.guide }}>
      <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
        <Text selectable style={{ color: p.foreground, fontFamily: MONO, fontSize: 12, lineHeight: 18 }}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}

/** Top bar back to the chat the screen was opened from. Hidden when there is no such chat. */
export function BackBar({
  agentId,
  title,
  hostId,
  navigation,
}: {
  agentId: string | undefined;
  /** Chat title passed in the screen params (screens have no plugin state host for useAgent). */
  title: string | undefined;
  hostId: string;
  navigation: PluginScreenProps["navigation"];
}) {
  const { p, compact } = useLook();
  if (!agentId || !navigation) return null;
  return (
    <View
      // No divider; sits in the same centred column as the screen body, its arrow lined up with
      // the content's left edge (the 30px button pads the 16px glyph by 7px).
      style={{
        flexDirection: "row",
        alignItems: "center",
        width: "100%",
        maxWidth: 820,
        alignSelf: "center",
        paddingTop: compact ? 10 : 16,
        paddingHorizontal: (compact ? 12 : 24) - 7,
        backgroundColor: p.background,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title ? t.back.toChat(title) : t.back.label}
        hitSlop={6}
        onPress={() => navigation.openAgent({ agentId, serverId: hostId })}
        style={({ pressed }) => ({
          width: 30,
          height: 30,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: RADIUS,
          backgroundColor: pressed ? p.pressed : "transparent",
        })}
      >
        <Icon name="ArrowLeft" size={16} color={p.foreground} />
      </Pressable>
    </View>
  );
}

/** Short name of a profile for dense strips: "기본" for the built-in provider, else the id
 *  without its kind prefix ("claude-pb1" -> "pb1"). */
export function shortLabel(profile: Profile): string {
  if (profile.id === profile.kind) return t.common.default;
  const prefix = `${profile.kind}-`;
  return profile.id.startsWith(prefix) && profile.id.length > prefix.length ? profile.id.slice(prefix.length) : profile.label;
}

/** Bulk actions may only target profiles whose CLI is installed and logged in (or unknown). */
export function bulkSelectable(profile: Profile): boolean {
  return profile.auth.state !== "logged_out" && profile.auth.state !== "not_installed";
}

/** Presence of one item in one profile. "loading": not known yet (or could not be listed). */
export type Presence = { kind: "present"; color: string; label: string } | { kind: "absent" } | { kind: "unknown"; label: string };

/** One chip per profile: provider mark, short label and a status dot (hollow = not there). */
export function ProfileStrip({ items }: { items: readonly { profile: Profile; presence: Presence }[] }) {
  const { p } = useLook();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      {items.map(({ profile, presence }) => {
        const state =
          presence.kind === "present" ? presence.label : presence.kind === "absent" ? t.strip.absent : presence.label;
        return (
          <View
            key={profile.id}
            accessibilityLabel={`${profile.label} · ${state}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              height: 20,
              paddingHorizontal: 6,
              borderRadius: 5,
              borderWidth: 1,
              borderColor: p.guide,
              opacity: presence.kind === "present" ? 1 : 0.6,
            }}
          >
            <ProviderGlyph provider={profile.id} size={11} />
            <Text numberOfLines={1} style={{ color: p.muted, fontSize: 11, maxWidth: 96 }}>
              {shortLabel(profile)}
            </Text>
            {presence.kind === "present" ? (
              <Dot color={presence.color} />
            ) : (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: p.muted,
                  borderStyle: presence.kind === "unknown" ? "dashed" : "solid",
                }}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

export interface TargetOption {
  id: string;
  label: string;
  provider: string;
  disabled: boolean;
  note?: string | null;
}

/** Multi-select of target profiles; wraps on narrow layouts. Disabled ones show why. */
export function TargetPicker({
  options,
  selected,
  onChange,
}: {
  options: readonly TargetOption[];
  selected: readonly string[];
  onChange(ids: string[]): void;
}) {
  const { p } = useLook();
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : options.filter((o) => o.id === id || selected.includes(o.id)).map((o) => o.id));
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = selected.includes(o.id) && !o.disabled;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: o.disabled }}
            accessibilityLabel={o.note ? `${o.label} · ${o.note}` : o.label}
            disabled={o.disabled}
            onPress={() => toggle(o.id)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              minHeight: 32,
              paddingHorizontal: 10,
              borderRadius: RADIUS,
              borderWidth: 1,
              borderColor: on ? p.muted : p.guide,
              backgroundColor: on ? p.selected : pressed ? p.pressed : "transparent",
              opacity: o.disabled ? 0.45 : 1,
            })}
          >
            <Icon name={on ? "SquareCheck" : "Square"} size={14} color={on ? p.foreground : p.muted} />
            <ProviderGlyph provider={o.provider} size={12} />
            <Text numberOfLines={1} style={{ color: p.foreground, fontSize: 12 }}>
              {o.label}
            </Text>
            {o.note ? <Text style={{ color: p.muted, fontSize: 11 }}>{o.note}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Scopes whose config lives in the project and is shared by every profile (one file). */
export const SHARED_SCOPES: readonly string[] = ["project"];

/** Where an MCP server's definition lives, in words. Kind-agnostic: a CLI without scopes has one
 *  account-wide config. Null scope from a CLI that has scopes means its list did not say. */
export function mcpScopeLabel(kind: ProviderKind, server: Pick<McpServer, "scope" | "name">): string {
  const scope = server.scope?.toLowerCase() ?? null;
  if (scope === "plugin" || (scope === null && server.name.startsWith("plugin:"))) return t.scope.plugin;
  if (scope === "user" || scope === "global") return t.scope.account;
  if (scope === "local") return t.scope.projectOwn;
  if (scope !== null && SHARED_SCOPES.includes(scope)) return t.scope.projectShared;
  if (scope === "workspace") return t.scope.project;
  if (scope === "claude.ai") return t.scope.connector;
  if (scope === null) return MCP_SCOPES[kind].length === 0 ? t.scope.account : t.scope.unknown;
  return scope;
}

/** Plugins carry no scope in the contract: Paseo plugins are daemon-wide and a CLI without
 *  MCP scopes keeps one account-wide config; otherwise the list does not say. */
export function pluginScopeLabel(ecosystem: Ecosystem, scope?: string | null): string {
  if (ecosystem === "paseo") return t.scope.paseo;
  const s = scope?.toLowerCase() ?? null;
  if (s === "user") return t.scope.account;
  if (s === "local") return t.scope.projectOwn;
  if (s === "project") return t.scope.projectShared;
  if (s === "synced") return t.scope.synced;
  if (s) return s;
  return MCP_SCOPES[ecosystem].length === 0 ? t.scope.account : t.scope.unknown;
}

/** One line under the profile switcher: which project the lists are for. */
export function ScopeBasis({ cwd }: { cwd: string | null }) {
  const { p } = useLook();
  const name = cwd ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd) : null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name={name ? "FolderOpen" : "Globe"} size={13} color={p.muted} />
      <Text numberOfLines={2} style={{ flex: 1, color: p.muted, fontSize: 12 }}>
        {name ? t.scope.basis(name) : t.scope.noProject}
      </Text>
    </View>
  );
}
