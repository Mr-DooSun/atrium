import { z } from "zod";
import type { AuthState, CatalogPlugin, InstalledPlugin, Marketplace, McpServer } from "../../../shared/toolbox/types";
import type { CatalogResult } from "../../core/adapter";
import { plain } from "../../core/exec.ts";

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

export function parseCatalog(data: unknown, marketData: unknown): CatalogResult {
  const { installed, available } = z.object({
    installed: installedSchema, available: z.array(z.object({
      pluginId: z.string(), name: z.string(), marketplaceName: z.string(),
      description: z.string().nullish(), source: sourceSchema.nullish(), category: z.string().nullish(),
    })),
  }).parse(data);
  const plugins = new Map<string, CatalogPlugin>();
  for (const p of parseInstalled(installed)) {
    plugins.set(p.id, { id: p.id, name: p.name, description: p.description, marketplace: p.marketplace,
      source: null, categories: [], installed: true });
  }
  for (const p of available) {
    const s = p.source;
    const source = typeof s === "string" ? s : s?.url ?? s?.repo ?? s?.package ?? s?.path ?? s?.source;
    plugins.set(p.pluginId, { id: p.pluginId, name: p.name, description: p.description ?? null,
      marketplace: p.marketplaceName, source: source ? displaySource(source) : null,
      categories: p.category ? [p.category] : [], installed: plugins.get(p.pluginId)?.installed ?? false });
  }
  const markets = z.array(z.object({ name: z.string(), source: z.string().optional(),
    repo: z.string().optional(), url: z.string().optional(), path: z.string().optional() })).parse(marketData);
  const counts = new Map<string, number>();
  for (const p of plugins.values()) if (p.marketplace) counts.set(p.marketplace, (counts.get(p.marketplace) ?? 0) + 1);
  const marketplaces: Marketplace[] = markets.map(m => ({ name: m.name,
    source: displaySource(m.repo ?? m.url ?? m.path ?? m.source ?? "") || null, pluginCount: counts.get(m.name) ?? 0 }));
  return { marketplaces, plugins: [...plugins.values()] };
}

export function filterCatalog(catalog: CatalogResult, query: string): CatalogResult {
  const needle = query.trim().toLowerCase();
  if (!needle) return catalog;
  return { marketplaces: catalog.marketplaces, plugins: catalog.plugins.filter(p =>
    [p.id, p.name, p.description].some(s => s?.toLowerCase().includes(needle))) };
}
