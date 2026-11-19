// Antigravity CLI (`agy`) adapter. Based only on documented behavior: see docs/antigravity.md.
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ActionPreview, AuthState, CatalogPlugin, McpAddInput, McpServer } from "../../../shared/toolbox/types";
import {
  commandResult,
  unsupported,
  type CatalogResult,
  type ProfileRuntime,
  type ProviderAdapter,
} from "../../core/adapter";
import { failure, plain } from "../../core/exec";
import { argvOf, runProfile } from "../../core/run-profile";
import { resolveTarget, withLocks, writeFileSafely } from "./files";
import {
  OFFICIAL_MARKETPLACE,
  addServerToConfig,
  authFromSignals,
  buildMcpEntry,
  mcpServersFromConfig,
  parseMcpConfig,
  parsePluginList,
  removeServerFromConfig,
  validPluginRef,
} from "./parse";

const NOT_INSTALLED = "agy is not installed (or not on PATH)";

const FALLBACK: ProfileRuntime = { id: "antigravity", command: "agy", args: [], env: {}, configHome: null };

/** Plugin methods are typed with a nullable profile (only paseo uses null); fall back to defaults. */
function rt(profile: ProfileRuntime | null): ProfileRuntime {
  return profile ?? FALLBACK;
}

function homeOf(profile: ProfileRuntime): string {
  return profile.env.HOME ?? process.env.HOME ?? homedir();
}

type McpScope = "user" | "project";

function normalizeScope(scope: string | null): McpScope | null {
  if (scope === null || scope === "user" || scope === "global") return "user";
  if (scope === "project" || scope === "workspace" || scope === "local") return "project";
  return null;
}

/** Project scope needs an absolute path to an existing directory (client-supplied, so validated). */
async function validCwd(cwd: string | null): Promise<string | null> {
  if (!cwd || !isAbsolute(cwd)) return null;
  try {
    return (await stat(cwd)).isDirectory() ? cwd : null;
  } catch {
    return null;
  }
}

