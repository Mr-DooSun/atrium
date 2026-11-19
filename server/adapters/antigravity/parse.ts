// Pure parsers/builders for the Antigravity adapter. No I/O, so they are unit-testable.
// Formats are from https://antigravity.google/docs/{mcp,plugins,install}.md (see docs/antigravity.md).
import type { AuthState, InstalledPlugin, McpAddInput, McpServer } from "../../../shared/toolbox/types";

export const OFFICIAL_MARKETPLACE = "antigravity-plugins-official";

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `agy plugin list --json` (documented: JSON array), falling back to the documented text form. */
export function parsePluginList(stdout: string): InstalledPlugin[] {
  const text = stdout.trim();
  if (text.startsWith("[")) {
    try {
      const data: unknown = JSON.parse(text);
      if (Array.isArray(data)) return data.filter(isRecord).flatMap(pluginFromJson);
    } catch {
      /* fall through to text */
    }
  }
  return parsePluginText(stdout);
}

function pluginFromJson(entry: Record<string, unknown>): InstalledPlugin[] {
  const name = str(entry.name);
  if (!name) return [];
  const source = str(entry.source);
  const counts: string[] = [];
  for (const key of ["skills", "agents", "rules", "mcpServers", "hooks"] as const) {
    const value = entry[key];
    if (Array.isArray(value) && value.length > 0) counts.push(`${value.length} ${key}`);
  }
  return [
    {
      id: name,
      name,
      version: str(entry.version),
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : null,
      marketplace: source,
      source: str(entry.path) ?? source,
      description: counts.length > 0 ? counts.join(", ") : null,
      status: null,
      error: null,
    },
  ];
}

/**
 * Documented text form:
 *   Installed plugins:
 *   - firebase (enabled, 1.0.3)
 *       Source:     antigravity-plugins-official
 *       Components: 13 skills, 1 agent
 * Unknown lines are dropped.
 */
export function parsePluginText(stdout: string): InstalledPlugin[] {
  const out: InstalledPlugin[] = [];
  let current: InstalledPlugin | null = null;
  for (const raw of stdout.split("\n")) {
    const head = /^-\s+(\S+)\s+\(([^)]*)\)\s*$/.exec(raw);
    if (head) {
      const parts = head[2].split(",").map((p) => p.trim());
      current = {
        id: head[1],
        name: head[1],
        version: parts.find((p) => /^\d/.test(p)) ?? null,
        enabled: parts.includes("enabled") ? true : parts.includes("disabled") ? false : null,
        marketplace: null,
        source: null,
        description: null,
        status: null,
        error: null,
      };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const field = /^\s+(Source|Components):\s*(.*?)\s*$/.exec(raw);
    if (!field) continue;
    if (field[1] === "Source") {
      current.marketplace = field[2] || null;
      current.source = field[2] || null;
    } else current.description = field[2] || null;
  }
  return out;
}

// ---- MCP config (mcp_config.json) -------------------------------------------------------

export interface ConfigParse {
  config: Record<string, unknown>;
  /** Set when the file exists but is not a JSON object; callers must not overwrite it. */
  error: string | null;
}

export function parseMcpConfig(text: string | null): ConfigParse {
  if (text === null || text.trim() === "") return { config: {}, error: null };
  try {
    const data: unknown = JSON.parse(text);
    if (isRecord(data)) return { config: data, error: null };
    return { config: {}, error: "mcp_config.json is not a JSON object" };
  } catch (error) {
    return { config: {}, error: `mcp_config.json is not valid JSON: ${(error as Error).message}` };
  }
}

/** Drops query/fragment/userinfo: URLs can carry tokens. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/** Never returns env values or headers. */
export function mcpServersFromConfig(config: Record<string, unknown>, scope: string): McpServer[] {
  const servers = config.mcpServers;
  if (!isRecord(servers)) return [];
  const out: McpServer[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    if (!isRecord(raw)) continue;
    const url = str(raw.serverUrl) ?? str(raw.url);
    const command = str(raw.command);
    out.push({
      name,
      scope,
      transport: url ? "http" : command ? "stdio" : null,
      target: url ? redactUrl(url) : command ?? null,
      status: raw.disabled === true ? "disabled" : "unknown",
      detail: raw.disabled === true ? null : "live status is only available inside agy via /mcp",
    });
  }
  return out;
}

export type EntryResult = { ok: true; entry: Record<string, unknown> } | { ok: false; error: string };

/** Documented entry shapes: stdio {command,args,env}, remote {serverUrl,headers}. */
export function buildMcpEntry(input: McpAddInput): EntryResult {
  if (input.transport === "sse") {
    return { ok: false, error: "Antigravity supports Streamable HTTP only; legacy SSE is not supported" };
  }
  if (input.transport === "http") {
    const entry: Record<string, unknown> = { serverUrl: input.target };
    if (Object.keys(input.headers).length > 0) entry.headers = input.headers;
    return { ok: true, entry };
  }
  const entry: Record<string, unknown> = { command: input.target };
  if (input.args.length > 0) entry.args = input.args;
  if (Object.keys(input.env).length > 0) entry.env = input.env;
  return { ok: true, entry };
}

export type EditResult = { ok: true; config: Record<string, unknown> } | { ok: false; error: string };

export function addServerToConfig(config: Record<string, unknown>, name: string, entry: Record<string, unknown>): EditResult {
  const existing = config.mcpServers;
  if (existing !== undefined && !isRecord(existing)) return { ok: false, error: "mcpServers is not an object" };
  if (existing && Object.hasOwn(existing, name)) return { ok: false, error: `MCP server "${name}" already exists` };
  return { ok: true, config: { ...config, mcpServers: { ...(existing ?? {}), [name]: entry } } };
}

export function removeServerFromConfig(config: Record<string, unknown>, name: string): EditResult {
  const existing = config.mcpServers;
  if (!isRecord(existing) || !Object.hasOwn(existing, name)) return { ok: false, error: `MCP server "${name}" not found` };
  const { [name]: _removed, ...rest } = existing;
  return { ok: true, config: { ...config, mcpServers: rest } };
}

// ---- Auth ---------------------------------------------------------------------------------

/**
 * Only documented, non-interactive signals. Keyring sign-in cannot be checked without running the
 * TUI, so the default is "unknown" (the binary exists, sign-in state cannot be read).
 */
export function authFromSignals(settingsText: string | null, env: Record<string, string | undefined>): AuthState {
  let modelProvider: unknown = null;
  if (settingsText) {
    try {
      const data: unknown = JSON.parse(settingsText);
      if (isRecord(data)) modelProvider = data.modelProvider;
    } catch {
      /* ignore */
    }
  }
  if (modelProvider === "gemini" && env.GEMINI_API_KEY) {
    return { state: "logged_in", method: "api_key", account: null, detail: "modelProvider=gemini and GEMINI_API_KEY set" };
  }
  if (env.AGY_ADC_AUTH === "true") {
    return { state: "logged_in", method: "adc", account: null, detail: "AGY_ADC_AUTH=true (Application Default Credentials)" };
  }
  return {
    state: "unknown",
    method: null,
    account: null,
    detail: "agy has no non-interactive login check; sign-in lives in the OS keyring",
  };
}

/** Plugin ids go straight into argv; refuse anything that could be parsed as a flag. */
export function validPluginRef(ref: string): boolean {
  return ref.length > 0 && !ref.startsWith("-") && !/[\s\0]/.test(ref);
}
