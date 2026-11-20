import type { PluginSidebarViewProps } from "@getpaseo/plugin/client";
import type { WorktreeInfo } from "../shared/project-rpc";

// Geometry and colors taken from Paseo's own sidebar (packages/app, sidebar-workspace-list,
// sidebar-workspace-row-content, status-ring, identity-colors) so the plugin view reads as the
// same sidebar. The plugin theme exposes fewer tokens than the app, so the status dot band is
// chosen here by the theme's brightness.

export type Bucket = "needs_input" | "failed" | "running" | "attention" | "done";

/** Title line box; the status slot shares it so marks centre on the first line. */
export const TITLE_LINE = 20;
/** Paseo's own row rhythm. gap: between rows; lineGap: between a row's title and meta lines. */
export const ROW = { minHeight: 36, paddingVertical: 8, gap: 2, lineGap: 4 } as const;
/** Project header: gap before its first session, and between project blocks. */
export const PROJECT = { gapBelow: 4, blockGap: 12 } as const;
/** rail: where depth-0 rows start (Paseo's rowIndented); step: each nesting level. */
/** Every level, the first included, sits one equal step further in than its parent. */
export const INDENT = { step: 24 } as const;
/**
 * Tree connectors. Column 0 runs down from the project chevron's centre (x 16); column c+1 from the
 * status mark of the row at depth c. The elbow meets a row at its title line's centre.
 */
export const CONNECT = { x0: 16, elbowY: ROW.paddingVertical + TITLE_LINE / 2 } as const;

/** x of connector column c: 0 is the project chevron's centre, c >= 1 the status-slot centre
 *  of the row at depth c-1. One step apart, so every level is indented the same. */
export function connectorX(column: number): number {
  return CONNECT.x0 + column * INDENT.step;
}

/** Left edge of the leading slot of a row at this depth. */
export function slotX(depth: number): number {
  // The slot is 16 wide, so its centre lands on the next connector column.
  return connectorX(depth + 1) - 8;
}

/** What a session row shows for its git worktree; see `worktreeBadge`. */
export interface WorktreeBadgeSpec {
  /** "linked": a linked worktree, told apart by color. "quiet": the main checkout, off its default branch. */
  tone: "quiet" | "linked";
  /** The branch, or the short commit when detached (never empty). */
  label: string;
  /** The worktree's folder name for a linked worktree; null for the main checkout. */
  folder: string | null;
  detached: boolean;
}

const lastSegment = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * Whether a session row gets a worktree badge, and what it says. No badge outside git, and none on
 * the main checkout when it sits on the default branch (or the default is unknown), unless it is
 * detached, so only what stands out is shown. A linked worktree always has one.
 */
export function worktreeBadge(info: WorktreeInfo | null | undefined): WorktreeBadgeSpec | null {
  if (!info || info.kind !== "git") return null;
  const label = info.detached ? (info.head ?? "HEAD") : (info.branch ?? info.head ?? "HEAD");
  if (!info.isMain) {
    return { tone: "linked", label, folder: lastSegment(info.worktreePath), detached: info.detached };
  }
  // A detached main checkout always shows, even when the default branch is unknown.
  if (info.detached) return { tone: "quiet", label, folder: null, detached: true };
  if (info.defaultBranch === null || info.branch === info.defaultBranch) return null;
  return { tone: "quiet", label, folder: null, detached: false };
}

type Colors = PluginSidebarViewProps["theme"]["colors"];

export interface Palette {
  background: string;
  foreground: string;
  muted: string;
  idle: string;
  guide: string;
  hover: string;
  pressed: string;
  selected: string;
  running: string;
  warning: string;
  danger: string;
  success: string;
  /** Colors a git worktree is told apart by; see `worktreeColor`. */
  worktrees: readonly string[];
}

const DOT = {
  dark: { success: "#35c264", danger: "#f7796d", warning: "#db932e", running: "#5caaf6" },
  light: { success: "#299f51", danger: "#f12e2f", warning: "#b37824", running: "#268ae0" },
} as const;

/** Eight hues, spaced apart, none of them the status colors' exact green/red/amber. */
const WORKTREE = {
  dark: ["#7aa2f7", "#bb9af7", "#e0af68", "#73daca", "#f7768e", "#9ece6a", "#ff9e64", "#7dcfff"],
  light: ["#3b6fd4", "#8c4fd0", "#a8741a", "#1b8f7e", "#d03a5b", "#4f8a1c", "#cc5a14", "#1c82b0"],
} as const;

/** The same worktree always gets the same color: a hash of its path picks from the palette. */
export function worktreeColor(p: Palette, worktreePath: string): string {
  let h = 2166136261;
  for (let i = 0; i < worktreePath.length; i++) h = Math.imul(h ^ worktreePath.charCodeAt(i), 16777619);
  return p.worktrees[(h >>> 0) % p.worktrees.length];
}

export function palette(c: Colors): Palette {
  const dark = isDark(c.surface0);
  const dot = dark ? DOT.dark : DOT.light;
  return {
    background: c.surface0,
    foreground: c.foreground,
    muted: c.foregroundMuted,
    idle: c.foregroundMuted,
    guide: c.border,
    hover: c.surface1,
    pressed: c.surface2,
    selected: c.surface2,
    running: dot.running,
    warning: dot.warning,
    danger: dot.danger,
    success: dot.success,
    worktrees: dark ? WORKTREE.dark : WORKTREE.light,
  };
}

/** Reads rgb, rgba, rrggbb or rrggbbaa hex (the # is optional) and rgb()/rgba() (comma, space or slash separated); alpha is ignored. */
function parseRgb(color: string): [number, number, number] | null {
  const text = color.trim();
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (hex) {
    const h = hex[1];
    const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
    return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(text);
  if (!fn) return null;
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  if (parts.length < 3) return null;
  const channels = parts.map((part) => {
    const n = parseFloat(part);
    if (!Number.isFinite(n)) return NaN;
    return Math.max(0, Math.min(255, part.endsWith("%") ? (n / 100) * 255 : n));
  });
  return channels.some(Number.isNaN) ? null : (channels as [number, number, number]);
}

/** Dark unless the color is readable and bright; a value this cannot read counts as dark. */
export function isDark(color: string): boolean {
  const rgb = parseRgb(color);
  if (!rgb) return true;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 128;
}
