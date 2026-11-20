// "/mcp": MCP servers of one profile (account), or of every profile side by side ("전체"),
// with add, remove and login; in the all view add and remove run on several profiles at once.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { addMcp, listMcp, loginMcp, previewMcpAdd, removeMcp } from "../../shared/toolbox/rpc";
import { MCP_SCOPES, type McpAddInput, type McpServer, type Profile, type ProviderKind } from "../../shared/toolbox/types";
import { palette } from "../look";
import { useActionFlow, type ActionFlow, type ActionTarget } from "./action-flow";
import { keys, useProfiles } from "./queries";
import { ToolboxTextProvider, useToolboxStrings, useToolboxText, type Strings } from "./strings";
import {
  ALL_PROFILES,
  Badge,
  SHARED_SCOPES,
  ScopeBasis,
  mcpScopeLabel,
  ProfileStrip,
  TargetPicker,
  bulkSelectable,
  shortLabel,
  type Presence,
  type TargetOption,
  Button,
  Card,
  Dot,
  EmptyState,
  ListRow,
  LoadingLine,
  BackBar,
  LookProvider,
  MONO,
  Notice,
  ProfileSwitcher,
  RADIUS,
  ScreenBody,
  SectionLabel,
  Segmented,
  errorText,
  mcpStatusColor,
  useLook,
} from "./ui";

export function McpScreen({ theme, layout, host, params, navigation }: PluginScreenProps) {
  const strings = useToolboxStrings();
  const look = useMemo(() => ({ p: palette(theme.colors), compact: layout.compact }), [theme, layout.compact]);
  return (
    <ToolboxTextProvider value={strings}>
      <LookProvider value={look}>
        <View style={{ flex: 1 }}>
          <BackBar agentId={params.agentId} title={params.agentTitle} hostId={host.id} navigation={navigation} />
          <McpBody hostId={host.id} params={params} />
        </View>
      </LookProvider>
    </ToolboxTextProvider>
  );
}

function McpBody({ hostId, params }: { hostId: string; params: Record<string, string> }) {
  const t = useToolboxText();
  const { query: profilesQuery, refresh, refreshing } = useProfiles();
  const profiles = profilesQuery.data?.profiles ?? [];
  const cwd = params.cwd ? params.cwd : null;
  const flow = useActionFlow(hostId);
  const queryClient = useQueryClient();

  // `/mcp <profile>` or the opening chat picks the tab (its kind); an unknown id never falls back.
  const requested = params.profileId ? params.profileId : null;
  const requestedProfile = profiles.find((x) => x.id === requested) ?? null;
  const unknown = profilesQuery.isSuccess && requested !== null && requestedProfile === null;
  const [tab, setTab] = useState<ProviderKind | null>(null);
  useEffect(() => setTab(null), [requested]);
  const activeTab: ProviderKind = tab ?? requestedProfile?.kind ?? "claude";

  // Per tab: an account the user picked, else "전체" when the tab has several accounts (they are
  // told apart row by row), else its only account.
  const [picked, setPicked] = useState<Partial<Record<ProviderKind, string>>>({});
  useEffect(() => setPicked({}), [requested]);
  const ofKind = profiles.filter((x) => x.kind === activeTab);
  const choice = picked[activeTab] ?? (ofKind.length > 1 ? ALL_PROFILES : (ofKind[0]?.id ?? null));
  const all = choice === ALL_PROFILES && ofKind.length > 1;
  const profile = all ? null : (ofKind.find((x) => x.id === choice) ?? ofKind[0] ?? null);

  return (
    <ScreenBody>
      <Segmented<ProviderKind>
        value={activeTab}
        options={KINDS.map((k) => ({ value: k, label: t.plugins.tabs[k] }))}
        onChange={setTab}
      />
      {profilesQuery.isPending ? <LoadingLine /> : null}
      {profilesQuery.isError ? (
        <Notice tone="danger" text={`${t.profile.loadError}: ${t.diagnostic(errorText(profilesQuery.error))}`} />
      ) : null}
      {unknown && requested ? <Notice tone="warning" text={t.profile.unmanaged(requested)} /> : null}
      {profilesQuery.isSuccess && ofKind.length === 0 ? (
        <EmptyState icon="Users" title={t.profile.noneOfKind(t.plugins.tabs[activeTab])} />
      ) : null}
      {ofKind.length > 0 ? (
        <ProfileSwitcher
          profiles={ofKind}
          value={all ? ALL_PROFILES : (profile?.id ?? null)}
          onChange={(id) => setPicked((prev) => ({ ...prev, [activeTab]: id }))}
          withAll={ofKind.length > 1}
          onRefresh={() => {
            refresh();
            // The list is cached (health checks are slow); the refresh button is the explicit rerun.
            if (all) void queryClient.invalidateQueries({ queryKey: keys.mcpAll });
            else if (profile) void queryClient.invalidateQueries({ queryKey: keys.mcp(profile.id) });
          }}
          refreshing={refreshing}
        />
      ) : null}
      {ofKind.length > 0 ? <ScopeBasis cwd={cwd} /> : null}
      {all ? <AllServers key={`all:${activeTab}`} profiles={ofKind} cwd={cwd} flow={flow} /> : null}
      {profile ? <ProfileServers key={profile.id} profile={profile} cwd={cwd} flow={flow} /> : null}
      {flow.element}
    </ScreenBody>
  );
}

