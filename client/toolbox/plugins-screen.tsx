// "/plugins": Paseo's own plugins and each agent CLI's plugins, per profile or for every profile
// of a kind side by side ("전체"), where actions run on several profiles at once.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import {
  CATALOG_PAGE,
  listCatalog,
  listInstalledPlugins,
  previewMarketplaceAction,
  previewPluginAction,
  previewSourceInstall,
  runMarketplaceAction,
  runPluginAction,
  runSourceInstall,
} from "../../shared/toolbox/rpc";
import {
  ECOSYSTEM_CAPS,
  type CatalogPlugin,
  type CatalogSort,
  type Ecosystem,
  type InstalledPlugin,
  type Marketplace,
  type MarketplaceAction,
  type PluginAction,
  type PluginSourceInput,
  type Profile,
} from "../../shared/toolbox/types";
import { SourceInstallModal } from "./source-form";
import {
  ACTIVITY_OF,
  FILTERS,
  PROJECT_SCOPES,
  attention,
  catalogSorts,
  installedView,
  pluginFacts,
  rowFacts,
  trackKey,
  type Facts,
  type InstalledFilter,
  type InstalledSort,
  type PluginRow,
} from "./store-logic";
import { palette } from "../look";
import { useActionFlow, type ActionFlow, type ActionTarget, type Activity, type ActivityKind } from "./action-flow";
import { keys, useProfiles } from "./queries";
import { CardGrid, PluginCard, PluginDetail, StateControl, catalogMeta, installedMeta, versionText } from "./store";
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
  Chip,
  ChipRow,
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
  SearchField,
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
  const { p } = useLook();
  const [section, setSection] = useState<Section>("installed");
  const caps = ECOSYSTEM_CAPS[ecosystem];
  const sections: Section[] = caps.marketplace.length > 0 ? ["installed", "browse", "marketplaces"] : ["installed", "browse"];
  const profileId = profile?.id ?? null;
  const scope: Scope = { ecosystem, profileId, cwd };
  const preview = useRpc(previewPluginAction);
  const runAction = useRpc(runPluginAction);
  const runMarket = useRpc(runMarketplaceAction);
  const previewMarket = useRpc(previewMarketplaceAction);
  const previewSource = useRpc(previewSourceInstall);
  const runSource = useRpc(runSourceInstall);
  const where = profile ? profile.label : t.plugins.tabs.paseo;
  const [sourceOpen, setSourceOpen] = useState(false);
  // Where catalog installs go, for CLIs with install scopes; project scopes need a project.
  const [installScope, setInstallScope] = useState<string | null>(
    caps.scopes.find((s) => cwd || !PROJECT_SCOPES.includes(s)) ?? null,
  );

  const startPlugin: StartPlugin = (action, pluginId, name, marketplace, pluginScope) => {
    const target = action === "install" ? installScope : pluginScope && caps.scopes.includes(pluginScope) ? pluginScope : null;
    const input = { ...scope, action, pluginId, marketplace, scope: target };
    flow.start({
      title: t.plugins.titles[action],
      subject: `${where} · ${name}`,
      destructive: action === "uninstall",
      bringsCode: action === "install" || action === "update" || action === "enable",
      preview: () => preview(input),
      run: () => runAction(input),
      invalidate: [keys.plugins(ecosystem, profileId)],
      reloadProvider: profileId,
      track: { key: trackKey(ecosystem, profileId, pluginId), kind: ACTIVITY_OF[action] },
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
      preview: () => previewMarket({ ...scope, action, source }),
      localWarnings: [warning],
      run: () => runMarket({ ...scope, action, source }),
      invalidate: [keys.plugins(ecosystem, profileId)],
      reloadProvider: profileId,
      onResult: (result) => {
        if (result.ok) onDone?.();
      },
    });
  };

  const startSource = (source: PluginSourceInput) => {
    setSourceOpen(false);
    const input = { ...scope, source };
    flow.start({
      title: t.plugins.source.title,
      subject: `${where} · ${source.kind === "marketplace" && source.plugin ? `${source.plugin}@${source.value}` : source.value}`,
      bringsCode: true,
      preview: () => previewSource(input),
      run: () => runSource(input),
      invalidate: [keys.plugins(ecosystem, profileId)],
      reloadProvider: profileId,
    });
  };

  const scopePicker =
    caps.scopes.length > 0 && caps.plugin.includes("install") ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: p.muted, fontSize: 12 }}>{t.plugins.installScope}</Text>
        <Segmented<string>
          value={installScope ?? ""}
          options={caps.scopes.map((s) => ({
            value: s,
            label: pluginScopeLabel(t, ecosystem, s),
            disabled: PROJECT_SCOPES.includes(s) && !cwd,
          }))}
          onChange={setInstallScope}
        />
      </View>
    ) : null;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Segmented<Section> value={section} options={sections.map((s) => ({ value: s, label: t.plugins.sections[s] }))} onChange={setSection} />
        {caps.sources.length > 0 && section !== "marketplaces" ? (
          <Button icon="PackagePlus" label={t.plugins.source.button} onPress={() => setSourceOpen(true)} disabled={flow.busy} />
        ) : null}
      </View>
      {section === "installed" ? (
        <InstalledList scope={scope} busy={flow.busy} onAction={startPlugin} activity={flow.activity} />
      ) : null}
      {section === "browse" ? (
        <BrowseList
          scope={scope}
          busy={flow.busy}
          onAction={startPlugin}
          activity={flow.activity}
          trackProfile={profileId}
          scopePicker={scopePicker}
        />
      ) : null}
      {sourceOpen ? (
        <SourceInstallModal ecosystem={ecosystem} cwd={cwd} where={where} onClose={() => setSourceOpen(false)} onSubmit={startSource} />
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

/** `scope`: where the plugin is installed (installed list), so the action targets that config. */
type StartPlugin = (action: PluginAction, pluginId: string, name: string, marketplace: string | null, scope?: string | null) => void;

export { ACTIVITY_OF, FILTERS, attention, catalogSorts, pluginFacts, rowFacts, trackKey };

// ---- Installed: search, state filters, sort ----------------------------------------------------

/** Search, filter chips and sort over a complete (unpaged) list; the logic is `installedView`. */
export function useInstalledView<T>(items: readonly T[], facts: (item: T) => Facts) {
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<InstalledFilter>("all");
  const [sort, setSort] = useState<InstalledSort>("name");
  const view = installedView(items, facts, filter, text, sort);
  return { text, setText, setFilter, sort, setSort, ...view };
}

/** What the toolbar reads and sets; the list itself stays with the caller. */
type InstalledControls = Omit<ReturnType<typeof useInstalledView<unknown>>, "shown" | "total">;

function InstalledToolbar({ view }: { view: InstalledControls }) {
  const t = useToolboxText();
  const { compact } = useLook();
  const chips: { value: InstalledFilter; label: string; icon?: string }[] = [
    { value: "all", label: t.plugins.filters.all },
    { value: "updates", label: t.plugins.filters.updates, icon: "ArrowUpCircle" },
    { value: "errors", label: t.plugins.filters.errors, icon: "TriangleAlert" },
    { value: "enabled", label: t.plugins.filters.enabled },
    { value: "disabled", label: t.plugins.filters.disabled },
  ];
  const sort = (
    <Segmented<InstalledSort>
      value={view.sort}
      options={[
        { value: "name", label: t.plugins.sort.name },
        { value: "attention", label: t.plugins.sort.attention },
      ]}
      onChange={view.setSort}
    />
  );
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: 8 }}>
        <SearchField value={view.text} onChange={view.setText} placeholder={t.plugins.searchInstalled} clearLabel={t.plugins.clearSearch} />
        {sort}
      </View>
      <ChipRow>
        {chips
          .filter((c) => c.value === "all" || view.counts[c.value] > 0)
          .map((c) => (
            <Chip
              key={c.value}
              label={c.label}
              icon={c.icon}
              count={view.counts[c.value]}
              active={view.filter === c.value}
              onPress={() => view.setFilter(c.value)}
            />
          ))}
      </ChipRow>
    </View>
  );
}

