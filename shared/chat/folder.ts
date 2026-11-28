// Which projects are a host's free chat folder. The plugin's RPCs only reach its own daemon, so
// another host's folder path (under that machine's home) is never known here; every host's chat
// folder carries the same name, though, so the name is what tells it apart.

/** The chat folder's name in the daemon user's home, on every host. */
export const CHAT_DIR_NAME = ".paseo-chat";

/** True for a project root that is a chat folder: this daemon's own, or any host's by name. */
export function isChatFolder(rootPath: string | null | undefined, ownChatDir: string | null): boolean {
  if (!rootPath) return false;
  if (ownChatDir !== null && rootPath === ownChatDir) return true;
  const trimmed = rootPath.replace(/[\\/]+$/, "");
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
  return name === CHAT_DIR_NAME;
}
