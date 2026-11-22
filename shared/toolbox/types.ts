// Toolbox data contracts shared by the daemon (server/) and the app (client/).
// Owned by the orchestrator. Workers read these; changes go through the orchestrator.
import { z } from "zod";

/** Agent CLIs whose MCP servers and plugins the toolbox manages. */
export const ProviderKind = z.enum(["claude", "codex", "antigravity"]);
export type ProviderKind = z.infer<typeof ProviderKind>;

/** Ecosystem/navigation tag. "paseo" opens native management and has no Toolbox operations. */
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
  // Store metadata joined from the catalog where cheap (same meaning as on CatalogPlugin).
  iconUrl: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  homepage: z.string().nullable().optional(),
  categories: z.array(z.string()).optional(),
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
  // Store metadata. Optional: absent or null = the ecosystem does not report it.
  author: z.string().nullable().optional(),
  /** Latest version the catalog offers. */
  version: z.string().nullable().optional(),
  /** Installed version, when installed and reported. */
  installedVersion: z.string().nullable().optional(),
  /** Installed and a newer version is offered (same meaning as InstalledPlugin.updateTo). */
  updateTo: z.string().nullable().optional(),
  /** https only. */
  homepage: z.string().nullable().optional(),
  /** https only; load it as a remote image, never as markup. */
  iconUrl: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  /** Install count when the source reports one. */
  installs: z.number().nullable().optional(),
  /** Highlighted by the registry. */
  featured: z.boolean().optional(),
  /** ISO date of the last catalog update for this plugin. */
  updatedAt: z.string().nullable().optional(),
});
export type CatalogPlugin = z.infer<typeof CatalogPlugin>;

export const Marketplace = z.object({
  name: z.string(),
  source: z.string().nullable(),
  pluginCount: z.number().nullable(),
  /** Built in or official; the UI may hide "remove" for it. */
  official: z.boolean().optional(),
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
  /** Daemon-home path relative to the daemon user's home, for display only. */
  relativeHome: z.string().optional(),
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

/**
 * Where a direct install fetches from.
 * git: https URL, git@host:owner/repo or GitHub owner/repo. npm: package name (optionally "pkg@version").
 * local: absolute directory on the daemon machine. marketplace: a marketplace source
 * (owner/repo, https URL or path) plus the plugin name in `plugin`.
 */
export const PluginSourceKind = z.enum(["git", "npm", "local", "marketplace"]);
export type PluginSourceKind = z.infer<typeof PluginSourceKind>;

export const PluginSourceInput = z.object({
  kind: PluginSourceKind,
  value: z.string().min(1).max(2048),
  /** git: branch, tag or commit. A full commit SHA pins the install. */
  ref: z.string().max(255).nullable().optional(),
  /** npm: exact version (pinned) or dist-tag. */
  version: z.string().max(128).nullable().optional(),
  /** Plugin directory inside the repository or package. */
  path: z.string().max(512).nullable().optional(),
  /** Plugin name; required for kind "marketplace". */
  plugin: z.string().max(128).nullable().optional(),
  /** Install scope from ECOSYSTEM_CAPS[eco].scopes; null = the CLI default. */
  scope: z.string().nullable().optional(),
});
export type PluginSourceInput = z.infer<typeof PluginSourceInput>;

/** Catalog orderings; plugins without the sort key come last, then by name. */
export const CatalogSort = z.enum(["name", "installs", "updated"]);
export type CatalogSort = z.infer<typeof CatalogSort>;

/** What each ecosystem can do, so the UI hides buttons that would only fail. */
export const ECOSYSTEM_CAPS: Record<
  Ecosystem,
  {
    /** Native ecosystems are navigation-only; never call Toolbox management RPCs for them. */
    management: "native" | "toolbox";
    plugin: readonly PluginAction[];
    marketplace: readonly MarketplaceAction[];
    browse: boolean;
    /** Direct-install sources (previewSourceInstall / runSourceInstall). */
    sources: readonly PluginSourceKind[];
    /** Scopes a plugin action may target; the first is the default. Empty: no choice, send null. */
    scopes: readonly string[];
    /** Catalog sorts the source can back with data; the first is the default. */
    sorts: readonly CatalogSort[];
  }
> = {
  paseo: {
    management: "native",
    plugin: [],
    marketplace: [],
    browse: false,
    sources: [],
    scopes: [],
    sorts: ["name"],
  },
  claude: {
    management: "toolbox",
    plugin: ["install", "uninstall", "enable", "disable", "update"],
    marketplace: ["add", "remove", "update"],
    browse: true,
    sources: ["marketplace"],
    scopes: ["user", "project", "local"],
    sorts: ["name", "installs"],
  },
  codex: { management: "toolbox", plugin: ["install", "uninstall"], marketplace: ["add", "remove", "update"], browse: true, sources: [], scopes: [], sorts: ["name"] },
  antigravity: {
    management: "toolbox",
    plugin: ["install", "uninstall", "enable", "disable"],
    marketplace: [],
    browse: false,
    sources: ["git", "local"],
    scopes: [],
    sorts: ["name"],
  },
};

