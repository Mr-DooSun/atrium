import { z } from "zod";
import type { PluginAction } from "../../../shared/toolbox/types.ts";
import { commandResult, unsupported, type PluginEcosystemAdapter, type ProfileRuntime } from "../../core/adapter.ts";
import { argvOf } from "../../core/run-profile.ts";
import { codexError, publicUrl, runCodex } from "./cli.ts";

const marketplaceSource = z.object({ source: z.string() }).nullish();
const plugin = z.object({
  pluginId: z.string(),
  name: z.string(),
  marketplaceName: z.string(),
  version: z.string().nullish(),
  description: z.string().nullish(),
  source: z.object({ url: z.string().nullish(), path: z.string().nullish() }).nullish(),
  marketplaceSource,
});
const pluginList = z.object({ installed: z.array(plugin), available: z.array(plugin).optional() });
const marketplaceList = z.object({
  marketplaces: z.array(z.object({ name: z.string(), root: z.string().nullish(), marketplaceSource })),
});

function displaySource(source: string | null | undefined): string | null {
  if (!source) return null;
  return /^https?:\/\//i.test(source) ? publicUrl(source) : source;
}

function pluginSource(entry: z.infer<typeof plugin>): string | null {
  const url = displaySource(entry.source?.url);
  if (url) return entry.source?.path ? `${url} (${entry.source.path})` : url;
  return entry.source?.path ?? displaySource(entry.marketplaceSource?.source);
}

function requireProfile(profile: ProfileRuntime | null): ProfileRuntime {
  if (!profile) throw new Error("Codex plugins require a profile.");
  return profile;
}

async function readJson<T>(
  profile: ProfileRuntime,
  args: string[],
  schema: z.ZodType<T>,
  operation: string,
  cwd?: string | null,
  maxOutputBytes?: number,
): Promise<T> {
  const result = await runCodex(profile, args, { cwd, maxOutputBytes });
  const error = codexError(result, operation, [], profile.env);
  if (error) throw new Error(error);
  try {
    return schema.parse(JSON.parse(result.stdout));
  } catch {
    throw new Error(`Codex returned invalid JSON for ${operation}.`);
  }
}

function listPlugins(profile: ProfileRuntime, available: boolean, cwd?: string | null) {
  const args = ["plugin", "list", "--json"];
  if (available) args.push("--available");
  // The available catalog is several MB (6 MB on this Mac); the default 2 MiB cap cut it off.
  return readJson(profile, args, pluginList, "plugin listing", cwd, available ? 64 * 1024 * 1024 : undefined);
}

function planAction(action: PluginAction, pluginId: string, marketplace: string | null) {
  if (action !== "install" && action !== "uninstall") {
    return { args: [], error: `Codex has no CLI command to ${action} an individual plugin.` };
  }
  const selector = pluginId.includes("@") || !marketplace ? pluginId : `${pluginId}@${marketplace}`;
  if (!/^[^\s@-][^\s@]*@[^\s@-][^\s@]*$/.test(selector) ||
      (marketplace !== null && selector.split("@")[1] !== marketplace)) {
    return { args: [], error: "Choose a Codex plugin and its marketplace." };
  }
  return { args: ["plugin", action === "install" ? "add" : "remove", selector, "--json"], error: null };
}

async function change(profile: ProfileRuntime, args: string[], command: string[], operation: string, cwd?: string | null, secrets: string[] = []) {
  const result = await runCodex(profile, args, { cwd, timeoutMs: 120_000 });
  const error = codexError(result, operation, secrets, profile.env);
  if (!error) catalogCache.clear();
  return commandResult(command, error ? "" : `Codex completed ${operation}.`, error, error === null);
}

const CATALOG_TTL_MS = 5 * 60_000;
const catalogCache = new Map<string, { at: number; listing: Awaited<ReturnType<typeof listPlugins>> }>();