function InstalledList({
  scope,
  busy,
  onAction,
  activity,
}: {
  scope: Scope;
  busy: boolean;
  onAction: StartPlugin;
  activity: ActionFlow["activity"];
}) {
  const t = useToolboxText();
  const list = useRpc(listInstalledPlugins);
  const query = useQuery({
    queryKey: keys.installed(scope.ecosystem, scope.profileId, scope.cwd),
    queryFn: () => list(scope),
  });
  const items = query.data?.plugins ?? [];
  const view = useInstalledView(items, pluginFacts);
  const [open, setOpen] = useState<string | null>(null);
  const opened = open ? items.find((x) => x.id === open) ?? null : null;
  return (
    <View style={{ gap: 8 }}>
      {query.isPending ? <LoadingLine /> : null}
      {query.isError ? <Notice tone="danger" text={`${t.plugins.loadError}: ${t.diagnostic(errorText(query.error))}`} /> : null}
      {query.data?.error ? <Notice tone="warning" text={t.diagnostic(query.data.error)} /> : null}
      {query.isSuccess && items.length === 0 ? <EmptyState icon="Package" title={t.plugins.installedEmpty} /> : null}
      {items.length > 0 ? <InstalledToolbar view={view} /> : null}
      {items.length > 0 && view.shown.length === 0 ? <EmptyState icon="SearchX" title={t.plugins.filterEmpty} /> : null}
      {view.shown.length > 0 ? (
        <View style={{ gap: 8 }}>
          {view.shown.map((plugin) => (
            <InstalledCard
              key={plugin.id}
              plugin={plugin}
              scope={scope}
              busy={busy}
              onAction={onAction}
              activity={activity(trackKey(scope.ecosystem, scope.profileId, plugin.id))}
              onOpen={() => setOpen(plugin.id)}
            />
          ))}
        </View>
      ) : null}
      {opened ? (
        <InstalledCard
          detail
          plugin={opened}
          scope={scope}
          busy={busy}
          onAction={(...args) => {
            setOpen(null);
            onAction(...args);
          }}
          activity={activity(trackKey(scope.ecosystem, scope.profileId, opened.id))}
          onOpen={() => setOpen(null)}
        />
      ) : null}
    </View>
  );
}

