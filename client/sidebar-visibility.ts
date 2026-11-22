// Which projects the Atrium sidebar shows, and where hidden ones keep their place (U-1). Pure: no
// React or react-native, so tests import it directly.
import { legacyRoot } from "../shared/project-order";
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

/**
 * Keeps hidden projects where they were in the saved order. Reordering only sees the shown
 * projects, so the order built from them (move / placeAt) would push every hidden one to the end.
 * Here each hidden key keeps its old slot and the shown keys fill the other slots in their new
 * order; anything left over follows. Keys are project root folders, as in the saved order.
 */
export function keepHiddenSlots(next: readonly string[], previous: readonly string[], hidden: ReadonlySet<string>): string[] {
  if (hidden.size === 0) return [...next];
  const rest = next.filter((key) => !hidden.has(key));
  const out: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  for (const key of previous) {
    if (hidden.has(key)) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    } else if (i < rest.length) {
      out.push(rest[i++]);
    }
  }
  out.push(...rest.slice(i));
  for (const key of next) {
    if (hidden.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** The host an order key names (`projectOrderKey`); null for a key saved before hosts were told apart. */
export function orderKeyHost(key: string): string | null {
  if (legacyRoot(key) !== null) return null;
  const [hostId] = JSON.parse(key) as [string, string];
  return hostId;
}

/**
 * The saved order after reordering one host's section. `next` is that section's new order (the
 * shown keys first, as move / placeAt build it from `sectionSaved`); `host` is the section's host,
 * or null when the sidebar has no sections and every key is in the one list.
 *
 * Only the slots of the section's own keys are refilled, hidden ones keeping theirs
 * (`keepHiddenSlots`); every other host's keys, hidden or not, stay exactly where they were.
 * Section keys the saved order did not have yet follow at the end.
 */
export function reorderSection(
  saved: readonly string[],
  next: readonly string[],
  host: string | null,
  hidden: ReadonlySet<string>,
): string[] {
  if (host === null) return keepHiddenSlots(next, saved, hidden);
  const inSection = (key: string) => orderKeyHost(key) === host;
  const filled = keepHiddenSlots(next.filter(inSection), saved.filter(inSection), hidden);
  const out: string[] = [];
  let i = 0;
  for (const key of saved) {
    if (!inSection(key)) out.push(key);
    else if (i < filled.length) out.push(filled[i++]);
  }
  out.push(...filled.slice(i));
  return out;
}

/** The section-only part of the saved order, to build a section's `next` from (move / placeAt). */
export function sectionSaved(saved: readonly string[], host: string | null): string[] {
  return host === null ? [...saved] : saved.filter((key) => orderKeyHost(key) === host);
}

/**
 * Every project's order key where the sidebar shows it now, hidden ones included: the projects
 * the saved order does not name yet first, in their default order (`keys`), as `applyOrder` puts
 * them, then the saved order itself, keys no project has now (an offline host's) staying in place.
 * Reordering starts from this rather than the saved order alone, which may not name a project
 * (never saved, or added since): a hidden project it did not name would lose its slot and come
 * back first, as a new project does.
 */
export function displayedOrder(keys: readonly string[], saved: readonly string[]): string[] {
  const named = new Set(saved);
  const fresh = [...new Set(keys)].filter((key) => !named.has(key));
  return [...fresh, ...named];
}
