import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActionPreview, CommandResult, McpAddInput, PluginAction, PluginSourceInput } from "../../../shared/toolbox/types";
import type { CatalogResult, ProfileRuntime, ProviderAdapter } from "../../core/adapter";
import type { MarketplaceAction } from "../../../shared/toolbox/types";
import type { ExecResult } from "../../core/exec.ts";
import { runProfile, argvOf } from "../../core/run-profile.ts";
import { displaySource, filterCatalog, parseAuth, parseCatalog, parseInstalled, parseManifestMeta, parseMcpList, failureReason, type ManifestMeta } from "./parsers.ts";
import { checkMarketplaceSource, checkName } from "../../core/source.ts";

function runtime(profile: ProfileRuntime | null) {
  if (!profile) throw new Error("claude plugins need a profile");
  return profile;
}

function errorOf(result: ExecResult, secrets: string[]) {
  if (result.spawnError) return result.spawnError;
  if (result.timedOut) return "timed out";
  if (result.truncated) return "output exceeded the size limit";
  if (result.code === 0) return null;
  return failureReason(result.stdout, result.stderr, secrets) ?? `exit ${result.code}`;
}

async function read(profile: ProfileRuntime, args: string[], cwd?: string | null) {
  const result = await runProfile(profile, args, { cwd: cwd ?? homedir(), timeoutMs: 60_000,
    maxOutputBytes: args.includes("--json") ? 32 * 1024 * 1024 : undefined });
  const error = errorOf(result, Object.values(profile.env));
  if (error) throw new Error(error);
  return result.stdout;
}

function parseOutput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Claude CLI returned incomplete JSON. Check the output size limit.");
  }
}

function preview(profile: ProfileRuntime, args: string[], source: string | null, warnings: string[] = []): ActionPreview {
  return { command: argvOf(profile, args), source, warnings, supported: true };
}

async function mutate(profile: ProfileRuntime, action: ActionPreview, cwd?: string | null, stdin?: string, secrets: string[] = []): Promise<CommandResult> {
  const command = action.command;
  if (!action.supported) return { command, ok: false, output: "", error: action.warnings[0], needsReload: false };
  const result = await runProfile(profile, command.slice(1 + profile.args.length), { cwd: cwd ?? homedir(), stdin, timeoutMs: 120_000 });
  const error = errorOf(result, [...secrets, ...Object.values(profile.env)]);
  return { command, ok: !error, output: "", error, needsReload: !error };
}

function scopedPreview(action: ActionPreview, scope: string | null, cwd: string | null) {
  if (cwd) return { ...action, warnings: [...action.warnings, "project: " + cwd] };
  if (scope === "user") return action;
  return { ...action, supported: false, warnings: ["project scope needs a workspace directory", ...action.warnings] };
}

function addPreview(profile: ProfileRuntime, cwd: string | null, server: McpAddInput) {
  const args = ["mcp", "add-json", "-s", server.scope ?? "local", "--", server.name, "-"];
  const keys = Object.keys(server.transport === "stdio" ? server.env : server.headers);
  return scopedPreview(preview(profile, args, displaySource(server.target), keys.map(key => key + "=***")), server.scope, cwd);
}

function pluginPreview(profile: ProfileRuntime, action: PluginAction, id: string, marketplace: string | null, scope: string | null = null) {
  const fullId = marketplace && !id.includes("@") ? id + "@" + marketplace : id;
  return preview(profile, ["plugin", action, "--json", ...(scope ? ["-s", scope] : []), "--", fullId], fullId);
}

/** project/local scopes write into the agent's project, so they need one. */
function needsProject(plan: ActionPreview, scope: string | null, cwd: string | null | undefined): ActionPreview {
  if (!scope || scope === "user") return plan;
  if (cwd) return { ...plan, warnings: [...plan.warnings, scope + ": " + cwd] };
  return { ...plan, supported: false, warnings: [`${scope} scope needs a workspace directory`, ...plan.warnings] };
}

const THIRD_PARTY = "This plugin source is not a marketplace you added. Install it only if you trust the source.";

