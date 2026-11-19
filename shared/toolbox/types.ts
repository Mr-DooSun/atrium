// Toolbox data contracts shared by the daemon (server/) and the app (client/).
// Owned by the orchestrator. Workers read these; changes go through the orchestrator.
import { z } from "zod";

/** Agent CLIs whose MCP servers and plugins the toolbox manages. */
export const ProviderKind = z.enum(["claude", "codex", "antigravity"]);
export type ProviderKind = z.infer<typeof ProviderKind>;

/** Where a plugin comes from. "paseo" is Paseo's own plugin system (no profile). */
export const Ecosystem = z.enum(["paseo", "claude", "codex", "antigravity"]);
export type Ecosystem = z.infer<typeof Ecosystem>;

export const AuthState = z.object({
  state: z.enum(["logged_in", "logged_out", "not_installed", "unknown"]),
  /** e.g. "claude.ai", "api_key", "ChatGPT". */
  method: z.string().nullable(),
  /** Account email or org when the CLI reports it; never a token. */
  account: z.string().nullable(),
  detail: z.string().nullable(),
});
export type AuthState = z.infer<typeof AuthState>;

/**
 * One account of one agent CLI. Paseo providers are the source: a built-in provider ("claude")
 * and every custom provider that extends one ("claude-pb1" with its own CLAUDE_CONFIG_DIR) are
 * separate profiles, so multi-subscription setups are covered without extra configuration.
 */
export const Profile = z.object({
  /** The Paseo provider id. */
  id: z.string(),
  label: z.string(),
  kind: ProviderKind,
  /** Paseo reports the provider usable. */
  available: z.boolean(),
  enabled: z.boolean(),
  /** Executable used for this profile. */
  command: z.string(),
  /** Config home the profile points at (CLAUDE_CONFIG_DIR, CODEX_HOME, ...), null = default. */
  configHome: z.string().nullable(),
  auth: AuthState,
});
export type Profile = z.infer<typeof Profile>;

/**
 * MCP scopes each CLI accepts when adding a server; the first is the default. Empty: the CLI has
 * one global config, send `scope: null`.
 */
export const MCP_SCOPES: Record<ProviderKind, readonly string[]> = {
  claude: ["local", "project", "user"],
  codex: [],
  antigravity: ["user", "project"],
};

export const McpServer = z.object({
  name: z.string(),
  /** user | project | local | plugin | global ... as the CLI names it. */
  scope: z.string().nullable(),
  transport: z.string().nullable(),
  /** Command line or URL. Secrets in env/headers are never returned. */
  target: z.string().nullable(),
  status: z.enum(["connected", "failed", "needs_auth", "pending", "disabled", "unknown"]),
  detail: z.string().nullable(),
});
export type McpServer = z.infer<typeof McpServer>;

export const InstalledPlugin = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  /** null when the ecosystem has no enable switch. */
  enabled: z.boolean().nullable(),
  marketplace: z.string().nullable(),
  source: z.string().nullable(),
  description: z.string().nullable(),
  /** Running state or load error, when the ecosystem reports one. */
  status: z.string().nullable(),
  error: z.string().nullable(),
  /** user | project | local | synced ... as the CLI reports it; null/absent = not reported. */
  scope: z.string().nullable().optional(),
  /** Version or revision an update would bring; null/absent = no update known. */
  updateTo: z.string().nullable().optional(),
});
export type InstalledPlugin = z.infer<typeof InstalledPlugin>;

export const CatalogPlugin = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  marketplace: z.string().nullable(),
  /** Repository or package the install would fetch. */
  source: z.string().nullable(),
  categories: z.array(z.string()),
  installed: z.boolean(),
});
export type CatalogPlugin = z.infer<typeof CatalogPlugin>;

export const Marketplace = z.object({
  name: z.string(),
  source: z.string().nullable(),
  pluginCount: z.number().nullable(),
});
export type Marketplace = z.infer<typeof Marketplace>;

/** Result of a command the toolbox ran. */
export const CommandResult = z.object({
  ok: z.boolean(),
  /** The argv that ran, for the record shown to the user. */
  command: z.array(z.string()),
  output: z.string(),
  error: z.string().nullable(),
  /** The change needs open sessions of this profile to reload before they see it. */
  needsReload: z.boolean(),
});
export type CommandResult = z.infer<typeof CommandResult>;

/** What an action would do, shown in the confirmation modal before anything runs. */
export const ActionPreview = z.object({
  command: z.array(z.string()),
  /** What will be fetched and from where (repo, package, URL). */
  source: z.string().nullable(),
  warnings: z.array(z.string()),
  supported: z.boolean(),
});
export type ActionPreview = z.infer<typeof ActionPreview>;

export const McpAddInput = z.object({
  name: z.string().min(1),
  scope: z.string().nullable(),
  transport: z.enum(["stdio", "http", "sse"]),
  /** stdio: the command; http/sse: the URL. */
  target: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  headers: z.record(z.string(), z.string()),
});
export type McpAddInput = z.infer<typeof McpAddInput>;

export const PluginAction = z.enum(["install", "uninstall", "enable", "disable", "update"]);
export type PluginAction = z.infer<typeof PluginAction>;

export const MarketplaceAction = z.enum(["add", "remove", "update"]);
export type MarketplaceAction = z.infer<typeof MarketplaceAction>;

/** What each ecosystem can do, so the UI hides buttons that would only fail. */
export const ECOSYSTEM_CAPS: Record<
  Ecosystem,
  { plugin: readonly PluginAction[]; marketplace: readonly MarketplaceAction[]; browse: boolean }
> = {
  paseo: { plugin: ["install", "uninstall", "enable", "disable", "update"], marketplace: [], browse: true },
  claude: {
    plugin: ["install", "uninstall", "enable", "disable", "update"],
    marketplace: ["add", "remove", "update"],
    browse: true,
  },
  codex: { plugin: ["install", "uninstall"], marketplace: ["add", "remove", "update"], browse: true },
  antigravity: { plugin: ["install", "uninstall", "enable", "disable"], marketplace: [], browse: false },
};
