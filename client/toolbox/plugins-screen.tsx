// "/plugins": Paseo's own plugins and each agent CLI's plugins, per profile or for every profile
// of a kind side by side ("전체"), where actions run on several profiles at once.
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import {
  CATALOG_PAGE,
  listCatalog,
  listInstalledPlugins,
  previewPluginAction,
  runMarketplaceAction,
  runPluginAction,
} from "../../shared/toolbox/rpc";
import {
  ECOSYSTEM_CAPS,
  type CatalogPlugin,
  type Ecosystem,
  type InstalledPlugin,
  type Marketplace,
  type MarketplaceAction,
  type PluginAction,
  type Profile,
} from "../../shared/toolbox/types";
import { palette } from "../look";
import { useActionFlow, type ActionFlow, type ActionTarget } from "./action-flow";
import { keys, useProfiles } from "./queries";
import { ToolboxTextProvider, useToolboxStrings, useToolboxText, type Strings } from "./strings";
import {
  ALL_PROFILES,
  Badge,
  ScopeBasis,
  pluginScopeLabel,
  ProfileStrip,
  bulkSelectable,
  shortLabel,
  type Presence,
  Button,
  Card,
  EmptyState,
  ListRow,
  LoadingLine,
  BackBar,
  useOnScreenEnd,
  LookProvider,
  Notice,
  ProfileSwitcher,
  ProviderGlyph,
  RADIUS,
  ScreenBody,
  SectionLabel,
  Segmented,
  errorText,
  useLook,
} from "./ui";

const ECOSYSTEMS: readonly Ecosystem[] = ["paseo", "claude", "codex", "antigravity"];
type Section = "installed" | "browse" | "marketplaces";

function asEcosystem(value: string | undefined): Ecosystem | null {
  const v = value?.trim().toLowerCase();
  if (v === "agy") return "antigravity";
  return ECOSYSTEMS.find((e) => e === v) ?? null;
}

export function PluginsScreen({ theme, layout, host, params, navigation }: PluginScreenProps) {
  const strings = useToolboxStrings();
  const look = useMemo(() => ({ p: palette(theme.colors), compact: layout.compact }), [theme, layout.compact]);
  return (
    <ToolboxTextProvider value={strings}>
      <LookProvider value={look}>
        <View style={{ flex: 1 }}>
          <BackBar agentId={params.agentId} title={params.agentTitle} hostId={host.id} navigation={navigation} />
          <PluginsBody hostId={host.id} params={params} />
        </View>
      </LookProvider>
    </ToolboxTextProvider>
  );
}

