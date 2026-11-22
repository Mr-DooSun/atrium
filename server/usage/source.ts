import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  hashAccountKey, unavailable, windowFromReportedDuration, windowFromUsedPct,
  type UsageDetail, type UsageReport, type UsageSourceRegistration, type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import { z } from "zod";
import type { AccountUsage, RateLimitWindow, TokenTotals } from "../../shared/usage/types";
import { antigravityAdapter } from "../adapters/antigravity";
import { claudeAdapter } from "../adapters/claude";
import { codexAdapter } from "../adapters/codex";
import { resolveConfiguredProfiles, type ResolvedProfile } from "../core/profiles";
import { absoluteHome, detectClaudeAccounts, detectCodexAccounts, type AccountDetectionOptions } from "./accounts";
import { usageWarningLevel } from "./rate-limits";
import { createUsageService, type UsageServiceOptions } from "./service";

const adapters = { claude: claudeAdapter, codex: codexAdapter, antigravity: antigravityAdapter };
const providers = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
] as const;

function usageSourceId(provider: AccountUsage["provider"]): string {
  return `${provider}-profiles`;
}

type AccountLabel = { label: string; profileIds: string[] };

export function usageAccountLabel(_provider: AccountUsage["provider"], account: AccountLabel, accounts: readonly AccountLabel[]): string {
  // Profile labels are user-owned names: retain the provider prefix and punctuation.
  const labelOf = (entry: AccountLabel) => entry.label.trim() || entry.profileIds[0];
  const label = labelOf(account);
  return accounts.filter((entry) => labelOf(entry) === label).length > 1 ? `${label} · ${account.profileIds[0]}` : label;
}

export async function builtinUsageHomes(provider: AccountUsage["provider"], detection: AccountDetectionOptions = {}) {
  const home = detection.home ?? homedir();
  const cwd = detection.cwd ?? process.cwd();
  const env = detection.env ?? process.env;
  const envKey = provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  const resolveHome = detection.realpath ?? realpath;
  const paths = [join(home, `.${provider}`)];
  const override = env[envKey];
  if (override) paths.push(absoluteHome(override, home, cwd));
  return new Set(await Promise.all(paths.map((path) => resolveHome(path).catch(() => path))));
}

export const usageSourceInput = z.object({
  provider: z.enum(["claude", "codex"]),
  configHome: z.string().refine((value) => isAbsolute(value) && !value.includes("\0")),
}).strict();

export interface UsageSourceOptions extends UsageServiceOptions {
  detection?: AccountDetectionOptions;
  loadProfiles?: () => Promise<ResolvedProfile[]>;
}

function compactTotal(totals: TokenTotals, provider: AccountUsage["provider"]): string {
  const cached = provider === "claude" ? totals.cacheCreationInputTokens + totals.cacheReadInputTokens : 0;
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
    .format(totals.inputTokens + totals.outputTokens + cached);
}

function usageDetails(account: AccountUsage): UsageDetail[] {
  const { identity, local, rateLimits } = account;
  const details: UsageDetail[] = [{ id: "profile", label: "Profile", value: account.label.trim() || account.profileIds[0] }];
  if (identity?.email) details.push({ id: "email", label: "Email", value: identity.email });
  if (local.state !== "unavailable") {
    const periods = [
      { id: "tokens-5h", label: "Tokens (5h)", totals: local.fiveHour },
      { id: "tokens-today", label: "Tokens (today)", totals: local.today },
      { id: "tokens-7d", label: "Tokens (7d)", totals: local.sevenDay },
    ];
    for (const { id, label, totals } of periods) {
      const total = compactTotal(totals, account.provider);
      details.push({ id, label, value: local.state === "partial" ? `${total} (partial)` : total });
    }
  }
  if (account.provider === "codex" && rateLimits.observedAt) {
    const observed = new Date(rateLimits.observedAt);
    const value = new Intl.DateTimeFormat("en", {
      dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
    }).format(observed);
    details.push({ id: "observed-at", label: "As of (UTC)", value });
  }
  return details;
}

// Extra fields are additive on 0.17.1. Attach them after calling the helpers because
// 0.16.1's helper implementations discard durationSeconds.
type TimedUsageWindow = UsageWindow & { durationSeconds?: number };

function toUsageWindow(window: RateLimitWindow): TimedUsageWindow {
  const durationSeconds = window.windowMinutes !== undefined ? window.windowMinutes * 60
    : window.kind === "five_hour" ? 5 * 3600
    : window.kind === "seven_day" || window.kind === "model_weekly" ? 7 * 86400 : undefined;
  const converted = convertUsageWindow(window);
  return durationSeconds === undefined ? converted : { ...converted, durationSeconds };
}

function convertUsageWindow(window: RateLimitWindow): UsageWindow {
  const warning = usageWarningLevel({ state: "ok", windows: [window] });
  const common = {
    utilizationPct: window.utilization,
    resetsAt: window.resetsAt,
    summary: window.kind === "five_hour" || window.kind === "seven_day",
    tone: warning === "critical" || warning === "limited" ? "danger" : warning === "warn" ? "warning" : "ok",
  } as const;
  if (window.windowMinutes !== undefined) {
    return windowFromReportedDuration({
      ...common,
      durationSeconds: window.windowMinutes * 60,
      unknown: { id: "rolling", label: "Rolling", shortLabel: "" },
    });
  }
  switch (window.kind) {
    case "five_hour":
      return windowFromUsedPct({ ...common, id: "five_hour", label: "5-hour", shortLabel: "5h" });
    case "seven_day":
      return windowFromUsedPct({ ...common, id: "weekly", label: "Weekly", shortLabel: "wk" });
    case "model_weekly": {
      const model = window.model?.replace(/^./, (letter) => letter.toUpperCase());
      return windowFromUsedPct({ ...common, id: window.id, label: model ? `${model} · Weekly` : "Model weekly", shortLabel: model });
    }
    case "custom":
      return windowFromUsedPct({ ...common, id: window.id, label: "Rolling" });
  }
}

