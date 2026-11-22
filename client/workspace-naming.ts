// How a workspace row is named (U-5). Pure: no React or react-native, so tests import it directly.

/**
 * The title the user gave the workspace, or null. Without one Paseo names a workspace after its
 * branch (or folder), so several workspaces on one branch would all read "main". `title` is
 * Paseo's override (null once reset); `name` can mirror it, so only the branch is compared.
 */
export function workspaceCustomTitle(w: { title: string | null; branch: string | null }): string | null {
  return w.title && w.title !== w.branch ? w.title : null;
}

/**
 * What the row says: the user's title; else, for a workspace drawn as one row with its only agent
 * (`singleAgent`), that agent's title; else Paseo's name (title or derived name).
 */
export function workspaceRowLabel(input: {
  customTitle: string | null;
  /** Paseo's display name: `title ?? name`. */
  name: string;
  singleAgent: boolean;
  agentTitle: string | null | undefined;
}): string {
  if (input.customTitle) return input.customTitle;
  if (input.singleAgent && input.agentTitle) return input.agentTitle;
  return input.name;
}
