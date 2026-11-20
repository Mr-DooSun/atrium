// The open panes, kept at module level so they survive the screen unmounting and remounting,
// and mirrored to localStorage where the platform has it (web, Electron).
import { useSyncExternalStore } from "react";
import { clampPaneWidth, parsePaneWidths, parsePanes, serializePanes, type PaneRef } from "./layout";

const STORAGE_KEY = "atrium.panes.v1";

interface MaybeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): MaybeStorage | null {
  try {
    const s = (globalThis as { localStorage?: MaybeStorage }).localStorage;
    return s && typeof s.getItem === "function" ? s : null;
  } catch {
    return null;
  }
}

const saved = storage()?.getItem(STORAGE_KEY);
let panes: readonly PaneRef[] = parsePanes(saved);
/** Custom widths by pane key; panes without one use the screen's default width. */
let widths: ReadonlyMap<string, number> = parsePaneWidths(saved);
const listeners = new Set<() => void>();

function persist() {
  try {
    storage()?.setItem(STORAGE_KEY, serializePanes(panes, widths));
  } catch {
    // Quota or private mode: the in-memory list still works.
  }
  for (const listener of [...listeners]) listener();
}

export function getPanes(): readonly PaneRef[] {
  return panes;
}

export function setPanes(next: readonly PaneRef[] | ((prev: readonly PaneRef[]) => readonly PaneRef[])): void {
  const value = typeof next === "function" ? next(panes) : next;
  if (value === panes) return;
  panes = value;
  persist();
}

export function getPaneWidths(): ReadonlyMap<string, number> {
  return widths;
}

/** Sets a pane's custom width (clamped), or resets it to the default with null. */
export function setPaneWidth(key: string, width: number | null): void {
  const clamped = width === null ? null : clampPaneWidth(width);
  if ((widths.get(key) ?? null) === clamped) return;
  const next = new Map(widths);
  if (clamped === null) next.delete(key);
  else next.set(key, clamped);
  widths = next;
  persist();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePanes(): readonly PaneRef[] {
  return useSyncExternalStore(subscribe, getPanes, getPanes);
}

export function usePaneWidths(): ReadonlyMap<string, number> {
  return useSyncExternalStore(subscribe, getPaneWidths, getPaneWidths);
}