/** One installed plugin of one profile, as a card or (with `detail`) as the detail sheet. */
function InstalledCard({
  plugin,
  scope,
  busy,
  onAction,
  activity,
  onOpen,
  detail,
}: {
  plugin: InstalledPlugin;
  scope: Scope;
  busy: boolean;
  onAction: StartPlugin;
  activity: Activity | null;
  /** Card: opens the detail. Detail: closes it. */
  onOpen(): void;
  detail?: boolean;
}) {
  const t = useToolboxText();
  const can = ECOSYSTEM_CAPS[scope.ecosystem].plugin;
  const m = installedMeta(plugin);
  const act = (action: PluginAction) => onAction(action, plugin.id, plugin.name, plugin.marketplace, plugin.scope ?? null);
  const running = activity?.state === "running";
  const scopeLabel = pluginScopeLabel(t, scope.ecosystem, plugin.scope);
  const control = (
    <StateControl
      state={{ installed: true, updateTo: m.updateTo, activity }}
      onInstall={null}
      onUpdate={can.includes("update") && m.updateTo ? () => act("update") : null}
      busy={busy}
      small={!detail}
      hideInstalled={!detail}
    />
  );
  const toggle = plugin.enabled === null ? null : plugin.enabled ? "disable" : "enable";
  const actions = running ? null : (
    <>
      {toggle && can.includes(toggle) ? (
        <Button
          small={!detail}
          icon={plugin.enabled ? "PowerOff" : "Power"}
          label={plugin.enabled ? t.plugins.actions.disable : t.plugins.actions.enable}
          onPress={() => act(toggle)}
          disabled={busy}
        />
      ) : null}
      {can.includes("uninstall") ? (
        <Button small={!detail} icon="Trash2" label={t.plugins.actions.uninstall} onPress={() => act("uninstall")} disabled={busy} />
      ) : null}
    </>
  );
  if (detail) {
    return (
      <PluginDetail
        info={{
          name: plugin.name,
          meta: m,
          description: plugin.description,
          marketplace: plugin.marketplace,
          source: plugin.source,
          scope: scopeLabel,
          errors: [activity?.state === "failed" && activity.error ? t.diagnostic(activity.error) : null, plugin.error ? t.diagnostic(plugin.error) : null].filter(
            (x): x is string => !!x,
          ),
        }}
        control={control}
        actions={actions}
        onClose={onOpen}
      />
    );
  }
  const failure = activity?.state === "failed" && activity.error ? t.diagnostic(activity.error) : null;
  return (
    <PluginCard
      layout="row"
      name={plugin.name}
      meta={m}
      subtitle={[m.version ? versionText(m.version) : null, m.author, plugin.marketplace, plugin.status].filter(Boolean).join(" · ") || null}
      description={failure ?? (plugin.error ? t.diagnostic(plugin.error) : plugin.description)}
      descriptionTone={failure || plugin.error ? "danger" : "muted"}
      badges={
        <>
          <Badge label={scopeLabel} />
          {m.updateTo ? <Badge label={t.plugins.updateTo(versionText(m.updateTo))} tone="warning" /> : null}
          {plugin.enabled === null ? null : (
            <Badge label={plugin.enabled ? t.plugins.enabled : t.plugins.disabled} tone={plugin.enabled ? "success" : "muted"} />
          )}
        </>
      }
      control={control}
      actions={actions}
      onOpen={onOpen}
    />
  );
}