function ProfileServers({ profile, cwd, flow }: { profile: Profile; cwd: string | null; flow: ActionFlow }) {
  const t = useToolboxText();
  const { p } = useLook();
  const list = useRpc(listMcp);
  const preview = useRpc(previewMcpAdd);
  const add = useRpc(addMcp);
  const remove = useRpc(removeMcp);
  const login = useRpc(loginMcp);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<McpForm>(() => emptyForm(profile.kind, cwd));
  const [search, setSearch] = useState("");

  const usable = profile.auth.state !== "not_installed" && profile.auth.state !== "logged_out";
  const servers = useQuery({
    queryKey: keys.mcpList(profile.id, cwd),
    queryFn: () => list({ profileId: profile.id, cwd }),
    enabled: usable,
    // `claude mcp list` health-checks every server: do not rerun on each mount or focus.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  if (profile.auth.state === "not_installed") {
    return <EmptyState icon="PackageX" title={t.profile.notInstalledTitle} body={t.profile.notInstalledBody(profile.command)} />;
  }
  if (profile.auth.state === "logged_out") {
    return <EmptyState icon="LogIn" title={t.profile.loggedOutTitle} body={t.profile.loggedOutBody} />;
  }

  const items = servers.data?.servers ?? [];
  const needle = search.trim().toLowerCase();
  // Name order; servers that need a login are pulled into their own group on top.
  const shown = items
    .filter((s) => !needle || [s.name, s.scope, s.transport, s.target].some((v) => v?.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const needsLogin = shown.filter((s) => s.status === "needs_auth");
  const rest = shown.filter((s) => s.status !== "needs_auth");
  const invalidate = [keys.mcp(profile.id)];

  const submitForm = () => {
    const server = toInput(form);
    const secrets = [...Object.values(server.env), ...Object.values(server.headers)];
    setFormOpen(false);
    flow.start({
      title: t.mcp.form.title,
      subject: `${profile.label} · ${server.name}`,
      bringsCode: true,
      preview: () => preview({ profileId: profile.id, cwd, server }),
      run: () => add({ profileId: profile.id, cwd, server }),
      invalidate,
      reloadProvider: profile.id,
      secrets,
      onResult: (result) => {
        if (result.ok) setForm(emptyForm(profile.kind, cwd));
      },
    });
  };

  const startRemove = (server: McpServer) =>
    flow.start({
      title: t.mcp.removeTitle,
      subject: `${profile.label} · ${server.name}`,
      destructive: true,
      preview: null,
      localWarnings:
        server.scope === null && cwd === null ? [t.mcp.removeWarning, t.mcp.removeUserLevel] : [t.mcp.removeWarning],
      run: () => remove({ profileId: profile.id, cwd, name: server.name, scope: server.scope }),
      invalidate,
      reloadProvider: profile.id,
    });

  const startLogin = (server: McpServer) =>
    flow.start({
      title: t.mcp.loginTitle,
      subject: `${profile.label} · ${server.name}`,
      preview: null,
      localWarnings: [t.mcp.loginWarning],
      run: () => login({ profileId: profile.id, cwd, name: server.name }),
      invalidate,
      reloadProvider: profile.id,
    });

  const renderCard = (list: McpServer[]) => (
    <Card>
      {list.map((server, i) => (
        <ListRow
          key={`${server.scope ?? ""}:${server.name}`}
          first={i === 0}
          leading={<Dot color={mcpStatusColor(p, server.status)} />}
          title={server.name}
          badge={
            <>
              <Badge label={t.mcp.status[server.status]} tone={statusTone(server.status)} />
              <Badge label={mcpScopeLabel(t, profile.kind, server)} />
            </>
          }
          meta={[server.transport, server.target].filter(Boolean).join(" · ") || null}
          detail={server.detail && t.diagnostic(server.detail)}
          detailTone={server.status === "failed" ? "danger" : "muted"}
          actions={
            <>
              {server.status === "needs_auth" ? (
                <Button small icon="LogIn" label={t.mcp.login} onPress={() => startLogin(server)} disabled={flow.busy} />
              ) : null}
              {server.scope !== "plugin" ? (
                <Button small icon="Trash2" label={t.mcp.remove} onPress={() => startRemove(server)} disabled={flow.busy} />
              ) : null}
            </>
          }
        />
      ))}
    </Card>
  );

  return (
    <View style={{ gap: 8 }}>
      <SectionLabel
        trailing={<Button small icon="Plus" label={t.mcp.add} onPress={() => setFormOpen(true)} disabled={flow.busy} />}
      >
        {servers.isSuccess ? t.mcp.count(items.length) : t.mcp.servers}
      </SectionLabel>
      {servers.isPending ? <LoadingLine /> : null}
      {servers.isError ? <Notice tone="danger" text={`${t.mcp.loadError}: ${t.diagnostic(errorText(servers.error))}`} /> : null}
      {servers.data?.error ? <Notice tone="warning" text={t.diagnostic(servers.data.error)} /> : null}
      {servers.isSuccess && items.length === 0 ? <EmptyState icon="Plug" title={t.mcp.empty} /> : null}
      {items.length > 0 ? (
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t.mcp.searchPlaceholder}
          placeholderTextColor={p.idle}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={{
            height: 36,
            paddingHorizontal: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: p.guide,
            color: p.foreground,
            fontSize: 13,
          }}
        />
      ) : null}
      {items.length > 0 && shown.length === 0 ? <EmptyState icon="Search" title={t.mcp.noMatch} /> : null}
      {needsLogin.length > 0 ? (
        <>
          <SectionLabel>{t.mcp.needsLoginGroup(needsLogin.length)}</SectionLabel>
          {renderCard(needsLogin)}
        </>
      ) : null}
      {rest.length > 0 ? (
        <>
          {needsLogin.length > 0 ? <SectionLabel>{t.mcp.otherGroup(rest.length)}</SectionLabel> : null}
          {renderCard(rest)}
        </>
      ) : null}
      <AddServerModal
        open={formOpen}
        kind={profile.kind}
        cwd={cwd}
        form={form}
        onChange={setForm}
        onClose={() => setFormOpen(false)}
        onSubmit={submitForm}
      />
    </View>
  );
}

function statusTone(status: McpServer["status"]): "success" | "warning" | "danger" | "muted" {
  if (status === "connected") return "success";
  if (status === "failed") return "danger";
  if (status === "needs_auth") return "warning";
  return "muted";
}

// ---- All profiles ----------------------------------------------------------------------------

const KINDS: readonly ProviderKind[] = ["claude", "codex", "antigravity"];

/** One server name across the profiles of one kind. Claude project scope is one shared row. */
interface ServerRow {
  key: string;
  name: string;
  scope: string | null;
  shared: boolean;
  /** profile id -> that profile's entry. */
  entries: Map<string, McpServer>;
}

type ListState = "ok" | "loading" | "error";

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

function authNote(t: Strings, profile: Profile): string | null {
  if (profile.auth.state === "logged_out") return t.targets.noteLoggedOut;
  if (profile.auth.state === "not_installed") return t.targets.noteNotInstalled;
  return null;
}

/** Prefill from a server another profile lists. Env and header values are never listed. */
function formFrom(server: McpServer, kind: ProviderKind, cwd: string | null): McpForm {
  const base = emptyForm(kind, cwd);
  const raw = server.transport?.toLowerCase() ?? "";
  const target = server.target?.trim() ?? "";
  const transport: McpAddInput["transport"] =
    raw === "stdio" || raw === "http" || raw === "sse" ? raw : /^https?:\/\//i.test(target) ? "http" : "stdio";
  // A quoted command line cannot be split safely here: keep it whole and let the user fix it.
  const parts = transport === "stdio" && !/["']/.test(target) ? target.split(/\s+/).filter(Boolean) : [target];
  const scopes = MCP_SCOPES[kind];
  const scope =
    server.scope && scopes.includes(server.scope) && (cwd || !PROJECT_SCOPES.includes(server.scope)) ? server.scope : base.scope;
  return { ...base, name: server.name, scope, transport, target: parts[0] ?? "", args: parts.slice(1).join("\n") };
}

interface BulkForm {
  kind: ProviderKind;
  form: McpForm;
  targets: string[];
  /** Row the form was copied from; profiles that already have it cannot be picked. */
  from: ServerRow | null;
}

function AllServers({ profiles, cwd, flow }: { profiles: readonly Profile[]; cwd: string | null; flow: ActionFlow }) {
  const t = useToolboxText();
  const { p } = useLook();
  const list = useRpc(listMcp);
  const preview = useRpc(previewMcpAdd);
  const add = useRpc(addMcp);
  const remove = useRpc(removeMcp);
  const login = useRpc(loginMcp);
  const [search, setSearch] = useState("");
  const [bulk, setBulk] = useState<BulkForm | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // Same keys as the single-profile view, so both share the cache. Each profile loads on its own.
  const listed = profiles.filter(bulkSelectable);
  const queries = useQueries({
    queries: listed.map((profile) => ({
      queryKey: keys.mcpList(profile.id, cwd),
      queryFn: () => list({ profileId: profile.id, cwd }),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    })),
  });

  const state = new Map<string, ListState>();
  const listError = new Map<string, string>();
  const rowsByKind = new Map<ProviderKind, Map<string, ServerRow>>();
  listed.forEach((profile, i) => {
    const q = queries[i];
    if (!q || q.isPending) {
      state.set(profile.id, "loading");
      return;
    }
    if (q.isError) {
      state.set(profile.id, "error");
      listError.set(profile.id, t.diagnostic(errorText(q.error)));
      return;
    }
    state.set(profile.id, "ok");
    if (q.data.error) listError.set(profile.id, t.diagnostic(q.data.error));
    const rows = rowsByKind.get(profile.kind) ?? new Map<string, ServerRow>();
    rowsByKind.set(profile.kind, rows);
    for (const server of q.data.servers) {
      // Same name in another scope is another server; project scope is one shared file.
      const shared = server.scope !== null && SHARED_SCOPES.includes(server.scope);
      const key = `${server.scope ?? ""}:${server.name}`;
      const row = rows.get(key) ?? { key, name: server.name, scope: server.scope, shared, entries: new Map<string, McpServer>() };
      rows.set(key, row);
      if (!row.entries.has(profile.id)) row.entries.set(profile.id, server);
    }
  });

  const needle = search.trim().toLowerCase();
  const matches = (row: ServerRow) =>
    !needle ||
    row.name.toLowerCase().includes(needle) ||
    [...row.entries.values()].some((s) => [s.scope, s.transport, s.target].some((v) => v?.toLowerCase().includes(needle)));
  const skipped = profiles.filter((x) => !bulkSelectable(x));
  const anyRows = [...rowsByKind.values()].some((rows) => rows.size > 0);

  const presence = (profile: Profile, row: ServerRow): Presence => {
    if (!bulkSelectable(profile)) return { kind: "unknown", label: t.auth[profile.auth.state] };
    const s = state.get(profile.id);
    if (s === "loading") return { kind: "unknown", label: t.strip.loading };
    if (s === "error") return { kind: "unknown", label: t.strip.unlisted };
    const entry = row.entries.get(profile.id);
    return entry ? { kind: "present", color: mcpStatusColor(p, entry.status), label: t.mcp.status[entry.status] } : { kind: "absent" };
  };

  const targetOptions = (ofKind: readonly Profile[], has?: ServerRow): TargetOption[] =>
    ofKind.map((profile) => ({
      id: profile.id,
      label: profile.label,
      provider: profile.id,
      disabled: !bulkSelectable(profile) || (has ? has.entries.has(profile.id) : false),
      note: authNote(t, profile) ?? (has?.entries.has(profile.id) ? t.targets.noteHas : null),
    }));

  const openAdd = (kind: ProviderKind, from?: { row: ServerRow; server: McpServer }) => {
    const ofKind = profiles.filter((x) => x.kind === kind);
    const targets = ofKind
      .filter((x) => x.auth.state === "logged_in" && (!from || (state.get(x.id) === "ok" && !from.row.entries.has(x.id))))
      .map((x) => x.id);
    setBulk({ kind, form: from ? formFrom(from.server, kind, cwd) : emptyForm(kind, cwd), targets, from: from?.row ?? null });
    setFormOpen(true);
  };

  const submitBulk = () => {
    if (!bulk) return;
    const server = toInput(bulk.form);
    const secrets = [...Object.values(server.env), ...Object.values(server.headers)];
    const chosen = profiles.filter(
      (x) => x.kind === bulk.kind && bulkSelectable(x) && bulk.targets.includes(x.id) && !bulk.from?.entries.has(x.id),
    );
    if (chosen.length === 0) return;
    setFormOpen(false);
    if (server.scope !== null && SHARED_SCOPES.includes(server.scope)) {
      // One shared file in the project: write it once, through the first chosen profile.
      const via = chosen[0];
      flow.start({
        title: t.mcp.form.title,
        subject: `${t.scope.projectShared} · ${server.name}`,
        bringsCode: true,
        localWarnings: [t.scope.sharedOnce(via.label)],
        preview: () => preview({ profileId: via.id, cwd, server }),
        run: () => add({ profileId: via.id, cwd, server }),
        invalidate: profiles.filter((x) => x.kind === bulk.kind).map((x) => keys.mcp(x.id)),
        reloadProvider: via.id,
        secrets,
        onResult: (result) => {
          if (result.ok) setBulk(null);
        },
      });
      return;
    }
    flow.startBulk({
      title: t.mcp.form.title,
      subject: server.name,
      bringsCode: true,
      pick: false,
      targets: chosen.map(
        (profile): ActionTarget => ({
          id: profile.id,
          label: profile.label,
          selectable: true,
          preselected: true,
          preview: () => preview({ profileId: profile.id, cwd, server }),
          run: () => add({ profileId: profile.id, cwd, server }),
          reloadProvider: profile.id,
        }),
      ),
      invalidate: chosen.map((x) => keys.mcp(x.id)),
      secrets,
      onResults: (results) => {
        if (results.every((r) => r.result.ok)) setBulk(null);
      },
    });
  };

  const startLogin = (profile: Profile, server: McpServer) =>
    flow.start({
      title: t.mcp.loginTitle,
      subject: `${profile.label} · ${server.name}`,
      preview: null,
      localWarnings: [t.mcp.loginWarning],
      run: () => login({ profileId: profile.id, cwd, name: server.name }),
      invalidate: [keys.mcp(profile.id)],
      reloadProvider: profile.id,
    });

  const startRemove = (ofKind: readonly Profile[], row: ServerRow) => {
    if (row.shared) {
      // One file (.mcp.json) for every profile: remove once, through a profile that lists it.
      const via = ofKind.find((x) => row.entries.has(x.id));
      const entry = via ? row.entries.get(via.id) : undefined;
      if (!via || !entry) return;
      flow.start({
        title: t.mcp.removeTitle,
        subject: `${t.mcp.shared} · ${row.name}`,
        destructive: true,
        preview: null,
        localWarnings: [t.mcp.sharedRemoveWarning],
        run: () => remove({ profileId: via.id, cwd, name: row.name, scope: entry.scope }),
        invalidate: ofKind.map((x) => keys.mcp(x.id)),
        reloadProvider: via.id,
      });
      return;
    }
    const userLevel = cwd === null && [...row.entries.values()].some((s) => s.scope === null);
    flow.startBulk({
      title: t.mcp.removeTitle,
      subject: row.name,
      destructive: true,
      pick: true,
      localWarnings: userLevel ? [t.mcp.removeWarning, t.mcp.removeUserLevel] : [t.mcp.removeWarning],
      targets: ofKind.map((profile): ActionTarget => {
        const entry = row.entries.get(profile.id);
        const removable = !!entry && entry.scope !== "plugin" && bulkSelectable(profile);
        return {
          id: profile.id,
          label: profile.label,
          selectable: removable,
          preselected: removable && profile.auth.state === "logged_in",
          note: authNote(t, profile) ?? (entry ? null : t.targets.noteMissing),
          preview: null,
          run: () => remove({ profileId: profile.id, cwd, name: row.name, scope: entry?.scope ?? null }),
          reloadProvider: profile.id,
        };
      }),
      invalidate: ofKind.map((x) => keys.mcp(x.id)),
    });
  };

  const renderRows = (kind: ProviderKind, ofKind: readonly Profile[], rows: ServerRow[]) => (
    <Card>
      {rows.map((row, i) => {
        const entries = [...row.entries.values()];
        const first = entries[0];
        const needAuth = ofKind.filter((x) => row.entries.get(x.id)?.status === "needs_auth");
        const missing = row.shared ? [] : ofKind.filter((x) => state.get(x.id) === "ok" && !row.entries.has(x.id));
        const removable = entries.some((s) => s.scope !== "plugin");
        const failed = ofKind
          .map((x) => ({ x, s: row.entries.get(x.id) }))
          .flatMap(({ x, s }) =>
            s?.status === "failed" && s.detail ? [`${shortLabel(t, x)}: ${t.diagnostic(s.detail)}`] : [],
          );
        return (
          <ListRow
            key={row.key}
            first={i === 0}
            title={row.name}
            badge={<Badge label={mcpScopeLabel(t, kind, row)} />}
            meta={[first?.transport, first?.target].filter(Boolean).join(" · ") || null}
            detail={failed.length > 0 ? failed.join("\n") : null}
            detailTone="danger"
            below={<ProfileStrip items={ofKind.map((profile) => ({ profile, presence: presence(profile, row) }))} />}
            actions={
              <>
                {needAuth.map((x) => (
                  <Button
                    key={x.id}
                    small
                    icon="LogIn"
                    label={t.mcp.loginIn(shortLabel(t, x))}
                    onPress={() => startLogin(x, row.entries.get(x.id)!)}
                    disabled={flow.busy}
                  />
                ))}
                {missing.length > 0 && first ? (
                  <Button
                    small
                    icon="CopyPlus"
                    label={t.mcp.addToRest}
                    onPress={() => openAdd(kind, { row, server: first })}
                    disabled={flow.busy}
                  />
                ) : null}
                {removable ? (
                  <Button small icon="Trash2" label={t.mcp.remove} onPress={() => startRemove(ofKind, row)} disabled={flow.busy} />
                ) : null}
              </>
            }
          />
        );
      })}
    </Card>
  );

  return (
    <View style={{ gap: 12 }}>
      {skipped.length > 0 ? <Notice text={t.profile.skippedProfiles(skipped.map((x) => x.label).join(", "))} /> : null}
      {anyRows ? (
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t.mcp.searchPlaceholder}
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
      ) : null}
      {KINDS.map((kind) => {
        const ofKind = profiles.filter((x) => x.kind === kind);
        if (ofKind.length === 0) return null;
        const usable = ofKind.filter(bulkSelectable);
        const loading = usable.filter((x) => state.get(x.id) === "loading");
        const errors = usable.filter((x) => listError.has(x.id));
        const all = [...(rowsByKind.get(kind)?.values() ?? [])];
        const shown = all.filter(matches).sort(byName);
        const needsLogin = shown.filter((row) => [...row.entries.values()].some((s) => s.status === "needs_auth"));
        const rest = shown.filter((row) => !needsLogin.includes(row));
        return (
          <View key={kind} style={{ gap: 8 }}>
            <SectionLabel
              trailing={
                usable.length > 0 ? (
                  <Button small icon="Plus" label={t.mcp.add} onPress={() => openAdd(kind)} disabled={flow.busy} />
                ) : undefined
              }
            >
              {t.profile.kindHeader(t.plugins.tabs[kind], ofKind.length)}
            </SectionLabel>
            {loading.length > 0 ? <LoadingLine label={t.profile.loadingProfiles(loading.map((profile) => shortLabel(t, profile)).join(", "))} /> : null}
            {errors.map((x) => (
              <Notice key={x.id} tone="warning" text={`${x.label}: ${listError.get(x.id)}`} />
            ))}
            {loading.length === 0 && all.length === 0 && usable.length > 0 ? <EmptyState icon="Plug" title={t.mcp.empty} /> : null}
            {all.length > 0 && shown.length === 0 ? <EmptyState icon="Search" title={t.mcp.noMatch} /> : null}
            {needsLogin.length > 0 ? (
              <>
                <SectionLabel>{t.mcp.needsLoginGroup(needsLogin.length)}</SectionLabel>
                {renderRows(kind, ofKind, needsLogin)}
              </>
            ) : null}
            {rest.length > 0 ? (
              <>
                {needsLogin.length > 0 ? <SectionLabel>{t.mcp.otherGroup(rest.length)}</SectionLabel> : null}
                {renderRows(kind, ofKind, rest)}
              </>
            ) : null}
          </View>
        );
      })}
      {bulk ? (
        <AddServerModal
          open={formOpen}
          kind={bulk.kind}
          cwd={cwd}
          form={bulk.form}
          onChange={(form) => setBulk((cur) => (cur ? { ...cur, form } : cur))}
          onClose={() => setFormOpen(false)}
          onSubmit={submitBulk}
          note={bulk.from ? t.mcp.copyNote : null}
          targets={{
            options: targetOptions(profiles.filter((x) => x.kind === bulk.kind), bulk.from ?? undefined),
            selected: bulk.targets,
            onChange: (ids) => setBulk((cur) => (cur ? { ...cur, targets: ids } : cur)),
          }}
        />
      ) : null}
    </View>
  );
}

// ---- Add form --------------------------------------------------------------------------------

interface Pair {
  id: number;
  key: string;
  value: string;
}

interface McpForm {
  name: string;
  scope: string | null;
  transport: McpAddInput["transport"];
  target: string;
  args: string;
  env: Pair[];
  headers: Pair[];
}

let pairId = 0;
const newPair = (): Pair => ({ id: ++pairId, key: "", value: "" });

/** Scopes that write into a project and so need the agent's cwd. */
const PROJECT_SCOPES: readonly string[] = ["local", "project"];
const USER_SCOPE = "user";

/**
 * The first scope in MCP_SCOPES is the CLI's default; no scopes means the CLI has none (null).
 * Without a project path the default is the user-level scope, never one bound to a project.
 */
function emptyForm(kind: ProviderKind, cwd: string | null): McpForm {
  const scopes = MCP_SCOPES[kind];
  const userLevel = scopes.includes(USER_SCOPE) ? USER_SCOPE : (scopes.find((s) => !PROJECT_SCOPES.includes(s)) ?? null);
  const scope = cwd ? (scopes[0] ?? null) : userLevel;
  return { name: "", scope, transport: "stdio", target: "", args: "", env: [], headers: [] };
}

function toRecord(pairs: readonly Pair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key) out[key] = pair.value;
  }
  return out;
}

