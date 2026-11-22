// Which sidebar rows are folded, kept across reloads where the platform has localStorage (web,
// Electron). Native apps keep it for the session only, as before. Keys are row keys (host-scoped
// refs) plus a few fixed section names, so one set serves the tree and the General section.
import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "atrium.sidebar.collapsed.v1";
/** Oldest entries go first past this: rows of projects long removed should not pile up. */
export const MAX_COLLAPSED = 500;

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

/** Saved text to keys; anything malformed reads as nothing folded. */
export function parseCollapsed(text: string | null): ReadonlySet<string> {
  if (!text) return new Set();
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((k): k is string => typeof k === "string").slice(-MAX_COLLAPSED));
  } catch {
    return new Set();
  }
}

function read(): ReadonlySet<string> {
  try {
    return parseCollapsed(storage()?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return new Set();
  }
}

let collapsed: ReadonlySet<string> = read();
const listeners = new Set<() => void>();

function set(next: ReadonlySet<string>) {
  collapsed = next;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify([...next].slice(-MAX_COLLAPSED)));
  } catch {
    // Quota or private mode: the in-memory set still works.
  }
  for (const listener of [...listeners]) listener();
}

export function toggleCollapsed(key: string): void {
  const next = new Set(collapsed);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  set(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const get = () => collapsed;

export function useCollapsed(): [ReadonlySet<string>, (key: string) => void] {
  const value = useSyncExternalStore(subscribe, get, get);
  return [value, useCallback((key: string) => toggleCollapsed(key), [])];
}