export function toUsageReport(account: AccountUsage): UsageReport & { observedAt?: string } {
  const limits = account.rateLimits;
  if (limits.rejectedStatus !== undefined) {
    return unavailable({ kind: "rejected", status: limits.rejectedStatus, refreshedBy: account.provider });
  }
  if (limits.state === "expired" && limits.expiresAt) {
    return unavailable({ kind: "expired", expiresAt: limits.expiresAt, refreshedBy: account.provider });
  }
  if (limits.state === "unavailable" || limits.state === "unauthenticated") {
    return unavailable({ kind: "no_quota", detail: limits.message ?? "Check this profile's CLI login and subscription, then refresh." });
  }
  if (limits.state !== "ok") return { status: "error", error: limits.message ?? "Usage could not be refreshed. Try again shortly." };
  return {
    status: "available",
    planLabel: account.identity?.subscriptionType,
    ...(limits.observedAt ? { observedAt: limits.observedAt } : {}),
    windows: [...new Map(limits.windows.map(toUsageWindow).map((window) => [window.id, window])).values()],
    details: usageDetails(account),
  };
}

async function readConfiguredProfiles(home: string, cwd: string, env: NodeJS.ProcessEnv): Promise<ResolvedProfile[]> {
  const paseoHome = absoluteHome(env.PASEO_HOME || join(home, ".paseo"), home, cwd);
  try {
    const config: unknown = JSON.parse(await readFile(join(paseoHome, "config.json"), "utf8"));
    return resolveConfiguredProfiles(config, adapters);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return [];
    throw new Error("Check the provider configuration in Paseo, then refresh usage.");
  }
}

export function createUsageSources(options: UsageSourceOptions = {}): UsageSourceRegistration[] {
  const home = options.detection?.home ?? homedir();
  const cwd = options.detection?.cwd ?? process.cwd();
  const env = options.detection?.env ?? process.env;
  const resolveHome = options.detection?.realpath ?? realpath;
  const canonical = (path: string) => resolveHome(path).catch(() => path);
  const loadProfiles = options.loadProfiles ?? (() => readConfiguredProfiles(home, cwd, env));
  const usage = createUsageService(options);

  return providers.map(({ id: provider, label }) => {
    async function detect() {
      const excludeConfigHomes = await builtinUsageHomes(provider, options.detection);
      const detection = { ...options.detection, excludeConfigHomes };
      const profiles = await loadProfiles();
      const detectAccounts = provider === "claude" ? detectClaudeAccounts : detectCodexAccounts;
      const accounts = await detectAccounts(profiles, detection);
      if (!accounts.length) return accounts;
      // Default routes may not occur in the configured profiles. Read their local identity
      // too, so copying a login to another home does not add a second quota card.
      const envKey = provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
      const defaultEnv = { ...env };
      delete defaultEnv[envKey];
      const builtinProfiles = [{
        profile: { id: provider, label, kind: provider }, runtime: { configHome: null },
      }];
      const defaults = (await Promise.all([
        detectAccounts(builtinProfiles, { ...options.detection, env: defaultEnv }),
        detectAccounts(builtinProfiles, options.detection),
      ])).flat();
      const covered = new Set(defaults.flatMap((account) => account.quotaIdentity ? [account.quotaIdentity] : []));
      const unique = new Map<string, (typeof accounts)[number]>();
      for (const account of accounts) {
        const identity = account.quotaIdentity;
        if (identity && covered.has(identity)) continue;
        const key = identity ?? await canonical(account.configHome);
        const existing = unique.get(key);
        if (existing) existing.profileIds.push(...account.profileIds);
        else unique.set(key, account);
      }
      return [...unique.values()];
    }

    return {
      id: usageSourceId(provider),
      // Native cards use this fixed source label as their title and default sort key.
      // A suffix places additional profiles after the provider's default source; user order wins.
      label: `${label} profiles`,
      icon: `server/usage/${provider}.svg`,
      input: usageSourceInput,
      async discover(scope) {
        if (scope.kind !== "global") return [];
        const accounts = await detect();
        usage.retainAccounts(provider, accounts);
        return Promise.all(accounts.map(async (account) => ({
          key: hashAccountKey(JSON.stringify(account.quotaIdentity
            ? [provider, "account", account.quotaIdentity] : [provider, await canonical(account.configHome)])),
          label: usageAccountLabel(provider, account, accounts),
          harness: usageAccountLabel(provider, account, accounts),
          input: { provider, configHome: account.configHome },
        })));
      },
      async fetch(value) {
        const input = usageSourceInput.safeParse(value);
        if (!input.success || input.data.provider !== provider) {
          return { status: "error", error: "Refresh the usage panel and choose this profile again." };
        }
        try {
          // Resolve the configured route again; the locator cannot select arbitrary credential files.
          const account = (await detect()).find((entry) => entry.configHome === input.data.configHome);
          if (!account) return { status: "error", error: "This profile was removed. Refresh the usage panel." };
          return toUsageReport(await usage.read(account));
        } catch {
          return { status: "error", error: "Check this profile's configuration and CLI login, then refresh." };
        }
      },
    };
  });
}