function toInput(form: McpForm): McpAddInput {
  const stdio = form.transport === "stdio";
  return {
    name: form.name.trim(),
    scope: form.scope,
    transport: form.transport,
    target: form.target.trim(),
    args: stdio
      ? form.args
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : [],
    env: stdio ? toRecord(form.env) : {},
    headers: stdio ? {} : toRecord(form.headers),
  };
}

function AddServerModal({
  open,
  kind,
  cwd,
  form,
  onChange,
  onClose,
  onSubmit,
  targets,
  note,
}: {
  open: boolean;
  kind: ProviderKind;
  cwd: string | null;
  form: McpForm;
  onChange(form: McpForm): void;
  onClose(): void;
  onSubmit(): void;
  /** All view: which profiles the server is added to. */
  targets?: { options: readonly TargetOption[]; selected: readonly string[]; onChange(ids: string[]): void };
  /** Shown above the fields (e.g. env/header values must be re-entered). */
  note?: string | null;
}) {
  const t = useToolboxText();
  const { p } = useLook();
  const set = <K extends keyof McpForm>(key: K, value: McpForm[K]) => onChange({ ...form, [key]: value });
  const stdio = form.transport === "stdio";
  const nameOk = form.name.trim().length > 0;
  const targetOk = form.target.trim().length > 0;
  const scopeOptions = MCP_SCOPES[kind].map((s) => ({
    value: s,
    label: s,
    disabled: !cwd && PROJECT_SCOPES.includes(s),
  }));
  const scopeBlocked = !cwd && form.scope !== null && PROJECT_SCOPES.includes(form.scope);
  const noTargets = targets ? targets.selected.length === 0 : false;

  return (
    <Modal
      title={t.mcp.form.title}
      icon={<Icon name="Plug" size={16} color={p.foreground} />}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal.Content>
        {note ? <Notice tone="warning" text={note} /> : null}
        {targets && form.scope !== null && SHARED_SCOPES.includes(form.scope) ? <Notice text={t.scope.sharedOnceForm} /> : null}
        {targets ? (
          <FormField label={t.targets.label}>
            <TargetPicker options={targets.options} selected={targets.selected} onChange={targets.onChange} />
            {noTargets ? <Text style={{ color: p.muted, fontSize: 11 }}>{t.targets.none}</Text> : null}
          </FormField>
        ) : null}
        <FormField label={t.mcp.form.name}>
          <Input value={form.name} onChangeText={(v) => set("name", v)} placeholder={t.mcp.form.namePlaceholder} />
        </FormField>
        {scopeOptions.length > 0 ? (
          <FormField label={t.mcp.form.scope}>
            <Segmented value={form.scope ?? scopeOptions[0].value} options={scopeOptions} onChange={(v) => set("scope", v)} />
            {!cwd && scopeOptions.some((o) => o.disabled) ? (
              <Text style={{ color: p.muted, fontSize: 11, lineHeight: 16 }}>{t.mcp.form.scopeNeedsProject}</Text>
            ) : null}
          </FormField>
        ) : null}
        {cwd ? (
          <Text selectable style={{ color: p.muted, fontSize: 12 }}>
            {t.mcp.form.project(cwd)}
          </Text>
        ) : null}
        <FormField label={t.mcp.form.transport}>
          <Segmented
            value={form.transport}
            options={[
              { value: "stdio", label: "stdio" },
              { value: "http", label: "http" },
              { value: "sse", label: "sse" },
            ]}
            onChange={(v) => set("transport", v)}
          />
        </FormField>
        <FormField label={stdio ? t.mcp.form.command : t.mcp.form.url}>
          <Input
            value={form.target}
            onChangeText={(v) => set("target", v)}
            placeholder={stdio ? t.mcp.form.commandPlaceholder : t.mcp.form.urlPlaceholder}
            mono
          />
        </FormField>
        {stdio ? (
          <FormField label={t.mcp.form.args}>
            <Input value={form.args} onChangeText={(v) => set("args", v)} placeholder={t.mcp.form.argsPlaceholder} mono multiline />
          </FormField>
        ) : null}
        {stdio ? (
          <PairsField label={t.mcp.form.env} pairs={form.env} onChange={(env) => set("env", env)} />
        ) : (
          <PairsField label={t.mcp.form.headers} pairs={form.headers} onChange={(headers) => set("headers", headers)} />
        )}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <Button label={t.common.cancel} onPress={onClose} />
          <Button label={t.mcp.form.next} tone="primary" onPress={onSubmit} disabled={!nameOk || !targetOk || scopeBlocked || noTargets} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  const { p } = useLook();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: p.muted, fontSize: 12, fontWeight: "500" }}>{label}</Text>
      {children}
    </View>
  );
}

