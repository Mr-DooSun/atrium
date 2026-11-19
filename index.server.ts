import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerChat } from "./server/chat";
import { registerProject } from "./server/project";
import { registerProjectOrder } from "./server/project-order";
import { registerToolbox } from "./server/toolbox";
import { registerUsage } from "./server/usage";

export default function contribute(server: PluginServerContext) {
  registerToolbox(server);
  registerChat(server);
  registerProject(server);
  registerProjectOrder(server);
  registerUsage(server);
  return () => {};
}
