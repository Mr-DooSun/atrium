// Toolbox entry: the /mcp and /plugins screens, their slash commands and Command Center items.
// The slash commands shadow the providers' own /mcp and /plugin(s) inside Paseo on purpose.
import type { PluginAgentCommandContext, PluginClientContext, PluginScreenParams } from "@getpaseo/plugin/client";
import { McpScreen } from "./mcp-screen";
import { PluginsScreen } from "./plugins-screen";
import { toolboxText } from "./strings";

export const TOOLBOX_SCREENS = { mcp: "mcp", plugins: "plugins" } as const;

function agentParams(ctx: PluginAgentCommandContext): PluginScreenParams {
  // agentId: the chat the screen was opened from, for its back button.
  const params: PluginScreenParams = { profileId: ctx.agent.provider, agentId: ctx.agent.id };
  if (ctx.agent.title) params.agentTitle = ctx.agent.title.slice(0, 80);
  if (ctx.agent.cwd) params.cwd = ctx.agent.cwd;
  return params;
}

function openMcp(ctx: PluginAgentCommandContext, args: string) {
  const params = agentParams(ctx);
  // `/mcp <profile>` looks at another profile (account) than the agent's own.
  const profile = args.trim().split(/\s+/)[0];
  if (profile) params.profileId = profile;
  ctx.openScreen({ screenId: TOOLBOX_SCREENS.mcp, params });
}

function openPlugins(ctx: PluginAgentCommandContext, args: string) {
  const params = agentParams(ctx);
  // `/plugins claude` preselects a tab; the screen ignores values it does not know.
  const tab = args.trim().split(/\s+/)[0]?.toLowerCase();
  if (tab) params.tab = tab;
  ctx.openScreen({ screenId: TOOLBOX_SCREENS.plugins, params });
}

export function registerToolbox(client: PluginClientContext): () => void {
  const cleanups = [
    client.addScreen({ id: TOOLBOX_SCREENS.mcp, title: toolboxText.message("screen.mcp"), Component: McpScreen }),
    client.addScreen({ id: TOOLBOX_SCREENS.plugins, title: toolboxText.message("screen.plugins"), Component: PluginsScreen }),

    client.addSlashCommand({
      name: "mcp",
      description: toolboxText.message("command.mcpDescription"),
      argumentHint: toolboxText.message("command.mcpHint"),
      context: "agent",
      onSubmit: (ctx) => openMcp(ctx, ctx.args),
    }),
    ...["plugins", "plugin"].map((name) =>
      client.addSlashCommand({
        name,
        description: toolboxText.message("command.pluginsDescription"),
        argumentHint: toolboxText.message("command.pluginsHint"),
        context: "agent",
        onSubmit: (ctx) => openPlugins(ctx, ctx.args),
      }),
    ),

    client.addCommandCenterItem({
      id: "toolbox-mcp",
      title: toolboxText.message("command.mcpCenter"),
      icon: "Plug",
      keywords: ["mcp", "server", "서버"],
      context: "agent",
      onSelect: (ctx) => openMcp(ctx, ""),
    }),
    client.addCommandCenterItem({
      id: "toolbox-plugins",
      title: toolboxText.message("command.pluginsCenter"),
      icon: "Puzzle",
      keywords: ["plugin", "plugins", "marketplace", "플러그인", "마켓플레이스"],
      context: "agent",
      onSelect: (ctx) => openPlugins(ctx, ""),
    }),
  ];
  return () => {
    for (const cleanup of cleanups.reverse()) void cleanup();
  };
}
