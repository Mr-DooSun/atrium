// The interface every ecosystem adapter implements. Owned by the orchestrator.
// Each worker owns one adapter folder under server/adapters/<name>/ and exports an object
// satisfying `ProviderAdapter` (claude, codex, antigravity) or `PluginEcosystemAdapter` (paseo).
import type {
  ActionPreview,
  AuthState,
  CatalogPlugin,
  CommandResult,
  InstalledPlugin,
  Marketplace,
  MarketplaceAction,
  McpAddInput,
  McpServer,
  PluginAction,
  PluginSourceInput,
} from "../../shared/toolbox/types";

/** What an adapter needs to run its CLI as one profile (one account). */
export interface ProfileRuntime {
  id: string;
  /** Executable for this profile, e.g. /Users/x/.local/bin/claude-pb1 or "claude". */
  command: string;
  /** Leading arguments from the Paseo provider command (e.g. ["-y", "@pkg/cli"] after "npx").
   *  Always prepend them; use `argvOf` / `runProfile` from server/core/run-profile.ts. */
  args: string[];
  /** Profile env from Paseo config (CLAUDE_CONFIG_DIR, CODEX_HOME, ...). Pass to every run. */
  env: Record<string, string>;
  configHome: string | null;
}

export interface CatalogResult {
  plugins: CatalogPlugin[];
  marketplaces: Marketplace[];
}

/** Plugin management for one ecosystem. `profile` is null only for paseo. */
export interface PluginEcosystemAdapter {
  /** `cwd`: the agent's project, so project/local-scoped plugins are listed and targeted too. */
  listInstalled(profile: ProfileRuntime | null, cwd?: string | null): Promise<InstalledPlugin[]>;
  /** Browse marketplaces; `query` filters by name/description, "" lists everything. */
  /** `cwd`: the agent's project, so `installed` reflects project/local installs there too. */
  listCatalog(profile: ProfileRuntime | null, query: string, cwd?: string | null): Promise<CatalogResult>;
  /** Describe the command an action would run without running it. Must not mutate anything. */
  previewAction(
    profile: ProfileRuntime | null,
    action: PluginAction,
    pluginId: string,
    marketplace: string | null,
    cwd?: string | null,
    /** Validated against ECOSYSTEM_CAPS[eco].scopes by the handler; null = CLI default. */
    scope?: string | null,
  ): Promise<ActionPreview>;
  runAction(
    profile: ProfileRuntime | null,
    action: PluginAction,
    pluginId: string,
    marketplace: string | null,
    cwd?: string | null,
    scope?: string | null,
  ): Promise<CommandResult>;
  runMarketplaceAction(
    profile: ProfileRuntime | null,
    action: MarketplaceAction,
    source: string,
  ): Promise<CommandResult>;
  /** Direct install from ECOSYSTEM_CAPS[eco].sources. Must validate `source` and not mutate. */
  previewSource?(profile: ProfileRuntime | null, source: PluginSourceInput, cwd?: string | null): Promise<ActionPreview>;
  installSource?(profile: ProfileRuntime | null, source: PluginSourceInput, cwd?: string | null): Promise<CommandResult>;
  /** What runMarketplaceAction would run. Must not mutate. */
  previewMarketplaceAction?(profile: ProfileRuntime | null, action: MarketplaceAction, source: string): Promise<ActionPreview>;
  /** Installed plugin id → version/revision an update would bring. Omit if the CLI cannot tell. */
  checkUpdates?(profile: ProfileRuntime | null, cwd?: string | null): Promise<Map<string, string>>;
}

/** An agent CLI: login state, MCP servers and its plugins. */
export interface ProviderAdapter extends PluginEcosystemAdapter {
  /** Default executable when the Paseo provider does not override it. */
  defaultCommand: string;
  /** Env var that points the CLI at another config home (multi-account), if the CLI has one. */
  configHomeEnv: string | null;
  /** Must be quick (< ~10s) and must not open a browser or prompt. */
  auth(profile: ProfileRuntime): Promise<AuthState>;
  /** Include live connection status when the CLI can check it. `cwd` selects project scope. */
  listMcp(profile: ProfileRuntime, cwd: string | null): Promise<McpServer[]>;
  previewMcpAdd(profile: ProfileRuntime, cwd: string | null, server: McpAddInput): Promise<ActionPreview>;
  addMcp(profile: ProfileRuntime, cwd: string | null, server: McpAddInput): Promise<CommandResult>;
  removeMcp(profile: ProfileRuntime, cwd: string | null, name: string, scope: string | null): Promise<CommandResult>;
  /** Start the CLI's OAuth login for a server; return the URL or instructions in `output`. */
  loginMcp(profile: ProfileRuntime, cwd: string | null, name: string): Promise<CommandResult>;
}

/** Helper for adapters: a CommandResult from argv + exec outcome. */
export function commandResult(
  command: string[],
  output: string,
  error: string | null,
  needsReload: boolean,
): CommandResult {
  return { ok: error === null, command, output, error, needsReload };
}

export function unsupported(command: string[], what: string): CommandResult {
  return commandResult(command, "", `${what} is not supported by this CLI`, false);
}
