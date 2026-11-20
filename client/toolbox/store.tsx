// Store pieces of "/plugins": plugin cards with an icon (or tinted initials), one install-state
// control per card (install / installing / installed / update / updating / failed + retry /
// removing) and a detail sheet. The screen decides what each action does; these only draw.
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ExternalLink, Icon, Modal } from "@getpaseo/plugin/client/ui";
import type { CatalogPlugin, InstalledPlugin } from "../../shared/toolbox/types";
import type { Activity, ActivityKind } from "./action-flow";
import { catalogMeta, installedMeta, versionText, type StoreMeta } from "./store-logic";
import { useToolboxText, type Strings } from "./strings";
import { Button, IconButton, PluginAvatar, RADIUS, Tag, useLook, } from "./ui";

// ---- Metadata --------------------------------------------------------------------------------

export { catalogMeta, installedMeta, versionText, type StoreMeta };

// ---- Install state ---------------------------------------------------------------------------

/** Where one plugin stands for the place the card is about (a profile, all profiles, Paseo). */
export interface StoreState {
  installed: boolean;
  /** Some (or the) install has a newer version to take. */
  updateTo: string | null;
  /** The tracked action on this plugin, running or failed. */
  activity: Activity | null;
}

function runningLabel(t: Strings, kind: ActivityKind): string {
  return t.plugins.state.running[kind];
}

function failedLabel(t: Strings, kind: ActivityKind): string {
  return t.plugins.state.failed[kind];
}

/**
 * The card's main control. Running: a spinner with what is happening. Failed: what failed and a
 * retry. Else install, update, or a quiet "installed" mark.
 */
export function StateControl({
  state,
  installLabel,
  onInstall,
  onUpdate,
  busy,
  small = true,
  hideInstalled,
}: {
  state: StoreState;
  /** Overrides "Install" (e.g. "Install on remaining accounts"). */
  installLabel?: string;
  /** Null: this place cannot install (no button). */
  onInstall: (() => void) | null;
  onUpdate: (() => void) | null;
  busy: boolean;
  small?: boolean;
  /** Draw nothing for a plain installed state (lists where everything is installed). */
  hideInstalled?: boolean;
}) {
  const t = useToolboxText();
  const { p } = useLook();
  const { activity } = state;
  if (activity?.state === "running") {
    return <Button small={small} loading label={runningLabel(t, activity.kind)} onPress={() => {}} />;
  }
  if (activity?.state === "failed") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="CircleX" size={14} color={p.danger} />
        <Text numberOfLines={1} style={{ color: p.danger, fontSize: 12 }}>
          {failedLabel(t, activity.kind)}
        </Text>
        <Button small={small} icon="RotateCw" label={t.common.retry} onPress={activity.retry} disabled={busy} />
        <IconButton icon="X" label={t.plugins.state.dismiss} onPress={activity.dismiss} />
      </View>
    );
  }
  if (state.installed && state.updateTo && onUpdate) {
    return <Button small={small} tone="primary" icon="ArrowUpCircle" label={t.plugins.actions.update} onPress={onUpdate} disabled={busy} />;
  }
  if (!state.installed || installLabel) {
    if (!onInstall) return null;
    return (
      <Button
        small={small}
        tone={state.installed ? "default" : "primary"}
        icon={state.installed ? "CopyPlus" : "Download"}
        label={installLabel ?? t.plugins.actions.install}
        onPress={onInstall}
        disabled={busy}
      />
    );
  }
  if (hideInstalled) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, height: small ? 28 : 32, paddingHorizontal: 4 }}>
      <Icon name="CircleCheck" size={14} color={p.success} />
      <Text style={{ color: p.success, fontSize: 12 }}>{t.plugins.installedBadge}</Text>
    </View>
  );
}

// ---- Card ------------------------------------------------------------------------------------

/**
 * One plugin. Pressing the card opens its details; buttons inside act on their own.
 * `layout: "tile"` for the browse grid (fixed height text), `"row"` for the installed list.
 */
