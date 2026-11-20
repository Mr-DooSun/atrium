// Toolbox RPC contracts. Owned by the orchestrator.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  ActionPreview,
  CatalogPlugin,
  CatalogSort,
  CommandResult,
  Ecosystem,
  InstalledPlugin,
  Marketplace,
  MarketplaceAction,
  McpAddInput,
  McpServer,
  PluginAction,
  PluginSourceInput,
  Profile,
} from "./types";

/** Profiles with login state. `refresh` re-runs the auth checks instead of using the cache. */
export const listProfiles = defineRpc({
  name: "toolbox.profiles.list",
  input: z.object({ refresh: z.boolean() }),
  output: z.object({ profiles: z.array(Profile) }),
});

const scoped = { profileId: z.string(), cwd: z.string().nullable() };

export const listMcp = defineRpc({
  name: "toolbox.mcp.list",
  input: z.object(scoped),
  output: z.object({ servers: z.array(McpServer), error: z.string().nullable() }),
});

export const previewMcpAdd = defineRpc({
  name: "toolbox.mcp.preview-add",
  input: z.object({ ...scoped, server: McpAddInput }),
  output: ActionPreview,
});

export const addMcp = defineRpc({
  name: "toolbox.mcp.add",
  input: z.object({ ...scoped, server: McpAddInput }),
  output: CommandResult,
});

export const removeMcp = defineRpc({
  name: "toolbox.mcp.remove",
  input: z.object({ ...scoped, name: z.string(), scope: z.string().nullable() }),
  output: CommandResult,
});

/** Starts the CLI's own login for an MCP server that needs auth (OAuth). */
export const loginMcp = defineRpc({
  name: "toolbox.mcp.login",
  input: z.object({ ...scoped, name: z.string() }),
  output: CommandResult,
});

const pluginScope = {
  ecosystem: Ecosystem,
  /** Required for claude/codex/antigravity; null for paseo. */
  profileId: z.string().nullable(),
  /** The agent's project directory, for project/local-scoped plugins. */
  cwd: z.string().nullable(),
};

/** Catalogs can hold thousands of plugins; the daemon returns one page of at most this many. */
export const CATALOG_LIMIT = 200;
/** Page size the browse list asks for; more pages load as the user scrolls. */
export const CATALOG_PAGE = 50;

export const listInstalledPlugins = defineRpc({
  name: "toolbox.plugins.installed",
  input: z.object(pluginScope),
  output: z.object({ plugins: z.array(InstalledPlugin), error: z.string().nullable() }),
});

export const listCatalog = defineRpc({
  name: "toolbox.plugins.catalog",
  input: z.object({
    ...pluginScope,
    query: z.string(),
    /** Page start within the name-sorted matches. */
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(CATALOG_LIMIT).default(CATALOG_LIMIT),
    /** Exact category match; null/absent = all. */
    category: z.string().nullable().optional(),
    sort: CatalogSort.optional(),
  }),
  output: z.object({
    /** One page of matches, sorted by name; `total` counts every match. */
    plugins: z.array(CatalogPlugin),
    total: z.number(),
    marketplaces: z.array(Marketplace),
    error: z.string().nullable(),
    /** Every category among the query matches (before the category filter), for filter chips. */
    categories: z.array(z.string()).optional(),
  }),
});

const pluginActionInput = z.object({
  ...pluginScope,
  action: PluginAction,
  pluginId: z.string(),
  marketplace: z.string().nullable(),
  /** One of ECOSYSTEM_CAPS[eco].scopes; null/absent = the CLI default. */
  scope: z.string().nullable().optional(),
});

export const previewPluginAction = defineRpc({
  name: "toolbox.plugins.preview",
  input: pluginActionInput,
  output: ActionPreview,
});

export const runPluginAction = defineRpc({
  name: "toolbox.plugins.run",
  input: pluginActionInput,
  output: CommandResult,
});

const sourceInstallInput = z.object({ ...pluginScope, source: PluginSourceInput });

/** Validates a direct source (git, npm, local directory, marketplace) and shows what would run. */
export const previewSourceInstall = defineRpc({
  name: "toolbox.plugins.preview-source",
  input: sourceInstallInput,
  output: ActionPreview,
});

/** Installs from a direct source. Paseo requires an unexpired preview of the identical input. */
export const runSourceInstall = defineRpc({
  name: "toolbox.plugins.install-source",
  input: sourceInstallInput,
  output: CommandResult,
});

/** What a marketplace action would run, for the confirmation modal. */
export const previewMarketplaceAction = defineRpc({
  name: "toolbox.plugins.marketplace-preview",
  input: z.object({ ...pluginScope, action: MarketplaceAction, source: z.string() }),
  output: ActionPreview,
});

export const runMarketplaceAction = defineRpc({
  name: "toolbox.plugins.marketplace",
  /** `source`: for "add" the marketplace source (repo, URL or path); for "remove" and "update"
   *  the marketplace name as listed in `Marketplace.name`. */
  input: z.object({ ...pluginScope, action: MarketplaceAction, source: z.string() }),
  output: CommandResult,
});
