// The open panes, kept at module level so they survive the screen unmounting and remounting,
// and mirrored to localStorage where the platform has it (web, Electron).
import { useSyncExternalStore } from "react";
import { parsePanes, serializePanes, type PaneRef } from "./layout";

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

let panes: readonly PaneRef[] = parsePanes(storage()?.getItem(STORAGE_KEY));
const listeners = new Set<() => void>();

export function getPanes(): readonly PaneRef[] {
  return panes;
}

export function setPanes(next: readonly PaneRef[] | ((prev: readonly PaneRef[]) => readonly PaneRef[])): void {
  const value = typeof next === "function" ? next(panes) : next;
  if (value === panes) return;
  panes = value;
  try {
    storage()?.setItem(STORAGE_KEY, serializePanes(value));
  } catch {
    // Quota or private mode: the in-memory list still works.
  }
  for (const listener of [...listeners]) listener();
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
