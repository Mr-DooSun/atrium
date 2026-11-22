import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import type { RateLimits, RateLimitWindow, WarningLevel } from "../../shared/usage/types";
import { run } from "../core/exec";
import type { DetectedAccount } from "./accounts";
import { asRecord, nonemptyString, parseJson } from "./json";

export const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const OAUTH_USAGE_BETA = "oauth-2025-04-20";
const REQUEST_TIMEOUT_MS = 8_000;

type Credential =
  | { state: "ok"; accessToken: string; expiresAt?: number }
  | { state: "expired"; expiresAt: string }
  | { state: "unauthenticated" | "unavailable" | "error" };

export type UsageFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json"> & { headers?: Pick<Headers, "get"> }>;

export interface RateLimitOptions {
  platform?: NodeJS.Platform;
  readKeychain?: (service: string, username: string) => Promise<string | null>;
  readFile?: (file: string) => Promise<string>;
  fetch?: UsageFetch;
  now?: () => number;
}

export function claudeKeychainService(configDir?: string): string {
  const service = "Claude Code-credentials";
  if (!configDir) return service;
  const suffix = createHash("sha256").update(configDir.normalize("NFC")).digest("hex").slice(0, 8);
  return `${service}-${suffix}`;
}

function keychainUsername(configuredUser?: string): string {
  let username: string;
  try {
    username = configuredUser || userInfo().username;
  } catch {
    username = "";
  }
  return /^[a-zA-Z0-9._-]+$/.test(username) ? username : "claude-code-user";
}

async function readMacKeychain(service: string, username: string): Promise<string | null> {
  const result = await run("/usr/bin/security", ["find-generic-password", "-a", username, "-w", "-s", service], {
    timeoutMs: 5_000,
    maxOutputBytes: 64 * 1024,
  });
  if (result.code === 0 && !result.truncated) return result.stdout;
  if (result.code === 44 && !result.stderr.includes("SecKeychainSearchCreateFromAttributes")) return null;
  throw new Error("Claude Keychain lookup failed");
}

export function parseClaudeCredentials(text: string | null, now = Date.now()): Credential {
  if (!text) return { state: "unauthenticated" };
  const record = asRecord(parseJson(text));
  if (!record) return { state: "error" };
  if (!("claudeAiOauth" in record)) return { state: "unauthenticated" };
  const oauth = asRecord(record.claudeAiOauth);
  const accessToken = nonemptyString(oauth?.accessToken);
  if (!accessToken) return { state: "unauthenticated" };
  const expiry = oauth?.expiresAt;
  const time = typeof expiry === "number" ? new Date(expiry).getTime() : NaN;
  const expiresAt = Number.isFinite(time) ? time : undefined;
  if (expiresAt !== undefined && expiresAt <= now) {
    return { state: "expired", expiresAt: new Date(expiresAt).toISOString() };
  }
  return { state: "ok", accessToken, expiresAt };
}

async function readCredentials(account: DetectedAccount, options: RateLimitOptions): Promise<Credential> {
  const now = options.now ?? Date.now;
  if ((options.platform ?? process.platform) === "darwin") {
    const read = options.readKeychain ?? readMacKeychain;
    try {
      const service = claudeKeychainService(account.keychainConfigDir);
      const raw = await read(service, keychainUsername(account.keychainUser));
      return parseClaudeCredentials(raw, now());
    } catch {
      return { state: "unavailable" };
    }
  }
  const read = options.readFile ?? ((file) => readFile(file, "utf8"));
  try {
    return parseClaudeCredentials(await read(join(account.credentialHome, ".credentials.json")), now());
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return { state: code === "ENOENT" || code === "ENOTDIR" ? "unauthenticated" : "unavailable" };
  }
}