function PluginsBody({ hostId, params }: { hostId: string; params: Record<string, string> }) {
  const t = useToolboxText();
  const { query: profilesQuery, refresh, refreshing } = useProfiles();
  const profiles = profilesQuery.data?.profiles ?? [];
  const flow = useActionFlow(hostId);
  const cwd = params.cwd ? params.cwd : null;
  const requested = params.profileId ? params.profileId : null;
  // A requested profile that is not managed (opencode agent, typo) never falls back silently.
  const unknown = profilesQuery.isSuccess && requested !== null && !profiles.some((x) => x.id === requested);

  // Tab: explicit param first, else the kind of the agent's own profile, else Paseo.
  const requestedTab = asEcosystem(params.tab);
  const agentKind = profiles.find((x) => x.id === params.profileId)?.kind ?? null;
  const [tab, setTab] = useState<Ecosystem | null>(requestedTab);
  const activeTab: Ecosystem = tab ?? agentKind ?? "paseo";
  useEffect(() => {
    if (requestedTab) setTab(requestedTab);
  }, [requestedTab]);

  const [picked, setPicked] = useState<Partial<Record<Ecosystem, string>>>({});
  const ofKind = activeTab === "paseo" ? [] : profiles.filter((x) => x.kind === activeTab);
  // A tab with several accounts opens on "전체" so they are told apart row by row.
  const preferred = picked[activeTab] ?? (ofKind.length > 1 ? ALL_PROFILES : requested);
  const all = preferred === ALL_PROFILES && ofKind.length > 1;
  // The agent's own profile when it is of this kind; another kind's tab starts at its first profile;
  // an unknown request selects nothing until the user picks.
  const profile = all
    ? null
    : ofKind.find((x) => x.id === preferred) ?? (picked[activeTab] === undefined && unknown ? null : (ofKind[0] ?? null));

  return (
    <ScreenBody>
      <Segmented<Ecosystem>
        value={activeTab}
        options={ECOSYSTEMS.map((e) => ({ value: e, label: t.plugins.tabs[e] }))}
        onChange={setTab}
      />
      {unknown && requested ? <Notice tone="warning" text={t.profile.unmanaged(requested)} /> : null}
      {activeTab === "paseo" ? (
        <EcosystemView key="paseo" ecosystem="paseo" profile={null} cwd={cwd} flow={flow} />
      ) : (
        <>
          {profilesQuery.isPending ? <LoadingLine /> : null}
          {profilesQuery.isError ? (
            <Notice tone="danger" text={`${t.profile.loadError}: ${t.diagnostic(errorText(profilesQuery.error))}`} />
          ) : null}
          {profilesQuery.isSuccess && ofKind.length === 0 ? (
            <EmptyState icon="Users" title={t.profile.noneOfKind(t.plugins.tabs[activeTab])} />
          ) : null}
          {ofKind.length > 0 ? (
            <ProfileSwitcher
              profiles={ofKind}
              value={all ? ALL_PROFILES : (profile?.id ?? null)}
              onChange={(id) => setPicked((prev) => ({ ...prev, [activeTab]: id }))}
              withAll={ofKind.length > 1}
              onRefresh={refresh}
              refreshing={refreshing}
            />
          ) : null}
          {ofKind.length > 0 ? <ScopeBasis cwd={cwd} /> : null}
          {all && ofKind.length > 0 ? (
            <AllPlugins key={`all:${activeTab}`} ecosystem={activeTab} profiles={ofKind} cwd={cwd} flow={flow} />
          ) : null}
          {profile ? <ProfileGate key={profile.id} ecosystem={activeTab} profile={profile} cwd={cwd} flow={flow} /> : null}
        </>
      )}
      {flow.element}
    </ScreenBody>
  );
}

function ProfileGate({
  ecosystem,
  profile,
  cwd,
  flow,
}: {
  ecosystem: Ecosystem;
  profile: Profile;
  cwd: string | null;
  flow: ActionFlow;
}) {
  const t = useToolboxText();
  if (profile.auth.state === "not_installed") {
    return <EmptyState icon="PackageX" title={t.profile.notInstalledTitle} body={t.profile.notInstalledBody(profile.command)} />;
  }
  // Plugins live in local config, so a logged-out profile can still be managed; say so and go on.
  return (
    <>
      {profile.auth.state === "logged_out" ? <Notice tone="warning" text={t.profile.loggedOutBody} /> : null}
      <EcosystemView ecosystem={ecosystem} profile={profile} cwd={cwd} flow={flow} />
    </>
  );
}

