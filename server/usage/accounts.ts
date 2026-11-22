import { readFile, realpath } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AccountIdentity } from "../../shared/usage/types";
import type { ResolvedProfile } from "../core/profiles";
import { asRecord, nonemptyString, parseJson } from "./json";

type UsageProfile = {
  profile: Pick<ResolvedProfile["profile"], "id" | "label" | "kind">;
  runtime: Pick<ResolvedProfile["runtime"], "configHome"> & { env?: Record<string, string> };
};

export interface DetectedAccount {
  provider?: "claude";
  profileIds: string[];
  label: string;
  configHome: string;
  credentialHome: string;
  /** Claude Code hashes the configured value, before filesystem canonicalization. */
  keychainConfigDir?: string;
  keychainUser?: string;
  nonLocalOAuth?: boolean;
  identity?: AccountIdentity;
  /** Hashed, provider-scoped quota identity; absent when local metadata cannot prove it. */
  quotaIdentity?: string;
}

export interface DetectedCodexAccount {
  provider: "codex";
  profileIds: string[];
  label: string;
  configHome: string;
  identity?: AccountIdentity;
  /** Hashed, provider-scoped quota identity; absent when local metadata cannot prove it. */
  quotaIdentity?: string;
}

export interface AccountDetectionOptions {
  home?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (file: string) => Promise<string>;
  realpath?: (directory: string) => Promise<string>;
  /** Canonical homes already covered by a built-in usage source. */
  excludeConfigHomes?: ReadonlySet<string>;
}

function quotaIdentity(provider: string, ...ids: unknown[]): string | undefined {
  if (!ids.every((id) => typeof id === "string" && id.trim().length > 0)) return;
  return createHash("sha256").update(JSON.stringify([provider, ...ids])).digest("hex");
}

export function parseAccountIdentity(value: unknown): AccountIdentity | undefined {
  const account = asRecord(asRecord(value)?.oauthAccount);
  if (!account) return;
  const email = nonemptyString(account.emailAddress) ?? nonemptyString(account.email);
  const organization = nonemptyString(account.organizationName)
    ?? nonemptyString(account.organizationUuid);
  const subscriptionType = nonemptyString(account.subscriptionType)
    ?? nonemptyString(account.planDisplayName)
    ?? nonemptyString(account.seatTier);
  if (email || organization || subscriptionType) return { email, organization, subscriptionType };
}

export function absoluteHome(directory: string, home: string, cwd: string): string {
  if (directory === "~") return home;
  if (directory.startsWith("~/")) return resolve(home, directory.slice(2));
  return resolve(cwd, directory);
}

function usesExternalAuthentication(env: NodeJS.ProcessEnv): boolean {
  const baseUrl = env.ANTHROPIC_BASE_URL?.replace(/\/+$/, "");
  const gateways = [env.CLAUDE_CODE_USE_BEDROCK, env.CLAUDE_CODE_USE_VERTEX, env.CLAUDE_CODE_USE_FOUNDRY];
  return Boolean(
    (baseUrl && baseUrl !== "https://api.anthropic.com") ||
    env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.CLAUDE_CODE_OAUTH_TOKEN ||
    gateways.some((flag) => /^(1|true|yes|on)$/i.test(flag ?? "")),
  );
}

