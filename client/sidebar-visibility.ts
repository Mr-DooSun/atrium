// Which projects the Atrium sidebar shows, and where hidden ones keep their place (U-1). Pure: no
// React or react-native, so tests import it directly.
import { hiddenProjectKey, type HiddenProject } from "../shared/project-rpc";

/** Host-scoped keys of the hidden projects: ids alone can repeat across hosts. */
export function hiddenKeySet(hidden: readonly HiddenProject[]): ReadonlySet<string> {
  return new Set(hidden.map((h) => hiddenProjectKey(h.hostId, h.projectId)));
}

/** Whether a project is hidden, by host AND id. */
export function isHiddenProject(ref: { hostId: string; id: string }, hiddenKeys: ReadonlySet<string>): boolean {
  return hiddenKeys.has(hiddenProjectKey(ref.hostId, ref.id));
}

/** The project blocks to draw: known projects that are not hidden, in the given order. */
export function visibleProjectBlocks<B extends { projectKey: string }>(
  blocks: readonly B[],
  projectRefs: ReadonlyMap<string, { hostId: string; id: string }>,
  hiddenKeys: ReadonlySet<string>,
): B[] {
  return blocks.filter((b) => {
    const ref = projectRefs.get(b.projectKey);
    return ref !== undefined && !isHiddenProject(ref, hiddenKeys);
  });
}