function EcosystemView({
  ecosystem,
  profile,
  cwd,
  flow,
}: {
  ecosystem: Ecosystem;
  profile: Profile | null;
  cwd: string | null;
  flow: ActionFlow;
}) {
  const t = useToolboxText();
  const [section, setSection] = useState<Section>("installed");
  const caps = ECOSYSTEM_CAPS[ecosystem];
  const sections: Section[] = caps.marketplace.length > 0 ? ["installed", "browse", "marketplaces"] : ["installed", "browse"];
  const profileId = profile?.id ?? null;
  const scope: Scope = { ecosystem, profileId, cwd };
  const preview = useRpc(previewPluginAction);
  const runAction = useRpc(runPluginAction);
  const runMarket = useRpc(runMarketplaceAction);
  const where = profile ? profile.label : t.plugins.tabs.paseo;

  const startPlugin = (action: PluginAction, pluginId: string, name: string, marketplace: string | null) => {
    const input = { ...scope, action, pluginId, marketplace };
    flow.start({
      title: t.plugins.titles[action],
      subject: `${where} · ${name}`,
      destructive: action === "uninstall",
      bringsCode: action === "install" || action === "update" || action === "enable",
      preview: () => preview(input),
      run: () => runAction(input),
      invalidate: [keys.plugins(ecosystem, profileId)],
      reloadProvider: profileId,
    });
  };

  const startMarket = (action: MarketplaceAction, source: string, onDone?: () => void) => {
    const title =
      action === "add"
        ? t.plugins.titles.marketplaceAdd
        : action === "remove"
          ? t.plugins.titles.marketplaceRemove
          : t.plugins.titles.marketplaceUpdate;
    const warning =
      action === "add"
        ? t.plugins.marketplaceAddWarning
        : action === "remove"
          ? t.plugins.marketplaceRemoveWarning
          : t.plugins.marketplaceUpdateWarning;
    flow.start({
      title,
      subject: `${where} · ${source}`,
      destructive: action === "remove",
      bringsCode: action === "add",
      preview: null,
      localWarnings: [warning],
      run: () => runMarket({ ...scope, action, source }),
      invalidate: [keys.plugins(ecosystem, profileId)],
      reloadProvider: profileId,
      onResult: (result) => {
        if (result.ok) onDone?.();
      },
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <Segmented<Section> value={section} options={sections.map((s) => ({ value: s, label: t.plugins.sections[s] }))} onChange={setSection} />
      {section === "installed" ? (
        <InstalledList scope={scope} busy={flow.busy} onAction={startPlugin} />
      ) : null}
      {section === "browse" ? (
        <BrowseList scope={scope} busy={flow.busy} onAction={startPlugin} />
      ) : null}
      {section === "marketplaces" ? (
        <MarketplaceList scope={scope} busy={flow.busy} onAction={startMarket} />
      ) : null}
    </View>
  );
}

interface Scope {
  ecosystem: Ecosystem;
  profileId: string | null;
  cwd: string | null;
}

type StartPlugin = (action: PluginAction, pluginId: string, name: string, marketplace: string | null) => void;

function InstalledList({
  scope,
  busy,
  onAction,
}: {
  scope: Scope;
  busy: boolean;
  onAction: StartPlugin;
}) {
  const t = useToolboxText();
  const list = useRpc(listInstalledPlugins);
  const query = useQuery({
    queryKey: keys.installed(scope.ecosystem, scope.profileId, scope.cwd),
    queryFn: () => list(scope),
  });
  const items = query.data?.plugins ?? [];
  return (
    <View style={{ gap: 8 }}>
      {query.isPending ? <LoadingLine /> : null}
      {query.isError ? <Notice tone="danger" text={`${t.plugins.loadError}: ${t.diagnostic(errorText(query.error))}`} /> : null}
      {query.data?.error ? <Notice tone="warning" text={t.diagnostic(query.data.error)} /> : null}
      {query.isSuccess && items.length === 0 ? <EmptyState icon="Package" title={t.plugins.installedEmpty} /> : null}
      {items.length > 0 ? (
        <Card>
          {items.map((plugin, i) => (
            <InstalledRow
              key={plugin.id}
              plugin={plugin}
              can={ECOSYSTEM_CAPS[scope.ecosystem].plugin}
              ecosystem={scope.ecosystem}
              first={i === 0}
              busy={busy}
              onAction={onAction}
            />
          ))}
        </Card>
      ) : null}
    </View>
  );
}

function InstalledRow({
  plugin,
  ecosystem,
  can,
  first,
  busy,
  onAction,
}: {
  plugin: InstalledPlugin;
  ecosystem: Ecosystem;
  can: readonly PluginAction[];
  first: boolean;
  busy: boolean;
  onAction: StartPlugin;
}) {
  const t = useToolboxText();
  const act = (action: PluginAction) => onAction(action, plugin.id, plugin.name, plugin.marketplace);
  const update = plugin.updateTo ?? null;
  const meta = [
    plugin.version ? `v${plugin.version}${update ? ` → ${/^[0-9a-f]{7}$/.test(update) ? update : `v${update}`}` : ""}` : null,
    plugin.marketplace,
    plugin.status,
  ].filter(Boolean).join(" · ");
  return (
    <ListRow
      first={first}
      title={plugin.name}
      badge={
        <>
          <Badge label={pluginScopeLabel(t, ecosystem, plugin.scope)} />
          {update ? <Badge label={t.plugins.updateAvailable} tone="warning" /> : null}
          {plugin.enabled === null ? null : (
            <Badge label={plugin.enabled ? t.plugins.enabled : t.plugins.disabled} tone={plugin.enabled ? "success" : "muted"} />
          )}
        </>
      }
      meta={meta || null}
      detail={plugin.error ? t.diagnostic(plugin.error) : plugin.description}
      detailTone={plugin.error ? "danger" : "muted"}
      actions={
        <>
          {plugin.enabled !== null && can.includes(plugin.enabled ? "disable" : "enable") ? (
            <Button
              small
              label={plugin.enabled ? t.plugins.actions.disable : t.plugins.actions.enable}
              onPress={() => act(plugin.enabled ? "disable" : "enable")}
              disabled={busy}
            />
          ) : null}
          {/* Only plugins with a known newer version get an update button. */}
          {can.includes("update") && update ? (
            <Button small icon="RefreshCw" label={t.plugins.actions.update} onPress={() => act("update")} disabled={busy} />
          ) : null}
          {can.includes("uninstall") ? (
            <Button small icon="Trash2" label={t.plugins.actions.uninstall} onPress={() => act("uninstall")} disabled={busy} />
          ) : null}
        </>
      }
    />
  );
}

/** Debounced search text, so typing does not fire a catalog call per key. */
function useDebounced(value: string, ms: number): string {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}

function useCatalog(scope: Scope, search: string, enabled = true) {
  const list = useRpc(listCatalog);
  return useQuery({
    queryKey: keys.catalog(scope.ecosystem, scope.profileId, scope.cwd, search),
    queryFn: () => list({ ...scope, query: search }),
    enabled,
    // First loads can take seconds; keep the last results on screen while the next search runs.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** Browse pages: the first page on open, the next one each time the user asks for more. */
function useCatalogPages(scope: Scope, search: string, enabled: boolean) {
  const list = useRpc(listCatalog);
  return useInfiniteQuery({
    queryKey: [...keys.catalog(scope.ecosystem, scope.profileId, scope.cwd, search), "pages"],
    queryFn: ({ pageParam }) => list({ ...scope, query: search, offset: pageParam, limit: CATALOG_PAGE }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.plugins.length, 0);
      return last.plugins.length > 0 && loaded < last.total ? loaded : undefined;
    },
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

function BrowseList({
  scope,
  busy,
  onAction,
  installedIn,
}: {
  scope: Scope;
  busy: boolean;
  onAction: StartPlugin;
  /** All view: install state across profiles instead of the catalog profile's own flag. */
  installedIn?: (pluginId: string) => { n: number; total: number };
}) {
  const t = useToolboxText();
  const { p } = useLook();
  const caps = ECOSYSTEM_CAPS[scope.ecosystem];
  const [text, setText] = useState("");
  const search = useDebounced(text.trim(), 300);
  const query = useCatalogPages(scope, search, caps.browse);
  const pages = query.data?.pages ?? [];
  const items = useMemo(() => pages.flatMap((page) => page.plugins), [pages]);
  const total = pages[0]?.total ?? items.length;
  const firstError = pages[0]?.error ?? null;
  const loadMore = () => {
    if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetching) void query.fetchNextPage();
  };
  useOnScreenEnd(loadMore);
  // No CLI browsing (Antigravity: only inside agy's /plugin), so the section is the note alone.
  if (!caps.browse) return <Notice text={t.plugins.antigravityBrowseNote} />;
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t.plugins.searchPlaceholder}
        placeholderTextColor={p.idle}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{
          height: 36,
          paddingHorizontal: 10,
          borderRadius: RADIUS,
          borderWidth: 1,
          borderColor: p.guide,
          color: p.foreground,
          fontSize: 13,
        }}
      />
      {query.isFetching ? <LoadingLine /> : null}
      {query.isError ? <Notice tone="danger" text={`${t.plugins.loadError}: ${t.diagnostic(errorText(query.error))}`} /> : null}
      {firstError ? <Notice tone="warning" text={t.diagnostic(firstError)} /> : null}
      {query.isSuccess && !query.isFetching && items.length === 0 ? <EmptyState icon="Search" title={t.plugins.browseEmpty} /> : null}
      {total > 0 ? <SectionLabel>{t.plugins.catalogShown(items.length, total)}</SectionLabel> : null}
      {items.length > 0 ? (
        <Card>
          {items.map((plugin, i) => (
            <CatalogRow
              key={`${plugin.marketplace ?? ""}:${plugin.id}`}
              plugin={plugin}
              installedIn={installedIn?.(plugin.id)}
              canInstall={caps.plugin.includes("install")}
              first={i === 0}
              busy={busy}
              onAction={onAction}
            />
          ))}
        </Card>
      ) : null}
      {query.hasNextPage ? (
        query.isFetchingNextPage ? (
          <LoadingLine />
        ) : (
          <Button label={t.plugins.loadMore(Math.min(CATALOG_PAGE, total - items.length))} onPress={loadMore} />
        )
      ) : null}
    </View>
  );
}

function CatalogRow({
  plugin,
  canInstall,
  first,
  busy,
  onAction,
  installedIn,
}: {
  installedIn?: { n: number; total: number };
  plugin: CatalogPlugin;
  canInstall: boolean;
  first: boolean;
  busy: boolean;
  onAction: StartPlugin;
}) {
  const t = useToolboxText();
  const meta = [plugin.marketplace, plugin.categories.join(", ")].filter(Boolean).join(" · ");
  return (
    <ListRow
      first={first}
      title={plugin.name}
      badge={
        installedIn ? (
          installedIn.n > 0 ? (
            <Badge label={t.plugins.installedIn(installedIn.n, installedIn.total)} tone="success" />
          ) : undefined
        ) : plugin.installed ? (
          <Badge label={t.plugins.installedBadge} tone="success" />
        ) : undefined
      }
      meta={meta || null}
      detail={plugin.description}
      actions={
        (installedIn ? installedIn.n >= installedIn.total : plugin.installed) || !canInstall ? undefined : (
          <Button
            small
            icon="Download"
            label={t.plugins.actions.install}
            onPress={() => onAction("install", plugin.id, plugin.name, plugin.marketplace)}
            disabled={busy}
          />
        )
      }
    />
  );
}

function MarketplaceList({
  scope,
  busy,
  onAction,
}: {
  scope: Scope;
  busy: boolean;
  onAction(action: MarketplaceAction, source: string, onDone?: () => void): void;
}) {
  const t = useToolboxText();
  const { p } = useLook();
  const can = ECOSYSTEM_CAPS[scope.ecosystem].marketplace;
  const query = useCatalog(scope, "");
  const items: Marketplace[] = query.data?.marketplaces ?? [];
  const [source, setSource] = useState("");
  return (
    <View style={{ gap: 8 }}>
      {can.includes("add") ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput
          value={source}
          onChangeText={setSource}
          placeholder={t.plugins.marketplaceSourcePlaceholder}
          placeholderTextColor={p.idle}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            flex: 1,
            height: 36,
            paddingHorizontal: 10,
            borderRadius: RADIUS,
            borderWidth: 1,
            borderColor: p.guide,
            color: p.foreground,
            fontSize: 13,
          }}
        />
        <Button
          icon="Plus"
          label={t.plugins.actions.add}
          onPress={() => onAction("add", source.trim(), () => setSource(""))}
          disabled={busy || source.trim().length === 0}
        />
      </View>
      ) : null}
      {query.isFetching ? <LoadingLine /> : null}
      {query.isError ? <Notice tone="danger" text={`${t.plugins.loadError}: ${t.diagnostic(errorText(query.error))}`} /> : null}
      {query.data?.error ? <Notice tone="warning" text={t.diagnostic(query.data.error)} /> : null}
      {query.isSuccess && items.length === 0 ? <EmptyState icon="Store" title={t.plugins.marketplacesEmpty} /> : null}
      {items.length > 0 ? (
        <Card>
          {items.map((m, i) => (
            <ListRow
              key={m.name}
              first={i === 0}
              leading={<ProviderGlyph provider={scope.ecosystem} size={13} />}
              title={m.name}
              meta={[m.source, m.pluginCount === null ? null : t.plugins.pluginCount(m.pluginCount)].filter(Boolean).join(" · ") || null}
              actions={
                <>
                  {can.includes("update") ? (
                    <Button small icon="RefreshCw" label={t.plugins.actions.update} onPress={() => onAction("update", m.name)} disabled={busy} />
                  ) : null}
                  {can.includes("remove") ? (
                    <Button small icon="Trash2" label={t.plugins.actions.remove} onPress={() => onAction("remove", m.name)} disabled={busy} />
                  ) : null}
                </>
              }
            />
          ))}
        </Card>
      ) : null}
    </View>
  );
}