// ---- Browse ----------------------------------------------------------------------------------

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

/** Store filters the catalog applies on the daemon, so paging stays honest. */
interface StoreQuery {
  category: string | null;
  sort: CatalogSort;
}

/** Browse pages: the first page on open, the next one each time the user asks for more. */
function useCatalogPages(scope: Scope, search: string, store: StoreQuery, enabled: boolean) {
  const list = useRpc(listCatalog);
  return useInfiniteQuery({
    queryKey: [...keys.catalog(scope.ecosystem, scope.profileId, scope.cwd, search), "pages", store.category, store.sort],
    queryFn: ({ pageParam }) =>
      list({ ...scope, query: search, offset: pageParam, limit: CATALOG_PAGE, category: store.category, sort: store.sort }),
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
  activity,
  trackProfile,
  installedIn,
  scopePicker,
}: {
  scope: Scope;
  busy: boolean;
  onAction: StartPlugin;
  activity: ActionFlow["activity"];
  /** Profile part of the tracking key: the catalog profile, or "*" in the all-profiles view. */
  trackProfile: string | null;
  /** All view: install state across profiles instead of the catalog profile's own flag. */
  installedIn?: (pluginId: string) => { n: number; total: number };
  /** "Install to" choice, for CLIs with install scopes. */
  scopePicker?: ReactNode;
}) {
  const t = useToolboxText();
  const { compact } = useLook();
  const caps = ECOSYSTEM_CAPS[scope.ecosystem];
  const sorts = catalogSorts(scope.ecosystem);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<CatalogSort>(sorts[0] ?? "name");
  const search = useDebounced(text.trim(), 300);
  const query = useCatalogPages(scope, search, { category, sort }, caps.browse);
  const pages = query.data?.pages ?? [];
  const items = useMemo(() => pages.flatMap((page) => page.plugins), [pages]);
  const total = pages[0]?.total ?? items.length;
  const firstError = pages[0]?.error ?? null;
  const facets = pages[0]?.categories ?? [];
  const catalogSource = scope.ecosystem === "paseo" ? pages[0]?.marketplaces[0]?.name : undefined;
  // The opened plugin follows refetches (installed flag, update) while its sheet is up.
  const [openKey, setOpenKey] = useState<{ key: string; snapshot: CatalogPlugin } | null>(null);
  const keyOf = (plugin: CatalogPlugin) => `${plugin.marketplace ?? ""}:${plugin.id}`;
  const open = openKey ? (items.find((x) => keyOf(x) === openKey.key) ?? openKey.snapshot) : null;
  const loadMore = () => {
    if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetching) void query.fetchNextPage();
  };
  useOnScreenEnd(loadMore);
  // No CLI browsing (Antigravity: only inside agy's /plugin), so the section is the note alone.
  if (!caps.browse) return <Notice text={t.plugins.antigravityBrowseNote} />;

  const card = (plugin: CatalogPlugin, detail: boolean) => (
    <CatalogCard
      key={keyOf(plugin)}
      plugin={plugin}
      detail={detail}
      showMarketplace={!catalogSource}
      installedIn={installedIn?.(plugin.id)}
      canInstall={caps.plugin.includes("install")}
      canUpdate={!installedIn && caps.plugin.includes("update")}
      busy={busy}
      activity={activity(trackKey(scope.ecosystem, trackProfile, plugin.id))}
      onAction={
        detail
          ? (...args) => {
              setOpenKey(null);
              onAction(...args);
            }
          : onAction
      }
      onOpen={() => setOpenKey(detail ? null : { key: keyOf(plugin), snapshot: plugin })}
    />
  );

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: 8 }}>
        <SearchField value={text} onChange={setText} placeholder={t.plugins.searchPlaceholder} clearLabel={t.plugins.clearSearch} />
        {sorts.length > 1 ? (
          <Segmented<CatalogSort>
            value={sort}
            options={sorts.map((s) => ({ value: s, label: t.plugins.sort[s] }))}
            onChange={setSort}
          />
        ) : null}
      </View>
      {scopePicker}
      {facets.length > 0 || category ? (
        <ChipRow>
          <Chip label={t.plugins.filters.all} active={category === null} onPress={() => setCategory(null)} />
          {/* The picked category stays even if a new search no longer lists it, so it can be undone. */}
          {(!category || facets.includes(category) ? facets : [category, ...facets]).map((name) => (
            <Chip key={name} label={name} active={category === name} onPress={() => setCategory(category === name ? null : name)} />
          ))}
        </ChipRow>
      ) : null}
      {query.isError ? <Notice tone="danger" text={`${t.plugins.loadError}: ${t.diagnostic(errorText(query.error))}`} /> : null}
      {firstError ? <Notice tone="warning" text={t.diagnostic(firstError)} /> : null}
      {total > 0 || query.isFetching ? (
        <SectionLabel trailing={query.isFetching && !query.isFetchingNextPage ? <ActivityIndicator size="small" /> : null}>
          {[catalogSource, total > 0 ? t.plugins.catalogCount(items.length, total) : null].filter(Boolean).join(" · ")}
        </SectionLabel>
      ) : null}
      {query.isPending ? <LoadingLine /> : null}
      {query.isSuccess && !query.isFetching && items.length === 0 ? (
        <EmptyState
          icon="SearchX"
          title={t.plugins.browseEmpty}
          action={
            text || category ? (
              <Button
                small
                label={t.plugins.clearFilters}
                onPress={() => {
                  setText("");
                  setCategory(null);
                }}
              />
            ) : undefined
          }
        />
      ) : null}
      {items.length > 0 ? <CardGrid columns={compact ? 1 : 2}>{items.map((plugin) => card(plugin, false))}</CardGrid> : null}
      {query.hasNextPage ? (
        query.isFetchingNextPage ? (
          <LoadingLine />
        ) : (
          <Button label={t.plugins.loadMore(Math.min(CATALOG_PAGE, total - items.length))} onPress={loadMore} />
        )
      ) : null}
      {open ? card(open, true) : null}
    </View>
  );
}

