import type { AccountUsage, RateLimits } from "../../shared/usage/types";
import type { DetectedAccount, DetectedCodexAccount } from "./accounts";
import { createCodexUsageReader } from "./codex-usage";
import { createLocalUsageReader, type LocalUsageFiles } from "./local-usage";
import { fetchClaudeRateLimits, type RateLimitOptions, usageWarningLevel } from "./rate-limits";

const RATE_LIMIT_TTL_MS = 60_000;
export type UsageAccountDetection = DetectedAccount | DetectedCodexAccount;

export interface UsageServiceOptions extends RateLimitOptions {
  localFiles?: LocalUsageFiles;
  codexFiles?: LocalUsageFiles;
  rateLimitTtlMs?: number;
}

function rateCacheKey(account: DetectedAccount): string {
  return JSON.stringify([
    account.configHome, account.credentialHome, account.keychainConfigDir, account.keychainUser, account.nonLocalOAuth,
  ]);
}

export function createUsageService(options: UsageServiceOptions = {}) {
  const now = options.now ?? Date.now;
  const ttl = options.rateLimitTtlMs ?? RATE_LIMIT_TTL_MS;
  const localReader = createLocalUsageReader(options.localFiles);
  const codexReader = createCodexUsageReader(options.codexFiles ?? options.localFiles);
  const rateCache = new Map<string, { fetchedAt: number; rateLimits: RateLimits; retryAt?: number }>();
  const inFlight = new Map<string, Promise<AccountUsage>>();

  async function loadClaude(account: DetectedAccount, key: string, at: number): Promise<AccountUsage> {
    const cached = rateCache.get(key);
    let rateLimits: RateLimits;
    const fresh = cached && at >= cached.fetchedAt && at - cached.fetchedAt < ttl;
    if (cached && (fresh || (cached.retryAt ?? 0) > at)) {
      rateLimits = cached.rateLimits;
    } else {
      let retryAt: number | undefined;
      rateLimits = await fetchClaudeRateLimits(account, options, (retry) => { retryAt = retry ?? now() + ttl; });
      rateCache.set(key, { fetchedAt: now(), rateLimits, retryAt });
    }
    const reset = rateLimits.windows.find((window) => window.kind === "five_hour")?.resetsAt;
    const local = await localReader.read(account.configHome, at, reset);
    return {
      provider: "claude",
      profileIds: account.profileIds,
      label: account.label,
      configHome: account.configHome,
      identity: account.identity,
      rateLimits,
      local,
      warningLevel: usageWarningLevel(rateLimits),
    };
  }

  async function loadCodex(account: DetectedCodexAccount, at: number): Promise<AccountUsage> {
    const { local, rateLimits } = await codexReader.read(account.configHome, at);
    return { ...account, local, rateLimits, warningLevel: usageWarningLevel(rateLimits) };
  }

  function read(account: UsageAccountDetection): Promise<AccountUsage> {
    const key = account.provider === "codex" ? `codex:${account.configHome}` : rateCacheKey(account);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const at = now();
    const load = account.provider === "codex" ? loadCodex(account, at) : loadClaude(account, key, at);
    const result = load.finally(() => inFlight.delete(key));
    inFlight.set(key, result);
    return result;
  }

  function retainAccounts(provider: AccountUsage["provider"], accounts: UsageAccountDetection[]) {
    const configHomes = accounts.map((account) => account.configHome);
    if (provider === "codex") {
      codexReader.retainAccounts(configHomes);
      return;
    }
    localReader.retainAccounts(configHomes);
    const active = new Set(accounts.filter((account) => account.provider !== "codex").map(rateCacheKey));
    for (const key of rateCache.keys()) {
      if (!active.has(key) && !inFlight.has(key)) rateCache.delete(key);
    }
  }

  return { read, retainAccounts };
}