function Input({
  value,
  onChangeText,
  placeholder,
  mono,
  multiline,
  secure,
}: {
  value: string;
  onChangeText(v: string): void;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
  secure?: boolean;
}) {
  const { p } = useLook();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={p.idle}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      secureTextEntry={secure}
      multiline={multiline}
      textAlignVertical={multiline ? "top" : "center"}
      style={{
        flex: 1,
        minHeight: multiline ? 72 : 36,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: p.guide,
        color: p.foreground,
        fontSize: 13,
        fontFamily: mono ? MONO : undefined,
      }}
    />
  );
}

/** Key/value rows. Values are secrets: masked while typing and never echoed back. */
function PairsField({ label, pairs, onChange }: { label: string; pairs: Pair[]; onChange(pairs: Pair[]): void }) {
  const t = useToolboxText();
  const { p } = useLook();
  const update = (id: number, patch: Partial<Pair>) => onChange(pairs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <FormField label={label}>
      {pairs.map((pair) => (
        <View key={pair.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Input value={pair.key} onChangeText={(v) => update(pair.id, { key: v })} placeholder={t.mcp.form.key} mono />
          <Input value={pair.value} onChangeText={(v) => update(pair.id, { value: v })} placeholder={t.mcp.form.value} secure />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.mcp.form.removeRow}
            hitSlop={6}
            onPress={() => onChange(pairs.filter((x) => x.id !== pair.id))}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              borderRadius: RADIUS,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? p.pressed : "transparent",
            })}
          >
            <Icon name="X" size={14} color={p.muted} />
          </Pressable>
        </View>
      ))}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Button small icon="Plus" label={t.mcp.form.addRow} onPress={() => onChange([...pairs, newPair()])} />
        {pairs.length > 0 ? <Text style={{ flex: 1, color: p.muted, fontSize: 11 }}>{t.mcp.form.secretNote}</Text> : null}
      </View>
    </FormField>
  );
}