function CatalogCard({
  plugin,
  showMarketplace,
  canInstall,
  canUpdate,
  busy,
  activity,
  onAction,
  installedIn,
  onOpen,
  detail,
}: {
  installedIn?: { n: number; total: number };
  showMarketplace: boolean;
  plugin: CatalogPlugin;
  canInstall: boolean;
  canUpdate: boolean;
  busy: boolean;
  activity: Activity | null;
  onAction: StartPlugin;
  onOpen(): void;
  detail: boolean;
}) {
  const t = useToolboxText();
  const m = catalogMeta(plugin);
  const act = (action: PluginAction) => onAction(action, plugin.id, plugin.name, plugin.marketplace);
  const installed = installedIn ? installedIn.n > 0 : plugin.installed;
  const everywhere = installedIn ? installedIn.n >= installedIn.total : plugin.installed;
  const control = (
    <StateControl
      state={{ installed, updateTo: m.updateTo, activity }}
      installLabel={installedIn && installed && !everywhere ? t.plugins.installToRest : undefined}
      onInstall={canInstall && !everywhere ? () => act("install") : null}
      onUpdate={canUpdate ? () => act("update") : null}
      busy={busy}
      small={!detail}
    />
  );
  const badges = installedIn ? (
    installedIn.n > 0 ? <Badge label={t.plugins.installedIn(installedIn.n, installedIn.total)} tone="success" /> : null
  ) : m.updateTo && installed ? (
    <Badge label={t.plugins.updateAvailable} tone="warning" />
  ) : null;
  if (detail) {
    return (
      <PluginDetail
        info={{
          name: plugin.name,
          meta: m,
          description: plugin.description,
          marketplace: plugin.marketplace,
          source: plugin.source,
          errors: activity?.state === "failed" && activity.error ? [t.diagnostic(activity.error)] : [],
        }}
        control={control}
        actions={badges}
        onClose={onOpen}
      />
    );
  }
  const failure = activity?.state === "failed" && activity.error ? t.diagnostic(activity.error) : null;
  return (
    <PluginCard
      layout="tile"
      name={plugin.name}
      meta={m}
      subtitle={[m.author, showMarketplace ? plugin.marketplace : null, m.version ? versionText(m.version) : null].filter(Boolean).join(" · ") || null}
      description={failure ?? plugin.description}
      descriptionTone={failure ? "danger" : "muted"}
      badges={badges}
      control={control}
      onOpen={onOpen}
    />
  );
}

