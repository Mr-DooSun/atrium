// Free chat: agents that run in one scratch folder on the daemon, outside any real project.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Creates the chat folder on the daemon if needed and returns its absolute path. */
export const ensureChatDir = defineRpc({
  name: "chat.ensure-dir",
  input: z.object({}),
  output: z.object({ path: z.string() }),
});
