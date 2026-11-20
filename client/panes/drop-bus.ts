// A tiny module-level bus that carries a session drag from the sidebar into the panes screen.
// The two live in different React trees (sidebar view vs. screen), so they meet here instead of
// through context. The core is plain TypeScript; only `useSessionDrag` touches React.
//
// Coordinates are page coordinates (React Native `pageX`/`pageY`, the same space as
// `View.measureInWindow`).
import { useSyncExternalStore } from "react";
import type { AgentRef } from "@getpaseo/plugin/client";

export interface SessionDragPayload {
  kind: "atrium.session";
  agent: AgentRef;
  title?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DropZone {
  id: string;
  measure(): Promise<Rect | null>;
  onDrop(p: SessionDragPayload, at: { x: number; y: number }): void;
  onHover?(p: SessionDragPayload | null, at?: { x: number; y: number }): void;
}

const zones = new Map<string, DropZone>();
let current: SessionDragPayload | null = null;
/** Zone rects measured when the drag began, refreshed while it moves. */
let rects = new Map<string, Rect>();
let hovered: string | null = null;
let measuring = false;
const dragListeners = new Set<() => void>();
const openListeners = new Set<(p: SessionDragPayload) => void>();

function notifyDrag() {
  for (const listener of [...dragListeners]) listener();
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** The zone under the point; the most recently registered wins when zones overlap. */
function zoneAt(measured: ReadonlyMap<string, Rect>, x: number, y: number): DropZone | null {
  const ids = [...zones.keys()].reverse();
  for (const id of ids) {
    const rect = measured.get(id);
    if (rect && contains(rect, x, y)) return zones.get(id) ?? null;
  }
  return null;
}

async function measureAll(): Promise<Map<string, Rect>> {
  const out = new Map<string, Rect>();
  await Promise.all(
    [...zones.values()].map(async (zone) => {
      try {
        const rect = await zone.measure();
        if (rect && rect.width > 0 && rect.height > 0) out.set(zone.id, rect);
      } catch {
        // A zone that can't measure itself just can't take the drop.
      }
    }),
  );
  return out;
}

function refreshRects() {
  if (measuring) return;
  measuring = true;
  void measureAll().then((next) => {
    measuring = false;
    if (current) rects = next;
  });
}

function setHovered(next: DropZone | null, at?: { x: number; y: number }) {
  const prevId = hovered;
  hovered = next?.id ?? null;
  if (prevId && prevId !== hovered) zones.get(prevId)?.onHover?.(null);
  if (next && current) next.onHover?.(current, at);
}

export function registerDropZone(zone: DropZone): () => void {
  zones.set(zone.id, zone);
  if (current) refreshRects();
  return () => {
    if (zones.get(zone.id) !== zone) return;
    zones.delete(zone.id);
    rects.delete(zone.id);
    if (hovered === zone.id) hovered = null;
  };
}

export function hasDropZones(): boolean {
  return zones.size > 0;
}

export function beginSessionDrag(p: SessionDragPayload): void {
  current = p;
  rects = new Map();
  hovered = null;
  refreshRects();
  notifyDrag();
}

let moves = 0;
export function moveSessionDrag(pageX: number, pageY: number): void {
  if (!current) return;
  // Zones scroll and resize; re-measure now and then rather than on every frame.
  if (++moves % 10 === 0) refreshRects();
  setHovered(zoneAt(rects, pageX, pageY), { x: pageX, y: pageY });
}

export async function endSessionDrag(pageX: number | null, pageY: number | null): Promise<boolean> {
  const payload = current;
  if (!payload) return false;
  let accepted = false;
  if (pageX !== null && pageY !== null) {
    // Measure fresh: the cached rects may be stale or still pending.
    const zone = zoneAt(await measureAll(), pageX, pageY);
    if (zone) {
      try {
        zone.onDrop(payload, { x: pageX, y: pageY });
        accepted = true;
      } catch {
        accepted = false;
      }
    }
  }
  setHovered(null);
  current = null;
  rects = new Map();
  moves = 0;
  notifyDrag();
  return accepted;
}

export function getSessionDrag(): SessionDragPayload | null {
  return current;
}

export function subscribeSessionDrag(listener: () => void): () => void {
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
  };
}

/** The drag in progress, or null. */
export function useSessionDrag(): SessionDragPayload | null {
  return useSyncExternalStore(subscribeSessionDrag, getSessionDrag, getSessionDrag);
}

/**
 * Non-drag fallback (mobile, keyboard, accessibility): ask the panes screen to open a session.
 * Queued until a listener shows up, so it works even when the screen opens afterwards.
 */
const pending: SessionDragPayload[] = [];
export function openInPanes(p: SessionDragPayload): void {
  if (openListeners.size === 0) {
    pending.push(p);
    return;
  }
  for (const listener of [...openListeners]) listener(p);
}

export function onOpenInPanes(listener: (p: SessionDragPayload) => void): () => void {
  openListeners.add(listener);
  while (pending.length > 0) listener(pending.shift()!);
  return () => {
    openListeners.delete(listener);
  };
}

/** Test helper: forget every zone, listener and drag. */
export function resetDropBus(): void {
  zones.clear();
  rects = new Map();
  current = null;
  hovered = null;
  measuring = false;
  moves = 0;
  pending.length = 0;
  dragListeners.clear();
  openListeners.clear();
}
