// RPC handlers for the toolbox. Owned by the orchestrator: wires contracts to adapters.
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
type PaseoApi = PluginHandlerContext["paseo"];
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  CATALOG_LIMIT,
  addMcp,
  listCatalog,
  listInstalledPlugins,
  listMcp,
  listProfiles,
  loginMcp,
  previewMarketplaceAction,
  previewMcpAdd,
  previewPluginAction,
  previewSourceInstall,
  removeMcp,
  runMarketplaceAction,
  runPluginAction,
  runSourceInstall,
} from "../shared/toolbox/rpc";
import { ECOSYSTEM_CAPS } from "../shared/toolbox/types";
import type {
  ActionPreview,
  AuthState,
  CatalogPlugin,
  CatalogSort,
  CommandResult,
  Ecosystem,
  PluginSourceInput,
  Profile,
  ProviderKind,
} from "../shared/toolbox/types";
import type { PluginEcosystemAdapter, ProviderAdapter } from "./core/adapter";
import { resolveProfiles, type ResolvedProfile } from "./core/profiles";
import { checkedCwd } from "./core/cwd";
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";
import { antigravityAdapter } from "./adapters/antigravity";
import { PASEO_NATIVE_GALLERY_NOTICE } from "../shared/toolbox/warnings";

const providers: Record<ProviderKind, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  antigravity: antigravityAdapter,
};

const AUTH_TTL_MS = 60_000;
const authCache = new Map<string, { at: number; auth: AuthState }>();

async function authFor(resolved: ResolvedProfile, refresh: boolean): Promise<AuthState> {
  const key = `${resolved.runtime.id}\u0000${resolved.runtime.command}\u0000${resolved.runtime.configHome ?? ""}`;
  const hit = authCache.get(key);
  if (!refresh && hit && Date.now() - hit.at < AUTH_TTL_MS) return hit.auth;
  let auth: AuthState;
  try {
    auth = await resolved.adapter.auth(resolved.runtime);
  } catch (error) {
    auth = { state: "unknown", method: null, account: null, detail: String(error) };
  }
  authCache.set(key, { at: Date.now(), auth });
  return auth;
}

async function profileById(paseo: PaseoApi, id: string): Promise<ResolvedProfile> {
  const found = (await resolveProfiles(paseo, providers)).find((p) => p.runtime.id === id);
  if (!found) throw new Error(`Unknown profile: ${id}`);
  return found;
}

async function ecosystem(
  paseo: PaseoApi,
  eco: Ecosystem,
  profileId: string | null,
): Promise<{ adapter: PluginEcosystemAdapter; profile: ResolvedProfile | null }> {
  if (ECOSYSTEM_CAPS[eco].management === "native") throw new Error(PASEO_NATIVE_GALLERY_NOTICE);
  if (!profileId) throw new Error(`${eco} plugins need a profile`);
  const profile = await profileById(paseo, profileId);
  if (profile.profile.kind !== eco) throw new Error(`Profile ${profileId} is not a ${eco} profile`);
  return { adapter: profile.adapter, profile };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Rejects a scope the ecosystem does not offer; null/undefined = the CLI default. */
function checkedScope(eco: Ecosystem, scope: string | null | undefined): string | null {
  if (scope == null || scope === "") return null;
  if (!ECOSYSTEM_CAPS[eco].scopes.includes(scope)) throw new Error(`Scope "${scope}" is not available for ${eco} plugins`);
  return scope;
}

const notPossible = (warning: string): ActionPreview => ({ command: [], source: null, warnings: [warning], supported: false });
const failed = (error: string): CommandResult => ({ ok: false, command: [], output: "", error, needsReload: false });

function checkedSource(eco: Ecosystem, source: PluginSourceInput): string | null {
  if (ECOSYSTEM_CAPS[eco].management === "native") return PASEO_NATIVE_GALLERY_NOTICE;
  if (!ECOSYSTEM_CAPS[eco].sources.includes(source.kind)) return `${eco} plugins cannot be installed from a ${source.kind} source`;
  try {
    checkedScope(eco, source.scope);
  } catch (error) {
    return errorText(error);
  }
  return null;
}

// Update checks run CLIs; the catalog asks once per page, so keep the answer briefly.
const UPDATES_TTL_MS = 60_000;
const updatesCache = new Map<string, { at: number; map: Promise<Map<string, string>> }>();

function updatesFor(
  adapter: PluginEcosystemAdapter,
  profile: ResolvedProfile | null,
  eco: Ecosystem,
  cwd: string | null,
): Promise<Map<string, string>> {
  if (!adapter.checkUpdates) return Promise.resolve(new Map());
  const key = JSON.stringify([eco, profile?.runtime.id ?? null, cwd]);
  const hit = updatesCache.get(key);
  if (hit && Date.now() - hit.at < UPDATES_TTL_MS) return hit.map;
  // A failing update check must never hide a list.
  const map = adapter.checkUpdates(profile?.runtime ?? null, cwd).catch(() => new Map<string, string>());
  updatesCache.set(key, { at: Date.now(), map });
  return map;
}

function forgetUpdates(eco: Ecosystem) {
  for (const key of updatesCache.keys()) if (JSON.parse(key)[0] === eco) updatesCache.delete(key);
}

const byName = (a: CatalogPlugin, b: CatalogPlugin) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id);