export async function detectClaudeAccounts(
  profiles: readonly UsageProfile[],
  options: AccountDetectionOptions = {},
): Promise<DetectedAccount[]> {
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const read = options.readFile ?? ((file) => readFile(file, "utf8"));
  const canonicalize = options.realpath ?? realpath;
  const defaultHome = join(home, ".claude");
  const accounts = new Map<string, DetectedAccount>();
  for (const { profile, runtime } of profiles) {
    if (profile.kind !== "claude") continue;
    const profileEnv = { ...env, ...runtime.env };
    const configDir = runtime.configHome ?? profileEnv.CLAUDE_CONFIG_DIR;
    const secureDir = profileEnv.CLAUDE_SECURESTORAGE_CONFIG_DIR;
    const keychainConfigDir = (secureDir ?? configDir)?.normalize("NFC") || undefined;
    const configHome = absoluteHome((configDir || defaultHome).normalize("NFC"), home, cwd);
    const credentialHome = absoluteHome(keychainConfigDir || defaultHome, home, cwd);
    const nonLocalOAuth = usesExternalAuthentication(profileEnv);
    const key = await canonicalize(configHome).catch(() => configHome);
    if (options.excludeConfigHomes?.has(key)) continue;
    const existing = accounts.get(key);
    if (existing && (!existing.nonLocalOAuth || nonLocalOAuth)) {
      existing.profileIds.push(profile.id);
      continue;
    }
    const account: DetectedAccount = {
      provider: "claude",
      profileIds: [...(existing?.profileIds ?? []), profile.id],
      label: profile.label,
      configHome,
      credentialHome,
      keychainConfigDir,
      keychainUser: profileEnv.USER,
      nonLocalOAuth,
    };
    // Claude's global account state can name a different login when the secure store is overridden.
    if (!nonLocalOAuth && (secureDir === undefined || (secureDir || undefined) === (configDir || undefined))) {
      const files = [join(configHome, ".claude.json")];
      if (!configDir) files.push(join(home, ".claude.json"));
      for (const file of files) {
        const state = await read(file).then(parseJson).catch(() => undefined);
        const oauth = asRecord(asRecord(state)?.oauthAccount);
        const identity = parseAccountIdentity(state);
        account.quotaIdentity = quotaIdentity("claude", oauth?.accountUuid, oauth?.organizationUuid);
        if (identity) account.identity = identity;
        if (identity || account.quotaIdentity) break;
      }
    }
    accounts.set(key, account);
  }
  return [...accounts.values()];
}

function readJwtClaims(token: unknown): Record<string, unknown> | undefined {
  if (typeof token !== "string") return;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return;
  return asRecord(parseJson(Buffer.from(parts[1], "base64url").toString("utf8")));
}

/** Read display claims from local tokens without using them as authentication. */
export function parseCodexIdentity(value: unknown): AccountIdentity | undefined {
  const tokens = asRecord(asRecord(value)?.tokens);
  const access = readJwtClaims(tokens?.access_token);
  const claims = readJwtClaims(tokens?.id_token);
  const auth = asRecord(claims?.["https://api.openai.com/auth"]);
  const profileKey = "https://api.openai.com/profile";
  const email = nonemptyString(asRecord(access?.[profileKey])?.email) ?? nonemptyString(access?.email)
    ?? nonemptyString(asRecord(claims?.[profileKey])?.email) ?? nonemptyString(claims?.email);
  const subscriptionType = nonemptyString(auth?.chatgpt_plan_type);
  if (email || subscriptionType) return { email, subscriptionType };
}

export async function detectCodexAccounts(
  profiles: readonly UsageProfile[],
  options: AccountDetectionOptions = {},
): Promise<DetectedCodexAccount[]> {
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const read = options.readFile ?? ((file) => readFile(file, "utf8"));
  const canonicalize = options.realpath ?? realpath;
  const accounts = new Map<string, DetectedCodexAccount>();
  for (const { profile, runtime } of profiles) {
    if (profile.kind !== "codex") continue;
    const configDir = runtime.configHome ?? runtime.env?.CODEX_HOME ?? env.CODEX_HOME;
    const configHome = absoluteHome(configDir || join(home, ".codex"), home, cwd);
    const key = await canonicalize(configHome).catch(() => configHome);
    if (options.excludeConfigHomes?.has(key)) continue;
    const existing = accounts.get(key);
    if (existing) {
      existing.profileIds.push(profile.id);
      continue;
    }
    const state = await read(join(configHome, "auth.json")).then(parseJson).catch(() => undefined);
    const tokens = asRecord(asRecord(state)?.tokens);
    const claims = readJwtClaims(tokens?.id_token);
    const auth = asRecord(claims?.["https://api.openai.com/auth"]);
    const accountId = nonemptyString(tokens?.account_id) ?? nonemptyString(auth?.chatgpt_account_id);
    // Team workspace ids can be shared by several users; keep their quota identities apart.
    const userId = nonemptyString(auth?.chatgpt_user_id) ?? nonemptyString(claims?.sub);
    const identity = parseCodexIdentity(state);
    accounts.set(key, {
      provider: "codex", profileIds: [profile.id], label: profile.label, configHome, identity,
      quotaIdentity: quotaIdentity("codex", accountId, userId),
    });
  }
  return [...accounts.values()];
}
