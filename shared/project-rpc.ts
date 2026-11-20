import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Same as Paseo's own "remove project": archives its sessions, keeps every file on disk. */
export const removeProject = defineRpc({
  name: "project.remove",
  input: z.object({ projectId: z.string().min(1) }),
  output: z.object({ ok: z.literal(true) }),
});

export const worktreeInfoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("git"),
    worktreePath: z.string(),
    mainWorktreePath: z.string(),
    isMain: z.boolean(),
    branch: z.string().nullable(),
    defaultBranch: z.string().nullable(),
    head: z.string().nullable(),
    detached: z.boolean(),
  }),
]);
export type WorktreeInfo = z.infer<typeof worktreeInfoSchema>;

export const MAX_WORKTREE_CWDS = 64;
export const projectWorktreesInputSchema = z.object({
  cwds: z.array(z.string()).max(MAX_WORKTREE_CWDS),
});
export const projectWorktreesOutputSchema = z.object({
  // Zod records discard "__proto__". Validate entries so even that cwd is echoed verbatim.
  worktrees: z.preprocess(
    (value) => value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : undefined,
    z.array(z.tuple([z.string(), worktreeInfoSchema])).transform((entries) => Object.fromEntries(entries)),
  ),
});
export type ProjectWorktreesInput = z.infer<typeof projectWorktreesInputSchema>;
export type ProjectWorktreesOutput = z.infer<typeof projectWorktreesOutputSchema>;

export const projectWorktrees = defineRpc({
  name: "project.worktrees",
  input: projectWorktreesInputSchema,
  output: projectWorktreesOutputSchema,
});