function sortCatalog(plugins: CatalogPlugin[], sort: CatalogSort): CatalogPlugin[] {
  const key = (p: CatalogPlugin): number | null => {
    if (sort === "installs") return p.installs ?? null;
    if (sort === "updated") {
      const t = p.updatedAt ? Date.parse(p.updatedAt) : NaN;
      return Number.isFinite(t) ? t : null;
    }
    return null;
  };
  return [...plugins].sort((a, b) => {
    if (sort !== "name") {
      const ka = key(a), kb = key(b);
      if (ka !== kb) {
        if (ka === null) return 1;
        if (kb === null) return -1;
        return kb - ka;
      }
    }
    return byName(a, b);
  });
}

export function registerToolbox(server: PluginServerContext) {
  server.handle(listProfiles, async ({ refresh }, { paseo }) => {
    const resolved = await resolveProfiles(paseo, providers);
    const profiles: Profile[] = await Promise.all(
      resolved.map(async (r) => ({ ...r.profile, auth: await authFor(r, refresh) })),
    );
    return { profiles };
  });

  server.handle(listMcp, async ({ profileId, cwd }, { paseo }) => {
    try {
      const p = await profileById(paseo, profileId);
      return { servers: await p.adapter.listMcp(p.runtime, checkedCwd(cwd)), error: null };
    } catch (error) {
      return { servers: [], error: errorText(error) };
    }
  });

  server.handle(previewMcpAdd, async ({ profileId, cwd, server: input }, { paseo }) => {
    const p = await profileById(paseo, profileId);
    return p.adapter.previewMcpAdd(p.runtime, checkedCwd(cwd), input);
  });

  server.handle(addMcp, async ({ profileId, cwd, server: input }, { paseo }) => {
    const p = await profileById(paseo, profileId);
    return p.adapter.addMcp(p.runtime, checkedCwd(cwd), input);
  });

  server.handle(removeMcp, async ({ profileId, cwd, name, scope }, { paseo }) => {
    const p = await profileById(paseo, profileId);
    return p.adapter.removeMcp(p.runtime, checkedCwd(cwd), name, scope);
  });

  server.handle(loginMcp, async ({ profileId, cwd, name }, { paseo }) => {
    const p = await profileById(paseo, profileId);
    return p.adapter.loginMcp(p.runtime, checkedCwd(cwd), name);
  });

  server.handle(listInstalledPlugins, async ({ ecosystem: eco, profileId, cwd }, { paseo }) => {
    try {
      const { adapter, profile } = await ecosystem(paseo, eco, profileId);
      const dir = checkedCwd(cwd);
      const [plugins, updates] = await Promise.all([
        adapter.listInstalled(profile?.runtime ?? null, dir),
        updatesFor(adapter, profile, eco, dir),
      ]);
      const byName = (a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      return {
        plugins: plugins.map((p) => ({ ...p, updateTo: updates.get(p.id) ?? null })).sort(byName),
        error: null,
      };
    } catch (error) {
      return { plugins: [], error: errorText(error) };
    }
  });

  server.handle(listCatalog, async (input, { paseo }) => {
    const { ecosystem: eco, profileId, query, offset, limit } = input;
    try {
      const { adapter, profile } = await ecosystem(paseo, eco, profileId);
      const [result, updates] = await Promise.all([
        adapter.listCatalog(profile?.runtime ?? null, query, checkedCwd(input.cwd)),
        updatesFor(adapter, profile, eco, checkedCwd(input.cwd)),
      ]);
      const categories = [...new Set(result.plugins.flatMap((p) => p.categories))].sort((a, b) => a.localeCompare(b));
      const matches = input.category ? result.plugins.filter((p) => p.categories.includes(input.category!)) : result.plugins;
      // The CLI hands over the whole catalog at once (adapters cache it); paging happens here.
      // A sort the source has no data for would only mislabel name order.
      const sorts = ECOSYSTEM_CAPS[eco].sorts;
      const sorted = sortCatalog(matches, input.sort && sorts.includes(input.sort) ? input.sort : sorts[0]);
      const page = sorted.slice(offset, offset + Math.min(limit, CATALOG_LIMIT)).map((p) => {
        const updateTo = p.installed ? updates.get(p.id) ?? p.updateTo ?? null : null;
        return updateTo ? { ...p, updateTo } : p;
      });
      return { plugins: page, total: sorted.length, marketplaces: result.marketplaces, error: null, categories };
    } catch (error) {
      return { plugins: [], total: 0, marketplaces: [], error: errorText(error), categories: [] };
    }
  });

  server.handle(previewPluginAction, async (input, { paseo }) => {
    const { adapter, profile } = await ecosystem(paseo, input.ecosystem, input.profileId);
    const scope = checkedScope(input.ecosystem, input.scope);
    return adapter.previewAction(profile?.runtime ?? null, input.action, input.pluginId, input.marketplace, checkedCwd(input.cwd), scope);
  });

  server.handle(runPluginAction, async (input, { paseo }) => {
    const { adapter, profile } = await ecosystem(paseo, input.ecosystem, input.profileId);
    const scope = checkedScope(input.ecosystem, input.scope);
    const result = await adapter.runAction(
      profile?.runtime ?? null, input.action, input.pluginId, input.marketplace, checkedCwd(input.cwd), scope);
    if (result.ok) forgetUpdates(input.ecosystem);
    return result;
  });

  server.handle(previewSourceInstall, async (input, { paseo }) => {
    const invalid = checkedSource(input.ecosystem, input.source);
    if (invalid) return notPossible(invalid);
    const { adapter, profile } = await ecosystem(paseo, input.ecosystem, input.profileId);
    if (!adapter.previewSource) return notPossible(`${input.ecosystem} has no direct install`);
    try {
      return await adapter.previewSource(profile?.runtime ?? null, input.source, checkedCwd(input.cwd));
    } catch (error) {
      return notPossible(errorText(error));
    }
  });

  server.handle(runSourceInstall, async (input, { paseo }) => {
    const invalid = checkedSource(input.ecosystem, input.source);
    if (invalid) return failed(invalid);
    const { adapter, profile } = await ecosystem(paseo, input.ecosystem, input.profileId);
    if (!adapter.installSource) return failed(`${input.ecosystem} has no direct install`);
    const result = await adapter.installSource(profile?.runtime ?? null, input.source, checkedCwd(input.cwd));
    if (result.ok) forgetUpdates(input.ecosystem);
    return result;
  });

  server.handle(previewMarketplaceAction, async (input, { paseo }) => {
    if (ECOSYSTEM_CAPS[input.ecosystem].management === "native") return notPossible(PASEO_NATIVE_GALLERY_NOTICE);
    if (!ECOSYSTEM_CAPS[input.ecosystem].marketplace.includes(input.action)) {
      return notPossible(`${input.ecosystem} cannot ${input.action} marketplaces`);
    }
    const { adapter, profile } = await ecosystem(paseo, input.ecosystem, input.profileId);
    if (!adapter.previewMarketplaceAction) return notPossible("No preview for this marketplace action");
    try {
      return await adapter.previewMarketplaceAction(profile?.runtime ?? null, input.action, input.source);
    } catch (error) {
      return notPossible(errorText(error));
    }
  });

  server.handle(runMarketplaceAction, async (input, { paseo }) => {
    const { adapter, profile } = await ecosystem(paseo, input.ecosystem, input.profileId);
    const result = await adapter.runMarketplaceAction(profile?.runtime ?? null, input.action, input.source);
    if (result.ok) forgetUpdates(input.ecosystem);
    return result;
  });
}
