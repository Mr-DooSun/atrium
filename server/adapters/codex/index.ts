import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ActionPreview, AuthState, McpAddInput, McpServer } from "../../../shared/toolbox/types.ts";
import { commandResult, unsupported, type ProfileRuntime, type ProviderAdapter } from "../../core/adapter.ts";
import { plain, type ExecResult } from "../../core/exec.ts";
import { argvOf } from "../../core/run-profile.ts";
import { codexError, maskValue, publicUrl, runCodex } from "./cli.ts";
import { codexPlugins } from "./plugins.ts";

const mcpList = z.array(z.object({
  name: z.string(),
  enabled: z.boolean(),
  auth_status: z.string().optional(),
  transport: z.discriminatedUnion("type", [
    z.object({ type: z.literal("stdio"), command: z.string() }),
    z.object({ type: z.literal("streamable_http"), url: z.string() }),
  ]),
}));

// Don't forward auth status text: Codex prints part of the API key for API-key logins.
export function parseAuth(result: ExecResult, profileEnv: Record<string, string> = {}): AuthState {
  const status = plain(result.stdout + "\n" + result.stderr);
  const method = [
    [/^Logged in using ChatGPT$/im, "ChatGPT"],
    [/^(?:API key configured\b|Logged in using (?:an? )?API key\b)/im, "API key"],
    [/^Logged in using workload identity$/im, "Workload identity"],
    [/^Logged in using access token$/im, "Access token"],
    [/^Logged in using personal access token$/im, "Personal access token"],
    [/^Logged in using Amazon Bedrock (?:API key|AWS access keys)$/im, "Amazon Bedrock"],
  ] as const;
  if (result.spawnError?.startsWith("spawn ") && result.spawnError.endsWith(" ENOENT")) {
    return { state: "not_installed", method: null, account: null, detail: null };
  }
  if (result.code === 0 && !result.timedOut && !result.truncated) {
    return { state: "logged_in", method: method.find(([pattern]) => pattern.test(status))?.[1] ?? null, account: null, detail: null };
  }
  if (result.code === 1 && !result.timedOut && !result.truncated && /^Not logged in$/im.test(status)) {
    return { state: "logged_out", method: null, account: null, detail: null };
  }
  return {
    state: "unknown",
    method: null,
    account: null,
    detail: codexError(result, "login status", [], profileEnv) ?? "Could not check Codex login status.",
  };
}

export function parseMcpList(output: string): McpServer[] {
  const entries = mcpList.parse(JSON.parse(output));
  return entries.map(({ name, enabled, auth_status, transport }) => ({
    name,
    scope: null, // Codex list merges CLI configuration and plugin-provided servers.
    transport: transport.type === "stdio" ? "stdio" : "http",
    // Arbitrary stdio args may carry positional credentials.
    target: transport.type === "stdio" ? transport.command : publicUrl(transport.url),
    status: !enabled ? "disabled" : auth_status === "not_logged_in" ? "needs_auth" : "unknown",
    detail: null,
  }));
}

const validName = (name: string) => /^[A-Za-z0-9_:@/.][A-Za-z0-9_:@/.-]*$/.test(name);
const globalScope = (scope: string | null) => scope === null || scope === "global" || scope === "user";

function mcpAddWarning(server: McpAddInput, source: string | null): string | null {
  if (!validName(server.name)) return "Use a valid Codex MCP server name.";
  if (!globalScope(server.scope)) return "Codex MCP changes apply to this profile's global configuration.";
  if (server.transport === "sse") return "Codex supports stdio and streamable HTTP.";
  if (Object.keys(server.headers).length) return "The Codex MCP add CLI cannot set custom headers.";
  const envKeys = Object.keys(server.env);
  if (server.transport === "http" && (!source || server.args.length || envKeys.length)) {
    return "Streamable HTTP requires an HTTP(S) URL and accepts no stdio arguments or environment values.";
  }
  if (envKeys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) return "Use valid environment variable names.";
  return null;
}

