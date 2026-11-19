import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ensureChatDir } from "../shared/chat/rpc";

/** The daemon user's scratch folder for free chat. Not a git repo, so no worktrees. */
export const CHAT_DIR = join(homedir(), ".paseo-chat");

export function registerChat(server: PluginServerContext) {
  server.handle(ensureChatDir, async () => {
    await mkdir(CHAT_DIR, { recursive: true });
    return { path: CHAT_DIR };
  });
}
