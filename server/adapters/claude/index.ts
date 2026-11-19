import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActionPreview, CommandResult, McpAddInput, PluginAction } from "../../../shared/toolbox/types";
import type { CatalogResult, ProfileRuntime, ProviderAdapter } from "../../core/adapter";
import type { ExecResult } from "../../core/exec.ts";
import { runProfile, argvOf } from "../../core/run-profile.ts";
import { displaySource, filterCatalog, parseAuth, parseCatalog, parseInstalled, parseMcpList, failureReason } from "./parsers.ts";

function runtime(profile: ProfileRuntime | null) {
  if (!profile) throw new Error("Claude 프로필이 필요합니다.");
  return profile;
}

function errorOf(result: ExecResult, secrets: string[]) {
  if (result.spawnError) return result.spawnError;
  if (result.timedOut) return "Claude CLI 응답 시간이 초과되었습니다.";
  if (result.truncated) return "Claude CLI 출력이 크기 제한을 초과했습니다.";
  if (result.code === 0) return null;
  return failureReason(result.stdout, result.stderr, secrets) ?? `Claude CLI 종료 코드: ${result.code}`;
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
    throw new Error("Claude CLI의 JSON 응답이 불완전합니다. 출력 크기 제한을 확인하세요.");
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
  return { ...action, supported: false, warnings: ["프로젝트 디렉터리를 선택하거나 user 범위를 지정하세요.", ...action.warnings] };
}

function addPreview(profile: ProfileRuntime, cwd: string | null, server: McpAddInput) {
  const args = ["mcp", "add-json", "-s", server.scope ?? "local", "--", server.name, "-"];
  const keys = Object.keys(server.transport === "stdio" ? server.env : server.headers);
  return scopedPreview(preview(profile, args, displaySource(server.target), keys.map(key => key + "=***")), server.scope, cwd);
}

function pluginPreview(profile: ProfileRuntime, action: PluginAction, id: string, marketplace: string | null) {
  const fullId = marketplace && !id.includes("@") ? id + "@" + marketplace : id;
  return preview(profile, ["plugin", action, "--json", "--", fullId], fullId);
}

const catalogs = new Map<string, { expires: number; loading: Promise<CatalogResult> }>();

function catalogKey(p: ProfileRuntime) {
  return JSON.stringify([p.id, p.configHome, p.command, p.args]);
}

async function loadCatalog(p: ProfileRuntime) {
  const [plugins, markets] = await Promise.all([
    read(p, ["plugin", "list", "--json", "--available"]),
    read(p, ["plugin", "marketplace", "list", "--json"]),
  ]);
  return parseCatalog(parseOutput(plugins), parseOutput(markets));
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

/** Plugin versions declared by each configured marketplace's manifest, keyed "name@marketplace". */
async function marketplaceVersions(p: ProfileRuntime): Promise<Map<string, string>> {
  const home = p.configHome ?? join(homedir(), ".claude");
  const versions = new Map<string, string>();
  let known: Record<string, { installLocation?: string }> = {};
  try {
    known = JSON.parse(await readFile(join(home, "plugins", "known_marketplaces.json"), "utf8"));
  } catch {
    return versions;
  }
  await Promise.all(Object.entries(known).map(async ([market, info]) => {
    if (!info?.installLocation) return;
    try {
      const manifest = JSON.parse(await readFile(join(info.installLocation, ".claude-plugin", "marketplace.json"), "utf8"));
      for (const plugin of manifest.plugins ?? []) {
        if (typeof plugin?.name === "string" && typeof plugin?.version === "string") {
          versions.set(`${plugin.name}@${market}`, plugin.version);
        }
      }
    } catch {
      // unreadable marketplace: no update info for its plugins
    }
  }));
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
      method: null, account: null, detail: errorOf(result, Object.values(profile.env)) ?? "인증 상태를 읽을 수 없습니다." };
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
      error: `${profile.id} 프로필로 Claude 터미널을 열고 /mcp에서 ${name} 인증을 완료하세요. mcp login --no-browser는 리디렉션 URL 입력이 필요합니다.` };
  },
  async listInstalled(profile, cwd) {
    return parseInstalled(parseOutput(await read(runtime(profile), ["plugin", "list", "--json"], cwd)));
  },
  async listCatalog(profile, query) {
    const p = runtime(profile);
    return filterCatalog(await cachedCatalog(p), query);
  },
  async previewAction(profile, action, id, marketplace) {
    const p = runtime(profile);
    const plan = pluginPreview(p, action, id, marketplace);
    const fullId = plan.command.at(-1)!;
    const market = fullId.split("@")[1] ?? marketplace;
    const catalog = await cachedCatalog(p).catch(() => null);
    const candidates = catalog?.plugins.filter(plugin => plugin.id === fullId || (!market && plugin.name === id));
    const match = candidates?.length === 1 ? candidates[0] : null;
    return { ...plan, source: match?.source ?? match?.marketplace ?? market };
  },
  async runAction(profile, action, id, marketplace, cwd) {
    const p = runtime(profile);
    const result = await mutate(p, pluginPreview(p, action, id, marketplace), cwd);
    if (result.ok) catalogs.delete(catalogKey(p));
    return result;
  },
  async runMarketplaceAction(profile, action, source) {
    const p = runtime(profile);
    const plan = preview(p, ["plugin", "marketplace", action, "--json", "--", source], source);
    const result = await mutate(p, plan);
    if (result.ok) catalogs.delete(catalogKey(p));
    result.command[result.command.length - 1] = displaySource(source);
    return result;
  },
};
