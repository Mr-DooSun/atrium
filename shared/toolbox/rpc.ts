// Toolbox RPC contracts. Owned by the orchestrator.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  ActionPreview,
  CatalogPlugin,
  CommandResult,
  Ecosystem,
  InstalledPlugin,
  Marketplace,
  MarketplaceAction,
  McpAddInput,
  McpServer,
  PluginAction,
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
  }),
  output: z.object({
    /** One page of matches, sorted by name; `total` counts every match. */
    plugins: z.array(CatalogPlugin),
    total: z.number(),
    marketplaces: z.array(Marketplace),
    error: z.string().nullable(),
  }),
});

const pluginActionInput = z.object({
  ...pluginScope,
  action: PluginAction,
  pluginId: z.string(),
  marketplace: z.string().nullable(),
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

export const runMarketplaceAction = defineRpc({
  name: "toolbox.plugins.marketplace",
  /** `source`: for "add" the marketplace source (repo, URL or path); for "remove" and "update"
   *  the marketplace name as listed in `Marketplace.name`. */
  input: z.object({ ...pluginScope, action: MarketplaceAction, source: z.string() }),
  output: CommandResult,
});
