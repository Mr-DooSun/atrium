import { z } from "zod";
import type { AuthState, CatalogPlugin, InstalledPlugin, Marketplace, McpServer } from "../../../shared/toolbox/types";
import type { CatalogResult } from "../../core/adapter";
import { plain } from "../../core/exec.ts";
import { safeHttpsUrl } from "../../core/source.ts";

export function parseAuth(text: string): AuthState {
  const data = z.object({
    loggedIn: z.boolean(), authMethod: z.string().nullish(),
    email: z.string().nullish(), orgName: z.string().nullish(),
  }).parse(JSON.parse(text));
  return {
    state: data.loggedIn ? "logged_in" : "logged_out", method: data.authMethod ?? null,
    account: data.loggedIn ? data.email ?? data.orgName ?? null : null, detail: null,
  };
}

// A URL may contain basic auth, signed query parameters or fragments.
export function displaySource(source: string): string {
  try {
    const url = new URL(source);
    if (url.host) return url.protocol + "//" + url.host + url.pathname;
  } catch { /* Local paths and owner/repo are valid sources. */ }
  return source;
}

function status(value: string): McpServer["status"] {
  const label = value.replace(/^[^a-z]+/i, "").toLowerCase().split(/\s+[—-]\s+/)[0].trim();
  switch (label) {
    case "connected": return "connected";
    case "failed to connect": case "failed": return "failed";
    case "needs auth": case "needs authentication": return "needs_auth";
    case "pending approval": return "pending";
    case "disabled": return "disabled";
    default: return "unknown";
  }
}

export function parseMcpList(text: string): McpServer[] {
  return plain(text).split("\n").flatMap(line => {
    const match = /^(.+?): (.*?) - ([^\n]+)$/.exec(line);
    if (!match) return [];
    const transport = /\((HTTP|SSE|WebSocket)\)$/i.exec(match[2])?.[1].toLowerCase() ?? null;
    return [{ name: match[1], status: status(match[3]), transport, scope: null, target: null, detail: null }];
  });
}

