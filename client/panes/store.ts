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

function readSaved(): string | null {
  try {
    return storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // Storage access can throw (blocked cookies, sandboxed frames): start empty.
    return null;
  }
}

const saved = readSaved();
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
  // A closed pane forgets its width, in memory as on disk (serializePanes only writes open
  // panes): otherwise reopening it would bring the old width back before a reload but not after.
  const open = new Set(value.map((p) => p.key));
  if ([...widths.keys()].some((key) => !open.has(key))) {
    widths = new Map([...widths].filter(([key]) => open.has(key)));
  }
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

/**
 * Another window of the same app (Electron, a second browser tab) saved its panes: take them, so
 * this window's next save doesn't bring back panes closed there (or drop ones opened there).
 */
function onStorage(event: { key?: string | null; newValue?: string | null }) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  const text = event.key === null ? readSaved() : (event.newValue ?? null);
  if (text === serializePanes(panes, widths)) return;
  panes = parsePanes(text);
  widths = parsePaneWidths(text);
  for (const listener of [...listeners]) listener();
}

type EventTarget = {
  addEventListener?(type: string, listener: (event: never) => void): void;
  removeEventListener?(type: string, listener: (event: never) => void): void;
};

/**
 * Follows other windows' saves until the returned function is called (the plugin's cleanup).
 * A no-op where there are no window events or no storage (native: one window only).
 */
export function watchOtherWindows(): () => void {
  const target = globalThis as EventTarget;
  try {
    if (typeof target.addEventListener !== "function" || !storage()) return () => {};
    target.addEventListener("storage", onStorage);
  } catch {
    return () => {};
  }
  return () => {
    try {
      target.removeEventListener?.("storage", onStorage);
    } catch {
      // Window already gone.
    }
  };
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