export function PluginCard({
  name,
  meta: m,
  subtitle,
  description,
  descriptionTone = "muted",
  badges,
  control,
  actions,
  below,
  layout,
  onOpen,
}: {
  name: string;
  meta: StoreMeta;
  subtitle: string | null;
  description: string | null;
  descriptionTone?: "muted" | "danger";
  badges?: ReactNode;
  /** The state control (see StateControl). */
  control?: ReactNode;
  /** Secondary actions (enable, uninstall, ...). */
  actions?: ReactNode;
  below?: ReactNode;
  layout: "tile" | "row";
  onOpen(): void;
}) {
  const t = useToolboxText();
  const { p, compact } = useLook();
  const tile = layout === "tile";
  const tags = m.categories.slice(0, 3);
  const descColor = descriptionTone === "danger" ? p.danger : p.muted;
  // Wide list rows keep their buttons beside the text, like Paseo's own rows; tiles and compact
  // layouts put them on a line of their own.
  const inline = !tile && !compact;
  const buttons = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
      {actions}
      {control}
    </View>
  );
  const footer = !inline && (control || actions) ? (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, justifyContent: tile ? "space-between" : "flex-end" }}>
      {tile ? <View style={{ flexDirection: "row", gap: 4, flexShrink: 1, overflow: "hidden" }}>{tags.map((c) => <Tag key={c} label={c} />)}</View> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {actions}
        {control}
      </View>
    </View>
  ) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} · ${t.plugins.detail.open}`}
      onPress={onOpen}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flex: tile ? 1 : undefined,
        minWidth: 0,
        gap: 10,
        padding: 12,
        borderRadius: RADIUS + 2,
        borderWidth: 1,
        borderColor: hovered ? p.muted : p.guide,
        backgroundColor: pressed ? p.pressed : hovered ? p.hover : "transparent",
      })}
    >
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <PluginAvatar name={name} picture={m.picture} size={tile || compact ? 40 : 44} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, color: p.foreground, fontSize: 14, fontWeight: "600" }}>
              {name}
            </Text>
            {m.featured ? <Featured /> : null}
            {badges}
          </View>
          {subtitle || m.installs !== null ? (
            <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12 }}>
              {[subtitle, m.installs !== null ? t.plugins.installs(m.installs) : null].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {description ? (
            <Text numberOfLines={tile ? 2 : 3} style={{ color: descColor, fontSize: 12, lineHeight: 17, minHeight: tile ? 34 : undefined }}>
              {description}
            </Text>
          ) : tile ? (
            <Text style={{ color: p.idle, fontSize: 12, lineHeight: 17, minHeight: 34, fontStyle: "italic" }}>{t.plugins.detail.noDescription}</Text>
          ) : null}
          {!tile && tags.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
              {tags.map((c) => (
                <Tag key={c} label={c} />
              ))}
            </View>
          ) : null}
          {below}
        </View>
        {inline && (control || actions) ? <View style={{ flexShrink: 0, maxWidth: "45%" }}>{buttons}</View> : null}
      </View>
      {footer}
    </Pressable>
  );
}

/** "Featured" mark for plugins the registry highlights. */
function Featured() {
  const t = useToolboxText();
  const { p } = useLook();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, height: 18, borderRadius: 5, borderWidth: 1, borderColor: p.guide }}>
      <Icon name="Star" size={10} color={p.warning} />
      <Text style={{ color: p.warning, fontSize: 11 }}>{t.plugins.featured}</Text>
    </View>
  );
}

/** Cards two by two on wide layouts, one per line on compact ones. */
export function CardGrid({ children, columns }: { children: ReactNode[]; columns: 1 | 2 }) {
  if (columns === 1) return <View style={{ gap: 8 }}>{children}</View>;
  const rows: ReactNode[][] = [];
  for (let i = 0; i < children.length; i += 2) rows.push(children.slice(i, i + 2));
  return (
    <View style={{ gap: 8 }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "stretch" }}>
          {row}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

// ---- Detail ----------------------------------------------------------------------------------

export interface DetailInfo {
  name: string;
  meta: StoreMeta;
  description: string | null;
  marketplace: string | null;
  source: string | null;
  scope?: string | null;
  /** Errors to show (load errors, per-profile errors). */
  errors?: readonly string[];
}

/** Everything known about one plugin, with the same controls as its card. */
export function PluginDetail({
  info,
  control,
  actions,
  extra,
  onClose,
}: {
  info: DetailInfo;
  control?: ReactNode;
  actions?: ReactNode;
  /** E.g. the per-profile strip in the all-profiles view. */
  extra?: ReactNode;
  onClose(): void;
}) {
  const t = useToolboxText();
  const { p } = useLook();
  const m = info.meta;
  const rows: { label: string; value: string }[] = [];
  if (m.author) rows.push({ label: t.plugins.detail.author, value: m.author });
  if (m.installedVersion && m.version && m.installedVersion !== m.version) {
    rows.push({ label: t.plugins.detail.installedVersion, value: versionText(m.installedVersion) });
    rows.push({ label: t.plugins.detail.latestVersion, value: versionText(m.version) });
  } else if (m.version) {
    rows.push({ label: t.plugins.detail.version, value: versionText(m.version) });
  }
  if (m.updateTo) rows.push({ label: t.plugins.detail.updateTo, value: versionText(m.updateTo) });
  if (m.installs !== null) rows.push({ label: t.plugins.detail.installs, value: t.count(m.installs) });
  if (m.updatedAt) rows.push({ label: t.plugins.detail.updated, value: t.date(m.updatedAt) });
  if (m.license) rows.push({ label: t.plugins.detail.license, value: m.license });
  if (info.scope) rows.push({ label: t.plugins.detail.scope, value: info.scope });
  if (info.marketplace) rows.push({ label: t.plugins.detail.marketplace, value: info.marketplace });
  if (info.source) rows.push({ label: t.plugins.detail.source, value: info.source });
  return (
    <Modal
      title={t.plugins.detail.title}
      icon={<Icon name="Puzzle" size={16} color={p.foreground} />}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content>
        <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <PluginAvatar name={info.name} picture={m.picture} size={56} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text selectable style={{ color: p.foreground, fontSize: 17, fontWeight: "600" }}>
              {info.name}
            </Text>
            {m.author ? <Text style={{ color: p.muted, fontSize: 12 }}>{t.plugins.detail.by(m.author)}</Text> : null}
            {m.featured ? (
              <View style={{ flexDirection: "row" }}>
                <Featured />
              </View>
            ) : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {control}
          {actions}
        </View>
        {(info.errors ?? []).map((e, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 8, padding: 10, borderRadius: RADIUS, backgroundColor: p.hover }}>
            <Icon name="TriangleAlert" size={14} color={p.danger} />
            <Text selectable style={{ flex: 1, color: p.danger, fontSize: 12, lineHeight: 17 }}>
              {e}
            </Text>
          </View>
        ))}
        <Text selectable style={{ color: info.description ? p.foreground : p.idle, fontSize: 13, lineHeight: 20 }}>
          {info.description ?? t.plugins.detail.noDescription}
        </Text>
        {m.categories.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {m.categories.map((c) => (
              <Tag key={c} label={c} />
            ))}
          </View>
        ) : null}
        {extra}
        {rows.length > 0 ? (
          <View style={{ borderWidth: 1, borderColor: p.guide, borderRadius: RADIUS }}>
            {rows.map((r, i) => (
              <View
                key={r.label}
                style={{
                  flexDirection: "row",
                  gap: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: p.guide,
                }}
              >
                <Text style={{ width: 110, color: p.muted, fontSize: 12 }}>{r.label}</Text>
                <Text selectable style={{ flex: 1, color: p.foreground, fontSize: 12 }}>
                  {r.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {m.homepage ? (
          <ExternalLink href={m.homepage} accessibilityLabel={t.plugins.detail.homepage}>
            {/* ExternalLink draws its own outward arrow. */}
            <Text style={{ color: p.foreground, fontSize: 13, textDecorationLine: "underline" }}>{t.plugins.detail.homepage}</Text>
          </ExternalLink>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

