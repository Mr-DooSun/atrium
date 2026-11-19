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
  previewMcpAdd,
  previewPluginAction,
  removeMcp,
  runMarketplaceAction,
  runPluginAction,
} from "../shared/toolbox/rpc";
import type { AuthState, Ecosystem, Profile, ProviderKind } from "../shared/toolbox/types";
import type { PluginEcosystemAdapter, ProviderAdapter } from "./core/adapter";
import { resolveProfiles, type ResolvedProfile } from "./core/profiles";
import { checkedCwd } from "./core/cwd";
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";
import { antigravityAdapter } from "./adapters/antigravity";
import { paseoPluginsAdapter } from "./adapters/paseo";

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
  if (eco === "paseo") return { adapter: paseoPluginsAdapter, profile: null };
  if (!profileId) throw new Error(`${eco} plugins need a profile`);
  const profile = await profileById(paseo, profileId);
  if (profile.profile.kind !== eco) throw new Error(`Profile ${profileId} is not a ${eco} profile`);
  return { adapter: profile.adapter, profile };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
        // An update check that fails must not hide the installed list.
        adapter.checkUpdates?.(profile?.runtime ?? null, dir).catch(() => new Map<string, string>()) ??
          Promise.resolve(new Map<string, string>()),
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

  server.handle(listCatalog, async ({ ecosystem: eco, profileId, query, offset, limit }, { paseo }) => {
    try {
      const { adapter, profile } = await ecosystem(paseo, eco, profileId);
      const result = await adapter.listCatalog(profile?.runtime ?? null, query);
      // The CLI hands over the whole catalog at once (adapters cache it); paging happens here.
      const sorted = [...result.plugins].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id),
      );
      return {
        plugins: sorted.slice(offset, offset + Math.min(limit, CATALOG_LIMIT)),
        total: sorted.length,
        marketplaces: result.marketplaces,
        error: null,
      };
    } catch (error) {
      return { plugins: [], total: 0, marketplaces: [], error: errorText(error) };
    }
  });

  server.handle(previewPluginAction, async (input, { paseo }) => {
    const { adapter, profile } = await ecosystem(paseo, input.ecosystem, input.profileId);
    return adapter.previewAction(profile?.runtime ?? null, input.action, input.pluginId, input.marketplace, checkedCwd(input.cwd));
  });

  server.handle(runPluginAction, async (input, { paseo }) => {
    const { adapter, profile } = await ecosystem(paseo, input.ecosystem, input.profileId);
    return adapter.runAction(profile?.runtime ?? null, input.action, input.pluginId, input.marketplace, checkedCwd(input.cwd));
  });

  server.handle(runMarketplaceAction, async (input, { paseo }) => {
    const { adapter, profile } = await ecosystem(paseo, input.ecosystem, input.profileId);
    return adapter.runMarketplaceAction(profile?.runtime ?? null, input.action, input.source);
  });
}