export function failureReason(stdout: string, stderr: string, secrets: string[]): string | null {
  const lines = plain(stdout + "\n" + stderr).trim().split("\n");
  let message: string | undefined;
  for (const line of lines.reverse()) {
    try {
      const data = JSON.parse(line);
      const reason = data?.error?.message ?? data?.error ?? data?.message;
      if (typeof reason === "string" && reason.trim()) { message = reason; break; }
    } catch { /* Plain stderr is handled below. */ }
  }
  message ??= plain(stderr).trim().split("\n").find(line => line.trim() && !/[{}]/.test(line));
  if (!message) return null;
  for (const value of secrets.filter(value => value.length >= 4).sort((a, b) => b.length - a.length)) {
    message = message.replaceAll(value, "***");
  }
  return message.replace(/https?:\/\/[^\s"']+/gi, displaySource)
    .replace(/\bBearer\s+\S+/gi, "Bearer ***")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "***")
    .replace(/\b(?:sk-[\w-]+|gh[pousr]_\w+|npm_\w+)\b/g, "***")
    .slice(0, 1000);
}

const installedSchema = z.array(z.object({
  id: z.string(), enabled: z.boolean().optional(), version: z.string().optional(), scope: z.string().optional(),
  installPath: z.string().optional(), description: z.string().optional(),
}));

export function parseInstalled(data: unknown): InstalledPlugin[] {
  return installedSchema.parse(data).map(p => {
    const [name, market] = p.id.split("@");
    return { id: p.id, name, marketplace: market ?? null, version: p.version ?? null,
      enabled: p.enabled ?? null, source: p.installPath ?? null, description: p.description ?? null,
      status: null, error: null, scope: p.scope ?? null };
  });
}

const sourceSchema = z.union([z.string(), z.object({
  url: z.string().optional(), repo: z.string().optional(), path: z.string().optional(),
  package: z.string().optional(), source: z.string().optional(),
})]);

/** Store metadata a marketplace manifest declares for one plugin ("name@marketplace"). */
export interface ManifestMeta {
  author: string | null;
  homepage: string | null;
  license: string | null;
  version: string | null;
  categories: string[];
}

const text = (value: unknown, max = 200) =>
  typeof value === "string" && value.trim() ? plain(value).trim().slice(0, max) : null;

/** Reads `.claude-plugin/marketplace.json` contents; unknown shapes are skipped, never thrown. */
export function parseManifestMeta(manifest: unknown, market: string, into = new Map<string, ManifestMeta>()) {
  const plugins = (manifest as { plugins?: unknown })?.plugins;
  if (!Array.isArray(plugins)) return into;
  for (const raw of plugins) {
    const p = raw as Record<string, unknown>;
    const name = text(p?.name);
    if (!name) continue;
    const author = p.author as { name?: unknown } | string | undefined;
    const tags = [p.category, ...(Array.isArray(p.tags) ? p.tags : []), ...(Array.isArray(p.keywords) ? p.keywords : [])];
    const categories = p.category ? [text(p.category, 40)].filter((c): c is string => !!c) : [];
    // Tags only fill in when no category is declared, so the chip list stays short.
    if (!categories.length) {
      for (const t of tags) {
        const c = text(t, 40);
        if (c && !categories.includes(c) && categories.length < 3) categories.push(c);
      }
    }
    into.set(`${name}@${market}`, {
      author: text(typeof author === "string" ? author : author?.name),
      homepage: safeHttpsUrl(p.homepage),
      license: text(p.license, 60),
      version: text(p.version, 60),
      categories: categories.map((c) => c.toLowerCase()),
    });
  }
  return into;
}

export function parseCatalog(data: unknown, marketData: unknown, meta = new Map<string, ManifestMeta>()): CatalogResult {
  const { installed, available } = z.object({
    installed: installedSchema, available: z.array(z.object({
      pluginId: z.string(), name: z.string(), marketplaceName: z.string(),
      description: z.string().nullish(), source: sourceSchema.nullish(), category: z.string().nullish(),
      version: z.string().nullish(), installCount: z.number().nullish(),
    })),
  }).parse(data);
  const plugins = new Map<string, CatalogPlugin>();
  const installedVersions = new Map<string, string | null>();
  for (const p of parseInstalled(installed)) {
    installedVersions.set(p.id, p.version);
    const m = meta.get(p.id);
    plugins.set(p.id, { id: p.id, name: p.name, description: p.description, marketplace: p.marketplace,
      source: null, categories: m?.categories ?? [], installed: true, installedVersion: p.version,
      version: m?.version ?? null, author: m?.author ?? null, homepage: m?.homepage ?? null, license: m?.license ?? null,
      installs: null, iconUrl: null });
  }
  for (const p of available) {
    const s = p.source;
    const source = typeof s === "string" ? s : s?.url ?? s?.repo ?? s?.package ?? s?.path ?? s?.source;
    const m = meta.get(p.pluginId);
    const isInstalled = installedVersions.has(p.pluginId);
    plugins.set(p.pluginId, { id: p.pluginId, name: p.name, description: p.description ?? null,
      marketplace: p.marketplaceName, source: source ? displaySource(source) : null,
      categories: p.category ? [p.category.toLowerCase()] : m?.categories ?? [], installed: isInstalled,
      installedVersion: isInstalled ? installedVersions.get(p.pluginId) ?? null : null,
      version: p.version ?? m?.version ?? null, author: m?.author ?? null, homepage: m?.homepage ?? null,
      license: m?.license ?? null, installs: p.installCount ?? null, iconUrl: null });
  }
  const markets = z.array(z.object({ name: z.string(), source: z.string().optional(),
    repo: z.string().optional(), url: z.string().optional(), path: z.string().optional() })).parse(marketData);
  const counts = new Map<string, number>();
  for (const p of plugins.values()) if (p.marketplace) counts.set(p.marketplace, (counts.get(p.marketplace) ?? 0) + 1);
  const marketplaces: Marketplace[] = markets.map(m => ({ name: m.name,
    source: displaySource(m.repo ?? m.url ?? m.path ?? m.source ?? "") || null, pluginCount: counts.get(m.name) ?? 0,
    ...(OFFICIAL_MARKETPLACES.has(m.name) ? { official: true } : {}) }));
  return { marketplaces, plugins: [...plugins.values()] };
}

/** Marketplaces Claude Code ships with; removing them is allowed but rarely wanted. */
export const OFFICIAL_MARKETPLACES = new Set(["claude-plugins-official"]);

export function filterCatalog(catalog: CatalogResult, query: string): CatalogResult {
  const needle = query.trim().toLowerCase();
  if (!needle) return catalog;
  return { marketplaces: catalog.marketplaces, plugins: catalog.plugins.filter(p =>
    [p.id, p.name, p.description, p.author, ...p.categories].some(s => s?.toLowerCase().includes(needle))) };
}