export const codexPlugins: PluginEcosystemAdapter = {
  async listInstalled(profile, cwd) {
    const { installed } = await listPlugins(requireProfile(profile), false, cwd);
    return installed.map((entry) => ({
      id: entry.pluginId,
      name: entry.name,
      version: entry.version ?? null,
      enabled: null,
      scope: "user",
      marketplace: entry.marketplaceName,
      source: pluginSource(entry),
      description: entry.description ?? null,
      status: null,
      error: null,
    }));
  },

  async listCatalog(profile, query, cwd?: string | null) {
    const runtime = requireProfile(profile);
    const key = JSON.stringify([runtime.id, runtime.command, runtime.args, runtime.configHome, cwd ?? null]);
    const hit = catalogCache.get(key);
    const listingPromise =
      hit && Date.now() - hit.at < CATALOG_TTL_MS ? Promise.resolve(hit.listing) : listPlugins(runtime, true, cwd);
    const [listing, marketplaceListing] = await Promise.all([
      listingPromise,
      readJson(runtime, ["plugin", "marketplace", "list", "--json"], marketplaceList, "marketplace listing", cwd),
    ]);
    catalogCache.set(key, { at: hit?.listing === listing ? hit.at : Date.now(), listing });
    const installed = new Set(listing.installed.map(({ pluginId }) => pluginId));
    const installedVersions = new Map(listing.installed.map((entry) => [entry.pluginId, entry.version ?? null]));
    const entries = new Map([...listing.installed, ...(listing.available ?? [])].map((entry) => [entry.pluginId, entry]));
    const marketplaces = new Map(marketplaceListing.marketplaces.map((entry) => [entry.name, {
      name: entry.name,
      source: displaySource(entry.marketplaceSource?.source ?? entry.root),
      pluginCount: 0,
    }]));
    const plugins = [];
    const search = query.trim().toLowerCase();
    for (const entry of entries.values()) {
      const market = marketplaces.get(entry.marketplaceName) ?? {
        name: entry.marketplaceName, source: displaySource(entry.marketplaceSource?.source), pluginCount: 0,
      };
      market.pluginCount += 1;
      marketplaces.set(market.name, market);
      if (![entry.pluginId, entry.name, entry.description].some((value) => value?.toLowerCase().includes(search))) continue;
      plugins.push({
        id: entry.pluginId,
        name: entry.name,
        description: entry.description ?? null,
        marketplace: entry.marketplaceName,
        source: pluginSource(entry),
        categories: [],
        installed: installed.has(entry.pluginId),
        version: entry.version ?? null,
        installedVersion: installed.has(entry.pluginId) ? installedVersions.get(entry.pluginId) ?? null : null,
      });
    }
    return { plugins, marketplaces: [...marketplaces.values()] };
  },

  async previewAction(profile, action, pluginId, marketplace) {
    const runtime = requireProfile(profile);
    const { args, error } = planAction(action, pluginId, marketplace);
    return {
      command: error ? [] : argvOf(runtime, args),
      source: null,
      warnings: error ? [error] : [],
      supported: error === null,
    };
  },

  async runAction(profile, action, pluginId, marketplace, cwd) {
    const runtime = requireProfile(profile);
    const { args, error } = planAction(action, pluginId, marketplace);
    if (error) return commandResult([], "", error, false);
    return change(runtime, args, argvOf(runtime, args), `plugin ${action}`, cwd);
  },

  async previewMarketplaceAction(profile, action, source) {
    const runtime = requireProfile(profile);
    if (!source.trim() || source.startsWith("-") || /[\u0000-\u001f]/.test(source)) {
      return { command: [], source: null, warnings: ["This marketplace source or name is invalid."], supported: false };
    }
    const shownSource = displaySource(source) ?? "<redacted>";
    const verb = action === "update" ? "upgrade" : action;
    return {
      command: argvOf(runtime, ["plugin", "marketplace", verb, shownSource, "--json"]),
      source: action === "add" ? shownSource : null,
      warnings: action === "add" ? ["Plugins from this marketplace are third-party code: add only sources you trust."] : [],
      supported: true,
    };
  },

  async runMarketplaceAction(profile, action, source, cwd?: string | null) {
    const runtime = requireProfile(profile);
    if (!source.trim() || source.startsWith("-")) return unsupported([], "This marketplace source or name");
    const args = ["plugin", "marketplace", action === "update" ? "upgrade" : action, source, "--json"];
    const shownSource = displaySource(source) ?? "<redacted>";
    const command = argvOf(runtime, [...args.slice(0, 3), shownSource, "--json"]);
    return change(runtime, args, command, `marketplace ${action}`, cwd, source === shownSource ? [] : [source]);
  },
};
