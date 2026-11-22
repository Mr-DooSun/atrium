// What state a pane is in, derived from the snapshot and the server's answers (U-4, R-4). Pure: no
// React or react-native, so tests import it directly.
import type { UnavailableReason } from "./timeline";

/**
 * Whether the pane's session is gone, and why. The server's word (`refused`, from a send) wins;
 * otherwise a session that has been missing from its host's snapshot long enough (`missing`, see
 * useMissingAgent) counts as gone without a known reason ("removed"). Present in the snapshot and
 * not refused: not gone.
 */
export function paneGone(input: {
  refused: UnavailableReason | null;
  present: boolean;
  missing: boolean;
}): UnavailableReason | null {
  if (input.refused) return input.refused;
  if (input.present) return null;
  return input.missing ? "removed" : null;
}

/** The host-refused notice shows only for a session that is not gone (gone has its own notice). */
export function showHostRefused(hostRefused: boolean, gone: UnavailableReason | null): boolean {
  return hostRefused && gone === null;
}

/**
 * The pane's title: a gone session keeps the last title it had; without one, the state's own words
 * (`goneTitles`). A live session shows its title, or `untitled`.
 */
export function paneTitle(input: {
  gone: UnavailableReason | null;
  title: string | null | undefined;
  lastTitle: string | null;
  untitled: string;
  goneTitles: { archived: string; removed: string };
}): string {
  if (input.gone) return input.lastTitle ?? input.goneTitles[input.gone];
  return input.title || input.untitled;
}