// ---- All profiles of one kind ----------------------------------------------------------------

/** One plugin id across the profiles of one kind. */
interface PluginRow {
  id: string;
  name: string;
  marketplace: string | null;
  description: string | null;
  /** profile id -> that profile's entry. */
  entries: Map<string, InstalledPlugin>;
}

function pluginColor(t: Strings, p: ReturnType<typeof useLook>["p"], plugin: InstalledPlugin): { color: string; label: string } {
  if (plugin.error) return { color: p.danger, label: t.strip.error };
  if (plugin.updateTo) return { color: p.warning, label: t.plugins.updateAvailable };
  if (plugin.enabled === false) return { color: p.idle, label: t.plugins.disabled };
  return { color: p.success, label: plugin.enabled ? t.plugins.enabled : t.plugins.installedBadge };
}

function AllPlugins({
  ecosystem,
  profiles,
  cwd,
  flow,
}: {
  ecosystem: Ecosystem;
  profiles: readonly Profile[];
  cwd: string | null;
  flow: ActionFlow;
}) {
  const t = useToolboxText();
  const { p } = useLook();
  const [section, setSection] = useState<Section>("installed");
  const caps = ECOSYSTEM_CAPS[ecosystem];
  const sections: Section[] = caps.marketplace.length > 0 ? ["installed", "browse", "marketplaces"] : ["installed", "browse"];
  const list = useRpc(listInstalledPlugins);
  const preview = useRpc(previewPluginAction);
  const runAction = useRpc(runPluginAction);

  // Installed lists come from local config, so logged-out profiles are listed too (as in the
  // single view); only actions are limited to logged-in ones.
  const listed = profiles.filter((x) => x.auth.state !== "not_installed");
  const queries = useQueries({
    queries: listed.map((profile) => ({
      queryKey: keys.installed(ecosystem, profile.id, cwd),
      queryFn: () => list({ ecosystem, profileId: profile.id, cwd }),
    })),
  });

  const loaded = new Set<string>();
  const loading: Profile[] = [];
  const errors: { profile: Profile; text: string }[] = [];
  const rows = new Map<string, PluginRow>();
  listed.forEach((profile, i) => {
    const q = queries[i];
    if (!q || q.isPending) {
      loading.push(profile);
      return;
    }
    if (q.isError) {
      errors.push({ profile, text: t.diagnostic(errorText(q.error)) });
      return;
    }
    loaded.add(profile.id);
    if (q.data.error) errors.push({ profile, text: t.diagnostic(q.data.error) });
    for (const plugin of q.data.plugins) {
      const row = rows.get(plugin.id) ?? {
        id: plugin.id,
        name: plugin.name,
        marketplace: plugin.marketplace,
        description: plugin.description,
        entries: new Map<string, InstalledPlugin>(),
      };
      rows.set(plugin.id, row);
      row.entries.set(profile.id, plugin);
    }
  });
  const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const notInstalled = profiles.filter((x) => x.auth.state === "not_installed");

  // Browse needs one profile's catalog; it is named on screen, never picked silently.
  const catalogProfile = profiles.find((x) => x.auth.state === "logged_in") ?? profiles.find(bulkSelectable) ?? null;

  const presence = (profile: Profile, row: PluginRow): Presence => {
    if (profile.auth.state === "not_installed") return { kind: "unknown", label: t.auth.not_installed };
    if (!loaded.has(profile.id)) {
      return { kind: "unknown", label: loading.includes(profile) ? t.strip.loading : t.strip.unlisted };
    }
    const entry = row.entries.get(profile.id);
    return entry ? { kind: "present", ...pluginColor(t, p, entry) } : { kind: "absent" };
  };

  const authNote = (profile: Profile): string | null =>
    profile.auth.state === "logged_out"
      ? t.targets.noteLoggedOut
      : profile.auth.state === "not_installed"
        ? t.targets.noteNotInstalled
        : null;

  /** Bulk run of one plugin action; `eligible` says which profiles it applies to. */
  const startBulk = (
    action: PluginAction,
    pluginId: string,
    name: string,
    marketplace: string | null,
    eligible: (profile: Profile) => boolean,
    missingNote: string,
  ) =>
    flow.startBulk({
      title: t.plugins.titles[action],
      subject: name,
      destructive: action === "uninstall",
      bringsCode: action === "install" || action === "update" || action === "enable",
      pick: true,
      targets: profiles.map((profile): ActionTarget => {
        const input = { ecosystem, profileId: profile.id, cwd, action, pluginId, marketplace };
        const ok = bulkSelectable(profile) && eligible(profile);
        return {
          id: profile.id,
          label: profile.label,
          selectable: ok,
          preselected: ok && profile.auth.state === "logged_in",
          note: authNote(profile) ?? (ok ? null : missingNote),
          preview: () => preview(input),
          run: () => runAction(input),
          reloadProvider: profile.id,
        };
      }),
      invalidate: profiles.map((x) => keys.plugins(ecosystem, x.id)),
    });

  const startForRow = (action: PluginAction, row: PluginRow) => {
    const entry = (profile: Profile) => row.entries.get(profile.id);
    const eligible: Record<PluginAction, (profile: Profile) => boolean> = {
      install: (x) => loaded.has(x.id) && !entry(x),
      uninstall: (x) => !!entry(x),
      enable: (x) => entry(x)?.enabled === false,
      disable: (x) => entry(x)?.enabled === true,
      update: (x) => !!entry(x)?.updateTo,
    };
    startBulk(action, row.id, row.name, row.marketplace, eligible[action], action === "install" ? t.targets.noteHas : t.targets.noteMissing);
  };

  // Browse installs: every profile that does not list the plugin yet.
  const browseInstall: StartPlugin = (action, pluginId, name, marketplace) =>
    startBulk(action, pluginId, name, marketplace, (x) => loaded.has(x.id) && !rows.get(pluginId)?.entries.has(x.id), t.targets.noteHas);

  const can = caps.plugin;
  return (
    <View style={{ gap: 12 }}>
      <Segmented<Section> value={section} options={sections.map((s) => ({ value: s, label: t.plugins.sections[s] }))} onChange={setSection} />
      {notInstalled.length > 0 ? <Notice text={t.profile.skippedProfiles(notInstalled.map((x) => x.label).join(", "))} /> : null}
      {section === "installed" ? (
        <View style={{ gap: 8 }}>
          {loading.length > 0 ? <LoadingLine label={t.profile.loadingProfiles(loading.map((profile) => shortLabel(t, profile)).join(", "))} /> : null}
          {errors.map((e) => (
            <Notice key={e.profile.id} tone="warning" text={`${e.profile.label}: ${e.text}`} />
          ))}
          {loading.length === 0 && sorted.length === 0 ? <EmptyState icon="Package" title={t.plugins.installedEmpty} /> : null}
          {sorted.length > 0 ? (
            <Card>
              {sorted.map((row, i) => {
                const entries = [...row.entries.values()];
                const has = (pred: (x: InstalledPlugin) => boolean) => entries.some(pred);
                const missing = profiles.some((x) => bulkSelectable(x) && loaded.has(x.id) && !row.entries.has(x.id));
                const updates = entries.filter((x) => x.updateTo);
                const versions = [...new Set(entries.map((x) => x.version).filter(Boolean))].map((v) => `v${v}`);
                const errorsOf = profiles
                  .flatMap((profile) => {
                    const error = row.entries.get(profile.id)?.error;
                    return error ? [`${shortLabel(t, profile)}: ${t.diagnostic(error)}`] : [];
                  });
                return (
                  <ListRow
                    key={row.id}
                    first={i === 0}
                    title={row.name}
                    badge={
                      <>
                        {[...new Set(entries.map((x) => pluginScopeLabel(t, ecosystem, x.scope)))].map((label) => (
                          <Badge key={label} label={label} />
                        ))}
                        {updates.length > 0 ? <Badge label={t.plugins.updateAvailable} tone="warning" /> : null}
                      </>
                    }
                    meta={[versions.join(", "), row.marketplace].filter(Boolean).join(" · ") || null}
                    detail={errorsOf.length > 0 ? errorsOf.join("\n") : row.description}
                    detailTone={errorsOf.length > 0 ? "danger" : "muted"}
                    below={<ProfileStrip items={profiles.map((profile) => ({ profile, presence: presence(profile, row) }))} />}
                    actions={
                      <>
                        {can.includes("enable") && has((x) => x.enabled === false) ? (
                          <Button small label={t.plugins.actions.enable} onPress={() => startForRow("enable", row)} disabled={flow.busy} />
                        ) : null}
                        {can.includes("disable") && has((x) => x.enabled === true) ? (
                          <Button small label={t.plugins.actions.disable} onPress={() => startForRow("disable", row)} disabled={flow.busy} />
                        ) : null}
                        {/* Only profiles with a known newer version get an update. */}
                        {can.includes("update") && updates.length > 0 ? (
                          <Button small icon="RefreshCw" label={t.plugins.actions.update} onPress={() => startForRow("update", row)} disabled={flow.busy} />
                        ) : null}
                        {can.includes("install") && missing ? (
                          <Button small icon="CopyPlus" label={t.plugins.installToRest} onPress={() => startForRow("install", row)} disabled={flow.busy} />
                        ) : null}
                        {can.includes("uninstall") ? (
                          <Button small icon="Trash2" label={t.plugins.actions.uninstall} onPress={() => startForRow("uninstall", row)} disabled={flow.busy} />
                        ) : null}
                      </>
                    }
                  />
                );
              })}
            </Card>
          ) : null}
        </View>
      ) : null}
      {section === "browse" ? (
        catalogProfile ? (
          <View style={{ gap: 8 }}>
            {caps.browse ? <Notice text={t.plugins.catalogFrom(catalogProfile.label)} /> : null}
            <BrowseList
              scope={{ ecosystem, profileId: catalogProfile.id, cwd }}
              busy={flow.busy}
              onAction={browseInstall}
              installedIn={(id) => ({
                n: rows.get(id)?.entries.size ?? 0,
                total: listed.length,
              })}
            />
          </View>
        ) : (
          <Notice text={t.plugins.catalogNoProfile} />
        )
      ) : null}
      {section === "marketplaces" ? <Notice text={t.plugins.marketplacesPerProfile} /> : null}
    </View>
  );
}