/** `claude plugin install <name> --marketplace <source>`: adds the marketplace (user settings) if needed. */
async function sourcePlan(profile: ProfileRuntime, source: PluginSourceInput, cwd: string | null | undefined): Promise<ActionPreview> {
  if (source.kind !== "marketplace") return { command: [], source: null, warnings: ["Claude installs plugins from marketplace sources only."], supported: false };
  const name = checkName(source.plugin, "Plugin name");
  if (!name.ok) return { command: [], source: null, warnings: [name.error], supported: false };
  const market = await checkMarketplaceSource(source.value);
  if (!market.ok) return { command: [], source: null, warnings: [market.error], supported: false };
  const scope = source.scope ?? null;
  const args = ["plugin", "install", "--json", ...(scope ? ["-s", scope] : []), "--marketplace", market.value, "--", name.value];
  const shown = displaySource(market.value);
  const plan = preview(profile, args, shown, [THIRD_PARTY, "A marketplace that is not added yet is also added to the user settings."]);
  return needsProject(plan, scope, cwd);
}

/** Argv for display: every URL loses credentials, query and fragment (signed tokens). The CLI
 *  still runs the full argv; only what is returned to the app is cleaned. */
function shown<T extends { command: string[] }>(value: T): T {
  return { ...value, command: value.command.map((arg) => (/^https?:\/\//i.test(arg) ? displaySource(arg) : arg)) };
}

function marketplacePlan(profile: ProfileRuntime, action: MarketplaceAction, source: string): ActionPreview {
  return preview(profile, ["plugin", "marketplace", action, "--json", "--", source], displaySource(source));
}

async function checkedMarketplacePlan(profile: ProfileRuntime, action: MarketplaceAction, source: string): Promise<ActionPreview> {
  if (action === "add") {
    const checked = await checkMarketplaceSource(source);
    if (!checked.ok) return { command: [], source: null, warnings: [checked.error], supported: false };
    return { ...marketplacePlan(profile, action, checked.value), warnings: [THIRD_PARTY] };
  }
  const name = checkName(source, "Marketplace name");
  if (!name.ok) return { command: [], source: null, warnings: [name.error], supported: false };
  return marketplacePlan(profile, action, name.value);
}

/** CLI output kept raw, so each call can mark installs for its own project directory. */
interface RawCatalog { plugins: unknown; markets: unknown; meta: Map<string, ManifestMeta> }

const catalogs = new Map<string, { expires: number; loading: Promise<RawCatalog> }>();

function catalogKey(p: ProfileRuntime) {
  return JSON.stringify([p.id, p.configHome, p.command, p.args]);
}

/** Author, homepage, category ... from each marketplace's manifest on disk (read-only). */
async function manifestMeta(markets: unknown): Promise<Map<string, ManifestMeta>> {
  const meta = new Map<string, ManifestMeta>();
  if (!Array.isArray(markets)) return meta;
  await Promise.all(markets.map(async (m: { name?: unknown; installLocation?: unknown }) => {
    if (typeof m?.name !== "string" || typeof m.installLocation !== "string") return;
    try {
      const manifest = JSON.parse(await readFile(join(m.installLocation, ".claude-plugin", "marketplace.json"), "utf8"));
      parseManifestMeta(manifest, m.name, meta);
    } catch {
      // Unreadable manifest: its plugins just show less metadata.
    }
  }));
  return meta;
}

async function loadCatalog(p: ProfileRuntime) {
  const [plugins, markets] = await Promise.all([
    read(p, ["plugin", "list", "--json", "--available"]),
    read(p, ["plugin", "marketplace", "list", "--json"]),
  ]);
  const marketData = parseOutput(markets);
  const raw: RawCatalog = { plugins: parseOutput(plugins), markets: marketData, meta: await manifestMeta(marketData) };
  // Validate once up front so a bad shape fails the load (and is not cached).
  parseCatalog(raw.plugins, raw.markets, raw.meta, null);
  return raw;
}

async function catalogFor(p: ProfileRuntime, cwd: string | null): Promise<CatalogResult> {
  const raw = await cachedCatalog(p);
  return parseCatalog(raw.plugins, raw.markets, raw.meta, cwd);
}

async function cachedCatalog(p: ProfileRuntime) {
  const key = catalogKey(p);
  const hit = catalogs.get(key);
  if (hit && hit.expires > Date.now()) return hit.loading;

  const entry = { expires: Date.now() + 5 * 60_000, loading: loadCatalog(p) };
  catalogs.set(key, entry);
  try {
    return await entry.loading;
  } catch (error) {
    if (catalogs.get(key) === entry) catalogs.delete(key);
    throw error;
  }
}

/** "1.10.0" > "1.9.2"; non-numeric parts compare as text. */
function newer(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/), pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0", y = pb[i] ?? "0";
    const nx = Number(x), ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (c !== 0) return c > 0;
  }
  return false;
}

/** Manifest metadata of every configured marketplace, keyed "name@marketplace", read from disk
 *  via known_marketplaces.json (no CLI run). Unreadable marketplaces contribute nothing. */
async function knownManifestMeta(p: ProfileRuntime): Promise<Map<string, ManifestMeta>> {
  const home = p.configHome ?? join(homedir(), ".claude");
  try {
    const known = JSON.parse(await readFile(join(home, "plugins", "known_marketplaces.json"), "utf8"));
    if (!known || typeof known !== "object") return new Map();
    return manifestMeta(Object.entries(known).map(([name, info]) => ({ name, ...(info as object) })));
  } catch {
    return new Map();
  }
}

/** Plugin versions declared by each configured marketplace's manifest, keyed "name@marketplace". */
async function marketplaceVersions(p: ProfileRuntime): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  for (const [id, meta] of await knownManifestMeta(p)) if (meta.version) versions.set(id, meta.version);
  return versions;
}

