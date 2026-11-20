// Pure logic of the plugin store screen: no React, no react-native, no Paseo UI kit, so tests can
// import it directly. The screen files (plugins-screen, store, source-form, ui, action-flow)
// import from here.
import {
  ECOSYSTEM_CAPS,
  type CatalogPlugin,
  type CatalogSort,
  type Ecosystem,
  type InstalledPlugin,
  type PluginAction,
  type PluginSourceInput,
  type PluginSourceKind,
} from "../../shared/toolbox/types";
import type { Palette } from "../look";

// ---- Tracked actions (progress on the item an action is about) --------------------------------

/** What a tracked action does to its item, for the item's own progress line. */
export type ActivityKind = "install" | "update" | "remove" | "enable" | "disable";

/** One tracked action: running, or failed and waiting for retry/dismiss. `flow` is what a retry
 *  starts again; the reducer only carries it. */
export interface Tracked<F> {
  kind: ActivityKind;
  state: "running" | "failed";
  error: string | null;
  flow: F;
}

export type TrackState<F> = Readonly<Record<string, Tracked<F>>>;

export type TrackEvent<F> =
  /** The run started (after confirmation): idle/failed → running. */
  | { type: "start"; key: string; kind: ActivityKind; flow: F }
  /** Every target succeeded: the entry goes away. */
  | { type: "done"; key: string }
  /** Some target failed: running → failed, with the first error. */
  | { type: "fail"; key: string; kind: ActivityKind; error: string; flow: F }
  /** Retry: the failure is cleared and the caller starts `flow` again (through preview/confirm,
   *  so nothing runs until the user confirms; "start" follows when it does). */
  | { type: "retry"; key: string }
  /** The user put the failure away. */
  | { type: "dismiss"; key: string };

export function trackReducer<F>(prev: TrackState<F>, event: TrackEvent<F>): TrackState<F> {
  switch (event.type) {
    case "start":
      return { ...prev, [event.key]: { kind: event.kind, state: "running", error: null, flow: event.flow } };
    case "fail":
      return { ...prev, [event.key]: { kind: event.kind, state: "failed", error: event.error, flow: event.flow } };
    case "done":
    case "retry":
    case "dismiss": {
      if (!(event.key in prev)) return prev;
      const next = { ...prev };
      delete next[event.key];
      return next;
    }
  }
}

/** Which tracked action belongs to which card: one plugin in one place (a profile, "*" = all). */
export function trackKey(ecosystem: Ecosystem, profileId: string | null, pluginId: string): string {
  return `${ecosystem}:${profileId ?? "paseo"}:${pluginId}`;
}

export const ACTIVITY_OF: Record<PluginAction, ActivityKind> = {
  install: "install",
  update: "update",
  uninstall: "remove",
  enable: "enable",
  disable: "disable",
};

/** Install scopes that write into the project, so they need the agent's project directory. */
export const PROJECT_SCOPES: readonly string[] = ["project", "local"];

// ---- Installed list: search, state filters, sort ----------------------------------------------

export type InstalledFilter = "all" | "updates" | "enabled" | "disabled" | "errors";
export type InstalledSort = "name" | "attention";

/** The facts the installed filters look at, for one card (one plugin, or one plugin across profiles). */
export interface Facts {
  name: string;
  /** Lowercased text the search matches against. */
  text: string;
  update: boolean;
  enabled: boolean;
  disabled: boolean;
  error: boolean;
}

export const FILTERS: Record<InstalledFilter, (f: Facts) => boolean> = {
  all: () => true,
  updates: (f) => f.update,
  enabled: (f) => f.enabled,
  disabled: (f) => f.disabled,
  errors: (f) => f.error,
};

/** Lower comes first under "needs attention": errors, then updates, then disabled, then the rest. */
export const attention = (f: Pick<Facts, "error" | "update" | "disabled">) => (f.error ? 0 : f.update ? 1 : f.disabled ? 2 : 3);

export const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

export interface InstalledViewResult<T> {
  /** The filter in effect: the asked one, or "all" when it matches nothing. */
  filter: InstalledFilter;
  counts: Record<InstalledFilter, number>;
  shown: T[];
  total: number;
}

/** Search, filter and sort over a complete (unpaged) list. A filter whose count dropped to 0
 *  (after an update, say) falls back to "all". */
export function installedView<T>(
  items: readonly T[],
  facts: (item: T) => Facts,
  filter: InstalledFilter,
  query: string,
  sort: InstalledSort,
): InstalledViewResult<T> {
  const all = items.map((item) => ({ item, f: facts(item) }));
  const counts = Object.fromEntries(
    (Object.keys(FILTERS) as InstalledFilter[]).map((k) => [k, all.filter(({ f }) => FILTERS[k](f)).length]),
  ) as Record<InstalledFilter, number>;
  const needle = query.trim().toLowerCase();
  const active: InstalledFilter = counts[filter] > 0 ? filter : "all";
  const shown = all
    .filter(({ f }) => FILTERS[active](f) && (!needle || f.text.includes(needle)))
    .sort((a, b) => (sort === "attention" ? attention(a.f) - attention(b.f) : 0) || byName(a.f.name, b.f.name))
    .map(({ item }) => item);
  return { filter: active, counts, shown, total: items.length };
}

export function pluginFacts(plugin: InstalledPlugin): Facts {
  return {
    name: plugin.name,
    text: [plugin.name, plugin.id, plugin.description, plugin.marketplace].filter(Boolean).join(" ").toLowerCase(),
    update: !!plugin.updateTo,
    enabled: plugin.enabled === true,
    disabled: plugin.enabled === false,
    error: !!plugin.error,
  };
}