/** Documented: global ~/.gemini/config/mcp_config.json, workspace <workspace>/.agents/mcp_config.json. */
async function configPath(profile: ProfileRuntime, cwd: string | null, scope: McpScope): Promise<string | null> {
  if (scope === "user") return join(homeOf(profile), ".gemini", "config", "mcp_config.json");
  const dir = await validCwd(cwd);
  return dir ? join(dir, ".agents", "mcp_config.json") : null;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function pluginArgs(action: string, pluginId: string, marketplace: string | null): string[] | null {
  if (!validPluginRef(pluginId)) return null;
  switch (action) {
    case "install": {
      // Documented: <name>@antigravity-plugins-official, GitHub URL, or local path.
      const isPathOrUrl = /^(https?:\/\/|\/|\.|~)/.test(pluginId) || pluginId.includes("@");
      if (marketplace && !isPathOrUrl && validPluginRef(marketplace)) return ["plugin", "install", `${pluginId}@${marketplace}`];
      return ["plugin", "install", pluginId];
    }
    case "uninstall":
    case "enable":
    case "disable":
      return ["plugin", action, pluginId];
    default:
      return null; // "update" has no documented command
  }
}

export const antigravityAdapter: ProviderAdapter = {
  defaultCommand: "agy",
  // No documented env var relocates ~/.gemini; HOME override is an assumption, so not advertised.
  configHomeEnv: null,

  async auth(profile): Promise<AuthState> {
    const probe = await runProfile(profile, ["--version"], { timeoutMs: 8000 });
    if (probe.spawnError) {
      return { state: "not_installed", method: null, account: null, detail: NOT_INSTALLED };
    }
    const settings = await readText(join(homeOf(profile), ".gemini", "antigravity-cli", "settings.json"));
    const signals = authFromSignals(settings, { ...process.env, ...profile.env });
    const version = plain(probe.stdout).trim().split("\n")[0];
    return version && signals.state === "unknown" ? { ...signals, detail: `${signals.detail} (${version})` } : signals;
  },

  async listMcp(profile, cwd): Promise<McpServer[]> {
    const out: McpServer[] = [];
    const userPath = await configPath(profile, cwd, "user");
    const projectPath = await configPath(profile, cwd, "project");
    if (userPath) out.push(...mcpServersFromConfig(parseMcpConfig(await readText(userPath)).config, "user"));
    if (projectPath) out.push(...mcpServersFromConfig(parseMcpConfig(await readText(projectPath)).config, "project"));
    // Servers bundled by enabled plugins (names only; `agy plugin list --json` lists them).
    const listed = await runProfile(profile, ["plugin", "list", "--json"], { cwd: await validCwd(cwd), timeoutMs: 10_000 });
    if (!failure(listed)) {
      try {
        const data: unknown = JSON.parse(listed.stdout);
        if (Array.isArray(data)) {
          for (const p of data as Array<Record<string, unknown>>) {
            if (p.enabled === false || !Array.isArray(p.mcpServers)) continue;
            for (const s of p.mcpServers) {
              if (typeof s !== "string") continue;
              out.push({
                name: `${String(p.name)}_${s}`,
                scope: "plugin",
                transport: null,
                target: null,
                status: "unknown",
                detail: `provided by plugin ${String(p.name)}`,
              });
            }
          }
        }
      } catch {
        /* not JSON: skip plugin servers */
      }
    }
    return out;
  },

  async previewMcpAdd(profile, cwd, server: McpAddInput): Promise<ActionPreview> {
    const scope = normalizeScope(server.scope);
    const path = scope ? await configPath(profile, cwd, scope) : null;
    const entry = buildMcpEntry(server);
    if (!scope || !path || !entry.ok) {
      const why = !scope ? `unknown scope "${server.scope}"` : !path ? "project scope needs a workspace directory" : (entry as { error: string }).error;
      return { command: [], source: null, warnings: [why], supported: false };
    }
    const warnings = ["agy has no `mcp add` command in its docs; this edits the documented config file directly."];
    if (Object.keys(server.env).length > 0 || Object.keys(server.headers).length > 0) {
      warnings.push("env values and headers are stored in plain text in the config file.");
    }
    return { command: ["write-file", path], source: path, warnings, supported: true };
  },

  async addMcp(profile, cwd, server): Promise<ReturnType<typeof commandResult>> {
    const preview = await this.previewMcpAdd(profile, cwd, server);
    if (!preview.supported) return commandResult(preview.command, "", preview.warnings[0] ?? "unsupported", false);
    const path = preview.command[1];
    const root = normalizeScope(server.scope) === "project" ? await validCwd(cwd) : null;
    return withLocks([path], async () => {
      const resolved = await resolveTarget(path, root, true);
      if (!resolved.ok) return commandResult(preview.command, "", resolved.error, false);
      const parsed = parseMcpConfig(await readText(resolved.target));
      if (parsed.error) return commandResult(preview.command, "", `${path}: ${parsed.error}; not modified`, false);
      const entry = buildMcpEntry(server) as { ok: true; entry: Record<string, unknown> };
      const edited = addServerToConfig(parsed.config, server.name, entry.entry);
      if (!edited.ok) return commandResult(preview.command, "", edited.error, false);
      try {
        await writeFileSafely(resolved.target, `${JSON.stringify(edited.config, null, 2)}\n`);
      } catch (error) {
        return commandResult(preview.command, "", `write failed: ${(error as Error).message}`, false);
      }
      return commandResult(preview.command, `Added "${server.name}" to ${path}`, null, true);
    });
  },

  async removeMcp(profile, cwd, name, scope): Promise<ReturnType<typeof commandResult>> {
    const wanted = scope === null ? (["project", "user"] as McpScope[]) : normalizeScope(scope) ? [normalizeScope(scope) as McpScope] : [];
    if (wanted.length === 0) return commandResult([], "", `unknown scope "${scope}"`, false);
    const projectRoot = await validCwd(cwd);
    const candidates: Array<{ path: string; root: string | null }> = [];
    for (const s of wanted) {
      const path = await configPath(profile, cwd, s);
      if (path) candidates.push({ path, root: s === "project" ? projectRoot : null });
    }
    return withLocks(candidates.map((c) => c.path), async () => {
      const hits = new Map<string, { path: string; config: Record<string, unknown> }>();
      for (const c of candidates) {
        const resolved = await resolveTarget(c.path, c.root, false);
        if (!resolved.ok) return commandResult(["write-file", c.path], "", resolved.error, false);
        if (hits.has(resolved.target)) continue; // both candidates are the same real file
        const parsed = parseMcpConfig(await readText(resolved.target));
        if (parsed.error) return commandResult(["write-file", c.path], "", `${c.path}: ${parsed.error}; not modified`, false);
        const edited = removeServerFromConfig(parsed.config, name);
        if (edited.ok) hits.set(resolved.target, { path: c.path, config: edited.config });
      }
      if (hits.size === 0) return commandResult([], "", `MCP server "${name}" not found in agy config files`, false);
      if (hits.size > 1) {
        return commandResult([], "", `"${name}" exists in both project and user config; pass a scope`, false);
      }
      const [[target, hit]] = [...hits];
      try {
        await writeFileSafely(target, `${JSON.stringify(hit.config, null, 2)}\n`);
      } catch (error) {
        return commandResult(["write-file", hit.path], "", `write failed: ${(error as Error).message}`, false);
      }
      return commandResult(["write-file", hit.path], `Removed "${name}" from ${hit.path}`, null, true);
    });
  },

  async loginMcp() {
    return commandResult(
      [],
      "",
      "agy has no CLI command for MCP login: OAuth runs in the browser automatically when the server connects. Open /mcp inside agy to reconnect.",
      false,
    );
  },

  async listInstalled(p, cwd) {
    const profile = rt(p);
    const result = await runProfile(profile, ["plugin", "list", "--json"], { cwd: await validCwd(cwd ?? null), timeoutMs: 15_000 });
    if (failure(result)) return [];
    return parsePluginList(result.stdout);
  },

  async listCatalog(p, query): Promise<CatalogResult> {
    // No documented CLI command lists marketplace contents (browse is /plugin Discover tab or the App).
    const installed = await this.listInstalled(p).catch(() => []);
    const q = query.trim().toLowerCase();
    const plugins: CatalogPlugin[] = installed
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        marketplace: p.marketplace,
        source: p.source,
        categories: [],
        installed: true,
      }));
    return { plugins, marketplaces: [{ name: OFFICIAL_MARKETPLACE, source: null, pluginCount: null }] };
  },

  async previewAction(p, action, pluginId, marketplace): Promise<ActionPreview> {
    const profile = rt(p);
    const args = pluginArgs(action, pluginId, marketplace);
    if (!args) {
      const why = action === "update" ? "agy documents no plugin update command" : "invalid plugin id";
      return { command: [], source: null, warnings: [why], supported: false };
    }
    const warnings: string[] = [];
    let source: string | null = null;
    if (action === "install") {
      source = /^https?:\/\//.test(pluginId) ? pluginId : /^[/.~]/.test(pluginId) ? pluginId : (marketplace ?? OFFICIAL_MARKETPLACE);
      if (/^https?:\/\//.test(pluginId)) warnings.push("Installs third-party code from a GitHub repository.");
      warnings.push("Marketplace installs need an active agy sign-in. Plugins with required variables install disabled.");
    }
    return { command: argvOf(profile, args), source, warnings, supported: true };
  },

  async runAction(p, action, pluginId, marketplace, cwd) {
    const profile = rt(p);
    const args = pluginArgs(action, pluginId, marketplace);
    if (!args) return unsupported(argvOf(profile, []), `plugin ${action}`);
    const command = argvOf(profile, args);
    const result = await runProfile(profile, args, { cwd: await validCwd(cwd ?? null), timeoutMs: 120_000 });
    if (result.spawnError) return commandResult(command, "", `${NOT_INSTALLED}: ${result.spawnError}`, false);
    const error = failure(result);
    return commandResult(command, plain(result.stdout).trim(), error, error === null);
  },

  async runMarketplaceAction(p, action) {
    return unsupported(argvOf(rt(p), []), `marketplace ${action} (agy supports only ${OFFICIAL_MARKETPLACE})`);
  },
};
