// Removing a project from Paseo, which the plugin SDK does not expose; the daemon does it
// through the paseo CLI.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Same as Paseo's own "remove project": archives its sessions, keeps every file on disk. */
export const removeProject = defineRpc({
  name: "project.remove",
  input: z.object({ projectId: z.string().min(1) }),
  output: z.object({ ok: z.literal(true) }),
});