interface McpScopeNames { user: Set<string>; local: Set<string>; project: Set<string> }

const keysOf = (value: unknown) =>
  new Set(value && typeof value === "object" ? Object.keys(value as Record<string, unknown>) : []);

/** Names per scope, read (read-only, names only) from the files `claude mcp list` merges:
 *  <config>/.claude.json top level (user) and projects[cwd] (local), <cwd>/.mcp.json (project). */
async function mcpScopes(p: ProfileRuntime, cwd: string | null): Promise<McpScopeNames> {
  const file = p.configHome ? join(p.configHome, ".claude.json") : join(homedir(), ".claude.json");
  const out: McpScopeNames = { user: new Set(), local: new Set(), project: new Set() };
  try {
    const config = JSON.parse(await readFile(file, "utf8"));
    out.user = keysOf(config?.mcpServers);
    if (cwd) out.local = keysOf(config?.projects?.[cwd]?.mcpServers);
  } catch { /* unreadable: leave unknown */ }
  if (cwd) {
    try {
      out.project = keysOf(JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf8"))?.mcpServers);
    } catch { /* no project file */ }
  }
  return out;
}

/** Same precedence as Claude Code: local over project over user. */
function scopeOf(name: string, scopes: McpScopeNames): string | null {
  if (name.startsWith("plugin:")) return "plugin";
  if (name.startsWith("claude.ai ")) return "claude.ai";
  if (scopes.local.has(name)) return "local";
  if (scopes.project.has(name)) return "project";
  if (scopes.user.has(name)) return "user";
  return null;
}

export const claudeAdapter: ProviderAdapter = {
  // Only plugins whose marketplace declares a version can be compared; others show no update.
  async checkUpdates(profile, cwd) {
    const p = runtime(profile);
    const [installed, versions] = await Promise.all([
      this.listInstalled(p, cwd),
      marketplaceVersions(p),
    ]);
    const map = new Map<string, string>();
    for (const plugin of installed) {
      const latest = versions.get(plugin.id);
      if (latest && plugin.version && newer(latest, plugin.version)) map.set(plugin.id, latest);
    }
    return map;
  },

  defaultCommand: "claude", configHomeEnv: "CLAUDE_CONFIG_DIR",
  async auth(profile) {
    const result = await runProfile(profile, ["auth", "status", "--json"], { cwd: homedir(), timeoutMs: 8000 });
    if (!result.spawnError && !result.timedOut && !result.truncated && (result.code === 0 || result.code === 1)) {
      try { return parseAuth(result.stdout); } catch { /* Ignore malformed output. */ }
    }
    return { state: result.spawnError?.includes("ENOENT") ? "not_installed" : "unknown",
      method: null, account: null, detail: errorOf(result, Object.values(profile.env)) ?? "Could not read the login status." };
  },
  async listMcp(profile, cwd) {
    const p = runtime(profile);
    const [servers, scopes] = await Promise.all([
      read(p, ["mcp", "list"], cwd).then(parseMcpList),
      mcpScopes(p, cwd),
    ]);
    return servers.map((s) => ({ ...s, scope: s.scope ?? scopeOf(s.name, scopes) }));
  },
  async previewMcpAdd(profile, cwd, server) { return addPreview(profile, cwd, server); },
  async addMcp(profile, cwd, server) {
    const config = server.transport === "stdio"
      ? { type: "stdio", command: server.target, args: server.args, env: server.env }
      : { type: server.transport, url: server.target, headers: server.headers };
    return mutate(profile, addPreview(profile, cwd, server), cwd, JSON.stringify(config),
      [...Object.values(server.headers), ...Object.values(server.env), ...server.args, server.target]);
  },
  async removeMcp(profile, cwd, name, scope) {
    scope ??= cwd ? null : "user";
    const args = ["mcp", "remove", ...(scope ? ["-s", scope] : []), "--", name];
    return mutate(profile, scopedPreview(preview(profile, args, null), scope, cwd), cwd);
  },
  async loginMcp(profile, _cwd, name) {
    return { command: [], ok: false, output: "", needsReload: false,
      error: `Open Claude in a terminal with profile ${profile.id} and authenticate ${name} in /mcp. mcp login --no-browser needs the redirect URL entered.` };
  },
  async listInstalled(profile, cwd) {
    const p = runtime(profile);
    const [plugins, meta] = await Promise.all([
      read(p, ["plugin", "list", "--json"], cwd).then((text) => parseInstalled(parseOutput(text), cwd ?? null)),
      knownManifestMeta(p),
    ]);
    return plugins.map((plugin) => {
      const m = meta.get(plugin.id);
      return m ? { ...plugin, author: m.author, homepage: m.homepage, categories: m.categories, iconUrl: null } : plugin;
    });
  },
  async listCatalog(profile, query, cwd) {
    const p = runtime(profile);
    return filterCatalog(await catalogFor(p, cwd ?? null), query);
  },
  async previewAction(profile, action, id, marketplace, cwd, scope) {
    const p = runtime(profile);
    const plan = needsProject(pluginPreview(p, action, id, marketplace, scope ?? null), scope ?? null, cwd);
    const fullId = plan.command.at(-1)!;
    const market = fullId.split("@")[1] ?? marketplace;
    const catalog = await catalogFor(p, null).catch(() => null);
    const candidates = catalog?.plugins.filter(plugin => plugin.id === fullId || (!market && plugin.name === id));
    const match = candidates?.length === 1 ? candidates[0] : null;
    return { ...plan, source: match?.source ?? match?.marketplace ?? market };
  },
  async runAction(profile, action, id, marketplace, cwd, scope) {
    const p = runtime(profile);
    const plan = needsProject(pluginPreview(p, action, id, marketplace, scope ?? null), scope ?? null, cwd);
    const result = await mutate(p, plan, cwd);
    if (result.ok) catalogs.delete(catalogKey(p));
    return result;
  },
  async previewSource(profile, source, cwd) {
    return shown(await sourcePlan(runtime(profile), source, cwd));
  },
  async installSource(profile, source, cwd) {
    const p = runtime(profile);
    const plan = await sourcePlan(p, source, cwd);
    const result = await mutate(p, plan, cwd, undefined, [source.value, ...plan.command.slice(-3, -2)]);
    if (result.ok) catalogs.delete(catalogKey(p));
    return shown(result);
  },
  async previewMarketplaceAction(profile, action, source) {
    return shown(await checkedMarketplacePlan(runtime(profile), action, source));
  },
  async runMarketplaceAction(profile, action, source) {
    const p = runtime(profile);
    const plan = await checkedMarketplacePlan(p, action, source);
    const result = await mutate(p, plan, undefined, undefined, [source, ...plan.command.slice(-1)]);
    if (result.ok) catalogs.delete(catalogKey(p));
    return shown(result);
  },
};