/** One plugin id across the profiles of one kind. */
export interface PluginRow {
  id: string;
  name: string;
  marketplace: string | null;
  description: string | null;
  source: string | null;
  /** profile id -> that profile's entry. */
  entries: Map<string, InstalledPlugin>;
}

/** A plugin across profiles counts for a filter when any profile's install does. */
export function rowFacts(row: PluginRow): Facts {
  const entries = [...row.entries.values()];
  return {
    name: row.name,
    text: [row.name, row.id, row.description, row.marketplace].filter(Boolean).join(" ").toLowerCase(),
    update: entries.some((x) => !!x.updateTo),
    enabled: entries.some((x) => x.enabled === true),
    disabled: entries.some((x) => x.enabled === false),
    error: entries.some((x) => !!x.error),
  };
}

/** Sorts the ecosystem's catalog can really do (the first is the default). A sort whose key the
 *  source never reports would only be name order under another label, so it is not offered. */
export function catalogSorts(ecosystem: Ecosystem): readonly CatalogSort[] {
  const sorts = ECOSYSTEM_CAPS[ecosystem].sorts;
  return sorts.length > 0 ? sorts : ["name"];
}

// ---- Card metadata ---------------------------------------------------------------------------

/** A plugin's picture as a catalog may give it: an image URL or inline SVG. */
export type PluginPicture = { kind: "url"; url: string } | { kind: "svg"; svg: string };

/** What a card shows beyond name and description. Every field may be missing in a catalog. */
export interface StoreMeta {
  picture: PluginPicture | null;
  author: string | null;
  /** Latest version the source offers (catalog) or the installed one (installed list). */
  version: string | null;
  /** Version on this profile, for a catalog entry that is installed. */
  installedVersion: string | null;
  /** Version or revision an update would bring. */
  updateTo: string | null;
  homepage: string | null;
  categories: readonly string[];
  license: string | null;
  installs: number | null;
  featured: boolean;
  /** ISO date of the catalog's last update. */
  updatedAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const https = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https:\/\//i.test(s) ? s : null;
};

/** Store fields both lists carry (all optional; validated again here: https only, finite counts). */
function meta(o: Record<string, unknown>): StoreMeta {
  const categories = Array.isArray(o.categories) ? o.categories.filter((c): c is string => typeof c === "string" && !!c.trim()) : [];
  const iconUrl = https(o.iconUrl);
  return {
    picture: iconUrl ? { kind: "url", url: iconUrl } : null,
    author: str(o.author),
    version: str(o.version),
    installedVersion: str(o.installedVersion),
    updateTo: str(o.updateTo),
    homepage: https(o.homepage),
    categories,
    license: str(o.license),
    installs: typeof o.installs === "number" && Number.isFinite(o.installs) ? o.installs : null,
    featured: o.featured === true,
    updatedAt: str(o.updatedAt),
  };
}

export const catalogMeta = (plugin: CatalogPlugin): StoreMeta => meta(plugin);
export const installedMeta = (plugin: InstalledPlugin): StoreMeta => meta(plugin);

/** "v1.2.0", or a short commit as is. */
export function versionText(v: string): string {
  return /^[0-9a-f]{7,40}$/.test(v) ? v.slice(0, 7) : /^\d/.test(v) ? `v${v}` : v;
}

// ---- Avatar ----------------------------------------------------------------------------------

/** Initials of a plugin name: "Account Switcher" -> "AS", "ado" -> "A". */
export function initials(name: string): string {
  const words = name
    .replace(/[-_./:@]+/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  const letters = words.slice(0, 2).map((w) => [...w.replace(/[^\p{L}\p{N}]/gu, "")][0] ?? "");
  return (letters.join("") || [...name][0] || "?").toUpperCase();
}

/** Same name, same hue: a hash of the name picks from the theme's distinct colors. */
export function avatarColor(p: Pick<Palette, "muted" | "worktrees">, name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const colors = p.worktrees;
  return colors[(h >>> 0) % colors.length] ?? p.muted;
}

// ---- Install from source ---------------------------------------------------------------------

export interface SourceForm {
  kind: PluginSourceKind;
  value: string;
  ref: string;
  version: string;
  path: string;
  plugin: string;
  scope: string | null;
}

const clean = (v: string) => (v.trim() ? v.trim() : null);

/** Antigravity installs a repo or folder as is: no ref, version or subfolder. */
export const takesExtras = (ecosystem: Ecosystem) => ecosystem !== "antigravity";

/** The RPC input for a filled form; fields the kind (or the ecosystem) does not take are null. */
export function toInput(form: SourceForm, extras: boolean): PluginSourceInput {
  return {
    kind: form.kind,
    value: form.value.trim(),
    ref: extras && form.kind === "git" ? clean(form.ref) : null,
    version: extras && form.kind === "npm" ? clean(form.version) : null,
    path: extras && (form.kind === "git" || form.kind === "npm") ? clean(form.path) : null,
    plugin: form.kind === "marketplace" ? clean(form.plugin) : null,
    scope: form.scope,
  };
}

/** Light shape checks so obvious mistakes are caught in the form; the daemon validates for real. */
export function valueOk(kind: PluginSourceKind, value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 2048) return false;
  switch (kind) {
    case "local":
      return v.startsWith("/") || /^[A-Za-z]:[\\/]/.test(v);
    case "npm":
      return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*-]+)?$/i.test(v);
    default:
      return !/\s/.test(v);
  }
}
