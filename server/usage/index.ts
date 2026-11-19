import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createUsageSources } from "./source";

export function registerUsage(server: PluginServerContext) {
  for (const source of createUsageSources()) server.registerUsageSource(source);
}

export { createUsageService } from "./service";
export { createUsageSources } from "./source";
