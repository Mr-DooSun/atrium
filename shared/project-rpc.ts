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
  // The answering daemon's Paseo host id (agent and workspace refs carry it as `hostId`). Paths
  // only mean something on that host. Null when the daemon cannot tell; absent from older servers.
  hostId: z.string().min(1).nullable().default(null),
  // Zod records discard "__proto__". Validate entries so even that cwd is echoed verbatim.
  worktrees: z.preprocess(
    (value) => value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : undefined,
    z.array(z.tuple([z.string(), worktreeInfoSchema])).transform((entries) => Object.fromEntries(entries)),
  ),
});
export type ProjectWorktreesInput = z.infer<typeof projectWorktreesInputSchema>;
export type ProjectWorktreesOutput = z.infer<typeof projectWorktreesOutputSchema>;

/** Key of a session folder in the sidebar's worktree map: paths only mean something on one host. */
export function worktreeKey(hostId: string, cwd: string): string {
  return `${hostId}\u0000${cwd}`;
}

/**
 * Which checkout a session works in, as far as its badge tells: the host, the worktree folder and
 * what is checked out there. Two sessions with the same key show the same badge.
 */
export function checkoutKey(hostId: string, info: Extract<WorktreeInfo, { kind: "git" }>): string {
  return JSON.stringify([hostId, info.worktreePath, info.detached ? (info.head ?? "") : (info.branch ?? info.head ?? "")]);
}

export const projectWorktrees = defineRpc({
  name: "project.worktrees",
  input: projectWorktreesInputSchema,
  output: projectWorktreesOutputSchema,
});