function planMcpAdd(profile: ProfileRuntime, server: McpAddInput): { preview: ActionPreview; args: string[] } {
  const { name, transport, target, args, env } = server;
  const source = transport === "stdio" ? target : publicUrl(target);
  const warning = mcpAddWarning(server, source);
  if (warning) {
    return { preview: { command: [], source, warnings: [warning], supported: false }, args: [] };
  }
  const prefix = ["mcp", "add", name];
  if (transport === "http" && source) {
    return {
      preview: {
        command: argvOf(profile, [...prefix, "--url", source]),
        source,
        warnings: [
          `Codex HTTP add can launch OAuth in a browser. Run the displayed command in a terminal with this profile's environment and the original URL. If the entry is already saved, run codex mcp login ${name} --no-browser.`,
        ],
        supported: false,
      },
      args: [],
    };
  }
  const entries = Object.entries(env);
  return {
    preview: {
      command: argvOf(profile, [
        ...prefix,
        ...entries.flatMap(([key, value]) => ["--env", `${key}=${maskValue(value)}`]),
        "--", target, ...args.map(maskValue),
      ]),
      source,
      warnings: entries.length ? ["Stdio environment values are passed as process arguments and can be visible to other local processes while Codex runs."] : [],
      supported: true,
    },
    args: [...prefix, ...entries.flatMap(([key, value]) => ["--env", `${key}=${value}`]), "--", target, ...args],
  };
}

function mcpChange(result: ExecResult, command: string[], action: "add" | "remove", name: string, secrets: string[], env: Record<string, string>) {
  const stdout = plain(result.stdout);
  const error = codexError(result, `MCP ${action}`, secrets, env);
  const changed = stdout.split("\n").includes(
    `${action === "add" ? "Added" : "Removed"} global MCP server '${name}'.`,
  );
  const successMessage = changed
    ? `MCP server ${name} was ${action === "add" ? "added" : "removed"}.`
    : action === "remove" ? `MCP server ${name} was already absent.` : `MCP server ${name} was added.`;
  const output = error && !changed ? "" : successMessage;
  return commandResult(command, output, error, changed || (action === "add" && error === null));
}

/** Server names declared in <cwd>/.codex/config.toml ([mcp_servers.<name>] tables). Read-only. */
async function projectServerNames(cwd: string): Promise<Set<string>> {
  let text = "";
  try {
    text = await readFile(join(cwd, ".codex", "config.toml"), "utf8");
  } catch {
    return new Set();
  }
  const names = new Set<string>();
  for (const m of text.matchAll(/^\s*\[\s*mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*[\].]/gm)) {
    names.add(m[1] ?? m[2] ?? m[3]);
  }
  return names;
}

export const codexAdapter: ProviderAdapter = {
  defaultCommand: "codex",
  configHomeEnv: "CODEX_HOME",

  async auth(profile) {
    return parseAuth(await runCodex(profile, ["login", "status"], { timeoutMs: 8_000 }), profile.env);
  },

  async listMcp(profile, cwd) {
    const result = await runCodex(profile, ["mcp", "list", "--json"], { cwd });
    const error = codexError(result, "MCP listing", [], profile.env);
    if (error) throw new Error(error);
    let servers: McpServer[];
    try {
      servers = parseMcpList(result.stdout);
    } catch {
      throw new Error("Codex returned an invalid MCP list.");
    }
    // `codex mcp list` merges a trusted project's .codex/config.toml without saying which is which.
    // Names declared there are project scope; the CLI can only add/remove the user-level ones.
    const projectNames = cwd ? await projectServerNames(cwd) : new Set<string>();
    return servers.map((s) => (projectNames.has(s.name) ? { ...s, scope: "project" } : { ...s, scope: s.scope ?? "user" }));
  },

  async previewMcpAdd(profile, _cwd, server) {
    return planMcpAdd(profile, server).preview;
  },

  async addMcp(profile, cwd, server) {
    const { preview, args } = planMcpAdd(profile, server);
    if (!preview.supported) return commandResult(preview.command, "", preview.warnings[0], false);
    const result = await runCodex(profile, args, { cwd });
    return mcpChange(result, preview.command, "add", server.name, [...Object.values(server.env), ...server.args], profile.env);
  },

  async removeMcp(profile, cwd, name, scope) {
    if (!validName(name) || !globalScope(scope)) return unsupported([], "This MCP name or scope");
    const args = ["mcp", "remove", name];
    return mcpChange(await runCodex(profile, args, { cwd }), argvOf(profile, args), "remove", name, [], profile.env);
  },

  async loginMcp(profile, _cwd, name) {
    if (!validName(name)) return unsupported([], "This MCP name");
    const command = argvOf(profile, ["mcp", "login", name, "--no-browser"]);
    return commandResult(
      command,
      "Run the displayed command in a terminal on the daemon host with this profile's environment. Open the authorization URL and paste the callback URL into that terminal.",
      "MCP OAuth requires a terminal that can keep the login process open and accept callback input.",
      false,
    );
  },

  ...codexPlugins,
};