function resetTime(value: unknown): string | null {
  let time = NaN;
  if (typeof value === "string") time = Date.parse(value);
  if (typeof value === "number") time = new Date(value * 1_000).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function limitWindow(
  value: unknown,
  id: string,
  kind: RateLimitWindow["kind"],
  model?: string,
): RateLimitWindow | undefined {
  const limit = asRecord(value);
  const raw = limit?.utilization ?? limit?.percent;
  const utilization = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  if (typeof utilization !== "number" || !Number.isFinite(utilization) || utilization < 0) return;
  const lockedReason = nonemptyString(limit?.locked_reason);
  const limited = utilization >= 100 || limit?.status === "rejected" || lockedReason !== undefined;
  return { id, kind, model, utilization, resetsAt: resetTime(limit?.resets_at), limited };
}

function modelId(name: string): string {
  return "model:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function parseRateLimits(value: unknown): RateLimits {
  const response = asRecord(value);
  if (!response) return emptyRateLimits("error", "Usage response was unreadable. Refresh to try again.");
  const windows = new Map<string, RateLimitWindow>();
  for (const [key, raw] of Object.entries(response)) {
    if (key === "five_hour" || key === "seven_day") {
      const window = limitWindow(raw, key, key);
      if (window) windows.set(key, window);
    } else if (/^seven_day_[a-z0-9_]+$/.test(key) && key !== "seven_day_oauth_apps") {
      const model = key === "seven_day_overage_included" ? "overage_included" : key.slice("seven_day_".length);
      const id = modelId(model);
      const window = limitWindow(raw, id, "model_weekly", model);
      if (window) windows.set(id, window);
    }
  }
  const scopedLimits = Array.isArray(response.limits) ? response.limits : [];
  for (const raw of scopedLimits) {
    const limit = asRecord(raw);
    if (limit?.kind === "session" || limit?.kind === "weekly_all") {
      const id = limit.kind === "session" ? "five_hour" : "seven_day";
      const window = limitWindow(limit, id, id);
      if (window && !windows.has(id)) windows.set(id, window);
    } else if (limit?.kind === "weekly_scoped") {
      const scope = asRecord(asRecord(limit.scope)?.model);
      const scopeId = nonemptyString(scope?.id);
      const model = nonemptyString(scope?.display_name) ?? scopeId;
      if (!model) continue;
      const legacyId = modelId(model);
      const id = scopeId ? modelId(scopeId) : legacyId;
      const window = limitWindow(limit, id, "model_weekly", model);
      if (window) {
        const legacy = windows.get(legacyId);
        windows.delete(legacyId);
        windows.set(id, { ...window, resetsAt: window.resetsAt ?? legacy?.resetsAt ?? null });
      }
    }
  }
  // The API can return null for every window on a plan with no available usage meters.
  if (windows.size === 0) return emptyRateLimits("unavailable", "No subscription quota is reported for this login. Check the plan in Claude.");
  const models = [...windows.values()].filter((window) => window.kind === "model_weekly");
  const primary = [windows.get("five_hour"), windows.get("seven_day")].filter((window) => window !== undefined);
  return { state: "ok", windows: [...primary, ...models] };
}

function emptyRateLimits(state: Exclude<RateLimits["state"], "ok">, message: string): RateLimits {
  return { state, windows: [], message };
}

export function retryAfterTime(value: string | null | undefined, now: number): number | undefined {
  if (!value?.trim()) return;
  const seconds = Number(value);
  const time = Number.isFinite(seconds) ? now + seconds * 1_000 : Date.parse(value);
  if (Number.isFinite(time) && time > now) return time;
}

export async function fetchClaudeRateLimits(
  account: DetectedAccount,
  options: RateLimitOptions = {},
  onThrottle?: (retryAt?: number) => void,
): Promise<RateLimits> {
  if (account.nonLocalOAuth) {
    return emptyRateLimits("unavailable", "Subscription quota is unavailable for API or gateway logins. Check your provider's billing.");
  }
  const credential = await readCredentials(account, options);
  switch (credential.state) {
    case "unauthenticated":
      return emptyRateLimits("unauthenticated", "Run claude auth login for this profile, then refresh.");
    case "expired":
      return { ...emptyRateLimits("expired", "Run claude auth login again for this profile, then refresh."), expiresAt: credential.expiresAt };
    case "unavailable":
      return emptyRateLimits("error", "Open this profile's Claude CLI to check login access, then refresh.");
    case "error":
      return emptyRateLimits("error", "Run claude auth login again for this profile, then refresh.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const fetchUsage = options.fetch ?? fetch;
    const response = await fetchUsage(OAUTH_USAGE_URL, {
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        "anthropic-beta": OAUTH_USAGE_BETA,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return { ...emptyRateLimits("unauthenticated", "Run claude auth login again for this profile, then refresh."), rejectedStatus: response.status };
    }
    if (response.status === 429) {
      onThrottle?.(retryAfterTime(response.headers?.get("retry-after"), (options.now ?? Date.now)()));
      return emptyRateLimits("error", "Usage refresh is rate-limited. Wait before refreshing again.");
    }
    if (!response.ok) return emptyRateLimits("error", "Usage service is unavailable. Check your connection and retry.");
    return parseRateLimits(await response.json());
  } catch {
    return emptyRateLimits("error", "Usage could not be refreshed. Check your connection and retry.");
  } finally {
    clearTimeout(timeout);
  }
}

export function usageWarningLevel(rateLimits: RateLimits): WarningLevel {
  if (rateLimits.state !== "ok" || rateLimits.windows.length === 0) return "unknown";
  if (rateLimits.windows.some((window) => window.limited)) return "limited";
  const highest = Math.max(...rateLimits.windows.map((window) => window.utilization));
  if (highest >= 95) return "critical";
  if (highest >= 80) return "warn";
  return "ok";
}
