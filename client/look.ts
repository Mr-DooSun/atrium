import type { PluginSidebarViewProps } from "@getpaseo/plugin/client";

// Geometry and colors taken from Paseo's own sidebar (packages/app, sidebar-workspace-list,
// sidebar-workspace-row-content, status-ring, identity-colors) so the plugin view reads as the
// same sidebar. The plugin theme exposes fewer tokens than the app, so the status dot band is
// chosen here by the theme's brightness.

export type Bucket = "needs_input" | "failed" | "running" | "attention" | "done";

/** Title line box; the status slot shares it so marks centre on the first line. */
export const TITLE_LINE = 20;
/** Paseo's own row rhythm. gap: between rows; lineGap: between a row's title and meta lines. */
export const ROW = { minHeight: 36, paddingVertical: 8, gap: 2, lineGap: 4 } as const;
/** Gap after the header, and spacing and divider inset between project blocks. */
export const PROJECT = { gapBelow: 4, blockGap: 12, dividerInset: 8 } as const;
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

type Theme = PluginSidebarViewProps["theme"];
type Colors = Theme["colors"];

export interface ProjectAppearance {
  accent: string;
  rail: string;
  divider: string;
}

const PROJECT_ACCENTS = [
  { light: "#a12646", dark: "#ffa1b5" },
  { light: "#a33827", dark: "#ffa68e" },
  { light: "#87511b", dark: "#f7bb78" },
  { light: "#726017", dark: "#e3ca6b" },
  { light: "#53651c", dark: "#c2d57e" },
  { light: "#226944", dark: "#8adeae" },
  { light: "#126967", dark: "#83dad4" },
  { light: "#19647f", dark: "#85d3f0" },
  { light: "#2b50a0", dark: "#a0beff" },
  { light: "#5b40ab", dark: "#c5b5ff" },
  { light: "#7e3a9b", dark: "#dfadf7" },
  { light: "#943670", dark: "#f6aad9" },
] as const;

/** Derive a project color from its root folder key, independent of display order and session state. */
export function projectAppearance(projectFolderKey: string, theme: Theme): ProjectAppearance {
  // FNV-1a over the folder key's UTF-16 code units.
  let hash = 2166136261;
  for (let i = 0; i < projectFolderKey.length; i++) {
    hash = Math.imul(hash ^ projectFolderKey.charCodeAt(i), 16777619);
  }

  const colors = PROJECT_ACCENTS[(hash >>> 0) % PROJECT_ACCENTS.length];
  const accent = isDark(theme.colors.surface0) ? colors.dark : colors.light;
  return { accent, rail: `${accent}a6`, divider: theme.colors.border };
}

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
}

const DOT = {
  dark: { success: "#35c264", danger: "#f7796d", warning: "#db932e", running: "#5caaf6" },
  light: { success: "#299f51", danger: "#f12e2f", warning: "#b37824", running: "#268ae0" },
} as const;

export function palette(c: Colors): Palette {
  const dot = isDark(c.surface0) ? DOT.dark : DOT.light;
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
  };
}

function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 128;
}