// ---- Marketplaces ----------------------------------------------------------------------------

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
              badge={m.official ? <Badge label={t.plugins.official} /> : undefined}
              meta={[m.source, m.pluginCount === null ? null : t.plugins.pluginCount(m.pluginCount)].filter(Boolean).join(" · ") || null}
              actions={
                <>
                  {can.includes("update") ? (
                    <Button small icon="RefreshCw" label={t.plugins.actions.update} onPress={() => onAction("update", m.name)} disabled={busy} />
                  ) : null}
                  {can.includes("remove") && !m.official ? (
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

/** Profile part of the tracking key for actions run across profiles. */
const ALL_TRACK = "*";

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
        source: plugin.source,
        entries: new Map<string, InstalledPlugin>(),
      };
      rows.set(plugin.id, row);
      row.entries.set(profile.id, plugin);
    }
  });
  const allRows = [...rows.values()];
  const view = useInstalledView(allRows, rowFacts);
  const notInstalled = profiles.filter((x) => x.auth.state === "not_installed");
  const [open, setOpen] = useState<string | null>(null);

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
      track: { key: trackKey(ecosystem, ALL_TRACK, pluginId), kind: ACTIVITY_OF[action] },
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

  const rowCard = (row: PluginRow, detail: boolean) => {
    const entries = [...row.entries.values()];
    const has = (pred: (x: InstalledPlugin) => boolean) => entries.some(pred);
    const missing = profiles.some((x) => bulkSelectable(x) && loaded.has(x.id) && !row.entries.has(x.id));
    const updates = entries.filter((x) => x.updateTo);
    const versions = [...new Set(entries.map((x) => x.version).filter((v): v is string => !!v))].map(versionText);
    const errorsOf = profiles.flatMap((profile) => {
      const error = row.entries.get(profile.id)?.error;
      return error ? [`${shortLabel(t, profile)}: ${t.diagnostic(error)}`] : [];
    });
    const activity = flow.activity(trackKey(ecosystem, ALL_TRACK, row.id));
    const running = activity?.state === "running";
    // Store fields from the first profile that has them (they describe the plugin, not the install).
    const first = entries[0];
    const m = first ? { ...installedMeta(first), version: versions.length === 1 ? (versions[0] ?? null) : null, updateTo: updates[0]?.updateTo ?? null } : null;
    if (!m) return null;
    const act = (action: PluginAction) => {
      if (detail) setOpen(null);
      startForRow(action, row);
    };
    const control = (
      <StateControl
        state={{ installed: true, updateTo: updates.length > 0 ? (updates[0]?.updateTo ?? null) : null, activity }}
        onInstall={null}
        onUpdate={can.includes("update") && updates.length > 0 ? () => act("update") : null}
        busy={flow.busy}
        small={!detail}
        hideInstalled={!detail}
      />
    );
    const actions = running ? null : (
      <>
        {can.includes("install") && missing ? (
          <Button small={!detail} icon="CopyPlus" label={t.plugins.installToRest} onPress={() => act("install")} disabled={flow.busy} />
        ) : null}
        {can.includes("enable") && has((x) => x.enabled === false) ? (
          <Button small={!detail} icon="Power" label={t.plugins.actions.enable} onPress={() => act("enable")} disabled={flow.busy} />
        ) : null}
        {can.includes("disable") && has((x) => x.enabled === true) ? (
          <Button small={!detail} icon="PowerOff" label={t.plugins.actions.disable} onPress={() => act("disable")} disabled={flow.busy} />
        ) : null}
        {can.includes("uninstall") ? (
          <Button small={!detail} icon="Trash2" label={t.plugins.actions.uninstall} onPress={() => act("uninstall")} disabled={flow.busy} />
        ) : null}
      </>
    );
    const strip = <ProfileStrip items={profiles.map((profile) => ({ profile, presence: presence(profile, row) }))} />;
    const scopes = [...new Set(entries.map((x) => pluginScopeLabel(t, ecosystem, x.scope)))];
    const failure = activity?.state === "failed" && activity.error ? t.diagnostic(activity.error) : null;
    if (detail) {
      return (
        <PluginDetail
          info={{
            name: row.name,
            meta: m,
            description: row.description,
            marketplace: row.marketplace,
            source: row.source,
            scope: scopes.join(", "),
            errors: [...(failure ? [failure] : []), ...errorsOf],
          }}
          control={control}
          actions={actions}
          extra={strip}
          onClose={() => setOpen(null)}
        />
      );
    }
    return (
      <PluginCard
        key={row.id}
        layout="row"
        name={row.name}
        meta={m}
        subtitle={[versions.join(", "), m.author, row.marketplace].filter(Boolean).join(" · ") || null}
        description={failure ?? (errorsOf.length > 0 ? errorsOf.join("\n") : row.description)}
        descriptionTone={failure || errorsOf.length > 0 ? "danger" : "muted"}
        badges={
          <>
            {scopes.map((label) => (
              <Badge key={label} label={label} />
            ))}
            {updates.length > 0 ? <Badge label={t.plugins.updateAvailable} tone="warning" /> : null}
          </>
        }
        below={<View style={{ marginTop: 4 }}>{strip}</View>}
        control={control}
        actions={actions}
        onOpen={() => setOpen(row.id)}
      />
    );
  };
  const opened = open ? rows.get(open) ?? null : null;

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
          {loading.length === 0 && allRows.length === 0 ? <EmptyState icon="Package" title={t.plugins.installedEmpty} /> : null}
          {allRows.length > 0 ? <InstalledToolbar view={view} /> : null}
          {allRows.length > 0 && view.shown.length === 0 ? <EmptyState icon="SearchX" title={t.plugins.filterEmpty} /> : null}
          {view.shown.length > 0 ? <View style={{ gap: 8 }}>{view.shown.map((row) => rowCard(row, false))}</View> : null}
          {opened ? rowCard(opened, true) : null}
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
              activity={flow.activity}
              trackProfile={ALL_TRACK}
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
